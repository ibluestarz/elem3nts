import { DurableObject } from 'cloudflare:workers';
import type { PlayerIndex } from '../domain/index.ts';
import {
  AUTH_TIMEOUT_MS,
  SOCKET_CLOSE_CODES,
  ackMessage,
  authorizeCommand,
  encodeServerMessage,
  errorMessage,
  parseClientMessage,
  pongMessage,
  projectState,
  roomClosedMessage,
  type ClientCommand,
  type CloseReason,
  type ErrorCode,
  type ServerMessage,
  type SocketCloseCode,
} from '../shared/protocol/index.ts';
import type { PersistedRoom } from './codec.ts';
import type { Env } from './env.ts';
import { RoomStorageError } from './errors.ts';
import { dueClosure, nextClosureDeadline } from './expiry.ts';
import {
  advanceGame,
  applyCommand,
  closeRoom,
  findReply,
  isReplayable,
  nextGameDeadline,
  withReply,
  type ReplayableCommand,
} from './game.ts';
import { jsonError } from './http.ts';
import { nextReservationDeadline, openRoom, reserveGuest, settleReservations } from './reservations.ts';
import { claimSeat, findSeat, leaveSeat } from './seats.ts';
import { RETIRED, freshBudget, spend, type Budget, type Connection } from './sockets.ts';
import { RoomStore } from './storage.ts';
import { hashResumeToken } from './tokens.ts';

/** Issue d'une création : `collision` si le code porte déjà une room, même illisible (jamais écrasée). */
export type CreateOutcome = { readonly kind: 'created' } | { readonly kind: 'collision' };

