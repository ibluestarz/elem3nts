import type { TestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ROOM_IDLE_TIMEOUT_MS, ROOM_MAX_DURATION_MS, parseRoomEntry, type RoomEntry } from '../../src/shared/protocol/index.ts';
import type { PersistedRoom } from '../../src/worker/codec.ts';
import { lobbyRoom } from '../unit/protocol/rooms.ts';
import {
  alarm,
  closedWith,
  openSocket,
  persisted,
  readRoom,
  rebuild,
  runAlarm,
  setClock,
  startHarness,
  tables,
  writeRoom,
  type SocketProbe,
} from './support.ts';

/**
 * PFC-018 — expiration d'inactivité (30 min, D16/D17) et durée maximale (4 h), dans le vrai runtime
 * Workers (workerd) : vraies sockets, horloge de room figée, alarmes exécutées à la main. Toute activité
 * passe par une vraie commande ; aucune échéance n'est écrite directement dans le stockage.
 */
let server: TestHarness;

beforeAll(async () => {
  server = await startHarness();
});

afterEach(async () => {
  for (const probe of open.splice(0)) probe.close();
  await setClock(server, null);
});

afterAll(async () => {
  await server.close();
});

const T0 = 2_000_000_000_000;
/** Contrat D08/D09/D15/D16, écrit en clair : ouverture 2,2 s, reconnexion 30 s, inactivité 30 min, durée 4 h. */
const INTRO_MS = 2200;
const RECONNECT_MS = 30_000;
const IDLE_MS = 30 * 60_000;
const MAX_MS = 4 * 60 * 60_000;
const MINUTE = 60_000;

const CLOSE_ROOM_UNAVAILABLE = 4404;

type Frame = Record<string, unknown>;

/** Sockets encore ouvertes par le test courant, fermées après lui. */
const open: SocketProbe[] = [];

interface Duel {
  readonly code: string;
  readonly tokens: readonly [string, string];
  host: SocketProbe;
  guest: SocketProbe;
}

async function post(path: string): Promise<RoomEntry> {
  const response = await server.fetch(path, { method: 'POST' });
  const entry = parseRoomEntry(await response.json());
  if (entry === null) throw new Error(`Entrée refusée : ${String(response.status)}`);
  return entry;
}

/** Socket authentifiée : son premier `state` (reçu avant l'ack) et la socket. */
async function connect(code: string, token: string): Promise<{ probe: SocketProbe; snapshot: Frame }> {
  const probe = await openSocket(server, code);
  open.push(probe);
  probe.send({ v: 1, type: 'authenticate', requestId: 'auth-1', payload: { resumeToken: token } });
  const snapshot = await probe.next();
  expect(snapshot).toMatchObject({ type: 'state' });
  expect(await probe.next()).toMatchObject({ type: 'ack', requestId: 'auth-1' });
  return { probe, snapshot };
}

/** Room à deux joueurs connectés au lobby ; création et deux premières connexions à l'instant `T0`. */
async function duel(): Promise<Duel> {
  await setClock(server, T0);
  const host = await post('/api/rooms');
  const guest = await post(`/api/rooms/${host.roomCode}/join`);
  const first = await connect(host.roomCode, host.resumeToken);
  const second = await connect(host.roomCode, guest.resumeToken);
  expect(await first.probe.next()).toMatchObject({ type: 'state', connected: [true, true] });
  return { code: host.roomCode, tokens: [host.resumeToken, guest.resumeToken], host: first.probe, guest: second.probe };
}

async function state(code: string): Promise<PersistedRoom> {
  const found = await readRoom(server, code);
  if (found === null) throw new Error(`Room ${code} absente.`);
  return found;
}

/** Envoie une commande et lit jusqu'à sa réponse (`ack` ou `error`) ; rend les trames publiées avant. */
async function send(probe: SocketProbe, frame: { requestId: string }): Promise<{ published: Frame[]; reply: Frame }> {
  probe.send(frame);
  const published: Frame[] = [];
  for (;;) {
    const next = await probe.next();
    if ((next['type'] === 'ack' || next['type'] === 'error') && next['requestId'] === frame.requestId) return { published, reply: next };
    published.push(next);
  }
}

let pings = 0;

