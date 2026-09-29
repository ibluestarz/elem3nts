import { describe, expect, it } from 'vitest';
import { ELEMENTS, type Choices, type PlayerIndex } from '../../../src/domain/index.ts';
import {
  PHASES,
  encodeServerMessage,
  parseServerMessage,
  projectState,
  type PublicState,
  type RoomView,
} from '../../../src/shared/protocol/index.ts';
import {
  ELEMENT_NAMES,
  MATCH_ID,
  ROOM_CODE,
  SECRET_KEYS,
  SECRET_VALUES,
  keysDeep,
  lobbyRoom,
  matchEndedRoom,
  roundResultRoom,
  selectingRoom,
  startingRoom,
  type StoredRoom,
} from './rooms.ts';

const NOW = 1_700_000_001_234;
const SLOTS: readonly PlayerIndex[] = [0, 1];

/** Trame réellement envoyée : c'est elle, et non l'objet, qui ne doit rien laisser fuir. */
function frame(room: RoomView, slot: PlayerIndex): string {
  return encodeServerMessage(projectState(room, slot, NOW));
}

function expectNoSecret(json: string): void {
  for (const secret of SECRET_VALUES) expect(json).not.toContain(secret);
  for (const key of SECRET_KEYS) expect(keysDeep(JSON.parse(json))).not.toContain(key);
}

function expectNoElement(json: string): void {
  for (const element of ELEMENT_NAMES) expect(json).not.toContain(`"${element}"`);
  expect(keysDeep(JSON.parse(json))).not.toContain('revealedChoices');
}

/** Toutes les combinaisons de choix privés d'une manche, absences comprises (R11/R12). */
const ALL_CHOICES: readonly Choices[] = [null, ...ELEMENTS].flatMap((p1) =>
  [null, ...ELEMENTS].map((p2): Choices => [p1, p2]),
);

