import type { TestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseRoomEntry, parseServerMessage, type RoomEntry } from '../../src/shared/protocol/index.ts';
import type { PersistedRoom } from '../../src/worker/codec.ts';
import {
  alarm,
  closedWith,
  failCommits,
  openSocket,
  readRoom,
  rebuild,
  rows,
  runAlarm,
  setClock,
  startHarness,
  tables,
  type SocketProbe,
} from './support.ts';

/**
 * PFC-014 — machine de jeu serveur, dans le vrai runtime Workers (workerd) : vraies sockets, horloge
 * de room figée, alarmes exécutées à la main (celles planifiées sous l'horloge figée, en 2033, ne se
 * déclenchent jamais seules).
 */
let server: TestHarness;

beforeAll(async () => {
  server = await startHarness();
});

afterEach(async () => {
  await setClock(server, null);
});

afterAll(async () => {
  await server.close();
});

const T0 = 2_000_000_000_000;

/** Contrat D08/D09, écrit en clair : ouverture 1,8 s + 0,4 s, sélection 5 s. */
const INTRO_MS = 2200;
/** Inactivité maximale d'une room (D16, PFC-018) : 30 min. */
const IDLE_MS = 30 * 60_000;
const SELECTION_MS = 5000;
/**
 * Résultat de manche = révélation (1,1 s ; 0,5 s sans choix) + effet D + 1,6 s + suite (pause 0,8 s,
 * fermeture 0,7 s, mort subite 2,2 s + 0,3 s). D : burn 3,6 s, solo 2,4 s, void 2 s, flare 3 s.
 */
const RESULT_MS = {
  burnNext: 1100 + 3600 + 1600 + 800,
  burnEnd: 1100 + 3600 + 1600 + 700,
  waveEnd: 1100 + 3400 + 1600 + 700,
  soloNext: 1100 + 2400 + 1600 + 800,
  voidNext: 500 + 2000 + 1600 + 800,
  flareSudden: 1100 + 3000 + 1600 + 2200 + 300,
} as const;

const ELEMENT_PATTERN = /fire|water|plant/;

type Frame = Record<string, unknown>;

/** Tokens de reprise de chaque room de test (la room n'en garde que l'empreinte). */
const tokens = new Map<string, readonly [string, string]>();

interface Duel {
  readonly code: string;
  readonly host: SocketProbe;
  readonly guest: SocketProbe;
}

async function post(path: string): Promise<RoomEntry> {
  const response = await server.fetch(path, { method: 'POST' });
  const entry = parseRoomEntry(await response.json());
  if (entry === null) throw new Error(`Entrée refusée : ${String(response.status)}`);
  return entry;
}

async function connect(code: string, token: string): Promise<SocketProbe> {
  const probe = await openSocket(server, code);
  probe.send({ v: 1, type: 'authenticate', requestId: 'auth-1', payload: { resumeToken: token } });
  expect(await probe.next()).toMatchObject({ type: 'state' });
  expect(await probe.next()).toMatchObject({ type: 'ack', requestId: 'auth-1' });
  return probe;
}

/** Room à deux joueurs connectés, au lobby, à l'instant `T0`. */
async function duel(): Promise<Duel> {
  await setClock(server, T0);
  const host = await post('/api/rooms');
  const guest = await post(`/api/rooms/${host.roomCode}/join`);
  tokens.set(host.roomCode, [host.resumeToken, guest.resumeToken]);
  const hostProbe = await connect(host.roomCode, host.resumeToken);
  const guestProbe = await connect(host.roomCode, guest.resumeToken);
  expect(await hostProbe.next()).toMatchObject({ type: 'state', connected: [true, true] });
  return { code: host.roomCode, host: hostProbe, guest: guestProbe };
}

async function state(code: string): Promise<PersistedRoom> {
  const found = await readRoom(server, code);
  if (found === null) throw new Error(`Room ${code} absente.`);
  return found;
}