/** `ping` à l'instant courant : rend son `pong` et les trames reçues avant lui. */
async function ping(probe: SocketProbe): Promise<{ before: Frame[]; pong: Frame }> {
  pings += 1;
  const requestId = `ping-${String(pings)}`;
  probe.send({ v: 1, type: 'ping', requestId, payload: {} });
  const before: Frame[] = [];
  for (;;) {
    const frame = await probe.next();
    if (frame['type'] === 'pong' && frame['requestId'] === requestId) return { before, pong: frame };
    before.push(frame);
  }
}

const commands = {
  ready: (requestId: string, expectedSettingsRevision = 0) => ({ v: 1, type: 'ready', requestId, payload: { expectedSettingsRevision } }),
  settings: (requestId: string, expectedSettingsRevision: number, target: number) => ({
    v: 1,
    type: 'update-settings',
    requestId,
    payload: { expectedSettingsRevision, settings: { target, drawEnabled: true } },
  }),
  choice: (requestId: string, matchId: string, roundId: number, element: string) => ({
    v: 1,
    type: 'submit-choice',
    requestId,
    matchId,
    roundId,
    payload: { element },
  }),
};

/** Avance l'horloge à `now` puis exécute l'alarme de la room ; rend la prochaine alarme planifiée. */
async function tick(code: string, now: number): Promise<number | null> {
  await setClock(server, now);
  const result = await runAlarm(server, code);
  expect(result.failed).toBe(false);
  return result.alarm;
}

/** Deux confirmations à l'instant `at`, puis l'ouverture s'écoule : manche 1 en sélection. Rend le matchId. */
async function start(d: Duel, at: number, settingsRevision = 0): Promise<string> {
  await setClock(server, at);
  await send(d.host, commands.ready('ready-h', settingsRevision));
  await send(d.guest, commands.ready('ready-g', settingsRevision));
  await tick(d.code, at + INTRO_MS);
  const { match, phase } = await state(d.code);
  expect(phase).toBe('selecting');
  return match?.id ?? '';
}

/** Lit toutes les trames déjà publiées aux deux joueurs (barrière `ping`). */
async function drainAll(d: Duel): Promise<void> {
  await ping(d.host);
  await ping(d.guest);
}

/** Lit jusqu'à `room-closed` : rend ce message ; seules des trames `state` peuvent le précéder. */
async function roomClosed(probe: SocketProbe): Promise<Frame> {
  for (;;) {
    const frame = await probe.next();
    if (frame['type'] === 'room-closed') return frame;
    expect(frame['type']).toBe('state');
  }
}

/** Trames `room-closed` reçues par une socket depuis son ouverture. */
const closures = (probe: SocketProbe): number => probe.raw.filter((raw) => raw.includes('"room-closed"')).length;

/**
 * Room entièrement nettoyée (AC2) : stockage effacé (hashes des tokens, choix, scores), alarme annulée,
 * le code ne mène plus à rien, ni par `join` ni par une socket authentifiée avec l'ancien token.
 */
async function expectErased(d: Duel): Promise<void> {
  expect(await tables(server, d.code)).toEqual([]);
  expect(await alarm(server, d.code)).toBeNull();
  const join = await server.fetch(`/api/rooms/${d.code}/join`, { method: 'POST' });
  expect(join.status).toBe(404);
  const probe = await openSocket(server, d.code);
  open.push(probe);
  expect(await probe.next()).toMatchObject({ type: 'error', code: 'ROOM_UNAVAILABLE' });
  expect(await closedWith(probe)).toBe(CLOSE_ROOM_UNAVAILABLE);
  // Aucun join ni aucune socket ne recrée la room.
  expect(await tables(server, d.code)).toEqual([]);
}