describe('PFC-010 — projection publique du state', () => {
  it('PFC-010-S1 — la room stocke feu/plante en selecting : ni élément ni token/hash dans le snapshot', () => {
    const room = selectingRoom(['fire', 'plant']);

    for (const slot of SLOTS) {
      const json = frame(room, slot);
      expectNoElement(json);
      expectNoSecret(json);
      expect(JSON.parse(json)).toMatchObject({ phase: 'selecting', choiceLocked: [true, true], yourSlot: slot });
    }
  });

  it('PFC-010-AC2 — aucun choix, même le sien, pour les 16 sélections possibles et les deux places', () => {
    for (const choices of ALL_CHOICES) {
      for (const slot of SLOTS) {
        const json = frame(selectingRoom(choices), slot);
        expectNoElement(json);
        expectNoSecret(json);
        expect(JSON.parse(json)).toMatchObject({ choiceLocked: [choices[0] !== null, choices[1] !== null] });
      }
    }
  });

  it('PFC-010-AC2 — pause pendant la sélection (reconnexion) : phase et verrous restaurés, aucun élément', () => {
    const paused = selectingRoom(['water', null], {
      phase: 'paused',
      resumePhase: 'selecting',
      connected: [true, false],
      deadline: 1_700_000_031_000,
    });

    for (const slot of SLOTS) {
      const json = frame(paused, slot);
      expectNoElement(json);
      expectNoSecret(json);
      expect(JSON.parse(json)).toMatchObject({
        phase: 'paused',
        resumePhase: 'selecting',
        connected: [true, false],
        choiceLocked: [true, false],
        deadline: 1_700_000_031_000,
      });
    }
  });

  it('PFC-010-AC2 — une manche précédente révélée ne ressort pas pendant la sélection suivante', () => {
    const previous = roundResultRoom(['water', 'fire']);
    // Stockage incohérent volontaire : lastRound conservé alors que la manche 2 a commencé.
    const next = selectingRoom(['plant', 'plant'], {
      match: previous.match,
      roundId: 2,
      lastRound: previous.lastRound,
    });
    const leakedIntoResult = { ...next, phase: 'round-result' as const };

    expectNoElement(frame(next, 0));
    // Même en round-result, un lastRound d'une autre manche n'est jamais publié.
    expectNoElement(frame(leakedIntoResult, 1));
  });

  it('PFC-010-AC2 — résultat écrit avant l’échéance : la phase seule interdit la révélation', () => {
    const early = roundResultRoom(['fire', 'plant']);
    for (const phase of ['selecting', 'paused'] as const) {
      const room = { ...early, phase, resumePhase: phase === 'paused' ? ('selecting' as const) : null };
      for (const slot of SLOTS) expectNoElement(frame(room, slot));
    }
  });

  it('révèle choix et résultat en round-result, identiques pour les deux places', () => {
    const room = roundResultRoom(['fire', 'plant']);
    const [p1, p2] = SLOTS.map((slot) => projectState(room, slot, NOW));

    expect(p1).toMatchObject({
      phase: 'round-result',
      matchId: MATCH_ID,
      roundId: 1,
      scores: [1, 0],
      revealedChoices: ['fire', 'plant'],
      result: { kind: 'burn', winner: 0, delta: [1, 0] },
      deadline: 1_700_000_009_000,
    });
    expect({ ...p2, yourSlot: 0 }).toEqual(p1);
    expectNoSecret(frame(room, 0));
  });

  it('garde les choix révélés pendant une pause survenue au résultat', () => {
    const paused = roundResultRoom(['water', 'water'], { phase: 'paused', resumePhase: 'round-result' });
    expect(projectState(paused, 1, NOW)).toMatchObject({
      resumePhase: 'round-result',
      revealedChoices: ['water', 'water'],
      result: { kind: 'siphon', winner: null, delta: [0, 0] },
    });
  });

  it('PFC-017 — pause pendant l’ouverture : phase à reprendre publiée, échéance de reconnexion, aucun choix', () => {
    const paused = startingRoom({ phase: 'paused', resumePhase: 'starting', connected: [true, false], deadline: 1_700_000_030_000 });
    const state = projectState(paused, 0, NOW);
    expect(state).toMatchObject({ phase: 'paused', resumePhase: 'starting', deadline: 1_700_000_030_000, connected: [true, false] });
    expect(state).not.toHaveProperty('revealedChoices');
    expect(parseServerMessage(JSON.stringify(state))).toEqual({ ok: true, message: state });
  });

  it('publie un choix manquant (R11/R12) comme null après révélation', () => {
    expect(projectState(roundResultRoom([null, 'plant']), 0, NOW)).toMatchObject({
      revealedChoices: [null, 'plant'],
      result: { kind: 'solo', winner: 1 },
    });
    expect(projectState(roundResultRoom([null, null]), 0, NOW)).toMatchObject({
      revealedChoices: [null, null],
      result: { kind: 'void', winner: null, delta: [0, 0] },
    });
  });

  it('publie le résultat de partie et les trophées réglés en match-ended, sans échéance', () => {
    const state = projectState(matchEndedRoom(1), 0, NOW);
    expect(state).toMatchObject({
      phase: 'match-ended',
      scores: [0, 3],
      trophies: [0, 1],
      matchResult: { status: 'won', winner: 1 },
      result: { kind: 'wave', winner: 1 },
    });
    expect(state).not.toHaveProperty('deadline');
  });

  it('lobby : aucune partie, scores 0/0, prêts et présences publiés', () => {
    const state = projectState(lobbyRoom({ ready: [true, false], connected: [true, false] }), 1, NOW);
    expect(state).toEqual({
      v: 1,
      type: 'state',
      revision: 3,
      serverNow: NOW,
      roomCode: ROOM_CODE,
      yourSlot: 1,
      phase: 'lobby',
      matchId: null,
      roundId: null,
      settings: { target: 3, drawEnabled: true },
      settingsRevision: 0,
      scores: [0, 0],
      trophies: [0, 0],
      ready: [true, false],
      connected: [true, false],
      choiceLocked: [false, false],
    });
  });

  it('PFC-010-AC2 — toutes les phases : clés allowlistées, aucun secret, trame relue par le client', () => {
    const rooms: Record<(typeof PHASES)[number], StoredRoom> = {
      lobby: lobbyRoom(),
      starting: startingRoom(),
      selecting: selectingRoom(),
      'round-result': roundResultRoom(),
      'match-ended': matchEndedRoom(),
      paused: selectingRoom(['fire', 'fire'], { phase: 'paused', resumePhase: 'selecting' }),
      closed: lobbyRoom({ phase: 'closed' }),
    };
    const allowed = new Set<string>([
      ...Object.keys(projectState(lobbyRoom(), 0, NOW)),
      'resumePhase',
      'deadline',
      'revealedChoices',
      'result',
      'matchResult',
    ]);

    for (const [phase, room] of Object.entries(rooms)) {
      for (const slot of SLOTS) {
        const json = frame(room, slot);
        expectNoSecret(json);
        for (const key of Object.keys(JSON.parse(json) as object)) expect(allowed).toContain(key);
        const parsed = parseServerMessage(json);
        expect(parsed, phase).toEqual({ ok: true, message: JSON.parse(json) as PublicState });
      }
    }
  });

  it('PFC-014 — ouverture de partie : échéance publiée, manche 1 annoncée, aucun choix ni résultat', () => {
    const state = projectState(startingRoom(), 1, NOW);
    expect(state).toMatchObject({ phase: 'starting', matchId: MATCH_ID, roundId: 1, deadline: 1_700_000_002_200 });
    expect(state.choiceLocked).toEqual([false, false]);
    for (const key of ['revealedChoices', 'result', 'matchResult', 'resumePhase']) expect(state).not.toHaveProperty(key);
  });

  it('ignore une resumePhase ou une échéance incohérente avec la phase publiée', () => {
    const state = projectState(lobbyRoom({ resumePhase: 'selecting', deadline: 42 }), 0, NOW);
    expect(state).not.toHaveProperty('resumePhase');
    expect(state).not.toHaveProperty('deadline');
  });

  it('ne modifie pas la room et rend un objet gelé, sans référence partagée avec le stockage', () => {
    const room = roundResultRoom();
    const snapshot = structuredClone(room);
    const state = projectState(room, 0, NOW);

    expect(room).toEqual(snapshot);
    expect(Object.isFrozen(state)).toBe(true);
    for (const nested of [state.settings, state.scores, state.trophies, state.ready, state.connected, state.result]) {
      expect(Object.isFrozen(nested)).toBe(true);
    }
    expect(state.settings).not.toBe(room.settings);
    expect(state.revealedChoices).not.toBe(room.lastRound?.choices);
    expect(state.scores).not.toBe(room.match?.scores);
  });
});
