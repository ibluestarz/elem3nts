import type { TestHarness } from 'wrangler';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parseServerMessage, SOCKET_CLOSE_CODES } from '../../src/shared/protocol/index.ts';
import {
  commands,
  createDriver,
  ELEMENT_PATTERN,
  INTRO_MS,
  RESULT_MS,
  SELECTION_MS,
  sha256,
  T0,
  type Driver,
  type Duel,
  type Frame,
} from './driver.ts';
import { alarm, closedWith, failCommits, openSocket, rows, runAlarm, setClock, startHarness, tables, type SocketProbe } from './support.ts';

/**
 * PFC-019 — recette multijoueur et tests adverses, dans le vrai runtime Workers (workerd) : vraies
 * sockets, horloge des rooms figée et partagée par toutes les rooms du harnais, alarmes exécutées à la
 * main. Aucun délai réel n'intervient : chaque test est déterministe. Les cas déjà prouvés ailleurs ne
 * sont pas recopiés (voir docs/TESTING.md « Depuis PFC-019 ») ; cette suite couvre les courses et
 * entrées adverses restantes, et les captures serveur → clients de bout en bout.
 */
let server: TestHarness;
let drv: Driver;

beforeAll(async () => {
  server = await startHarness();
  drv = createDriver(server);
});

afterEach(async () => {
  drv.closeAll();
  await setClock(server, null);
});

afterAll(async () => {
  await server.close();
});

const DEADLINE = T0 + INTRO_MS + SELECTION_MS;

/** Room en X = 1 (révision de réglages 1) : une manche gagnée termine la partie. */
async function shortDuel(): Promise<Duel> {
  const d = await drv.duel();
  await drv.send(d.host, commands.settings('set-x1', 1));
  await drv.drain(d.guest);
  return d;
}

/** Choix acceptés des deux joueurs dans la manche 1. */
async function lock(d: Duel, matchId: string, host: string, guest: string): Promise<void> {
  expect((await drv.send(d.host, commands.choice('c-h', matchId, 1, host))).reply).toMatchObject({ type: 'ack' });
  expect((await drv.send(d.guest, commands.choice('c-g', matchId, 1, guest))).reply).toMatchObject({ type: 'ack' });
}

/** Trames reçues par une socket avant la première qui révèle les choix. */
function beforeReveal(probe: SocketProbe): readonly string[] {
  const index = probe.raw.findIndex((raw) => raw.includes('"revealedChoices"'));
  return index === -1 ? probe.raw : probe.raw.slice(0, index);
}

/** Chaque trame reçue respecte le schéma serveur et ne porte aucun token ni empreinte de token. */
function expectClean(probe: SocketProbe, tokens: readonly string[]): void {
  for (const frame of probe.raw) {
    expect(parseServerMessage(frame).ok).toBe(true);
    for (const token of tokens) {
      expect(frame).not.toContain(token);
      expect(frame).not.toContain(sha256(token));
    }
  }
}

/** Ferme la socket de J2 à l'instant courant et attend que la room ait traité son absence. */
async function guestLeaves(d: Duel): Promise<void> {
  d.guest.close();
  await closedWith(d.guest);
  await expect.poll(async () => (await drv.state(d.code)).connected[1]).toBe(false);
}

