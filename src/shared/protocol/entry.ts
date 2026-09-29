import type { PlayerIndex } from '../../domain/index.ts';
import { isResumeToken, isRoomCode } from './limits.ts';
import { hasExactKeys, isJsonObject } from './schema.ts';

/**
 * Réponse privée de `POST /api/rooms` (J1, 201) et de `POST /api/rooms/:code/join` (J2, 200)
 * (PROTOCOL « Transport et entrée dans une room ») : le code à partager, la place réservée et le
 * token de reprise, qui ne quitte jamais cette réponse ni le `sessionStorage` de la room.
 */
export interface RoomEntry {
  readonly roomCode: string;
  readonly slot: PlayerIndex;
  readonly resumeToken: string;
}

const ENTRY_KEYS = ['roomCode', 'slot', 'resumeToken'] as const;

/** Valide une réponse d'entrée reçue (clés exactes, code canonique, token 256 bits) ; `null` sinon. */
export function parseRoomEntry(value: unknown): RoomEntry | null {
  if (!isJsonObject(value) || !hasExactKeys(value, ENTRY_KEYS)) return null;
  const { roomCode, slot, resumeToken } = value;
  if (!isRoomCode(roomCode) || (slot !== 0 && slot !== 1) || !isResumeToken(resumeToken)) return null;
  return Object.freeze({ roomCode, slot, resumeToken });
}
