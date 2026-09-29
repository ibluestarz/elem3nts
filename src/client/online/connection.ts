import {
  PROTOCOL_VERSION,
  RECONNECT_TIMEOUT_MS,
  SOCKET_CLOSE_CODES,
  parseServerMessage,
  roomSocketPath,
  type AuthenticateCommand,
  type ClientCommand,
  type CloseReason,
  type ErrorCode,
  type PublicState,
  type RoomEntry,
} from '../../shared/protocol/index.ts';
import { now } from '../state/clock.ts';
import { ServerClock } from './serverClock.ts';

/**
 * Fin d'une connexion à une room, décidée une seule fois :
 * - un motif `room-closed` du serveur (`left`, `inactive`, `max-duration`, `reconnect-timeout`) ;
 * - `unauthorized` (4401 : token refusé, oublié), `room-unavailable` (4404), `replaced` (4409 : un autre
 *   onglet a repris la place, pas de reconnexion automatique), `limit` (4429), `auth-timeout` (4408 répété) ;
 * - `closed-while-away` : room fermée (4404) pendant une coupure, découverte à la reconnexion ;
 * - `lost` : coupure sans reprise possible dans le délai de reconnexion (D15, 30 s).
 */
export type EndReason =
  | CloseReason
  | 'unauthorized'
  | 'room-unavailable'
  | 'replaced'
  | 'limit'
  | 'auth-timeout'
  | 'closed-while-away'
  | 'lost';

/** État du lien : `online` (authentifié), `reconnecting` (coupure en cours de reprise, PFC-017). */
export type LinkStatus = 'online' | 'reconnecting';

/**
 * `offset` : décalage serveur − local estimé après la trame (`ServerClock`), pour convertir les
 * échéances publiées sur l'horloge locale. `latency` : aller-retour mesuré par `ping`/`pong` (ms).
 * `link` : coupure détectée (`reconnecting`), puis reprise authentifiée (`online`).
 */
export type ConnectionEvent =
  | { readonly type: 'state'; readonly state: PublicState; readonly offset: number }
  | { readonly type: 'latency'; readonly rtt: number; readonly offset: number }
  | { readonly type: 'ack'; readonly requestId: string }
  | { readonly type: 'error'; readonly requestId: string | null; readonly code: ErrorCode; readonly message: string }
  | { readonly type: 'link'; readonly status: LinkStatus }
  | { readonly type: 'ended'; readonly reason: EndReason };

type Unenveloped<C> = C extends unknown ? Omit<C, 'v' | 'requestId'> : never;

/** Commande authentifiée, sans enveloppe : la connexion ajoute `v` et `requestId`. */
export type OutgoingCommand = Unenveloped<Exclude<ClientCommand, AuthenticateCommand>>;

/** Constructeur de socket injectable (tests) ; par défaut le `WebSocket` du navigateur. */
export type SocketFactory = (url: string) => WebSocket;

/** `WebSocket.OPEN`, sans dépendre du constructeur global (sockets injectées). */
const SOCKET_OPEN = 1;

/** Délai laissé au serveur pour confirmer un départ avant fermeture locale de la socket. */
export const LEAVE_GRACE_MS = 3000;

/**
 * Mesure de latence et d'horloge (`ping`, PROTOCOL) : dès l'authentification puis toutes les 5 s.
 * Un `ping` ne prolonge jamais l'expiration d'inactivité de la room ; une trame toutes les 5 s reste
 * loin de la limite de débit (20/s).
 */
export const PING_INTERVAL_MS = 5000;

/**
 * Sans aucun `pong` depuis ce délai, le lien est tenu pour mort (réseau changé, connexion à demi
 * ouverte : le navigateur ne signale pas toujours la fermeture) et la reprise commence.
 */
export const PONG_TIMEOUT_MS = 10_000;

/**
 * Reprise après coupure (PFC-017) : une tentative aussitôt, puis après ces attentes, la dernière
 * répétée, jusqu'à `RECONNECT_TIMEOUT_MS` depuis la coupure (au-delà, le serveur a fermé la room).
 */
export const RECONNECT_DELAYS_MS: readonly number[] = [0, 1000, 2000, 4000];

/** Une tentative qui n'aboutit pas (ni ouverture ni authentification) en ce délai est abandonnée. */
export const ATTEMPT_TIMEOUT_MS = 5000;

