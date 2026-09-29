import type { TestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RECONNECT_TIMEOUT_MS, parseRoomEntry, type RoomEntry } from '../../src/shared/protocol/index.ts';
import type { PersistedRoom } from '../../src/worker/codec.ts';
import { selectingRoom } from '../unit/protocol/rooms.ts';
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
 * PFC-017 — déconnexion, pause, reprise et fermeture (D15), dans le vrai runtime Workers (workerd) :
 * vraies sockets, horloge de room figée, alarmes exécutées à la main. Chaque absence est provoquée par
 * la fermeture réelle d'une socket, ou par la perte d'une instance (état persisté « présent » relu sans
 * socket), jamais par une écriture de présence.
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
/** Contrat D08/D09/D15, écrit en clair : ouverture 2,2 s, sélection 5 s, reconnexion 30 s. */
const INTRO_MS = 2200;
const SELECTION_MS = 5000;
const RECONNECT_MS = 30_000;
/** Inactivité maximale d'une room (D16, PFC-018) : 30 min, sans lien avec la reconnexion. */
const IDLE_MS = 30 * 60_000;
/** Résultat burn en fin de partie : révélation 1,1 s + effet 3,6 s + résultat 1,6 s + fermeture 0,7 s. */
const BURN_END_MS = 1100 + 3600 + 1600 + 700;
/** Résultat burn, partie en cours : même chronologie suivie de la pause de 0,8 s. */
const BURN_NEXT_MS = 1100 + 3600 + 1600 + 800;

const ELEMENTS = /fire|water|plant/;
const CLOSE_ROOM_UNAVAILABLE = 4404;
const CLOSE_REPLACED = 4409;

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

/** Room à deux joueurs connectés, au lobby, à l'instant `T0`. */
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

let barrier = 0;

/** Trames reçues avant le pong d'un ping (le serveur traite les trames d'une socket dans l'ordre). */
async function drain(probe: SocketProbe): Promise<Frame[]> {
  barrier += 1;
  const requestId = `barrier-${String(barrier)}`;
  probe.send({ v: 1, type: 'ping', requestId, payload: {} });
  const before: Frame[] = [];
  for (;;) {
    const frame = await probe.next();
    if (frame['type'] === 'pong' && frame['requestId'] === requestId) return before;
    before.push(frame);
  }
}