describe('PFC-018-AC1 — inactivité (manches vides comprises) et durée maximale ferment avec une raison lisible', () => {
  it('PFC-018-S1 — aucune manche n’a reçu de choix depuis 30 min : room fermée sans trophée, les deux clients informés', async () => {
    const d = await duel();
    const matchId = await start(d, T0);
    // Dernière activité : la seconde confirmation, à T0. Aucune manche ne reçoit de choix ensuite.
    const idleAt = T0 + IDLE_MS;

    // Toutes les échéances de jeu antérieures sont traitées, une à une, chacune à son instant exact.
    let next = await alarm(server, d.code);
    while (next !== null && next < idleAt) next = await tick(d.code, next);
    // L'alarme unique porte l'échéance d'inactivité elle-même (plus proche que la manche suivante).
    expect(next).toBe(idleAt);

    // Plus de 150 manches publiées, toutes vides (R12) : aucun point, la partie continue sans activité.
    await ping(d.host);
    const results = d.host.raw.map((raw) => JSON.parse(raw) as Frame).filter((frame) => frame['phase'] === 'round-result');
    const rounds = new Set(results.map((frame) => frame['roundId']));
    expect(rounds.size).toBeGreaterThan(150);
    expect(results.every((frame) => (frame['result'] as { kind: string }).kind === 'void')).toBe(true);
    expect(await state(d.code)).toMatchObject({
      match: { id: matchId, scores: [0, 0], result: { status: 'playing' } },
      trophies: [0, 0],
      lastActivityAt: T0,
    });

    expect(await tick(d.code, idleAt)).toBeNull();
    expect(await roomClosed(d.host)).toEqual({ v: 1, type: 'room-closed', reason: 'inactive' });
    expect(await roomClosed(d.guest)).toEqual({ v: 1, type: 'room-closed', reason: 'inactive' });
    expect(await closedWith(d.host)).toBe(CLOSE_ROOM_UNAVAILABLE);
    expect(await closedWith(d.guest)).toBe(CLOSE_ROOM_UNAVAILABLE);
    // Aucune trophée ni résultat après l'annonce : `room-closed` est la dernière trame.
    expect(d.host.raw.at(-1)).toBe('{"v":1,"type":"room-closed","reason":"inactive"}');
    await expectErased(d);
  }, 120_000); // 150+ manches simulées, une requête HTTP par échéance : ~40 s sur une machine chargée.

  it('une seule manche vide ne ferme pas la room (R12) : la partie continue avec la manche suivante', async () => {
    const d = await duel();
    await start(d, T0);
    const resolvedAt = T0 + INTRO_MS + 5000;
    const next = await tick(d.code, resolvedAt);
    expect(await state(d.code)).toMatchObject({ phase: 'round-result', lastRound: { resolution: { kind: 'void' } } });
    expect(await tick(d.code, next ?? 0)).toBeGreaterThan(next ?? 0);
    expect(await state(d.code)).toMatchObject({ phase: 'selecting', roundId: 2, lastActivityAt: T0 });
    expect(closures(d.host) + closures(d.guest)).toBe(0);
  });

  it('PFC-018-S2 — des ping jusqu’à l’échéance ne prolongent rien : la room expire malgré eux', async () => {
    const d = await duel();
    const idleAt = T0 + IDLE_MS;
    expect(await alarm(server, d.code)).toBe(idleAt);

    for (const at of [T0 + 10 * MINUTE, T0 + 20 * MINUTE, idleAt - 5000, idleAt - 1]) {
      await setClock(server, at);
      const { before, pong } = await ping(d.host);
      expect(before).toEqual([]);
      expect(pong).toMatchObject({ serverNow: at });
      await ping(d.guest);
    }
    expect(await state(d.code)).toMatchObject({ phase: 'lobby', lastActivityAt: T0 });
    expect(await alarm(server, d.code)).toBe(idleAt);

    // Ping à l'instant exact de l'échéance, avant que l'alarme ne passe : l'échéance est traitée d'abord.
    await setClock(server, idleAt);
    d.host.send({ v: 1, type: 'ping', requestId: 'ping-late', payload: {} });
    expect(await roomClosed(d.host)).toEqual({ v: 1, type: 'room-closed', reason: 'inactive' });
    expect(await roomClosed(d.guest)).toEqual({ v: 1, type: 'room-closed', reason: 'inactive' });
    expect(await closedWith(d.host)).toBe(CLOSE_ROOM_UNAVAILABLE);
    expect(d.host.raw.some((raw) => raw.includes('ping-late'))).toBe(false);
    await expectErased(d);
  });

  it('une activité utile repousse l’échéance de 30 min ; refus, commande sans effet et reprise de place ne la déplacent pas', async () => {
    const d = await duel();

    // Commande acceptée qui modifie la room : réglages de l'hôte.
    const changedAt = T0 + 20 * MINUTE;
    await setClock(server, changedAt);
    expect((await send(d.host, commands.settings('s-1', 0, 5))).reply).toMatchObject({ type: 'ack' });
    expect(await state(d.code)).toMatchObject({ lastActivityAt: changedAt });
    expect(await alarm(server, d.code)).toBe(changedAt + IDLE_MS);

    await setClock(server, changedAt + 10 * MINUTE);
    // Refus (réglages par l'invité, révision périmée) : aucune écriture.
    expect((await send(d.guest, commands.settings('s-g', 1, 4))).reply).toMatchObject({ type: 'error', code: 'NOT_HOST' });
    expect((await send(d.host, commands.ready('r-stale', 0))).reply).toMatchObject({ type: 'error', code: 'STALE_SETTINGS' });
    // Commande acceptée sans effet (mêmes réglages) : acquittée sans écriture.
    expect((await send(d.host, commands.settings('s-same', 1, 5))).reply).toMatchObject({ type: 'ack' });
    // Reprise de place par une nouvelle socket, après une vraie absence : un retour n'est pas une activité.
    d.guest.close();
    await closedWith(d.guest);
    await expect.poll(async () => (await state(d.code)).connected[1]).toBe(false);
    d.guest = (await connect(d.code, d.tokens[1])).probe;
    expect(await state(d.code)).toMatchObject({ connected: [true, true], lastActivityAt: changedAt });
    expect(await alarm(server, d.code)).toBe(changedAt + IDLE_MS);

    // Choix verrouillé : activité, même si la manche suivante reste vide.
    const matchId = await start(d, changedAt + 15 * MINUTE, 1);
    const choiceAt = changedAt + 15 * MINUTE + INTRO_MS + 1000;
    await setClock(server, choiceAt);
    expect((await send(d.guest, commands.choice('c-g', matchId, 1, 'water'))).reply).toMatchObject({ type: 'ack' });
    expect(await state(d.code)).toMatchObject({ lastActivityAt: choiceAt });
  });

  it('un invité arrivé tard au lobby relance l’échéance à sa première connexion ; sa seule réservation ne suffit pas', async () => {
    await setClock(server, T0);
    const host = await post('/api/rooms');
    const first = await connect(host.roomCode, host.resumeToken);

    // Réservation HTTP seule, 29 min après : aucune activité (n'importe quel porteur du code peut réserver).
    await setClock(server, T0 + 29 * MINUTE);
    const guest = await post(`/api/rooms/${host.roomCode}/join`);
    expect(await state(host.roomCode)).toMatchObject({ lastActivityAt: T0 });

    // Première connexion de J2, 20 s plus tard : 30 min pleines à partir d'elle.
    const arrivedAt = T0 + 29 * MINUTE + 20_000;
    await setClock(server, arrivedAt);
    const second = await connect(host.roomCode, guest.resumeToken);
    expect(await state(host.roomCode)).toMatchObject({ lastActivityAt: arrivedAt });
    expect(await alarm(server, host.roomCode)).toBe(arrivedAt + IDLE_MS);

    expect(await tick(host.roomCode, T0 + IDLE_MS)).toBe(arrivedAt + IDLE_MS);
    expect(closures(first.probe) + closures(second.probe)).toBe(0);
  });

  it('durée maximale : 4 h absolues depuis la création malgré une activité continue, fermeture `max-duration`', async () => {
    const d = await duel();
    const maxAt = T0 + MAX_MS;
    // Réglages changés toutes les 29 min : l'inactivité n'est jamais atteinte.
    let revision = 0;
    for (let at = T0 + 29 * MINUTE; at < maxAt; at += 29 * MINUTE) {
      await setClock(server, at);
      expect((await send(d.host, commands.settings(`s-${String(revision)}`, revision, (revision % 9) + 2))).reply).toMatchObject({ type: 'ack' });
      revision += 1;
      expect(await alarm(server, d.code)).toBe(Math.min(at + IDLE_MS, maxAt));
    }
    expect(await alarm(server, d.code)).toBe(maxAt);

    await setClock(server, maxAt - 1);
    expect((await ping(d.host)).before).toEqual([]);
    expect(await tick(d.code, maxAt)).toBeNull();
    expect(await roomClosed(d.host)).toEqual({ v: 1, type: 'room-closed', reason: 'max-duration' });
    expect(await roomClosed(d.guest)).toEqual({ v: 1, type: 'room-closed', reason: 'max-duration' });
    await expectErased(d);
  });

  it('durée maximale absolue pendant une pause : fermeture à 4 h avant le délai de reconnexion, sans trophée', async () => {
    const d = await duel();
    const maxAt = T0 + MAX_MS;
    // Réglages changés toutes les 29 min jusqu'à 3 h 52, puis partie lancée à 4 h − 20 s : jamais inactive.
    let revision = 0;
    for (let at = T0 + 29 * MINUTE; at < maxAt - 20_000; at += 29 * MINUTE) {
      await setClock(server, at);
      await send(d.host, commands.settings(`s-${String(revision)}`, revision, (revision % 9) + 2));
      revision += 1;
    }
    await drainAll(d);
    const matchId = await start(d, maxAt - 20_000, revision);
    await setClock(server, maxAt - 15_000);
    await send(d.host, commands.choice('c-h', matchId, 1, 'fire'));

    // J2 part à 4 h − 10 s : pause, reconnexion possible jusqu'à 4 h + 20 s… mais la durée maximale passe avant.
    await setClock(server, maxAt - 10_000);
    d.guest.close();
    await closedWith(d.guest);
    await expect.poll(async () => (await state(d.code)).phase).toBe('paused');
    expect(await state(d.code)).toMatchObject({ reconnectDeadline: maxAt - 10_000 + RECONNECT_MS });
    expect(await alarm(server, d.code)).toBe(maxAt);

    expect(await tick(d.code, maxAt)).toBeNull();
    expect(await roomClosed(d.host)).toEqual({ v: 1, type: 'room-closed', reason: 'max-duration' });
    expect(await closedWith(d.host)).toBe(CLOSE_ROOM_UNAVAILABLE);

    // J2 revient dans son délai de reconnexion : la room n'existe plus et n'est pas recréée.
    await setClock(server, maxAt + 1000);
    const late = await openSocket(server, d.code);
    open.push(late);
    late.send({ v: 1, type: 'authenticate', requestId: 'auth-late', payload: { resumeToken: d.tokens[1] } });
    expect(await late.next()).toMatchObject({ type: 'error', code: 'ROOM_UNAVAILABLE' });
    expect(await closedWith(late)).toBe(CLOSE_ROOM_UNAVAILABLE);
    await expectErased(d);
  });

  it('alarme en retard, plusieurs échéances dues : le motif est la première survenue', async () => {
    const d = await duel();
    const idleAt = T0 + IDLE_MS;
    // J2 part 10 s avant l'inactivité : son délai (idleAt + 20 s) tombe après elle.
    await setClock(server, idleAt - 10_000);
    d.guest.close();
    await closedWith(d.guest);
    await expect.poll(async () => (await state(d.code)).connected[1]).toBe(false);
    expect(await alarm(server, d.code)).toBe(idleAt);

    // Alarme traitée 25 s en retard : inactivité et reconnexion sont dues ; l'inactivité est la cause.
    expect(await tick(d.code, idleAt + 25_000)).toBeNull();
    expect(await roomClosed(d.host)).toEqual({ v: 1, type: 'room-closed', reason: 'inactive' });
    expect(await tables(server, d.code)).toEqual([]);
  });

  it('à l’inverse, un délai de reconnexion échu avant l’inactivité reste `reconnect-timeout`', async () => {
    const d = await duel();
    const idleAt = T0 + IDLE_MS;
    await setClock(server, idleAt - 40_000);
    d.guest.close();
    await closedWith(d.guest);
    await expect.poll(async () => (await state(d.code)).connected[1]).toBe(false);
    expect(await alarm(server, d.code)).toBe(idleAt - 10_000);

    expect(await tick(d.code, idleAt + 5000)).toBeNull();
    expect(await roomClosed(d.host)).toEqual({ v: 1, type: 'room-closed', reason: 'reconnect-timeout' });
  });
});

