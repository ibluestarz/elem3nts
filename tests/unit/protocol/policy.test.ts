import { describe, expect, it } from 'vitest';
import { type PlayerIndex } from '../../../src/domain/index.ts';
import {
  COMMAND_TYPES,
  authorizeCommand,
  type ClientCommand,
  type CommandType,
  type Phase,
  type RoomView,
} from '../../../src/shared/protocol/index.ts';
import {
  MATCH_ID,
  RESUME_TOKEN,
  lobbyRoom,
  matchEndedRoom,
  roundResultRoom,
  selectingRoom,
  startingRoom,
} from './rooms.ts';

/** Commande valide de chaque type, adressée au contexte courant de `room` (partie, manche, réglages). */
function commandFor(type: CommandType, room: RoomView): ClientCommand {
  const base = { v: 1, requestId: `r-${type}` } as const;
  const matchId = room.match?.id ?? MATCH_ID;
  const expectedSettingsRevision = room.settingsRevision;
  switch (type) {
    case 'authenticate':
      return { ...base, type, payload: { resumeToken: RESUME_TOKEN } };
    case 'update-settings':
      return { ...base, type, payload: { expectedSettingsRevision, settings: { target: 5, drawEnabled: false } } };
    case 'ready':
      return { ...base, type, payload: { expectedSettingsRevision } };
    case 'submit-choice':
      return { ...base, type, matchId, roundId: room.roundId ?? 1, payload: { element: 'water' } };
    case 'rematch-ready':
      return { ...base, type, matchId, payload: { expectedSettingsRevision } };
    case 'leave':
    case 'ping':
      return { ...base, type, payload: {} };
  }
}

/** Une room cohérente par phase, sans choix verrouillé pour la place testée. */
const ROOMS: Readonly<Record<Exclude<Phase, 'closed'>, RoomView>> = {
  lobby: lobbyRoom(),
  starting: startingRoom(),
  selecting: selectingRoom([null, null]),
  'round-result': roundResultRoom(),
  'match-ended': matchEndedRoom(),
  paused: selectingRoom([null, null], { phase: 'paused', resumePhase: 'selecting', connected: [true, false] }),
};

/** Tableau « Contexte » de PROTOCOL, pour une place authentifiée J1. */
const ALLOWED_IN: Readonly<Record<CommandType, readonly Phase[]>> = {
  authenticate: [],
  'update-settings': ['lobby', 'match-ended'],
  ready: ['lobby'],
  'submit-choice': ['selecting'],
  'rematch-ready': ['match-ended'],
  leave: ['lobby', 'starting', 'selecting', 'round-result', 'match-ended', 'paused'],
  ping: ['lobby', 'starting', 'selecting', 'round-result', 'match-ended', 'paused'],
};

function authorize(type: CommandType, room: RoomView, slot: PlayerIndex | null, command = commandFor(type, room)) {
  return authorizeCommand(command, room, slot);
}