describe('PFC-019-S1 — rooms indépendantes en parallèle', () => {
  it('PFC-019-S1 — une manche gagnée dans A ne change ni l’état ni les trophées de B, puis B se résout seule', async () => {
    const a = await shortDuel();
    const b = await shortDuel();
    // Horloge partagée et toujours croissante. B démarre 7,1 s après A : sa sélection (T0 + 9,3 s à
    // T0 + 14,3 s) couvre la fin de A (T0 + 14,2 s), et aucune échéance de B n'est due aux points de contrôle
    // (un ping la réglerait légitimement). Seules les alarmes de la room visée sont exécutées.
    const bStart = T0 + 7100;
    const bOpen = bStart + INTRO_MS;
    const bDeadline = bOpen + SELECTION_MS;
    const aEnd = DEADLINE + RESULT_MS.burnEnd;
    expect(bDeadline).toBeGreaterThan(aEnd);

    const matchA = await drv.start(a, T0, 1);
    await lock(a, matchA, 'fire', 'plant'); // J1 gagnera A
    await setClock(server, bStart);
    await drv.send(b.host, commands.ready('ready-h', 1));
    await drv.send(b.guest, commands.ready('ready-g', 1));
    for (const probe of [a.host, a.guest, b.host, b.guest]) await drv.drain(probe);

    /** B intact : même ligne persistée (révision, phase, choix, scores, trophées), même alarme, aucune trame. */
    const expectUntouched = async (d: Duel, persisted: unknown, due: number | null): Promise<void> => {
      expect(await rows(server, d.code)).toEqual(persisted);
      expect(await alarm(server, d.code)).toBe(due);
      expect(await drv.drain(d.host)).toEqual([]);
      expect(await drv.drain(d.guest)).toEqual([]);
    };

    // Manche gagnée dans A pendant l'ouverture de B.
    let rowsB = await rows(server, b.code);
    expect(await drv.tick(a.code, DEADLINE)).toBe(aEnd);
    expect(await drv.state(a.code)).toMatchObject({ phase: 'round-result', match: { scores: [1, 0] } });
    await expectUntouched(b, rowsB, bOpen);

    // B ouvre sa sélection et verrouille ses choix ; A termine sa partie et règle son trophée.
    await drv.tick(b.code, bOpen);
    const matchB = (await drv.state(b.code)).match?.id ?? '';
    await lock(b, matchB, 'fire', 'water'); // J2 gagnera B
    for (const probe of [b.host, b.guest]) await drv.drain(probe);
    rowsB = await rows(server, b.code);
    await drv.tick(a.code, aEnd);
    expect(await drv.state(a.code)).toMatchObject({ phase: 'match-ended', trophies: [1, 0], settledMatchId: matchA });
    await expectUntouched(b, rowsB, bDeadline);
    expect(await drv.state(b.code)).toMatchObject({ phase: 'selecting', trophies: [0, 0], selection: ['fire', 'water'] });

    // B se résout ensuite avec ses propres choix, sans rien changer à A.
    for (const probe of [a.host, a.guest]) await drv.drain(probe);
    const rowsA = await rows(server, a.code);
    const alarmA = await alarm(server, a.code);
    const bEnd = await drv.tick(b.code, bDeadline);
    await drv.tick(b.code, bEnd ?? 0);
    expect(await drv.state(b.code)).toMatchObject({
      phase: 'match-ended',
      trophies: [0, 1],
      lastRound: { choices: ['fire', 'water'] },
      settledMatchId: matchB,
    });
    await expectUntouched(a, rowsA, alarmA);

    // Aucune trame de A ne mentionne B, et réciproquement (le matchId n'est unique que dans sa room :
    // les commandes sont rattachées à la room de la socket authentifiée, jamais à un identifiant global).
    for (const probe of [a.host, a.guest]) expect(probe.raw.join('\n')).not.toContain(b.code);
    for (const probe of [b.host, b.guest]) expect(probe.raw.join('\n')).not.toContain(a.code);
  });
});

describe('PFC-019-S2 — fuite avant révélation et secrets, sur une partie complète', () => {
  it('PFC-019-S2 — deux choix verrouillés : aucune trame reçue avant la révélation ne porte un élément ; aucun token ni empreinte, jusqu’à la revanche', async () => {
    const d = await shortDuel();
    const matchId = await drv.start(d, T0, 1);
    await lock(d, matchId, 'fire', 'water');
    // Chaque joueur voit les deux verrous, jamais un élément (le sien est gardé par le client).
    for (const probe of [d.host, d.guest]) {
      await drv.drain(probe);
      const states = probe.raw.map((raw) => JSON.parse(raw) as Frame).filter((frame) => frame['type'] === 'state');
      expect(states.at(-1)).toMatchObject({ phase: 'selecting', choiceLocked: [true, true] });
    }

    const end = await drv.tick(d.code, DEADLINE);
    expect(end).toBe(DEADLINE + RESULT_MS.waveEnd);
    await drv.tick(d.code, end ?? 0);
    await drv.send(d.host, commands.rematch('re-h', matchId, 1));
    await drv.send(d.guest, commands.rematch('re-g', matchId, 1));
    for (const probe of [d.host, d.guest]) await drv.drain(probe);

    for (const probe of [d.host, d.guest]) {
      const before = beforeReveal(probe);
      expect(before.length).toBeGreaterThan(3);
      for (const frame of before) expect(frame).not.toMatch(ELEMENT_PATTERN);
      const reveal = parseServerMessage(probe.raw[before.length] ?? '');
      expect(reveal.ok && reveal.message).toMatchObject({ type: 'state', phase: 'round-result', revealedChoices: ['fire', 'water'] });
      expectClean(probe, d.tokens);
    }
    expect(await drv.state(d.code)).toMatchObject({ phase: 'starting', trophies: [0, 1] });
  });
});