const commands = {
  ready: (requestId: string, expectedSettingsRevision = 0) => ({ v: 1, type: 'ready', requestId, payload: { expectedSettingsRevision } }),
  settings: (requestId: string, target: number, drawEnabled = true, expectedSettingsRevision = 0) => ({
    v: 1,
    type: 'update-settings',
    requestId,
    payload: { expectedSettingsRevision, settings: { target, drawEnabled } },
  }),
  choice: (requestId: string, matchId: string, roundId: number, element: string) => ({
    v: 1,
    type: 'submit-choice',
    requestId,
    matchId,
    roundId,
    payload: { element },
  }),
  rematch: (requestId: string, matchId: string, expectedSettingsRevision = 0) => ({
    v: 1,
    type: 'rematch-ready',
    requestId,
    matchId,
    payload: { expectedSettingsRevision },
  }),
  leave: (requestId: string) => ({ v: 1, type: 'leave', requestId, payload: {} }),
};

/** Envoie une commande et lit jusqu'à sa réponse (`ack` ou `error`) ; rend les trames publiées avant. */
async function send(probe: SocketProbe, frame: { requestId: string }): Promise<{ published: Frame[]; reply: Frame }> {
  probe.send(frame);
  const published: Frame[] = [];
  for (;;) {
    const next = await probe.next();
    if ((next['type'] === 'ack' || next['type'] === 'error') && next['requestId'] === frame.requestId) {
      return { published, reply: next };
    }
    published.push(next);
  }
}

let barrier = 0;

/** Barrière observable : les trames reçues avant le pong d'un ping (le serveur traite dans l'ordre). */
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

/** Avance l'horloge à `now` puis exécute l'alarme de la room ; rend la prochaine alarme planifiée. */
async function tick(code: string, now: number): Promise<number | null> {
  await setClock(server, now);
  const result = await runAlarm(server, code);
  expect(result.failed).toBe(false);
  return result.alarm;
}

/** Les deux joueurs confirment, puis l'ouverture s'écoule : manche 1 en sélection. Rend le matchId. */
async function start({ code, host, guest }: Duel, at = T0, settingsRevision = 0): Promise<string> {
  await setClock(server, at);
  await send(host, commands.ready('ready-h', settingsRevision));
  await send(guest, commands.ready('ready-g', settingsRevision));
  await tick(code, at + INTRO_MS);
  await drain(host);
  await drain(guest);
  const { match, phase } = await state(code);
  expect(phase).toBe('selecting');
  return match?.id ?? '';
}

function close(...probes: SocketProbe[]): void {
  for (const probe of probes) probe.close();
}