describe('PFC-010-AC1 — commandes autorisées et refusées par phase', () => {
  it('matrice complète : chaque commande × chaque phase, pour J1 authentifié', () => {
    for (const type of COMMAND_TYPES) {
      for (const [phase, room] of Object.entries(ROOMS) as [Phase, RoomView][]) {
        const expected = ALLOWED_IN[type].includes(phase) ? { ok: true } : { ok: false, code: 'INVALID_PHASE' };
        expect(authorize(type, room, 0), `${type} en ${phase}`).toEqual(expected);
      }
    }
  });

  it('avant authentification : seul authenticate, quelle que soit la phase', () => {
    for (const room of Object.values(ROOMS)) {
      for (const type of COMMAND_TYPES) {
        expect(authorize(type, room, null)).toEqual(
          type === 'authenticate' ? { ok: true } : { ok: false, code: 'UNAUTHORIZED' },
        );
      }
    }
  });

  it('room fermée : ROOM_UNAVAILABLE pour tout message, authentifié ou non', () => {
    const closed = lobbyRoom({ phase: 'closed' });
    for (const type of COMMAND_TYPES) {
      for (const slot of [null, 0, 1] as const) {
        expect(authorize(type, closed, slot)).toEqual({ ok: false, code: 'ROOM_UNAVAILABLE' });
      }
    }
  });

  it('J2 peut tout ce que J1 peut, sauf update-settings : NOT_HOST avant toute autre garde', () => {
    for (const [phase, room] of Object.entries(ROOMS) as [Phase, RoomView][]) {
      for (const type of COMMAND_TYPES) {
        const expected =
          type === 'update-settings' ? { ok: false, code: 'NOT_HOST' } : authorize(type, room, 0);
        expect(authorize(type, room, 1), `${type} en ${phase}`).toEqual(expected);
      }
    }
    const stale = commandFor('update-settings', lobbyRoom({ settingsRevision: 9 }));
    expect(authorize('update-settings', lobbyRoom(), 1, stale)).toEqual({ ok: false, code: 'NOT_HOST' });
  });

  it('ready exige les deux places connectées', () => {
    for (const connected of [
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      const room = lobbyRoom({ connected });
      expect(authorize('ready', room, 0)).toEqual({ ok: false, code: 'INVALID_PHASE' });
    }
  });

  it('STALE_SETTINGS pour update-settings, ready et rematch-ready d’une révision dépassée', () => {
    const lobby = lobbyRoom({ settingsRevision: 4 });
    const ended = { ...matchEndedRoom(), settingsRevision: 4 };
    for (const [type, room] of [
      ['update-settings', lobby],
      ['ready', lobby],
      ['update-settings', ended],
      ['rematch-ready', ended],
    ] as const) {
      for (const expectedSettingsRevision of [3, 5, 0]) {
        const command = { ...commandFor(type, room), payload: { ...commandFor(type, room).payload, expectedSettingsRevision } };
        expect(authorize(type, room, 0, command as ClientCommand)).toEqual({ ok: false, code: 'STALE_SETTINGS' });
      }
      expect(authorize(type, room, 0)).toEqual({ ok: true });
    }
  });

  it('PFC-014-S2 (contrat) — la room joue roundId=3, un choix de roundId=2 : STALE_ROUND', () => {
    const room = selectingRoom([null, null], { roundId: 3 });
    const command = { ...commandFor('submit-choice', room), roundId: 2 } as ClientCommand;
    expect(authorize('submit-choice', room, 1, command)).toEqual({ ok: false, code: 'STALE_ROUND' });
    // Une manche future ou une autre partie ne sont pas plus acceptées.
    expect(authorize('submit-choice', room, 1, { ...command, roundId: 4 } as ClientCommand)).toEqual({ ok: false, code: 'STALE_ROUND' });
    expect(authorize('submit-choice', room, 1, { ...command, roundId: 3, matchId: 'match-41' } as ClientCommand)).toEqual({
      ok: false,
      code: 'STALE_ROUND',
    });
  });

  it('choix de la bonne manche arrivé pendant son résultat : INVALID_PHASE ; hors partie : INVALID_PHASE', () => {
    expect(authorize('submit-choice', roundResultRoom(), 0)).toEqual({ ok: false, code: 'INVALID_PHASE' });
    expect(authorize('submit-choice', lobbyRoom(), 0)).toEqual({ ok: false, code: 'INVALID_PHASE' });
  });

  it('CHOICE_LOCKED pour la place qui a déjà choisi, jamais pour l’autre', () => {
    const room = selectingRoom(['fire', null]);
    expect(authorize('submit-choice', room, 0)).toEqual({ ok: false, code: 'CHOICE_LOCKED' });
    expect(authorize('submit-choice', room, 1)).toEqual({ ok: true });
  });

  it('rematch-ready d’une partie précédente, retardé jusqu’à la suivante : STALE_ROUND', () => {
    const ended = matchEndedRoom();
    if (ended.match === null) throw new Error('partie terminée attendue');
    const next = selectingRoom([null, null], { match: { ...ended.match, id: 'match-43' } });
    const late = { ...commandFor('rematch-ready', next), matchId: MATCH_ID } as ClientCommand;
    expect(authorize('rematch-ready', next, 0, late)).toEqual({ ok: false, code: 'STALE_ROUND' });
    expect(authorize('rematch-ready', ended, 1, { ...late, matchId: 'match-41' } as ClientCommand)).toEqual({
      ok: false,
      code: 'STALE_ROUND',
    });
  });

  it('ne modifie ni la room ni la commande', () => {
    for (const room of Object.values(ROOMS)) {
      for (const type of COMMAND_TYPES) {
        const command = commandFor(type, room);
        const before = structuredClone({ room, command });
        authorize(type, room, 0, command);
        expect({ room, command }).toEqual(before);
      }
    }
  });
});
