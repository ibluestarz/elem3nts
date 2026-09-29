import {
  DEFAULT_SETTINGS,
  EMPTY_SELECTION,
  lockChoice,
  playRound,
  startMatch,
  startSession,
  settleMatch,
  type Choices,
  type Element,
  type Match,
  type PlayerIndex,
  type Selection,
} from '../../../src/domain/index.ts';
import type { RoomView } from '../../../src/shared/protocol/index.ts';

/** Token de reprise conforme (256 bits base64url) et secrets de stockage qu'aucune sortie ne doit porter. */
export const RESUME_TOKEN = 'Zml4dHVyZS10b2tlbi1ub3QtYS1zZWNyZXQtMDAwMzI';
export const SECRETS = Object.freeze({
  resumeToken: RESUME_TOKEN,
  tokenHashes: ['9f2c4e1b7a3d5f60c8e2b4a6d8f0e1c3a5b7d9f1e3c5a7b9d1f3e5c7a9b1d3f5', 'e4d2c0b8a6f4e2d0c8b6a4f2e0d8c6b4a2f0e8d6c4b2a0f8e6d4c2b0a8f6e4d2'],
  idempotency: [{ requestId: 'r-secret', response: '{"type":"ack"}' }],
});

export const MATCH_ID = 'match-42';
export const ROOM_CODE = 'K7M2Q9XA';

/** Room de stockage simulée : la vue projetable plus les secrets qu'un vrai stockage porte aussi. */
export type StoredRoom = RoomView & typeof SECRETS;

export function lobbyRoom(overrides: Partial<RoomView> = {}): StoredRoom {
  return {
    ...SECRETS,
    revision: 3,
    roomCode: ROOM_CODE,
    phase: 'lobby',
    resumePhase: null,
    settings: DEFAULT_SETTINGS,
    settingsRevision: 0,
    match: null,
    roundId: null,
    selection: EMPTY_SELECTION,
    lastRound: null,
    trophies: [0, 0],
    ready: [false, false],
    connected: [true, true],
    deadline: null,
    ...overrides,
  };
}

/** Verrouille de vrais choix avec le moteur partagé (`lockChoice`), sans fabriquer de sélection. */
export function lockAll(choices: Choices): Selection {
  return choices.reduce<Selection>(
    (selection, element, player) =>
      element === null ? selection : lockChoice(selection, player as PlayerIndex, element).selection,
    EMPTY_SELECTION,
  );
}

/** Ouverture d'une partie (PFC-014) : manche 1 annoncée, aucun choix encore possible. */
export function startingRoom(overrides: Partial<RoomView> = {}): StoredRoom {
  return lobbyRoom({
    revision: 4,
    phase: 'starting',
    match: startMatch(MATCH_ID, DEFAULT_SETTINGS),
    roundId: 1,
    deadline: 1_700_000_002_200,
    ...overrides,
  });
}

/** Manche 1 en sélection, choix privés verrouillés (feu/plante par défaut, cas PFC-010-S1). */
export function selectingRoom(choices: Choices = ['fire', 'plant'], overrides: Partial<RoomView> = {}): StoredRoom {
  return lobbyRoom({
    revision: 5,
    phase: 'selecting',
    match: startMatch(MATCH_ID, DEFAULT_SETTINGS),
    roundId: 1,
    selection: lockAll(choices),
    deadline: 1_700_000_005_000,
    ...overrides,
  });
}

/** Manche 1 révélée avec le moteur partagé : scores, résultat et choix publics cohérents. */
export function roundResultRoom(choices: Choices = ['fire', 'plant'], overrides: Partial<RoomView> = {}): StoredRoom {
  const played = playRound(startMatch(MATCH_ID, DEFAULT_SETTINGS), choices);
  return selectingRoom(choices, {
    revision: 6,
    phase: 'round-result',
    match: played.match,
    lastRound: { roundId: 1, choices, resolution: played.round },
    deadline: 1_700_000_009_000,
    ...overrides,
  });
}

/** Partie X = 3 réellement jouée jusqu'à la victoire de `winner`, trophée réglé une fois. */
export function matchEndedRoom(winner: PlayerIndex = 0): StoredRoom {
  const winning: Choices = winner === 0 ? ['water', 'fire'] : ['fire', 'water'];
  let match: Match = startMatch(MATCH_ID, DEFAULT_SETTINGS);
  let last = playRound(match, winning);
  for (let round = 1; round < DEFAULT_SETTINGS.target; round += 1) {
    match = last.match;
    last = playRound(match, winning);
  }
  const session = settleMatch(startSession(), last.match).session;
  return lobbyRoom({
    revision: 12,
    phase: 'match-ended',
    match: last.match,
    roundId: DEFAULT_SETTINGS.target,
    selection: lockAll(winning),
    lastRound: { roundId: DEFAULT_SETTINGS.target, choices: winning, resolution: last.round },
    trophies: session.trophies,
  });
}

/** Tous les éléments et secrets dont la présence dans une trame serait une fuite avant révélation. */
export const ELEMENT_NAMES: readonly Element[] = ['fire', 'water', 'plant'];
export const SECRET_VALUES: readonly string[] = [RESUME_TOKEN, ...SECRETS.tokenHashes, 'r-secret'];
export const SECRET_KEYS: readonly string[] = ['resumeToken', 'tokenHashes', 'tokenHash', 'hash', 'token', 'selection', 'idempotency', 'lastRound'];

/** Toutes les clés d'un JSON, à toute profondeur. */
export function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, nested]) => [key, ...keysDeep(nested)]);
  }
  return [];
}