type Phase = 'lobby' | 'starting' | 'selecting' | 'round-result' | 'match-ended';
type Refused = readonly [label: string, phase: Phase, sender: 'host' | 'guest', code: string, build: (matchId: string) => { requestId: string }];

/** Amène une room X = 1 à `phase` (J1 gagne la manche 1) ; rend le matchId courant ('' au lobby). */
async function reach(d: Duel, phase: Phase): Promise<string> {
  if (phase === 'lobby') return '';
  await setClock(server, T0);
  await drv.send(d.host, commands.ready('ready-h', 1));
  await drv.send(d.guest, commands.ready('ready-g', 1));
  const matchId = (await drv.state(d.code)).match?.id ?? '';
  if (phase !== 'starting') await drv.tick(d.code, T0 + INTRO_MS);
  if (phase === 'round-result' || phase === 'match-ended') {
    await lock(d, matchId, 'fire', 'plant');
    await drv.tick(d.code, DEADLINE);
  }
  if (phase === 'match-ended') await drv.tick(d.code, DEADLINE + RESULT_MS.burnEnd);
  await drv.drain(d.host);
  await drv.drain(d.guest);
  expect((await drv.state(d.code)).phase).toBe(phase);
  return matchId;
}

const REFUSED: readonly Refused[] = [
  ['un choix au lobby', 'lobby', 'host', 'INVALID_PHASE', () => commands.choice('bad', 'm-0', 1, 'fire')],
  ['un choix pendant l’ouverture', 'starting', 'guest', 'INVALID_PHASE', (m) => commands.choice('bad', m, 1, 'fire')],
  ['un choix pendant le résultat', 'round-result', 'guest', 'INVALID_PHASE', (m) => commands.choice('bad', m, 1, 'water')],
  ['un choix après la fin de partie', 'match-ended', 'guest', 'INVALID_PHASE', (m) => commands.choice('bad', m, 1, 'water')],
  ['une revanche au lobby', 'lobby', 'host', 'INVALID_PHASE', () => commands.rematch('bad', 'm-0', 1)],
  ['une revanche en pleine sélection', 'selecting', 'guest', 'INVALID_PHASE', (m) => commands.rematch('bad', m, 1)],
  ['une revanche pendant le résultat', 'round-result', 'host', 'INVALID_PHASE', (m) => commands.rematch('bad', m, 1)],
  ['un prêt en pleine sélection', 'selecting', 'host', 'INVALID_PHASE', () => commands.ready('bad', 1)],
  ['un prêt en fin de partie', 'match-ended', 'host', 'INVALID_PHASE', () => commands.ready('bad', 1)],
  ['des réglages de l’hôte en pleine sélection', 'selecting', 'host', 'INVALID_PHASE', () => commands.settings('bad', 3, 1)],
  ['des réglages de l’hôte pendant l’ouverture', 'starting', 'host', 'INVALID_PHASE', () => commands.settings('bad', 3, 1)],
  ['des réglages de l’invité au lobby', 'lobby', 'guest', 'NOT_HOST', () => commands.settings('bad', 3, 1)],
  ['des réglages de l’invité en fin de partie', 'match-ended', 'guest', 'NOT_HOST', () => commands.settings('bad', 3, 1)],
];