describe('PFC-014-AC1 — prêts, réglages et démarrage', () => {
  it('deux prêts démarrent : ouverture de 2,2 s, puis sélection de la manche 1 avec une échéance de 5 s', async () => {
    const d = await duel();
    const first = await send(d.host, commands.ready('ready-h'));
    expect(first.published).toEqual([expect.objectContaining({ phase: 'lobby', ready: [true, false] })]);
    expect(first.reply).toMatchObject({ type: 'ack', requestId: 'ready-h' });
    expect(await drain(d.guest)).toEqual([expect.objectContaining({ yourSlot: 1, ready: [true, false] })]);

    const second = await send(d.guest, commands.ready('ready-g'));
    const [starting] = second.published;
    expect(starting).toMatchObject({ phase: 'starting', roundId: 1, ready: [false, false], scores: [0, 0], deadline: T0 + INTRO_MS });
    expect(starting?.['matchId']).toMatch(/^m-\d+$/);
    expect(second.reply).toEqual({ v: 1, type: 'ack', requestId: 'ready-g', revision: starting?.['revision'] });
    expect(await drain(d.host)).toEqual([expect.objectContaining({ phase: 'starting', yourSlot: 0 })]);
    expect(await alarm(server, d.code)).toBe(T0 + INTRO_MS);

    // Un choix pendant l'ouverture est refusé : la manche 1 n'est pas encore ouverte.
    const early = await send(d.host, commands.choice('early', String(starting?.['matchId']), 1, 'fire'));
    expect(early.reply).toMatchObject({ type: 'error', code: 'INVALID_PHASE' });

    expect(await tick(d.code, T0 + INTRO_MS)).toBe(T0 + INTRO_MS + SELECTION_MS);
    expect(await drain(d.guest)).toEqual([
      expect.objectContaining({ phase: 'selecting', roundId: 1, deadline: T0 + INTRO_MS + SELECTION_MS, choiceLocked: [false, false] }),
    ]);
    close(d.host, d.guest);
  });

  it('changer les réglages efface les confirmations ; seul J1 modifie ; un ready d’une ancienne settingsRevision est rejeté', async () => {
    const d = await duel();
    await send(d.guest, commands.ready('ready-g'));
    await drain(d.host);

    const changed = await send(d.host, commands.settings('set-1', 5, false));
    expect(changed.published).toEqual([
      expect.objectContaining({ settings: { target: 5, drawEnabled: false }, settingsRevision: 1, ready: [false, false] }),
    ]);
    expect(await drain(d.guest)).toEqual([expect.objectContaining({ settingsRevision: 1, ready: [false, false] })]);

    const before = await rows(server, d.code);
    const stale = await send(d.guest, commands.ready('ready-stale', 0));
    expect(stale).toEqual({
      published: [],
      reply: expect.objectContaining({ type: 'error', requestId: 'ready-stale', code: 'STALE_SETTINGS' }) as unknown,
    });
    const notHost = await send(d.guest, commands.settings('set-guest', 7, true, 1));
    expect(notHost.reply).toMatchObject({ type: 'error', code: 'NOT_HOST' });
    // Mêmes réglages : acquittés sans écriture ni révision de réglages consommée.
    const same = await send(d.host, commands.settings('set-same', 5, false, 1));
    expect(same).toEqual({ published: [], reply: { v: 1, type: 'ack', requestId: 'set-same', revision: (await state(d.code)).revision } });
    expect(await rows(server, d.code)).toEqual(before);
    expect(await drain(d.host)).toEqual([]);

    const fresh = await send(d.guest, commands.ready('ready-fresh', 1));
    expect(fresh.reply).toMatchObject({ type: 'ack' });
    expect((await state(d.code)).ready).toEqual([false, true]);
    close(d.host, d.guest);
  });

  it('double prêt : un second ready est sans effet, un doublon de requestId rejoue l’ack, deux prêts simultanés démarrent une seule partie', async () => {
    const d = await duel();
    const first = await send(d.host, commands.ready('ready-1'));
    const revision = (await state(d.code)).revision;
    expect(first.reply).toEqual({ v: 1, type: 'ack', requestId: 'ready-1', revision });

    expect(await send(d.host, commands.ready('ready-1'))).toEqual({ published: [], reply: first.reply });
    expect(await send(d.host, commands.ready('ready-2'))).toEqual({
      published: [],
      reply: { v: 1, type: 'ack', requestId: 'ready-2', revision },
    });
    expect((await state(d.code)).revision).toBe(revision);
    await drain(d.guest);

    // J1 retire sa confirmation en partant ; les deux confirment ensuite dans la même rafale.
    close(d.host);
    expect(await d.guest.next()).toMatchObject({ connected: [false, true], ready: [false, false] });
    const host = await reconnect(d.code, 0);
    host.send(commands.ready('burst-h'));
    d.guest.send(commands.ready('burst-g'));
    const room = await waitFor(d.code, (current) => current.phase === 'starting');
    expect(room.revision).toBe(revision + 4);
    const hostFrames = await drain(host);
    const guestFrames = await drain(d.guest);
    const started = [...hostFrames, ...guestFrames].filter((frame) => frame['phase'] === 'starting');
    expect(started).toHaveLength(2);
    expect(new Set(started.map((frame) => frame['matchId']))).toEqual(new Set([room.match?.id]));
    close(host, d.guest);
  });
});

