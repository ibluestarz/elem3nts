import { DEFAULT_SETTINGS, EMPTY_SELECTION } from '../domain/index.ts';
import type { PersistedRoom, Seat } from './codec.ts';

/** Délai de première connexion d'une place réservée (PROTOCOL « Transport et entrée dans une room »). */
export const RESERVATION_TTL_MS = 30_000;

/**
 * Règles pures de réservation des places (PFC-012) : aucune horloge, aucun stockage. La room
 * (`room.ts`) fournit `now`, persiste le résultat, puis replanifie son alarme.
 */

/** Room neuve au lobby : J1 réservé pour `RESERVATION_TTL_MS`, J2 libre, réglages par défaut (D07). */
export function openRoom(roomCode: string, hostTokenHash: string, now: number): PersistedRoom {
  return {
    revision: 1,
    roomCode,
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
    connected: [false, false],
    deadline: null,
    createdAt: now,
    seats: [reserve(hostTokenHash, now), null],
    settledMatchId: null,
    replies: [[], []],
    reconnectDeadline: null,
    resumeRemainingMs: null,
    // La création est la première activité utile (D16) : l'inactivité se compte à partir d'elle.
    lastActivityAt: now,
  };
}

export type Reservation =
  | { readonly kind: 'reserved'; readonly room: PersistedRoom }
  /** J2 déjà réservé ou occupé : une troisième place n'existe jamais. */
  | { readonly kind: 'full' }
  /** Room sans hôte (v1 migrée) : personne ne peut la rejoindre, comme une room absente. */
  | { readonly kind: 'absent' };

/**
 * Réserve J2 avec l'empreinte d'un nouveau token. L'appelant a déjà traité les échéances dues
 * (`settleReservations`) : une place dont la réservation expire à cet instant est déjà libérée.
 */
export function reserveGuest(room: PersistedRoom, guestTokenHash: string, now: number): Reservation {
  const [host, guest] = room.seats;
  if (host === null) return { kind: 'absent' };
  // Une place J2 libre n'existe qu'au lobby avant toute partie ; ailleurs, la room est complète.
  if (guest !== null || room.phase !== 'lobby' || room.match !== null) return { kind: 'full' };
  // 2^-256 : impossible avec deux tokens aléatoires ; refusé plutôt que de confondre deux places.
  if (guestTokenHash === host.tokenHash) throw new Error('Empreintes de token identiques.');
  return {
    kind: 'reserved',
    room: { ...room, revision: room.revision + 1, seats: [host, reserve(guestTokenHash, now)] },
  };
}

export type ReservationSettlement =
  | { readonly kind: 'unchanged' }
  /** J2 jamais connecté libéré : la room reste ouverte pour un autre invité. */
  | { readonly kind: 'released'; readonly room: PersistedRoom }
  /** J1 jamais connecté : la room est fermée et son état effacé. */
  | { readonly kind: 'closed' };

/**
 * Applique les réservations échues à `now` (échéance ≤ `now` : une arrivée à l'instant exact est
 * trop tardive). J1 absent ferme la room ; J2 absent libère seulement J2 et retire les
 * confirmations, pour qu'un nouvel invité soit confirmé à neuf. Idempotente.
 */
export function settleReservations(room: PersistedRoom, now: number): ReservationSettlement {
  const [host, guest] = room.seats;
  if (isDue(host, now)) return { kind: 'closed' };
  if (!isDue(guest, now)) return { kind: 'unchanged' };
  return {
    kind: 'released',
    room: {
      ...room,
      revision: room.revision + 1,
      ready: [false, false],
      connected: [room.connected[0], false],
      seats: [host, null],
    },
  };
}

/** Prochaine échéance de réservation, pour l'alarme unique de la room ; `null` s'il n'y en a aucune. */
export function nextReservationDeadline(room: PersistedRoom): number | null {
  const deadlines = room.seats.map(reservedUntil).filter((until) => until !== null);
  return deadlines.length === 0 ? null : Math.min(...deadlines);
}

function reserve(tokenHash: string, now: number): Seat {
  return { tokenHash, reservedUntil: now + RESERVATION_TTL_MS };
}

function isDue(seat: Seat | null, now: number): boolean {
  const until = reservedUntil(seat);
  return until !== null && until <= now;
}

function reservedUntil(seat: Seat | null): number | null {
  return seat?.reservedUntil ?? null;
}