/** Issue d'une réservation de J2 ; `absent` couvre room inconnue, expirée ou fermée. */
export type JoinOutcome =
  | { readonly kind: 'reserved' }
  | { readonly kind: 'full' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unavailable' };

/** Fermeture sur erreur interne (RFC 6455) : aucune donnée, la place reste reprenable. */
const INTERNAL_ERROR_CLOSE = 1011;

/** Socket acceptée par cette instance : son identité, son budget et sa file de trames. */
interface Link {
  connection: Connection;
  readonly budget: Budget;
  /** Trames traitées une à une, dans l'ordre d'arrivée, même quand l'une attend (empreinte du token). */
  queue: Promise<void>;
}

/**
 * Durable Object SQLite d'une room : unique autorité de ses deux places. L'état en mémoire n'est
 * qu'une copie de la ligne persistée : il est relu à chaque reconstruction de l'objet (réveil,
 * éviction, redéploiement) et remplacé seulement après une écriture réussie.
 *
 * Création et réservation (PFC-012) : le Worker transmet seulement l'empreinte du token. Chaque
 * décision (échéances dues, contrôle des places, écriture) s'exécute sans aucun `await` avant le
 * `commit` : deux arrivées concurrentes sont sérialisées et une place n'est jamais accordée deux fois.
 * Seuls la replanification de l'alarme et l'effacement d'une room fermée suivent l'écriture ; les
 * portes d'entrée du Durable Object retiennent tout autre événement pendant ces opérations.
 *
 * WebSocket (PFC-013, D37) : sockets standard, tenues en mémoire (`#links`) et fermées par le runtime
 * si l'instance disparaît. Une socket doit s'authentifier en 5 s ; sa place vient de l'empreinte du
 * token (`seats.ts`). Une nouvelle socket de la même place retire l'ancienne. L'échéance
 * d'authentification est portée par l'alarme unique de la room et revérifiée à chaque trame.
 *
 * Jeu (PFC-014, `game.ts`) : chaque commande de jeu autorisée devient une transition persistée, puis
 * publiée (`state` par place), puis acquittée. Sa réponse est mémorisée dans le même `commit` : un
 * doublon de `requestId` reçoit le même `ack` sans nouvel effet. Les échéances de jeu (ouverture,
 * sélection, résultat) sont portées par la même alarme unique et traitées, comme les réservations,
 * avant toute commande : une alarme répétée, en retard ou après reconstruction ne rejoue rien.
 *
 * Absence et reprise (PFC-017, D15) : une place sans socket courante devient absente (fermeture, ou
 * sockets perdues avec une instance précédente, réconciliées au premier événement). Une phase
 * chronométrée est alors mise en pause avec son temps restant ; le délai de reconnexion (30 s, depuis
 * la première absence) est porté par la même alarme. Le retour de toutes les places reprend la phase ;
 * à l'échéance, la room est fermée sans trophée (`room-closed {reconnect-timeout}`) et effacée.
 *
 * Fin de vie (PFC-018, D16/D17, `expiry.ts`) : toute room ouverte porte aussi ses échéances d'inactivité
 * (30 min sans activité utile) et de durée maximale (4 h depuis sa création, pause comprise), sous la même
 * alarme : une instance perdue sans client de retour est donc toujours réveillée puis fermée. Même
 * fermeture que le délai de reconnexion, avec son motif (`inactive`, `max-duration`) ; aucun trophée.
 */
export class Room extends DurableObject<Env> {
  readonly #store: RoomStore;
  #state: PersistedRoom | null = null;
  /** Vrai si l'état persisté est illisible (schéma plus récent, altération) : la room ne sert plus rien. */
  #unavailable = false;
  /** Sockets vivantes de cette instance, jusqu'à leur événement `close`. */
  readonly #links = new Map<WebSocket, Link>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#store = new RoomStore(ctx.storage);
    try {
      this.#state = this.#store.load();
    } catch (error) {
      if (!(error instanceof RoomStorageError)) throw error;
      // Échec fermé : aucune donnée n'est relue ni réécrite ; la ligne reste en place pour analyse.
      this.#unavailable = true;
    }
  }

  /** État durable courant ; `null` si la room n'a jamais été écrite. */
  protected get current(): PersistedRoom | null {
    this.#assertAvailable();
    return this.#state;
  }

  /**
   * Point de linéarisation : persiste `next` (révision strictement croissante, fondée sur l'état
   * courant), puis seulement ensuite le rend visible en mémoire. En cas d'échec, rien ne change :
   * l'appelant ne publie aucun résultat non enregistré (ARCHITECTURE « État et atomicité »).
   */
  protected commit(next: PersistedRoom): PersistedRoom {
    this.#assertAvailable();
    this.#state = this.#store.save(next, this.#state?.revision ?? null);
    return this.#state;
  }

  /** Horloge serveur, seule source des échéances (le harnais de test la fige ; jamais la production). */
  protected now(): number {
    return Date.now();
  }

  /** Crée la room sous ce code et réserve J1 (`POST /api/rooms`). */
  async create(roomCode: string, hostTokenHash: string): Promise<CreateOutcome> {
    if (this.#unavailable || this.#state !== null) return { kind: 'collision' };
    this.commit(openRoom(roomCode, hostTokenHash, this.now()));
    await this.#scheduleAlarm();
    return { kind: 'created' };
  }

  /**
   * Réserve J2 (`POST /api/rooms/:code/join`). Les échéances dues passent avant la demande : une
   * réservation échue à cet instant est libérée, une room dont J1 ne s'est jamais connecté est
   * fermée et n'est jamais recréée.
   */
  async join(guestTokenHash: string): Promise<JoinOutcome> {
    if (this.#unavailable) return { kind: 'unavailable' };
    const now = this.now();
    const settled = this.#settle(now);
    const room = this.#state;
    if (room === null) {
      if (settled === 'closed') await this.#erase();
      return { kind: 'absent' };
    }
    const reservation = reserveGuest(room, guestTokenHash, now);
    if (reservation.kind === 'reserved') this.commit(reservation.room);
    if (settled === 'changed' || reservation.kind === 'reserved') await this.#scheduleAlarm();
    return reservation.kind === 'reserved' ? { kind: 'reserved' } : reservation;
  }

  /**
   * Alarme unique : ferme les sockets non authentifiées échues, traite les réservations et l'échéance
   * de jeu dues, puis se replanifie ou efface la room. Idempotente. Une écriture refusée lève : rien
   * n'est publié et le runtime relance l'alarme.
   */
  override async alarm(): Promise<void> {
    const now = this.now();
    for (const [ws, link] of this.#links) {
      if (link.connection.kind === 'pending' && link.connection.authDeadline <= now) {
        this.#retire(ws, SOCKET_CLOSE_CODES.AUTH_TIMEOUT);
      }
    }
    if (this.#unavailable || this.#state === null) return;
    if (this.#settle(now) === 'closed') await this.#erase();
    else await this.#scheduleAlarm();
  }

  /**
   * `GET /api/rooms/:code/ws`, déjà filtré par le Worker (méthode, upgrade, Origin, code). La socket
   * est toujours acceptée, pour que le client lise la raison d'un refus : room absente, fermée ou
   * illisible → `ROOM_UNAVAILABLE` puis fermeture 4404. Sinon, elle attend son `authenticate` et
   * ne reçoit rien d'autre avant. Sans upgrade : aucune route (JSON 404, 503 si illisible).
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return jsonError(this.#unavailable ? 'ROOM_UNAVAILABLE' : 'NOT_FOUND');
    }
    const now = this.now();
    if (this.#settle(now) === 'closed') await this.#erase();
    const { 0: client, 1: server } = new WebSocketPair();
    server.accept();
    if (this.#openRoom() === null) {
      this.#send(server, errorMessage('ROOM_UNAVAILABLE'));
      server.close(SOCKET_CLOSE_CODES.ROOM_UNAVAILABLE);
      return new Response(null, { status: 101, webSocket: client });
    }
    const link: Link = {
      connection: { kind: 'pending', authDeadline: now + AUTH_TIMEOUT_MS },
      budget: freshBudget(now),
      queue: Promise.resolve(),
    };
    this.#links.set(server, link);
    server.addEventListener('message', (event) => {
      const data: unknown = event.data;
      // Le runtime livre du texte ou un ArrayBuffer ; toute autre forme est traitée comme binaire vide.
      const frame = typeof data === 'string' || data instanceof ArrayBuffer ? data : new ArrayBuffer(0);
      link.queue = link.queue.then(() => this.#receive(server, frame));
    });
    const closed = (): void => {
      link.queue = link.queue.then(() => this.#disconnect(server));
    };
    server.addEventListener('close', closed);
    server.addEventListener('error', closed);
    await this.#scheduleAlarm();
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Trame d'une socket. Ordre : socket retirée ignorée → échéance d'authentification (une trame
   * arrivée à l'instant exact est trop tardive) → budget de taille et de débit → schéma →
   * échéances dues de la room → gardes de PROTOCOL → effet. Avant authentification, toute trame
   * autre qu'un `authenticate` valide ferme la socket après son erreur, sans donnée de room.
   * Ne lève jamais : une écriture refusée ou une erreur inattendue ferme la socket sans rien publier.
   */
  async #receive(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const link = this.#links.get(ws);
      if (link === undefined || link.connection.kind === 'retired') return;
      const { connection } = link;
      const now = this.now();
      if (connection.kind === 'pending' && now >= connection.authDeadline) {
        this.#retire(ws, SOCKET_CLOSE_CODES.AUTH_TIMEOUT);
        return;
      }
      const spent = spend(link.budget, message, now);
      if (spent === 'close') {
        this.#retire(ws, SOCKET_CLOSE_CODES.LIMIT_EXCEEDED);
        return;
      }
      if (spent !== 'ok') {
        this.#reject(ws, connection.kind, spent === 'rate' ? 'RATE_LIMITED' : 'INVALID_MESSAGE');
        return;
      }
      const parsed = parseClientMessage(message);
      if (!parsed.ok) {
        this.#reject(ws, connection.kind, parsed.code, parsed.requestId);
        return;
      }
      const { command } = parsed;
      // Seul `await` avant la décision : l'empreinte du token. Tout ce qui suit est synchrone jusqu'au
      // `commit` ; l'identité est relue, car l'alarme ou une autre socket a pu la retirer entre-temps.
      const tokenHash =
        command.type === 'authenticate' && connection.kind === 'pending'
          ? await hashResumeToken(command.payload.resumeToken)
          : null;
      if (link.connection !== connection) return;
      await this.#dispatch(ws, command, connection.kind === 'player' ? connection.slot : null, tokenHash, now);
    } catch {
      this.#retire(ws, INTERNAL_ERROR_CLOSE);
    }
  }

  async #dispatch(
    ws: WebSocket,
    command: ClientCommand,
    slot: PlayerIndex | null,
    tokenHash: string | null,
    now: number,
  ): Promise<void> {
    const settled = this.#settle(now);
    if (settled === 'closed') {
      await this.#erase();
      return;
    }
    const room = this.#openRoom();
    if (room === null) {
      this.#refuse(ws, 'ROOM_UNAVAILABLE', SOCKET_CLOSE_CODES.ROOM_UNAVAILABLE, command.requestId);
      return;
    }
    let changed = settled === 'changed';
    if (slot !== null && isReplayable(command)) {
      const outcome = this.#play(ws, room, slot, command, now);
      if (outcome === 'closed') {
        await this.#erase();
        return;
      }
      changed = outcome === 'changed' || changed;
    } else {
      const authorization = authorizeCommand(command, room, slot);
      if (!authorization.ok) {
        this.#reject(ws, slot === null ? 'pending' : 'player', authorization.code, command.requestId);
      } else if (command.type === 'authenticate') {
        changed = this.#authenticate(ws, room, command.requestId, tokenHash, now) || changed;
      } else if (command.type === 'ping') {
        // Ne prolonge aucune échéance (PROTOCOL) : aucune écriture.
        this.#send(ws, pongMessage(command.requestId, now));
      }
      // Aucune autre commande n'arrive ici : `authorizeCommand` refuse tout jeu avant authentification.
    }
    if (changed) await this.#scheduleAlarm();
  }

  /**
   * Commande de jeu d'une place authentifiée, dans une seule transition synchrone. Un doublon de
   * `requestId` reçoit la réponse mémorisée, sans garde ni mutation (PROTOCOL « Idempotence »). Sinon :
   * gardes de PROTOCOL, puis `commit` de la transition avec sa réponse, publication, et `ack`. Sans effet
   * (mêmes réglages, confirmation déjà donnée) : `ack` à la révision courante, sans écriture.
   */
  #play(
    ws: WebSocket,
    room: PersistedRoom,
    slot: PlayerIndex,
    command: ReplayableCommand,
    now: number,
  ): 'unchanged' | 'changed' | 'closed' {
    const reply = findReply(room, slot, command.requestId);
    if (reply !== null) {
      this.#send(ws, ackMessage(reply.requestId, reply.revision));
      return 'unchanged';
    }
    const authorization = authorizeCommand(command, room, slot);
    if (!authorization.ok) {
      this.#reject(ws, 'player', authorization.code, command.requestId);
      return 'unchanged';
    }
    if (command.type === 'leave') {
      this.#close(ws, room, slot, command.requestId);
      return 'closed';
    }
    const next = applyCommand(room, slot, command, now);
    if (next === null) {
      this.#send(ws, ackMessage(command.requestId, room.revision));
      return 'unchanged';
    }
    const committed = this.commit(withReply(next, slot, command.requestId));
    this.#publish(now);
    this.#send(ws, ackMessage(command.requestId, committed.revision));
    return 'changed';
  }

  /**
   * `leave` : la room est persistée fermée avant toute publication (partie en cours annulée sans
   * trophée). Chaque joueur reçoit `room-closed {left}`, le demandeur son `ack`, puis les sockets sont
   * fermées (4404) ; l'appelant efface ensuite le stockage. Un effacement interrompu laisse une room
   * `closed`, effacée au prochain événement.
   */
  #close(ws: WebSocket, room: PersistedRoom, slot: PlayerIndex, requestId: string): void {
    const closed = this.commit(withReply(closeRoom(room), slot, requestId));
    const players = [...this.#links].filter(([, { connection }]) => connection.kind === 'player');
    for (const [other] of players) this.#send(other, roomClosedMessage('left'));
    this.#send(ws, ackMessage(requestId, closed.revision));
    for (const [other] of players) this.#retire(other, SOCKET_CLOSE_CODES.ROOM_UNAVAILABLE);
    this.#state = null;
  }

  /**
   * Associe la socket à la place dont l'empreinte correspond. Place inconnue ou libérée : refus et
   * fermeture sans donnée. Sinon, dans une seule transition synchrone : place présente et première
   * connexion faite (persistées), ancienne socket de la place retirée, puis publication. Rend vrai
   * si la room a été écrite.
   */
  #authenticate(ws: WebSocket, room: PersistedRoom, requestId: string, tokenHash: string | null, now: number): boolean {
    const slot = tokenHash === null ? null : findSeat(room.seats, tokenHash);
    const link = this.#links.get(ws);
    if (slot === null || link === undefined) {
      this.#refuse(ws, 'UNAUTHORIZED', SOCKET_CLOSE_CODES.UNAUTHORIZED, requestId);
      return false;
    }
    const claimed = claimSeat(room, slot, now);
    if (claimed !== null) this.commit(claimed);
    for (const [other, { connection }] of this.#links) {
      if (other !== ws && connection.kind === 'player' && connection.slot === slot) {
        this.#retire(other, SOCKET_CLOSE_CODES.REPLACED);
      }
    }
    link.connection = { kind: 'player', slot };
    // Présence changée : les deux places reçoivent l'état ; sinon seule la nouvelle socket.
    if (claimed === null) this.#sendState(ws, slot, now);
    else this.#publish(now);
    this.#send(ws, ackMessage(requestId, this.#state?.revision ?? room.revision));
    return claimed !== null;
  }

  /**
   * Fermeture par le client ou le réseau. Seule la socket courante d'une place rend celle-ci absente :
   * la réconciliation de `#settle` (échéances dues d'abord, puis présence) la marque absente, met la
   * partie en pause et publie ; une socket remplacée ou refusée n'a plus d'effet. Ne lève jamais : une
   * écriture refusée laisse la présence persistée telle quelle, réconciliée au prochain événement.
   */
  async #disconnect(ws: WebSocket): Promise<void> {
    this.#links.delete(ws);
    if (this.#openRoom() === null) return;
    try {
      if (this.#settle(this.now()) === 'closed') await this.#erase();
      else await this.#scheduleAlarm();
    } catch {
      // Rien n'est publié d'une transition non persistée ; l'alarme en cours reste planifiée.
    }
  }

  /** État projeté pour chaque socket courante, par place ; jamais de donnée à une socket non authentifiée. */
  #publish(now: number): void {
    for (const [ws, { connection }] of this.#links) {
      if (connection.kind === 'player') this.#sendState(ws, connection.slot, now);
    }
  }

  #sendState(ws: WebSocket, slot: PlayerIndex, now: number): void {
    const room = this.#state;
    if (room !== null) this.#send(ws, projectState(room, slot, now));
  }

  /** Refus d'une trame : erreur seule pour une socket authentifiée ; avant authentification, erreur puis fermeture. */
  #reject(ws: WebSocket, kind: 'pending' | 'player', code: ErrorCode, requestId?: string): void {
    if (kind === 'pending') this.#refuse(ws, code, SOCKET_CLOSE_CODES.UNAUTHORIZED, requestId);
    else this.#send(ws, errorMessage(code, requestId));
  }

  /** Erreur à message fixe, puis fermeture : la socket est retirée avant tout autre événement. */
  #refuse(ws: WebSocket, code: ErrorCode, close: SocketCloseCode, requestId?: string): void {
    this.#send(ws, errorMessage(code, requestId));
    this.#retire(ws, close);
  }

  /** Retire la socket (ses trames suivantes sont ignorées) puis la ferme avec `code`. */
  #retire(ws: WebSocket, code: number): void {
    const link = this.#links.get(ws);
    if (link !== undefined) link.connection = RETIRED;
    try {
      ws.close(code);
    } catch {
      // Socket déjà fermée : son événement `close` la retire de `#links`.
    }
  }

  #send(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(encodeServerMessage(message));
    } catch {
      // Socket fermée entre-temps : son événement `close` est traité par `#disconnect`.
    }
  }

  /** Room lisible, écrite et non fermée ; `null` sinon. */
  #openRoom(): PersistedRoom | null {
    const room = this.#state;
    return this.#unavailable || room === null || room.phase === 'closed' ? null : room;
  }

  /**
   * Applique les échéances dues à `now`, dans cet ordre : réservations échues, fin de vie échue (délai de
   * reconnexion, durée maximale ou inactivité : room fermée sans trophée), échéance de jeu (une
   * transition), puis réconciliation de la présence.
   * Une place persistée présente sans socket courante dans cette instance (fermeture traitée à l'instant,
   * ou sockets perdues avec une instance précédente : redéploiement, éviction) devient absente, après
   * les échéances dues : à instant égal, l'échéance passe d'abord (PROTOCOL). Chaque changement est
   * persisté puis publié aux sockets présentes ; une fermeture retire aussitôt l'état en mémoire
   * (sockets restantes fermées par `#erase`). Une écriture refusée lève avant toute publication.
   */
  #settle(now: number): 'unchanged' | 'changed' | 'closed' {
    const room = this.#state;
    if (room === null) return 'unchanged';
    // Room fermée : plus aucune réservation n'est accordée, même avant la fin de l'effacement.
    if (room.phase === 'closed') {
      this.#state = null;
      return 'closed';
    }
    const settlement = settleReservations(room, now);
    if (settlement.kind === 'closed') {
      this.#state = null;
      return 'closed';
    }
    /** Persiste puis publie une transition ; vrai si la room a changé. */
    const apply = (next: PersistedRoom | null): boolean => {
      if (next === null) return false;
      this.commit(next);
      this.#publish(now);
      return true;
    };
    let changed = apply(settlement.kind === 'released' ? settlement.room : null);
    const closure = dueClosure(this.#current(), now);
    if (closure !== null) {
      this.#terminate(closeRoom(this.#current()), closure);
      return 'closed';
    }
    changed = apply(advanceGame(this.#current(), now)) || changed;
    for (const slot of [0, 1] as const) {
      if (this.#current().connected[slot] && !this.#hasPlayer(slot)) changed = apply(leaveSeat(this.#current(), slot, now)) || changed;
    }
    return changed ? 'changed' : 'unchanged';
  }

  /** État courant, lisible et non effacé ; réservé aux transitions internes de `#settle`. */
  #current(): PersistedRoom {
    const room = this.#state;
    if (room === null) throw new Error('Room effacée pendant une transition.');
    return room;
  }

  /** Vrai si une socket authentifiée de cette instance tient la place. */
  #hasPlayer(slot: PlayerIndex): boolean {
    for (const { connection } of this.#links.values()) {
      if (connection.kind === 'player' && connection.slot === slot) return true;
    }
    return false;
  }

  /**
   * Fermeture décidée par la room (délai de reconnexion, durée maximale, inactivité) : `closed` persisté
   * avant toute publication, puis `room-closed {reason}` à chaque joueur présent et fermeture 4404 ;
   * l'appelant efface ensuite le stockage (`#erase`, qui ferme aussi les sockets non authentifiées).
   */
  #terminate(closed: PersistedRoom, reason: CloseReason): void {
    this.commit(closed);
    for (const [ws, { connection }] of this.#links) {
      if (connection.kind !== 'player') continue;
      this.#send(ws, roomClosedMessage(reason));
      this.#retire(ws, SOCKET_CLOSE_CODES.ROOM_UNAVAILABLE);
    }
    this.#state = null;
  }

  /**
   * Alarme sur la plus proche échéance : réservation de place, fin de vie (reconnexion, durée maximale,
   * inactivité), échéance de jeu ou authentification d'une socket. Une room ouverte en a toujours une.
   */
  async #scheduleAlarm(): Promise<void> {
    const deadlines: number[] = [];
    if (this.#state !== null) {
      for (const deadline of [
        nextReservationDeadline(this.#state),
        nextClosureDeadline(this.#state),
        nextGameDeadline(this.#state),
      ]) {
        if (deadline !== null) deadlines.push(deadline);
      }
      for (const { connection } of this.#links.values()) {
        if (connection.kind === 'pending') deadlines.push(connection.authDeadline);
      }
    }
    if (deadlines.length === 0) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  /**
   * Room fermée : sockets fermées (4404, sans donnée de room), alarme annulée et stockage entièrement
   * libéré (hashes compris) ; le code redevient libre.
   */
  async #erase(): Promise<void> {
    for (const [ws, { connection }] of this.#links) {
      if (connection.kind !== 'retired') this.#refuse(ws, 'ROOM_UNAVAILABLE', SOCKET_CLOSE_CODES.ROOM_UNAVAILABLE);
    }
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  #assertAvailable(): void {
    if (this.#unavailable) throw new RoomStorageError('CORRUPT', 'Room illisible.');
  }
}
