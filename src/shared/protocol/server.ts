import { ERROR_MESSAGES, isErrorCode, type ErrorCode } from './errors.ts';
import {
  PROTOCOL_VERSION,
  isIdentifier,
  isRevision,
  isRoomCode,
  isRoundId,
  isTimestamp,
} from './limits.ts';
import {
  deepFreeze,
  hasExactKeys,
  isChoicePair,
  isCounterPair,
  isFlagPair,
  isJsonObject,
  isRoundKind,
  isSettings,
  isSlot,
  type JsonObject,
} from './schema.ts';
import { isPhase, isResumablePhase, isRevealedPhase, type PublicState } from './state.ts';

export interface AckMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'ack';
  readonly requestId: string;
  /** Révision de la room après la commande (ou inchangée pour un doublon rejoué). */
  readonly revision: number;
}

export interface ErrorMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'error';
  /** Absent si la trame n'a pas pu être rattachée à une requête valide. */
  readonly requestId?: string;
  readonly code: ErrorCode;
  readonly message: string;
}

export interface PongMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'pong';
  readonly requestId: string;
  /** Horloge serveur : le client estime latence et décalage avec l'instant d'envoi de son `ping`. */
  readonly serverNow: number;
}

/** Motifs de fermeture : départ, 30 min sans activité utile, 4 h de durée, reconnexion au-delà de 30 s. */
export const CLOSE_REASONS = ['left', 'inactive', 'max-duration', 'reconnect-timeout'] as const;

export type CloseReason = (typeof CLOSE_REASONS)[number];

export interface RoomClosedMessage {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'room-closed';
  readonly reason: CloseReason;
}

export type ServerMessage = AckMessage | ErrorMessage | PongMessage | RoomClosedMessage | PublicState;

/** Les constructeurs ne reçoivent que des identifiants et des nombres : aucun contenu de commande. */
export function ackMessage(requestId: string, revision: number): AckMessage {
  return Object.freeze({ v: PROTOCOL_VERSION, type: 'ack', requestId, revision });
}

export function errorMessage(code: ErrorCode, requestId?: string): ErrorMessage {
  const message = ERROR_MESSAGES[code];
  return Object.freeze(
    requestId === undefined
      ? { v: PROTOCOL_VERSION, type: 'error', code, message }
      : { v: PROTOCOL_VERSION, type: 'error', requestId, code, message },
  );
}

export function pongMessage(requestId: string, serverNow: number): PongMessage {
  return Object.freeze({ v: PROTOCOL_VERSION, type: 'pong', requestId, serverNow });
}

export function roomClosedMessage(reason: CloseReason): RoomClosedMessage {
  return Object.freeze({ v: PROTOCOL_VERSION, type: 'room-closed', reason });
}

export function encodeServerMessage(message: ServerMessage): string {
  return JSON.stringify(message);
}

export type ServerParseResult = { readonly ok: true; readonly message: ServerMessage } | { readonly ok: false };

const INVALID: ServerParseResult = Object.freeze({ ok: false });

/**
 * Validation côté client d'une trame serveur, aussi stricte que celle du serveur : clés exactes,
 * bornes, et cohérence de la projection (pas de choix révélés hors révélation). Une trame refusée
 * est ignorée par le client ; la fonction ne lève jamais et gèle le message accepté.
 */
export function parseServerMessage(raw: unknown): ServerParseResult {
  if (typeof raw !== 'string') return INVALID;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return INVALID;
  }
  if (!isJsonObject(data) || data['v'] !== PROTOCOL_VERSION || !isServerMessage(data)) return INVALID;
  return Object.freeze({ ok: true, message: deepFreeze(data) });
}