describe('PFC-018-AC2 — tokens, choix et sockets supprimés ; aucune room expirée recréée', () => {
  it('alarmes concurrentes à l’échéance : une seule fermeture, aucun échec, rien ne survit', async () => {
    const d = await duel();
    const matchId = await start(d, T0);
    await setClock(server, T0 + INTRO_MS + 1000);
    await send(d.host, commands.choice('c-h', matchId, 1, 'plant'));
    const idleAt = T0 + INTRO_MS + 1000 + IDLE_MS;
    // Place l'échéance d'inactivité hors de toute échéance de jeu : manche en cours à l'instant exact.
    await setClock(server, idleAt);

    const results = await Promise.all([runAlarm(server, d.code), runAlarm(server, d.code), runAlarm(server, d.code)]);
    expect(results.map((result) => result.failed)).toEqual([false, false, false]);
    expect(results.map((result) => result.alarm)).toEqual([null, null, null]);
    await closedWith(d.host);
    await closedWith(d.guest);
    expect(closures(d.host)).toBe(1);
    expect(closures(d.guest)).toBe(1);
    // Choix caché jamais révélé à l'adversaire, même à la fermeture.
    expect(d.guest.raw.some((raw) => raw.includes('plant'))).toBe(false);
    await expectErased(d);
  });

  it('alarme et commande arrivées au même instant que l’échéance : la commande ne s’applique jamais', async () => {
    const d = await duel();
    const idleAt = T0 + IDLE_MS;
    await setClock(server, idleAt);
    d.host.send(commands.ready('r-late'));
    d.guest.send(commands.settings('s-late', 0, 7));
    // Les commandes et l'alarme sont en vol ensemble : quel que soit l'ordre, l'échéance passe avant elles.
    expect((await runAlarm(server, d.code)).failed).toBe(false);
    expect(await roomClosed(d.host)).toEqual({ v: 1, type: 'room-closed', reason: 'inactive' });
    expect(await roomClosed(d.guest)).toEqual({ v: 1, type: 'room-closed', reason: 'inactive' });
    await closedWith(d.host);
    await closedWith(d.guest);
    for (const probe of [d.host, d.guest]) {
      expect(probe.raw.some((raw) => raw.includes('"ack"') && raw.includes('-late'))).toBe(false);
      expect(closures(probe)).toBe(1);
    }
    await expectErased(d);
  });

  it('une socket encore non authentifiée est fermée sans donnée de room à l’expiration', async () => {
    const d = await duel();
    const idleAt = T0 + IDLE_MS;
    await setClock(server, idleAt - 1000);
    const pending = await openSocket(server, d.code);
    open.push(pending);
    // Son échéance d'authentification (5 s) tombe après l'inactivité : l'alarme reste à l'inactivité.
    expect(await alarm(server, d.code)).toBe(idleAt);

    expect(await tick(d.code, idleAt)).toBeNull();
    expect(await pending.next()).toMatchObject({ type: 'error', code: 'ROOM_UNAVAILABLE' });
    expect(await closedWith(pending)).toBe(CLOSE_ROOM_UNAVAILABLE);
    expect(pending.raw.some((raw) => raw.includes('"state"') || raw.includes('room-closed'))).toBe(false);
    await expectErased(d);
  });

  it('instance perdue au lobby sans client de retour : le réveil d’inactivité ferme et efface la room', async () => {
    // Présence persistée « vraie » sans aucune socket (instance perdue : redéploiement, éviction). Le harnais
    // ne peut pas évincer une instance qui tient des sockets ; l'alarme d'inactivité est planifiée par toute
    // room ouverte (tests ci-dessus) et persiste avec le stockage.
    const name = 'expiry-instance-lost';
    const lobby = persisted(lobbyRoom({ connected: [true, true] }), T0);
    expect((await writeRoom(server, name, lobby)).ok).toBe(true);
    await rebuild(server, name);

    expect(await tick(name, T0 + IDLE_MS)).toBeNull();
    expect(await tables(server, name)).toEqual([]);
    expect(await readRoom(server, name)).toBeNull();
  });
});

describe('PFC-018 — constantes partagées', () => {
  it('inactivité 30 min et durée maximale 4 h (D16), côté serveur comme côté client', () => {
    expect(ROOM_IDLE_TIMEOUT_MS).toBe(IDLE_MS);
    expect(ROOM_MAX_DURATION_MS).toBe(MAX_MS);
  });
});