describe('PFC-019-AC2 — mauvaise phase : refus sans écriture, sans publication, sans décaler une échéance', () => {
  it.each(REFUSED)('%s (%s, %s) → %s', async (_label, phase, sender, code, build) => {
    const d = await shortDuel();
    const matchId = await reach(d, phase);
    const before = await rows(server, d.code);
    const due = await alarm(server, d.code);
    const other = sender === 'host' ? d.guest : d.host;

    const refused = await drv.send(d[sender], build(matchId));

    expect(refused).toEqual({ published: [], reply: expect.objectContaining({ type: 'error', code }) as unknown });
    expect(await rows(server, d.code)).toEqual(before);
    expect(await alarm(server, d.code)).toBe(due);
    expect(await drv.drain(other)).toEqual([]);
  });
});

describe('PFC-019-AC2 — doublons et commandes obsolètes', () => {
  it('revanche en double : même requestId → même ack sans écriture ; autre requestId déjà prêt → ack courant sans écriture ; une seule nouvelle partie', async () => {
    const d = await shortDuel();
    const matchId = await reach(d, 'match-ended');
    const first = await drv.send(d.host, commands.rematch('re-h', matchId, 1));
    expect(first.reply).toMatchObject({ type: 'ack' });
    expect(await drv.drain(d.guest)).toEqual([expect.objectContaining({ phase: 'match-ended', ready: [true, false] })]);
    const confirmed = await rows(server, d.code);

    expect(await drv.send(d.host, commands.rematch('re-h', matchId, 1))).toEqual({ published: [], reply: first.reply });
    expect(await drv.send(d.host, commands.rematch('re-h2', matchId, 1))).toEqual({
      published: [],
      reply: { v: 1, type: 'ack', requestId: 're-h2', revision: first.reply['revision'] },
    });
    expect(await rows(server, d.code)).toEqual(confirmed);
    expect(await drv.drain(d.guest)).toEqual([]);

    const started = await drv.send(d.guest, commands.rematch('re-g', matchId, 1));
    expect(started.published).toEqual([expect.objectContaining({ phase: 'starting', trophies: [1, 0], scores: [0, 0] })]);
    // Le doublon de J2 après le départ rejoue sa réponse : aucune seconde partie, aucun trophée de plus.
    const newMatch = (await drv.state(d.code)).match?.id;
    expect(await drv.send(d.guest, commands.rematch('re-g', matchId, 1))).toEqual({ published: [], reply: started.reply });
    expect(await drv.state(d.code)).toMatchObject({ phase: 'starting', trophies: [1, 0], match: { id: newMatch } });
  });

  it('reprise puis renvoi d’un choix en attente (même requestId, sur une nouvelle socket) : même ack, choix d’origine conservé', async () => {
    const d = await drv.duel();
    const matchId = await drv.start(d);
    const first = await drv.send(d.guest, commands.choice('c-g', matchId, 1, 'water'));
    await setClock(server, T0 + INTRO_MS + 1000);
    await guestLeaves(d);
    d.guest = (await drv.connect(d.code, d.tokens[1], 'auth-2')).probe;
    await drv.drain(d.guest);
    const resumed = await rows(server, d.code);

    // Le client renvoie la commande dont il n'a pas reçu l'ack ; un intercepteur la rejoue altérée.
    expect(await drv.send(d.guest, commands.choice('c-g', matchId, 1, 'water'))).toEqual({ published: [], reply: first.reply });
    expect(await drv.send(d.guest, commands.choice('c-g', matchId, 1, 'plant'))).toEqual({ published: [], reply: first.reply });
    expect(await rows(server, d.code)).toEqual(resumed);
    expect((await drv.state(d.code)).selection).toEqual([null, 'water']);
    expect(await drv.drain(d.host)).not.toContainEqual(expect.objectContaining({ revealedChoices: expect.anything() as unknown }));
  });

  it('obsolètes : revanche sur des réglages périmés → STALE_SETTINGS ; choix visant l’ancienne partie → STALE_ROUND', async () => {
    const d = await shortDuel();
    const matchId = await reach(d, 'match-ended');
    await drv.send(d.host, commands.settings('set-x2', 2, 1));
    await drv.drain(d.guest);
    const changed = await rows(server, d.code);

    const stale = await drv.send(d.guest, commands.rematch('re-old', matchId, 1));
    expect(stale.reply).toMatchObject({ type: 'error', code: 'STALE_SETTINGS' });
    expect(await rows(server, d.code)).toEqual(changed);

    await drv.send(d.host, commands.rematch('re-h', matchId, 2));
    await drv.send(d.guest, commands.rematch('re-g', matchId, 2));
    await drv.tick(d.code, DEADLINE + RESULT_MS.burnEnd + INTRO_MS);
    const current = await drv.state(d.code);
    expect(current).toMatchObject({ phase: 'selecting', roundId: 1 });
    expect(current.match?.id).not.toBe(matchId);
    const oldChoice = await drv.send(d.host, commands.choice('c-old', matchId, 1, 'fire'));
    expect(oldChoice.reply).toMatchObject({ type: 'error', code: 'STALE_ROUND' });
    expect(await drv.state(d.code)).toEqual(current);
  });
});