function isServerMessage(data: JsonObject): data is JsonObject & ServerMessage {
  switch (data['type']) {
    case 'ack':
      return hasExactKeys(data, ['v', 'type', 'requestId', 'revision']) && isIdentifier(data['requestId']) && isRevision(data['revision']);
    case 'error':
      return (
        hasExactKeys(data, ['v', 'type', 'code', 'message'], ['requestId']) &&
        (!Object.hasOwn(data, 'requestId') || isIdentifier(data['requestId'])) &&
        isErrorCode(data['code']) &&
        typeof data['message'] === 'string'
      );
    case 'pong':
      return hasExactKeys(data, ['v', 'type', 'requestId', 'serverNow']) && isIdentifier(data['requestId']) && isTimestamp(data['serverNow']);
    case 'room-closed':
      return hasExactKeys(data, ['v', 'type', 'reason']) && (CLOSE_REASONS as readonly unknown[]).includes(data['reason']);
    case 'state':
      return isPublicState(data);
    default:
      return false;
  }
}

const STATE_KEYS = [
  'v',
  'type',
  'revision',
  'serverNow',
  'roomCode',
  'yourSlot',
  'phase',
  'matchId',
  'roundId',
  'settings',
  'settingsRevision',
  'scores',
  'trophies',
  'ready',
  'connected',
  'choiceLocked',
] as const;

const STATE_OPTIONAL_KEYS = ['resumePhase', 'deadline', 'revealedChoices', 'result', 'matchResult'] as const;

function isPublicState(data: JsonObject): boolean {
  if (!hasExactKeys(data, STATE_KEYS, STATE_OPTIONAL_KEYS)) return false;
  const phase = data['phase'];
  if (!isPhase(phase)) return false;
  const resumePhase = data['resumePhase'];
  if ((phase === 'paused') !== Object.hasOwn(data, 'resumePhase')) return false;
  if (resumePhase !== undefined && !isResumablePhase(resumePhase)) return false;
  const revealed = isRevealedPhase(phase, resumePhase ?? null);
  const hasChoices = Object.hasOwn(data, 'revealedChoices');
  // Défense en profondeur : un état qui porterait des choix hors révélation est rejeté.
  if (hasChoices !== Object.hasOwn(data, 'result') || (hasChoices && !revealed)) return false;
  if (Object.hasOwn(data, 'matchResult') && phase !== 'match-ended') return false;
  return (
    isRevision(data['revision']) &&
    isTimestamp(data['serverNow']) &&
    isRoomCode(data['roomCode']) &&
    isSlot(data['yourSlot']) &&
    (data['matchId'] === null || isIdentifier(data['matchId'])) &&
    (data['roundId'] === null || isRoundId(data['roundId'])) &&
    isSettings(data['settings']) &&
    isRevision(data['settingsRevision']) &&
    isCounterPair(data['scores']) &&
    isCounterPair(data['trophies']) &&
    isFlagPair(data['ready']) &&
    isFlagPair(data['connected']) &&
    isFlagPair(data['choiceLocked']) &&
    (!Object.hasOwn(data, 'deadline') || isTimestamp(data['deadline'])) &&
    (!hasChoices || isChoicePair(data['revealedChoices'])) &&
    (!Object.hasOwn(data, 'result') || isRoundResult(data['result'])) &&
    (!Object.hasOwn(data, 'matchResult') || isMatchResult(data['matchResult']))
  );
}

function isRoundResult(value: unknown): boolean {
  if (!isJsonObject(value) || !hasExactKeys(value, ['kind', 'winner', 'delta'])) return false;
  const delta = value['delta'];
  return (
    isRoundKind(value['kind']) &&
    (value['winner'] === null || isSlot(value['winner'])) &&
    Array.isArray(delta) &&
    delta.length === 2 &&
    delta.every((step) => Number.isSafeInteger(step))
  );
}

function isMatchResult(value: unknown): boolean {
  if (!isJsonObject(value)) return false;
  if (value['status'] === 'draw') return hasExactKeys(value, ['status']);
  return value['status'] === 'won' && hasExactKeys(value, ['status', 'winner']) && isSlot(value['winner']);
}