describe('PFC-014-AC2 — sélection de 5 s et résolution unique à l’échéance', () => {
  it('l’échéance n’est jamais avancée par les choix ; résolution à l’échéance, sans élément publié avant la révélation', async () => {
    const d = await duel();
    const matchId = await start(d);
    const deadline = T0 + INTRO_MS + SELECTION_MS;
    await setClock(server, T0 + INTRO_MS + 1000);

    const hostChoice = await send(d.host, commands.choice('c-h', matchId, 1, 'fire'));
    expect(hostChoice.published).toEqual([expect.objectContaining({ choiceLocked: [true, false], deadline })]);
    await send(d.guest, commands.choice('c-g', matchId, 1, 'plant'));
    expect(await drain(d.host)).toEqual([expect.objectContaining({ choiceLocked: [true, true], deadline })]);
    expect(await alarm(server, d.code)).toBe(deadline);
    expect((await state(d.code)).phase).toBe('selecting');
    const hidden = [...d.host.raw, ...d.guest.raw];
    for (const frame of hidden) expect(frame).not.toMatch(ELEMENT_PATTERN);

    // Juste avant l'échéance, rien n'est résolu.
    expect(await tick(d.code, deadline - 1)).toBe(deadline);
    expect((await state(d.code)).phase).toBe('selecting');

    expect(await tick(d.code, deadline)).toBe(deadline + RESULT_MS.burnNext);
    const [result] = await drain(d.guest);
    expect(result).toMatchObject({
      phase: 'round-result',
      roundId: 1,
      scores: [1, 0],
      revealedChoices: ['fire', 'plant'],
      result: { kind: 'burn', winner: 0, delta: [1, 0] },
      deadline: deadline + RESULT_MS.burnNext,
    });
    expect(parseServerMessage(JSON.stringify(result)).ok).toBe(true);

    // Fin du résultat : manche 2, choix effacés, nouvelle fenêtre pleine de 5 s.
    expect(await tick(d.code, deadline + RESULT_MS.burnNext)).toBe(deadline + RESULT_MS.burnNext + SELECTION_MS);
    expect(await drain(d.host)).toEqual([
      expect.objectContaining({ phase: 'round-result' }),
      expect.objectContaining({ phase: 'selecting', roundId: 2, choiceLocked: [false, false], scores: [1, 0] }),
    ]);
    close(d.host, d.guest);
  });

  it('R11 : un seul choix rapporte +1 ; un choix arrivé à l’instant exact de l’échéance est trop tardif', async () => {
    const d = await duel();
    const matchId = await start(d);
    const deadline = T0 + INTRO_MS + SELECTION_MS;
    await setClock(server, deadline - 1);
    await send(d.guest, commands.choice('c-g', matchId, 1, 'water'));
    await drain(d.host);

    await setClock(server, deadline);
    const late = await send(d.host, commands.choice('c-late', matchId, 1, 'fire'));
    // L'échéance due passe avant la commande : la manche est résolue, puis le choix refusé par la phase.
    expect(late.published).toEqual([
      expect.objectContaining({ phase: 'round-result', revealedChoices: [null, 'water'], scores: [0, 1] }),
    ]);
    expect(late.reply).toMatchObject({ type: 'error', code: 'INVALID_PHASE' });
    expect((await state(d.code)).lastRound?.resolution).toMatchObject({ kind: 'solo', winner: 1, delta: [0, 1] });
    expect(await alarm(server, d.code)).toBe(deadline + RESULT_MS.soloNext);
    close(d.host, d.guest);
  });

  it('R12 : aucun choix, manche annulée sans point, la partie continue', async () => {
    const d = await duel();
    await start(d);
    const deadline = T0 + INTRO_MS + SELECTION_MS;
    expect(await tick(d.code, deadline)).toBe(deadline + RESULT_MS.voidNext);
    const room = await state(d.code);
    expect(room).toMatchObject({ phase: 'round-result', match: { scores: [0, 0], result: { status: 'playing' } } });
    expect(room.lastRound?.resolution).toMatchObject({ kind: 'void', winner: null, delta: [0, 0] });
    await tick(d.code, deadline + RESULT_MS.voidNext);
    expect(await state(d.code)).toMatchObject({ phase: 'selecting', roundId: 2 });
    close(d.host, d.guest);
  });

  it('nul OFF, égalité au-delà de X : le résultat inclut la bannière « mort subite » avant la manche suivante', async () => {
    const d = await duel();
    await send(d.host, commands.settings('set', 1, false));
    await drain(d.guest);
    const matchId = await start(d, T0, 1);
    const deadline = T0 + INTRO_MS + SELECTION_MS;
    await send(d.host, commands.choice('c-h', matchId, 1, 'fire'));
    await send(d.guest, commands.choice('c-g', matchId, 1, 'fire'));
    expect(await tick(d.code, deadline)).toBe(deadline + RESULT_MS.flareSudden);
    expect(await state(d.code)).toMatchObject({ phase: 'round-result', match: { scores: [1, 1], result: { status: 'playing' } } });
    close(d.host, d.guest);
  });

  it('partie gagnée : fin après le résultat, trophée réglé une fois, puis revanche à deux confirmations', async () => {
    const d = await duel();
    await send(d.host, commands.settings('set', 1));
    await drain(d.guest);
    const matchId = await start(d, T0, 1);
    const deadline = T0 + INTRO_MS + SELECTION_MS;
    await send(d.host, commands.choice('c-h', matchId, 1, 'fire'));
    await send(d.guest, commands.choice('c-g', matchId, 1, 'plant'));

    expect(await tick(d.code, deadline)).toBe(deadline + RESULT_MS.burnEnd);
    // Le résultat final est affiché avant l'écran de fin : aucun trophée pendant l'effet.
    expect(await state(d.code)).toMatchObject({ phase: 'round-result', trophies: [0, 0], match: { result: { status: 'won', winner: 0 } } });

    // Fin de partie : plus aucune échéance de jeu ; reste l'inactivité (PFC-018), comptée depuis les choix.
    expect(await tick(d.code, deadline + RESULT_MS.burnEnd)).toBe(T0 + INTRO_MS + IDLE_MS);
    const [ended] = (await drain(d.guest)).slice(-1);
    expect(ended).toMatchObject({
      phase: 'match-ended',
      matchId,
      trophies: [1, 0],
      scores: [1, 0],
      matchResult: { status: 'won', winner: 0 },
      ready: [false, false],
    });
    expect(ended).not.toHaveProperty('deadline');
    expect(await state(d.code)).toMatchObject({ settledMatchId: matchId });

    await setClock(server, deadline + RESULT_MS.burnEnd + 1000);
    await send(d.host, commands.rematch('re-h', matchId, 1));
    expect(await drain(d.guest)).toEqual([expect.objectContaining({ phase: 'match-ended', ready: [true, false] })]);
    const rematch = await send(d.guest, commands.rematch('re-g', matchId, 1));
    const [starting] = rematch.published;
    expect(starting).toMatchObject({ phase: 'starting', roundId: 1, scores: [0, 0], trophies: [1, 0] });
    expect(starting?.['matchId']).not.toBe(matchId);
    // Une confirmation retardée de l'ancienne partie ne vise jamais la nouvelle.
    const stale = await send(d.host, commands.rematch('re-old', matchId, 1));
    expect(stale.reply).toMatchObject({ type: 'error', code: 'STALE_ROUND' });
    close(d.host, d.guest);
  });
});