describe('PFC-019-AC2 — room tierce en pleine partie', () => {
  it('un token de la room B présenté à A (4401), puis un troisième join HTTP (409) : A ne change pas et ne publie rien', async () => {
    const a = await drv.duel();
    const b = await drv.duel();
    const matchId = await drv.start(a);
    await drv.send(a.host, commands.choice('c-h', matchId, 1, 'fire'));
    await drv.drain(a.guest);
    const before = await rows(server, a.code);

    for (const token of b.tokens) {
      const intruder = await openSocket(server, a.code);
      intruder.send({ v: 1, type: 'authenticate', requestId: 'auth-x', payload: { resumeToken: token } });
      expect(await intruder.next()).toMatchObject({ type: 'error', code: 'UNAUTHORIZED', requestId: 'auth-x' });
      expect(await closedWith(intruder)).toBe(SOCKET_CLOSE_CODES.UNAUTHORIZED);
      expect(intruder.raw).toHaveLength(1);
    }
    const third = await server.fetch(`/api/rooms/${a.code}/join`, { method: 'POST' });
    expect(third.status).toBe(409);
    expect(await third.json()).toMatchObject({ error: { code: 'ROOM_FULL' } });

    expect(await rows(server, a.code)).toEqual(before);
    expect(await drv.drain(a.host)).toEqual([]);
    expect(await drv.drain(a.guest)).toEqual([]);
    for (const probe of [a.host, a.guest]) expectClean(probe, [...a.tokens, ...b.tokens]);
  });
});

describe('PFC-019-AC2 — alarmes répétées et concurrentes aux échéances de jeu', () => {
  it('trois alarmes et un choix tardif au même instant : la manche est résolue une fois, le trophée réglé une fois', async () => {
    const d = await shortDuel();
    const matchId = await drv.start(d, T0, 1);
    await drv.send(d.host, commands.choice('c-h', matchId, 1, 'fire'));
    await drv.drain(d.guest);

    await setClock(server, DEADLINE);
    const [late, ...alarms] = await Promise.all([
      drv.send(d.guest, commands.choice('c-late', matchId, 1, 'water')),
      runAlarm(server, d.code),
      runAlarm(server, d.code),
      runAlarm(server, d.code),
    ]);
    // Une échéance due passe avant toute commande (D43) : le choix à l'instant exact est trop tardif.
    expect(late.reply).toMatchObject({ type: 'error', code: 'INVALID_PHASE' });
    for (const result of alarms) expect(result).toEqual({ alarm: DEADLINE + RESULT_MS.soloEnd, failed: false });
    expect(await drv.state(d.code)).toMatchObject({ phase: 'round-result', match: { scores: [1, 0] }, lastRound: { choices: ['fire', null] } });

    const end = DEADLINE + RESULT_MS.soloEnd;
    await setClock(server, end);
    await Promise.all([runAlarm(server, d.code), runAlarm(server, d.code), runAlarm(server, d.code)]);
    expect(await drv.state(d.code)).toMatchObject({ phase: 'match-ended', trophies: [1, 0], settledMatchId: matchId });
    for (const probe of [d.host, d.guest]) {
      await drv.drain(probe);
      const phases = probe.raw.map((raw) => (JSON.parse(raw) as Frame)['phase']);
      expect(phases.filter((phase) => phase === 'round-result')).toHaveLength(1);
      expect(phases.filter((phase) => phase === 'match-ended')).toHaveLength(1);
    }
  });
});