/** Pings en attente de réponse conservés au plus (un `pong` perdu n'accumule rien). */
const MAX_PENDING_PINGS = 4;

/** Adresse de la socket d'une room : même origine, `wss:` sous HTTPS (PROTOCOL « Transport »). */
export function roomSocketUrl(code: string, location: Pick<Location, 'protocol' | 'host'> = window.location): string {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}${roomSocketPath(code)}`;
}

/**
 * Identifiants de requête `[A-Za-z0-9_-]` : préfixe aléatoire par connexion puis compteur.
 * `crypto.getRandomValues` reste disponible hors contexte sécurisé, contrairement à `randomUUID`.
 */
function requestIds(): () => string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  const prefix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  let next = 0;
  return () => {
    next += 1;
    return `${prefix}-${String(next)}`;
  };
}

const END_BY_CLOSE_CODE: Readonly<Record<number, EndReason>> = {
  [SOCKET_CLOSE_CODES.UNAUTHORIZED]: 'unauthorized',
  [SOCKET_CLOSE_CODES.ROOM_UNAVAILABLE]: 'room-unavailable',
  [SOCKET_CLOSE_CODES.REPLACED]: 'replaced',
  [SOCKET_CLOSE_CODES.LIMIT_EXCEEDED]: 'limit',
};

/**
 * Connexion d'une place à sa room (PFC-013, D37) : première trame `authenticate`, trames serveur
 * validées (`parseServerMessage`) et révisions anciennes ignorées. Le token ne quitte la mémoire
 * que dans cette première trame (le stockage de reprise de l'onglet relève de `session.ts`).
 *
 * Reprise (PFC-017) : une fermeture qui n'est pas une fin décidée par le serveur (4401, 4404, 4409,
 * 4429, `room-closed`) ouvre une nouvelle socket avec le même token, aussitôt puis à intervalles
 * croissants, pendant au plus le délai de reconnexion du serveur. Horloge serveur et dernière révision
 * sont conservées d'une socket à l'autre : un état ancien reste ignoré, le décompte ne remonte jamais.
 */
export class RoomConnection {
  readonly #code: string;
  readonly #listener: (event: ConnectionEvent) => void;
  readonly #factory: SocketFactory;
  readonly #nextId = requestIds();
  #token: string | null;
  #socket: WebSocket | null = null;
  /** Socket remplacée par une resynchronisation, fermée dès que la nouvelle est authentifiée. */
  #replaced: WebSocket | null = null;
  #revision = -1;
  #authRetried = false;
  #authRequestId: string | null = null;
  #authenticated = false;
  #ended = false;
  #closedReason: CloseReason | null = null;
  /** Instant local de la coupure en cours de reprise ; `null` quand le lien est en ligne. */
  #lostAt: number | null = null;
  #attempt = 0;
  #retryTimer = 0;
  #attemptTimer = 0;
  readonly #clock = new ServerClock();
  /** Instant local d'envoi de chaque `ping` en attente, par `requestId`. */
  readonly #pings = new Map<string, number>();
  #pingTimer = 0;
  /** Instant local de la dernière preuve de vie du serveur (authentification, `pong`). */
  #aliveAt = 0;
  readonly #onOnline = (): void => {
    // Le réseau revient : tentative immédiate plutôt que d'attendre l'intervalle suivant.
    if (this.#lostAt !== null && this.#socket === null) this.#attemptNow();
  };

  constructor(entry: RoomEntry, listener: (event: ConnectionEvent) => void, factory: SocketFactory = (url) => new WebSocket(url)) {
    this.#code = entry.roomCode;
    this.#token = entry.resumeToken;
    this.#listener = listener;
    this.#factory = factory;
    window.addEventListener('online', this.#onOnline);
    this.#open();
  }

  /** Envoie une commande si la socket est ouverte et authentifiée ; renvoie son `requestId`, `null` sinon. */
  send(command: OutgoingCommand): string | null {
    const socket = this.#socket;
    if (this.#ended || socket?.readyState !== SOCKET_OPEN) return null;
    const requestId = this.#nextId();
    socket.send(JSON.stringify({ v: PROTOCOL_VERSION, requestId, ...command }));
    return requestId;
  }

  /**
   * « Réessayer » : pendant une coupure, tentative immédiate (sans attendre l'intervalle) ; en ligne,
   * resynchronisation par une nouvelle socket authentifiée, qui remplace l'actuelle côté serveur sans
   * aucune écriture (place déjà présente) et renvoie un état frais.
   */
  retryNow(): void {
    if (this.#ended) return;
    if (this.#lostAt !== null) {
      if (this.#socket === null) this.#attemptNow();
      return;
    }
    this.#replaced?.close();
    this.#replaced = this.#socket;
    this.#stopPings();
    this.#lostAt = now();
    this.#attempt = 1;
    this.#listener({ type: 'link', status: 'reconnecting' });
    this.#open();
  }

  /**
   * Quitte la room (`leave` : fermée pour les deux joueurs) puis se tait : aucun événement n'est plus
   * émis. La socket est fermée par le serveur, ou localement après un court délai de grâce.
   */
  leave(): void {
    const socket = this.#socket;
    const sent = this.send({ type: 'leave', payload: {} }) !== null;
    this.#finish();
    if (!sent || socket === null) {
      socket?.close();
      return;
    }
    window.setTimeout(() => {
      socket.close();
    }, LEAVE_GRACE_MS);
  }

  /** Ferme la connexion sans quitter la room (démontage) ; aucun événement n'est plus émis. */
  dispose(): void {
    const socket = this.#socket;
    this.#finish();
    socket?.close();
  }

  #finish(): void {
    this.#ended = true;
    this.#token = null;
    this.#socket = null;
    this.#replaced?.close();
    this.#replaced = null;
    window.clearTimeout(this.#retryTimer);
    window.clearTimeout(this.#attemptTimer);
    window.removeEventListener('online', this.#onOnline);
    this.#stopPings();
  }

  #stopPings(): void {
    window.clearInterval(this.#pingTimer);
    this.#pingTimer = 0;
    this.#pings.clear();
  }

  /**
   * Premier `ping` aussitôt authentifié, puis à intervalle fixe. Sans `pong` depuis `PONG_TIMEOUT_MS`,
   * le lien est tenu pour mort : la socket est abandonnée et la reprise commence.
   */
  #startPings(): void {
    if (this.#pingTimer !== 0 || this.#ended) return;
    const ping = () => {
      const socket = this.#socket;
      if (socket !== null && now() - this.#aliveAt > PONG_TIMEOUT_MS) {
        socket.close();
        this.#lose(socket);
        return;
      }
      const requestId = this.send({ type: 'ping', payload: {} });
      if (requestId === null) return;
      this.#pings.set(requestId, now());
      for (const id of this.#pings.keys()) {
        if (this.#pings.size <= MAX_PENDING_PINGS) break;
        this.#pings.delete(id);
      }
    };
    ping();
    this.#pingTimer = window.setInterval(ping, PING_INTERVAL_MS);
  }

  #open(): void {
    if (this.#ended) return;
    const socket = this.#factory(roomSocketUrl(this.#code));
    this.#socket = socket;
    this.#authenticated = false;
    window.clearTimeout(this.#attemptTimer);
    // Tentative sans issue (réseau bloqué, poignée de main suspendue) : abandonnée, la suivante suit.
    this.#attemptTimer = window.setTimeout(() => {
      if (this.#socket !== socket || this.#authenticated) return;
      socket.close();
      this.#lose(socket);
    }, ATTEMPT_TIMEOUT_MS);
    socket.addEventListener('open', () => {
      if (this.#socket !== socket || this.#token === null) return;
      this.#authRequestId = this.#nextId();
      // Première et seule trame avant authentification ; le token n'est jamais journalisé.
      socket.send(
        JSON.stringify({ v: PROTOCOL_VERSION, type: 'authenticate', requestId: this.#authRequestId, payload: { resumeToken: this.#token } }),
      );
    });
    socket.addEventListener('message', (event: MessageEvent) => {
      // Instant de réception relevé avant tout traitement : il borne le décalage d'horloge.
      if (this.#socket === socket) this.#receive(event.data, now());
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      if (this.#socket === socket) this.#closed(socket, event.code);
    });
  }

  #receive(raw: unknown, receivedAt: number): void {
    const parsed = parseServerMessage(raw);
    // Trame refusée par la validation : ignorée, jamais interprétée (PROTOCOL « Réponses »).
    if (!parsed.ok) return;
    const message = parsed.message;
    // Toute trame valide prouve que le lien vit ; un état n'est envoyé qu'à une socket authentifiée.
    this.#aliveAt = receivedAt;
    if (message.type === 'state') window.clearTimeout(this.#attemptTimer);
    switch (message.type) {
      case 'state':
        // Un état retardé (révision plus ancienne) ne fait jamais régresser la vue (PROTOCOL, AC2).
        if (message.revision < this.#revision) return;
        this.#revision = message.revision;
        this.#clock.sample(message.serverNow, receivedAt);
        this.#listener({ type: 'state', state: message, offset: this.#clock.offset ?? 0 });
        return;
      case 'ack':
        if (message.requestId === this.#authRequestId) {
          this.#authenticated = true;
          this.#authRetried = false;
          window.clearTimeout(this.#attemptTimer);
          this.#replaced?.close();
          this.#replaced = null;
          this.#startPings();
          if (this.#lostAt !== null) {
            this.#lostAt = null;
            this.#attempt = 0;
            this.#listener({ type: 'link', status: 'online' });
          }
        }
        this.#listener({ type: 'ack', requestId: message.requestId });
        return;
      case 'error':
        this.#listener({ type: 'error', requestId: message.requestId ?? null, code: message.code, message: message.message });
        return;
      case 'room-closed':
        // La fermeture 4404 qui suit porte ce motif plutôt que « room indisponible ».
        this.#closedReason = message.reason;
        return;
      case 'pong': {
        const sentAt = this.#pings.get(message.requestId);
        if (sentAt === undefined) return;
        this.#pings.delete(message.requestId);
        this.#clock.sample(message.serverNow, receivedAt);
        this.#listener({ type: 'latency', rtt: Math.max(0, receivedAt - sentAt), offset: this.#clock.offset ?? 0 });
        return;
      }
    }
  }

  #closed(socket: WebSocket, code: number): void {
    if (this.#ended) return;
    // Fin décidée par le serveur : motif `room-closed`, puis code de fermeture applicatif.
    const decided = this.#closedReason ?? END_BY_CLOSE_CODE[code];
    if (decided !== undefined) {
      // Room fermée pendant la coupure (délai échu, départ de l'adversaire) : la reprise l'apprend ici.
      this.#end(decided === 'room-unavailable' && this.#lostAt !== null ? 'closed-while-away' : decided);
      return;
    }
    // 4408 d'une première connexion : rouvrir et s'authentifier aussitôt, une seule fois de suite.
    if (code === SOCKET_CLOSE_CODES.AUTH_TIMEOUT && this.#lostAt === null) {
      if (this.#authRetried) {
        this.#end('auth-timeout');
        return;
      }
      this.#authRetried = true;
      this.#open();
      return;
    }
    this.#lose(socket);
  }

  /** Socket perdue sans fin décidée : reprise, aussitôt puis à intervalles, dans le délai de reconnexion. */
  #lose(socket: WebSocket): void {
    if (this.#ended || this.#socket !== socket) return;
    this.#socket = null;
    this.#authenticated = false;
    window.clearTimeout(this.#attemptTimer);
    this.#stopPings();
    if (this.#lostAt === null) {
      this.#lostAt = now();
      this.#attempt = 0;
      this.#listener({ type: 'link', status: 'reconnecting' });
    }
    const elapsed = now() - this.#lostAt;
    if (elapsed >= RECONNECT_TIMEOUT_MS) {
      this.#end('lost');
      return;
    }
    const delays = RECONNECT_DELAYS_MS;
    const delay = delays[Math.min(this.#attempt, delays.length - 1)] ?? 0;
    this.#attempt += 1;
    window.clearTimeout(this.#retryTimer);
    // Première tentative sans attendre : la plupart des coupures (rechargement du serveur, bascule réseau) se reprennent aussitôt.
    if (delay === 0) {
      this.#attemptNow();
      return;
    }
    this.#retryTimer = window.setTimeout(
      () => {
        this.#attemptNow();
      },
      Math.min(delay, RECONNECT_TIMEOUT_MS - elapsed),
    );
  }

  #attemptNow(): void {
    window.clearTimeout(this.#retryTimer);
    if (this.#ended || this.#socket !== null) return;
    if (this.#lostAt !== null && now() - this.#lostAt >= RECONNECT_TIMEOUT_MS) {
      this.#end('lost');
      return;
    }
    this.#open();
  }

  #end(reason: EndReason): void {
    // 4401 : le token est refusé, il est oublié (PROTOCOL) ; `#finish` l'efface dans tous les cas.
    this.#finish();
    this.#listener({ type: 'ended', reason });
  }
}