const commands = {
  ready: (requestId: string, expectedSettingsRevision = 0) => ({ v: 1, type: 'ready', requestId, payload: { expectedSettingsRevision } }),
  settings: (requestId: string, target: number) => ({
    v: 1,
    type: 'update-settings',
    requestId,
    payload: { expectedSettingsRevision: 0, settings: { target, drawEnabled: true } },
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

/** Deux confirmations, puis l'ouverture s'écoule : manche 1 en sélection à `T0 + INTRO_MS`. Rend le matchId. */
async function start(d: Duel, settingsRevision = 0): Promise<string> {
  await send(d.host, commands.ready('ready-h', settingsRevision));
  await send(d.guest, commands.ready('ready-g', settingsRevision));
  await tick(d.code, T0 + INTRO_MS);
  await drain(d.host);
  await drain(d.guest);
  const { match, phase } = await state(d.code);
  expect(phase).toBe('selecting');
  return match?.id ?? '';
}

/** Ferme la socket de J2 à l'instant `at` et attend que la room ait traité son absence. */
async function guestLeaves(d: Duel, at: number): Promise<void> {
  await setClock(server, at);
  d.guest.close();
  await closedWith(d.guest);
  await expect.poll(async () => (await state(d.code)).connected[1]).toBe(false);
}

/** J2 ouvre une nouvelle socket avec son token : reprise de sa place. */
async function guestReturns(d: Duel, at: number): Promise<Frame> {
  await setClock(server, at);
  const { probe, snapshot } = await connect(d.code, d.tokens[1]);
  d.guest = probe;
  return snapshot;
}

/** Lit jusqu'à `room-closed` : rend ce message ; les états publiés avant ne sont pas examinés ici. */
async function roomClosed(probe: SocketProbe): Promise<Frame> {
  for (;;) {
    const frame = await probe.next();
    if (frame['type'] === 'room-closed') return frame;
    expect(frame['type']).toBe('state');
  }
}

/** Trames texte reçues par une socket avant la première qui porte un élément révélé. */
const beforeReveal = (probe: SocketProbe): readonly string[] => {
  const index = probe.raw.findIndex((raw) => raw.includes('"revealedChoices"'));
  return index === -1 ? probe.raw : probe.raw.slice(0, index);
};

describe('PFC-017-AC1 — une coupure met en pause ; la reprise restaure place, scores et temps restant', () => {
  it('PFC-017-S1 — la sélection a 2 s restantes, J2 revient 10 s plus tard : elle reprend avec 2 s et les mêmes choix cachés', async () => {
    const d = await duel();
    const matchId = await start(d);
    const deadline = T0 + INTRO_MS + SELECTION_MS;
    await send(d.host, commands.choice('c-h', matchId, 1, 'fire'));
    await send(d.guest, commands.choice('c-g', matchId, 1, 'water'));

    const leftAt = deadline - 2000;
    await guestLeaves(d, leftAt);
    const paused = await state(d.code);
    expect(paused).toMatchObject({
      phase: 'paused',
      resumePhase: 'selecting',
      resumeRemainingMs: 2000,
      reconnectDeadline: leftAt + RECONNECT_MS,
      deadline: leftAt + RECONNECT_MS,
      connected: [true, false],
      selection: ['fire', 'water'],
    });
    // J1 voit la pause, l'échéance de reconnexion et les deux verrous, jamais un élément.
    expect((await drain(d.host)).at(-1)).toMatchObject({
      type: 'state',
      phase: 'paused',
      resumePhase: 'selecting',
      deadline: leftAt + RECONNECT_MS,
      connected: [true, false],
      choiceLocked: [true, true],
    });
    expect(await alarm(server, d.code)).toBe(leftAt + RECONNECT_MS);

    const snapshot = await guestReturns(d, leftAt + 10_000);
    const resumed = leftAt + 10_000 + 2000;
    expect(snapshot).toMatchObject({ phase: 'selecting', deadline: resumed, connected: [true, true], choiceLocked: [true, true], yourSlot: 1 });
    expect(snapshot).not.toHaveProperty('revealedChoices');
    expect(await state(d.code)).toMatchObject({
      phase: 'selecting',
      resumePhase: null,
      resumeRemainingMs: null,
      reconnectDeadline: null,
      deadline: resumed,
      selection: ['fire', 'water'],
      match: { scores: [0, 0] },
    });
    expect((await drain(d.host)).at(-1)).toMatchObject({ phase: 'selecting', deadline: resumed, connected: [true, true] });
    expect(await alarm(server, d.code)).toBe(resumed);

    // Un choix déjà verrouillé le reste : un second est refusé ; la résolution utilise les choix d'avant la coupure.
    expect((await send(d.guest, commands.choice('c-g2', matchId, 1, 'plant'))).reply).toMatchObject({ code: 'CHOICE_LOCKED' });
    await tick(d.code, resumed);
    expect(await state(d.code)).toMatchObject({ phase: 'round-result', match: { scores: [0, 1] }, lastRound: { choices: ['fire', 'water'] } });
    for (const probe of [d.host, d.guest]) expect(beforeReveal(probe).join('\n')).not.toMatch(ELEMENTS);
  });

  it('juste avant l’échéance (29 999 ms), la reconnexion reprend la partie', async () => {
    const d = await duel();
    await start(d);
    const leftAt = T0 + INTRO_MS + 1000;
    await guestLeaves(d, leftAt);
    const snapshot = await guestReturns(d, leftAt + RECONNECT_MS - 1);
    expect(snapshot).toMatchObject({ phase: 'selecting', deadline: leftAt + RECONNECT_MS - 1 + 4000 });
  });

  it('pendant l’ouverture : pause avec le reste de la bannière, puis reprise de l’ouverture', async () => {
    const d = await duel();
    await send(d.host, commands.ready('ready-h'));
    await send(d.guest, commands.ready('ready-g'));
    expect(await state(d.code)).toMatchObject({ phase: 'starting', deadline: T0 + INTRO_MS });

    await guestLeaves(d, T0 + 1000);
    expect(await state(d.code)).toMatchObject({ phase: 'paused', resumePhase: 'starting', resumeRemainingMs: INTRO_MS - 1000 });
    const snapshot = await guestReturns(d, T0 + 5000);
    expect(snapshot).toMatchObject({ phase: 'starting', deadline: T0 + 5000 + INTRO_MS - 1000, roundId: 1 });
  });

  it('pendant le résultat : les scores déjà persistés restent, la chronologie reprend au même point', async () => {
    const d = await duel();
    const matchId = await start(d);
    await send(d.host, commands.choice('c-h', matchId, 1, 'fire'));
    await send(d.guest, commands.choice('c-g', matchId, 1, 'plant'));
    const resolvedAt = T0 + INTRO_MS + SELECTION_MS;
    await tick(d.code, resolvedAt);
    await drain(d.guest);

    await guestLeaves(d, resolvedAt + 3000);
    expect(await state(d.code)).toMatchObject({
      phase: 'paused',
      resumePhase: 'round-result',
      resumeRemainingMs: BURN_NEXT_MS - 3000,
      match: { scores: [1, 0] },
    });
    // La pause survenue au résultat garde la manche révélée publique (PROTOCOL « Réponses et projection »).
    expect((await drain(d.host)).at(-1)).toMatchObject({ phase: 'paused', resumePhase: 'round-result', revealedChoices: ['fire', 'plant'] });
    const snapshot = await guestReturns(d, resolvedAt + 20_000);
    expect(snapshot).toMatchObject({ phase: 'round-result', scores: [1, 0], deadline: resolvedAt + 20_000 + BURN_NEXT_MS - 3000 });
  });

  it('un choix envoyé pendant la pause est refusé (INVALID_PHASE) sans rien changer', async () => {
    const d = await duel();
    const matchId = await start(d);
    await guestLeaves(d, T0 + INTRO_MS + 1000);
    const before = await state(d.code);
    expect((await send(d.host, commands.choice('c-h', matchId, 1, 'fire'))).reply).toMatchObject({ type: 'error', code: 'INVALID_PHASE' });
    expect(await state(d.code)).toEqual(before);
  });

  it('coupure à l’instant exact de l’échéance : la manche est résolue d’abord, puis le résultat est mis en pause', async () => {
    const d = await duel();
    const matchId = await start(d);
    await send(d.host, commands.choice('c-h', matchId, 1, 'fire'));
    await send(d.guest, commands.choice('c-g', matchId, 1, 'plant'));
    const deadline = T0 + INTRO_MS + SELECTION_MS;

    await guestLeaves(d, deadline);
    expect(await state(d.code)).toMatchObject({
      phase: 'paused',
      resumePhase: 'round-result',
      resumeRemainingMs: BURN_NEXT_MS,
      match: { scores: [1, 0] },
      lastRound: { roundId: 1, choices: ['fire', 'plant'] },
    });
  });

  it('coupure 1 ms avant l’échéance : la sélection est mise en pause avec 1 ms, résolue 1 ms après la reprise', async () => {
    const d = await duel();
    await start(d);
    const deadline = T0 + INTRO_MS + SELECTION_MS;

    await guestLeaves(d, deadline - 1);
    expect(await state(d.code)).toMatchObject({ phase: 'paused', resumePhase: 'selecting', resumeRemainingMs: 1 });
    await guestReturns(d, deadline + 5000);
    expect(await alarm(server, d.code)).toBe(deadline + 5001);
    await tick(d.code, deadline + 5001);
    expect(await state(d.code)).toMatchObject({ phase: 'round-result', lastRound: { roundId: 1 } });
  });
});

describe('PFC-017-AC2 — à 30 s ou au-delà, fermeture sans trophée ; aucune reconnexion ne ressuscite la room', () => {
  it('PFC-017-S2 — la pause expire à t=30000 et une reconnexion arrive à t=30000 : room fermée sans trophée', async () => {
    const d = await duel();
    await start(d);
    const leftAt = T0 + INTRO_MS + 1000;
    await guestLeaves(d, leftAt);

    await setClock(server, leftAt + RECONNECT_MS);
    const late = await openSocket(server, d.code);
    open.push(late);
    // L'échéance passe avant l'arrivée : la room est fermée, la nouvelle socket n'obtient rien d'elle.
    expect(await late.next()).toMatchObject({ type: 'error', code: 'ROOM_UNAVAILABLE' });
    expect(await closedWith(late)).toBe(CLOSE_ROOM_UNAVAILABLE);
    expect(await roomClosed(d.host)).toEqual({ v: 1, type: 'room-closed', reason: 'reconnect-timeout' });
    expect(await closedWith(d.host)).toBe(CLOSE_ROOM_UNAVAILABLE);
    // Aucun état publié ne porte de trophée ; tokens, choix et alarme effacés ; le code n'est plus joignable.
    for (const raw of d.host.raw) expect(raw).not.toMatch(/"trophies":\[(?!0,0)/);
    expect(await tables(server, d.code)).toEqual([]);
    expect(await alarm(server, d.code)).toBeNull();
    expect((await server.fetch(`/api/rooms/${d.code}/join`, { method: 'POST' })).status).toBe(404);
    const again = await openSocket(server, d.code);
    open.push(again);
    expect(await again.next()).toMatchObject({ type: 'error', code: 'ROOM_UNAVAILABLE' });
    expect(await closedWith(again)).toBe(CLOSE_ROOM_UNAVAILABLE);
  });

  it('l’alarme de reconnexion ferme seule la room à l’échéance et prévient le joueur resté', async () => {
    const d = await duel();
    await start(d);
    const leftAt = T0 + INTRO_MS;
    await guestLeaves(d, leftAt);

    expect(await tick(d.code, leftAt + RECONNECT_MS - 1)).toBe(leftAt + RECONNECT_MS);
    expect(await readRoom(server, d.code)).not.toBeNull();
    expect(await tick(d.code, leftAt + RECONNECT_MS)).toBeNull();
    expect(await roomClosed(d.host)).toMatchObject({ reason: 'reconnect-timeout' });
    expect(await closedWith(d.host)).toBe(CLOSE_ROOM_UNAVAILABLE);
    expect(await tables(server, d.code)).toEqual([]);
  });

  it('les deux absents : le délai part de la première absence, jamais repoussé par la seconde ni par un retour partiel', async () => {
    const d = await duel();
    await start(d);
    const first = T0 + INTRO_MS + 500;
    await setClock(server, first);
    d.host.close();
    await closedWith(d.host);
    await expect.poll(async () => (await state(d.code)).connected[0]).toBe(false);
    await guestLeaves(d, first + 10_000);
    expect(await state(d.code)).toMatchObject({ phase: 'paused', connected: [false, false], reconnectDeadline: first + RECONNECT_MS, resumeRemainingMs: 4500 });

    // J2 revient seul : la pause continue, avec la même échéance.
    const snapshot = await guestReturns(d, first + 20_000);
    expect(snapshot).toMatchObject({ phase: 'paused', deadline: first + RECONNECT_MS, connected: [false, true] });
    expect(await alarm(server, d.code)).toBe(first + RECONNECT_MS);
    expect(await tick(d.code, first + RECONNECT_MS)).toBeNull();
    expect(await roomClosed(d.guest)).toMatchObject({ reason: 'reconnect-timeout' });
    expect(await tables(server, d.code)).toEqual([]);
  });

  it('au lobby : l’absent garde sa place 30 s (confirmation retirée), puis la room est fermée', async () => {
    const d = await duel();
    await send(d.guest, commands.ready('ready-g'));
    await guestLeaves(d, T0 + 1000);
    expect(await state(d.code)).toMatchObject({ phase: 'lobby', ready: [false, false], reconnectDeadline: T0 + 1000 + RECONNECT_MS });
    expect(await tick(d.code, T0 + 1000 + RECONNECT_MS)).toBeNull();
    expect(await roomClosed(d.host)).toMatchObject({ reason: 'reconnect-timeout' });
    expect(await tables(server, d.code)).toEqual([]);
  });
});

describe('PFC-017-AC3 — aucune double récompense, anciennes sockets ignorées, instance perdue', () => {
  /** Partie X = 1 : feu contre plante, J1 gagne à la première manche ; rend l'instant de résolution. */
  async function decisiveRound(d: Duel): Promise<number> {
    await send(d.host, commands.settings('s-1', 1));
    await drain(d.guest);
    const matchId = await start(d, 1);
    await send(d.host, commands.choice('c-h', matchId, 1, 'fire'));
    await send(d.guest, commands.choice('c-g', matchId, 1, 'plant'));
    const resolvedAt = T0 + INTRO_MS + SELECTION_MS;
    await tick(d.code, resolvedAt);
    await drain(d.host);
    await drain(d.guest);
    return resolvedAt;
  }

  it('coupure pendant le dernier résultat puis reprise : trophée réglé une fois ; revenir après la fin ne récompense pas deux fois', async () => {
    const d = await duel();
    const resolvedAt = await decisiveRound(d);
    await guestLeaves(d, resolvedAt + 1000);
    // Partie décidée mais non réglée : aucun trophée pendant la pause.
    expect(await state(d.code)).toMatchObject({ phase: 'paused', resumePhase: 'round-result', trophies: [0, 0], settledMatchId: null });

    await guestReturns(d, resolvedAt + 5000);
    const endAt = resolvedAt + 5000 + BURN_END_MS - 1000;
    // Fin de partie : reste l'inactivité (PFC-018), comptée depuis les choix ; la reprise ne la prolonge pas.
    expect(await tick(d.code, endAt)).toBe(T0 + INTRO_MS + IDLE_MS);
    const ended = await state(d.code);
    expect(ended).toMatchObject({ phase: 'match-ended', trophies: [1, 0] });

    // Nouvelle coupure et retour après la fin : trophées inchangés, aucune pause.
    await guestLeaves(d, endAt + 1000);
    expect(await state(d.code)).toMatchObject({ phase: 'match-ended', trophies: [1, 0], reconnectDeadline: endAt + 1000 + RECONNECT_MS });
    const snapshot = await guestReturns(d, endAt + 2000);
    expect(snapshot).toMatchObject({ phase: 'match-ended', trophies: [1, 0], matchResult: { status: 'won', winner: 0 } });
    expect(await state(d.code)).toMatchObject({ trophies: [1, 0], settledMatchId: ended.settledMatchId, reconnectDeadline: null });
    expect(await alarm(server, d.code)).toBe(T0 + INTRO_MS + IDLE_MS);
  });

  it('délai échu pendant le dernier résultat : partie jamais réglée, room fermée sans trophée', async () => {
    const d = await duel();
    const resolvedAt = await decisiveRound(d);
    await guestLeaves(d, resolvedAt + 1000);
    expect(await tick(d.code, resolvedAt + 1000 + RECONNECT_MS)).toBeNull();
    expect(await roomClosed(d.host)).toMatchObject({ reason: 'reconnect-timeout' });
    for (const raw of d.host.raw) expect(raw).not.toMatch(/"trophies":\[(?!0,0)/);
    expect(await tables(server, d.code)).toEqual([]);
  });

  it('en fin de partie : l’absent ne revient pas, la room est fermée à 30 s, trophées jamais réattribués', async () => {
    const d = await duel();
    const resolvedAt = await decisiveRound(d);
    const endAt = resolvedAt + BURN_END_MS;
    await tick(d.code, endAt);
    await drain(d.host);
    await guestLeaves(d, endAt + 100);
    expect(await tick(d.code, endAt + 100 + RECONNECT_MS)).toBeNull();
    expect(await roomClosed(d.host)).toMatchObject({ reason: 'reconnect-timeout' });
    // Seuls les trophées réglés à la fin (1/0) ont été publiés, jamais davantage.
    for (const raw of d.host.raw) expect(raw).not.toMatch(/"trophies":\[(?!0,0|1,0)/);
  });

  it('une ancienne socket remplacée (4409) puis fermée ne met pas en pause et n’écrit rien', async () => {
    const d = await duel();
    await start(d);
    const before = await state(d.code);
    const old = d.guest;
    const { probe } = await connect(d.code, d.tokens[1]);
    d.guest = probe;
    expect(await closedWith(old)).toBe(CLOSE_REPLACED);
    // Barrière : toute trame de l'ancienne génération serait traitée avant ce ping.
    expect(await drain(d.guest)).toEqual([]);
    expect(await drain(d.host)).toEqual([]);
    expect(await state(d.code)).toEqual(before);
  });

  it('instance perdue (redéploiement) avec une présence persistée : réconciliée en pause au premier événement', async () => {
    const name = 'reconnect-instance-lost';
    const deadline = T0 + 5000;
    const selecting = persisted(selectingRoom(['fire', null], { deadline, connected: [true, true] }), T0);
    expect((await writeRoom(server, name, selecting)).ok).toBe(true);
    await rebuild(server, name);

    // Première alarme de la nouvelle instance, 2 s avant l'échéance : aucune socket ne tient les places.
    await setClock(server, deadline - 2000);
    expect(await tick(name, deadline - 2000)).toBe(deadline - 2000 + RECONNECT_MS);
    expect(await state(name)).toMatchObject({
      phase: 'paused',
      resumePhase: 'selecting',
      resumeRemainingMs: 2000,
      connected: [false, false],
      reconnectDeadline: deadline - 2000 + RECONNECT_MS,
      selection: ['fire', null],
    });
  });

  it('instance perdue réveillée après l’échéance : la manche due est résolue d’abord, puis le résultat est mis en pause', async () => {
    const name = 'reconnect-instance-late';
    const deadline = T0 + 5000;
    expect((await writeRoom(server, name, persisted(selectingRoom(['fire', null], { deadline }), T0))).ok).toBe(true);
    await rebuild(server, name);

    await tick(name, deadline + 100);
    expect(await state(name)).toMatchObject({
      phase: 'paused',
      resumePhase: 'round-result',
      match: { scores: [1, 0] },
      lastRound: { roundId: 1, choices: ['fire', null], resolution: { kind: 'solo' } },
    });
  });
});

describe('PFC-017 — constante partagée', () => {
  it('le délai de reconnexion vaut 30 s (D15), côté serveur comme côté client', () => {
    expect(RECONNECT_TIMEOUT_MS).toBe(RECONNECT_MS);
  });
});