describe('PFC-019 — nul simultané en ligne (R07, R09, R10 ; TRACEABILITY)', () => {
  it('nul ON, feu/feu à X = 1 : fin de partie nulle, un trophée chacun, réglé une seule fois malgré l’alarme répétée et la revanche', async () => {
    const d = await shortDuel();
    const matchId = await drv.start(d, T0, 1);
    await lock(d, matchId, 'fire', 'fire');
    const end = await drv.tick(d.code, DEADLINE);
    expect(end).toBe(DEADLINE + RESULT_MS.flareEnd);
    expect(await drv.state(d.code)).toMatchObject({ phase: 'round-result', trophies: [0, 0], match: { scores: [1, 1], result: { status: 'draw' } } });

    await drv.tick(d.code, end ?? 0);
    await drv.tick(d.code, end ?? 0);
    const ended = await drv.state(d.code);
    expect(ended).toMatchObject({ phase: 'match-ended', trophies: [1, 1], settledMatchId: matchId });
    for (const probe of [d.host, d.guest]) {
      const last = (await drv.drain(probe)).filter((frame) => frame['phase'] === 'match-ended');
      expect(last).toEqual([expect.objectContaining({ matchResult: { status: 'draw' }, trophies: [1, 1], scores: [1, 1] })]);
    }

    await drv.send(d.host, commands.rematch('re-h', matchId, 1));
    expect(await drv.drain(d.guest)).toEqual([expect.objectContaining({ phase: 'match-ended', ready: [true, false], trophies: [1, 1] })]);
    const started = await drv.send(d.guest, commands.rematch('re-g', matchId, 1));
    expect(started.published).toEqual([expect.objectContaining({ phase: 'starting', trophies: [1, 1], scores: [0, 0] })]);
  });
});

describe('PFC-019-AC3 — aucun token ni empreinte dans les journaux du runtime, sur tout le cycle de vie', () => {
  it('connexion, partie, revanche, reprise, panne de stockage (1011), intrusion, départ et expiration : journaux propres', async () => {
    server.clearLogs();
    const a = await shortDuel();
    const b = await drv.duel();
    const matchId = await drv.start(a, T0, 1);
    await lock(a, matchId, 'plant', 'water');
    const end = await drv.tick(a.code, DEADLINE);
    await drv.tick(a.code, end ?? 0);
    await drv.send(a.host, commands.rematch('re-h', matchId, 1));
    await drv.send(a.guest, commands.rematch('re-g', matchId, 1));

    await guestLeaves(a);
    a.guest = (await drv.connect(a.code, a.tokens[1], 'auth-2')).probe;
    await drv.drain(a.guest);

    const intruder = await openSocket(server, a.code);
    intruder.send({ v: 1, type: 'authenticate', requestId: 'auth-x', payload: { resumeToken: b.tokens[0] } });
    expect(await closedWith(intruder)).toBe(SOCKET_CLOSE_CODES.UNAUTHORIZED);

    await failCommits(server, a.code, 1);
    a.host.send(commands.leave('bye-fail'));
    expect(await closedWith(a.host)).toBe(1011);

    // Sans J1 revenu, l'échéance de reconnexion ferme A et efface son stockage.
    const closeAt = await alarm(server, a.code);
    expect(closeAt).not.toBeNull();
    await drv.tick(a.code, closeAt ?? 0);
    expect(await tables(server, a.code)).toEqual([]);

    await drv.send(b.guest, commands.leave('bye'));
    expect(await closedWith(b.host)).toBe(SOCKET_CLOSE_CODES.ROOM_UNAVAILABLE);

    const secrets = [...a.tokens, ...b.tokens].flatMap((token) => [token, sha256(token)]);
    const logs = JSON.stringify(server.getLogs());
    for (const secret of secrets) expect(logs).not.toContain(secret);
    for (const probe of [a.guest, b.guest, intruder]) expectClean(probe, [...a.tokens, ...b.tokens]);
  });
});
