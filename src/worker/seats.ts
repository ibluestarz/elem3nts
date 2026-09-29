import type { PlayerIndex } from '../domain/index.ts';
import { RECONNECT_TIMEOUT_MS } from '../shared/protocol/index.ts';
import { isAbsent, type PersistedRoom, type Seat } from './codec.ts';
import { recordActivity } from './expiry.ts';

/**
 * Règles d'authentification et de présence des places (PFC-013). La place vient toujours de
 * l'empreinte du token, jamais d'une valeur choisie par le client. Aucun stockage ni horloge : la
 * room persiste le résultat puis publie.
 */

const encoder = new TextEncoder();

/**
 * Place dont l'empreinte est `tokenHash` (SHA-256 hexadécimal), ou `null`. Les deux places sont
 * toujours comparées, à temps constant et sans court-circuit : la durée ne révèle ni laquelle
 * correspond, ni le préfixe commun. Les empreintes sont distinctes (codec) : au plus une correspond.
 */
export function findSeat(seats: readonly [Seat | null, Seat | null], tokenHash: string): PlayerIndex | null {
  const candidate = encoder.encode(tokenHash);
  const matches = seats.map((seat) => seat !== null && sameHash(candidate, encoder.encode(seat.tokenHash)));
  if (matches[0] === true) return 0;
  return matches[1] === true ? 1 : null;
}

/**
 * Place authentifiée : première connexion faite (`reservedUntil = null`) et présente, dans la même
 * transition (invariant du codec). Si plus aucune place n'est absente, l'échéance de reconnexion est
 * levée et une pause reprend sa phase avec le temps qui lui restait (D15, PFC-017) ; sinon la pause
 * continue, sans que son échéance ne bouge. `null` si rien ne change (reprise d'une place déjà présente
 * par une nouvelle socket) : aucune écriture, aucune révision consommée.
 * Seule la première connexion d'une place est une activité utile (D16, PFC-018) : l'arrivée tardive d'un
 * invité au lobby repart pour 30 min ; une reprise après absence ne prolonge pas la room.
 */
export function claimSeat(room: PersistedRoom, slot: PlayerIndex, now: number): PersistedRoom | null {
  const seat = room.seats[slot];
  if (seat === null) throw new Error('Place authentifiée sans réservation.');
  if (seat.reservedUntil === null && room.connected[slot]) return null;
  const seats: [Seat | null, Seat | null] = [room.seats[0], room.seats[1]];
  seats[slot] = { tokenHash: seat.tokenHash, reservedUntil: null };
  const claimed: PersistedRoom = { ...room, revision: room.revision + 1, connected: withFlag(room.connected, slot, true), seats };
  const present = seat.reservedUntil === null ? claimed : recordActivity(claimed, now);
  if (isAbsent(present, 0) || isAbsent(present, 1)) return present;
  const { phase, resumePhase, resumeRemainingMs } = present;
  if (phase !== 'paused' || resumePhase === null || resumeRemainingMs === null) return { ...present, reconnectDeadline: null };
  return {
    ...present,
    phase: resumePhase,
    resumePhase: null,
    resumeRemainingMs: null,
    reconnectDeadline: null,
    deadline: now + resumeRemainingMs,
  };
}

/**
 * Socket courante d'une place fermée (ou perdue avec l'instance) : la place reste réservée mais n'est
 * plus présente. Au lobby et en fin de partie, sa confirmation (prêt, revanche) est retirée avec elle :
 * aucune partie ne démarre avec un absent (PFC-014). Délai de reconnexion (D15, PFC-017) : fixé à la
 * première absence, jamais repoussé par une seconde. Une phase chronométrée est mise en pause avec son
 * temps restant (l'appelant a traité les échéances dues : il reste toujours du temps) ; la pause publie
 * l'échéance de reconnexion. `null` si la place était déjà absente.
 */
export function leaveSeat(room: PersistedRoom, slot: PlayerIndex, now: number): PersistedRoom | null {
  if (!room.connected[slot]) return null;
  const confirming = room.phase === 'lobby' || room.phase === 'match-ended';
  const reconnectDeadline = room.reconnectDeadline ?? now + RECONNECT_TIMEOUT_MS;
  const absent: PersistedRoom = {
    ...room,
    revision: room.revision + 1,
    connected: withFlag(room.connected, slot, false),
    ready: confirming ? withFlag(room.ready, slot, false) : room.ready,
    reconnectDeadline,
  };
  const { phase, deadline } = room;
  if ((phase !== 'starting' && phase !== 'selecting' && phase !== 'round-result') || deadline === null) return absent;
  return {
    ...absent,
    phase: 'paused',
    resumePhase: phase,
    // Au moins 1 ms : une échéance due à cet instant a déjà été traitée par l'appelant.
    resumeRemainingMs: Math.max(1, deadline - now),
    deadline: reconnectDeadline,
  };
}

function sameHash(candidate: Uint8Array, stored: Uint8Array): boolean {
  // Longueurs fixes (64 octets ASCII, codec) ; comparer une longueur n'apprend rien sur le secret.
  return candidate.byteLength === stored.byteLength && crypto.subtle.timingSafeEqual(candidate, stored);
}

function withFlag(flags: readonly [boolean, boolean], slot: PlayerIndex, value: boolean): readonly [boolean, boolean] {
  return slot === 0 ? [value, flags[1]] : [flags[0], value];
}