describe('PFC-014-AC3 — doublons, obsolescence, retard, reconstruction et panne', () => {
  it('PFC-014-S1 — la même alarme traitée deux fois : scores et trophées appliqués une seule fois', async () => {
    const d = await duel();
    await send(d.host, commands.settings('set', 1));
    await drain(d.guest);
    const matchId = await start(d, T0, 1);
    const deadline = T0 + INTRO_MS + SELECTION_MS;
    await send(d.host, commands.choice('c-h', matchId, 1, 'water'));
    await send(d.guest, commands.choice('c-g', matchId, 1, 'fire'));

    await tick(d.code, deadline);
    const resolved = await state(d.code);
    await tick(d.code, deadline);
    expect(await state(d.code)).toEqual(resolved);
    expect(resolved.match?.scores).toEqual([1, 0]);

    const end = deadline + RESULT_MS.waveEnd;
    await tick(d.code, end);
    const ended = await state(d.code);
    await tick(d.code, end);
    await tick(d.code, end + 60_000);
    expect(await state(d.code)).toEqual(ended);
    expect(ended).toMatchObject({ phase: 'match-ended', trophies: [1, 0], match: { scores: [1, 0] } });
    const published = (await drain(d.host)).filter((frame) => frame['phase'] === 'match-ended');
    expect(published).toHaveLength(1);
    close(d.host, d.guest);
  });

  it('PFC-014-S2 — la room joue roundId=3, un choix de roundId=2 arrive : STALE_ROUND sans changer la manche 3', async () => {
    const d = await duel();
    const matchId = await start(d);
    let now = T0 + INTRO_MS + SELECTION_MS;
    for (let round = 1; round < 3; round += 1) {
      now = (await tick(d.code, now)) ?? 0; // manche vide résolue
      now = (await tick(d.code, now)) ?? 0; // manche suivante ouverte
    }
    await drain(d.host);
    const before = await state(d.code);
    expect(before).toMatchObject({ phase: 'selecting', roundId: 3 });

    const stale = await send(d.host, commands.choice('c-old', matchId, 2, 'fire'));
    expect(stale).toEqual({ published: [], reply: expect.objectContaining({ type: 'error', code: 'STALE_ROUND' }) as unknown });
    expect(await state(d.code)).toEqual(before);
    close(d.host, d.guest);
  });

  it('double submit : un doublon de requestId rejoue l’ack sans écriture ; un autre choix est CHOICE_LOCKED', async () => {
    const d = await duel();
    const matchId = await start(d);
    const first = await send(d.host, commands.choice('c-1', matchId, 1, 'fire'));
    const before = await rows(server, d.code);

    expect(await send(d.host, commands.choice('c-1', matchId, 1, 'fire'))).toEqual({ published: [], reply: first.reply });
    const other = await send(d.host, commands.choice('c-2', matchId, 1, 'water'));
    expect(other.reply).toMatchObject({ type: 'error', code: 'CHOICE_LOCKED' });
    expect(await rows(server, d.code)).toEqual(before);
    expect((await state(d.code)).selection).toEqual(['fire', null]);
    close(d.host, d.guest);
  });

  it('alarme en retard : une seule transition, et la fenêtre suivante garde ses 5 s pleines', async () => {
    const d = await duel();
    await start(d);
    const deadline = T0 + INTRO_MS + SELECTION_MS;
    const late = deadline + 20_000;
    expect(await tick(d.code, late)).toBe(late + RESULT_MS.voidNext);
    expect(await state(d.code)).toMatchObject({ phase: 'round-result', roundId: 1 });

    const later = late + RESULT_MS.voidNext + 45_000;
    expect(await tick(d.code, later)).toBe(later + SELECTION_MS);
    expect(await state(d.code)).toMatchObject({ phase: 'selecting', roundId: 2, deadline: later + SELECTION_MS });
    close(d.host, d.guest);
  });

  it('reconstruction de l’objet entre un choix et l’échéance : pause puis résolution avec le choix persisté', async () => {
    const d = await duel();
    const matchId = await start(d);
    await send(d.host, commands.choice('c-h', matchId, 1, 'plant'));
    const pausedAt = T0 + INTRO_MS;
    // Une socket standard retient l'objet en mémoire (D37) : il n'est reconstruit qu'une fois vide. Les
    // deux départs mettent la sélection en pause (PFC-017), ses 5 s intactes.
    close(d.host, d.guest);
    await closedWith(d.host);
    await closedWith(d.guest);
    await expect.poll(async () => (await state(d.code)).connected).toEqual([false, false]);

    await rebuild(server, d.code);
    expect(await state(d.code)).toMatchObject({ phase: 'paused', resumePhase: 'selecting', resumeRemainingMs: SELECTION_MS });
    expect(await alarm(server, d.code)).toBe(pausedAt + 30_000);
    const [hostToken, guestToken] = tokens.get(d.code) ?? ['', ''];
    await setClock(server, pausedAt + 1_000);
    const host = await connect(d.code, hostToken);
    const guest = await connect(d.code, guestToken);
    const deadline = pausedAt + 1_000 + SELECTION_MS;
    expect(await state(d.code)).toMatchObject({ phase: 'selecting', deadline, reconnectDeadline: null });
    await tick(d.code, deadline);

    const room = await state(d.code);
    expect(room).toMatchObject({ phase: 'round-result', match: { scores: [1, 0] } });
    expect(room.lastRound).toMatchObject({ roundId: 1, choices: ['plant', null], resolution: { kind: 'solo', winner: 0 } });
    close(host, guest);
  });

  it('panne de stockage à l’échéance : rien n’est publié ni écrit ; l’alarme relancée résout une seule fois', async () => {
    const d = await duel();
    const matchId = await start(d);
    await send(d.host, commands.choice('c-h', matchId, 1, 'fire'));
    await drain(d.guest);
    const deadline = T0 + INTRO_MS + SELECTION_MS;
    const before = await rows(server, d.code);

    await failCommits(server, d.code, 1);
    await setClock(server, deadline);
    expect(await runAlarm(server, d.code)).toEqual({ alarm: deadline, failed: true });
    expect(await rows(server, d.code)).toEqual(before);
    await setClock(server, deadline - 1);
    expect(await drain(d.host)).toEqual([]);
    expect(await drain(d.guest)).toEqual([]);

    await tick(d.code, deadline);
    const results = (await drain(d.guest)).filter((frame) => frame['phase'] === 'round-result');
    expect(results).toEqual([expect.objectContaining({ scores: [1, 0], result: { kind: 'solo', winner: 0, delta: [1, 0] } })]);
    close(d.host, d.guest);
  });

  it('panne de stockage sur une commande : aucun choix enregistré ni publié, la socket fermée en 1011', async () => {
    const d = await duel();
    const matchId = await start(d);
    const before = await state(d.code);

    await failCommits(server, d.code, 1);
    d.host.send(commands.choice('c-h', matchId, 1, 'fire'));
    expect(await closedWith(d.host)).toBe(1011);
    expect(d.host.raw.some((frame) => frame.includes('"requestId":"c-h"'))).toBe(false);
    for (const frame of await drain(d.guest)) expect(frame).toMatchObject({ choiceLocked: [false, false] });
    expect((await state(d.code)).selection).toEqual(before.selection);
    close(d.guest);
  });

  it('leave en pleine manche : room fermée pour les deux, sans trophée, stockage et alarme effacés', async () => {
    const d = await duel();
    await start(d);
    const left = await send(d.guest, commands.leave('bye'));
    expect(left.published).toEqual([{ v: 1, type: 'room-closed', reason: 'left' }]);
    expect(left.reply).toMatchObject({ type: 'ack', requestId: 'bye' });
    expect(await d.host.next()).toEqual({ v: 1, type: 'room-closed', reason: 'left' });
    expect(await closedWith(d.host)).toBe(4404);
    expect(await closedWith(d.guest)).toBe(4404);
    expect(await tables(server, d.code)).toEqual([]);
    expect(await alarm(server, d.code)).toBeNull();
  });
});

/** Nouvelle socket authentifiée pour une place (reprise par son token). */
async function reconnect(code: string, slot: 0 | 1): Promise<SocketProbe> {
  const pair = tokens.get(code);
  if (pair === undefined) throw new Error('Tokens inconnus.');
  return connect(code, pair[slot]);
}

/** Relit la room jusqu'à ce que `predicate` soit vrai (au plus 10 s) : aucune attente arbitraire. */
async function waitFor(code: string, predicate: (room: PersistedRoom) => boolean): Promise<PersistedRoom> {
  const limit = Date.now() + 10_000;
  for (;;) {
    const room = await state(code);
    if (predicate(room)) return room;
    if (Date.now() > limit) throw new Error('État attendu jamais atteint.');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
