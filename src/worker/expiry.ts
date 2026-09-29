import { ROOM_IDLE_TIMEOUT_MS, ROOM_MAX_DURATION_MS, type CloseReason } from '../shared/protocol/index.ts';
import type { PersistedRoom } from './codec.ts';

/**
 * Fin de vie d'une room (D15, D16, D17 ; PFC-017, PFC-018) : règles pures, sans horloge ni stockage,
 * comme `game.ts` et `reservations.ts`. La room (`room.ts`) fournit `now`, persiste la fermeture
 * (`closeRoom`) avant toute publication, informe les joueurs présents (`room-closed {reason}`), puis
 * efface son stockage.
 *
 * Trois échéances ferment une room ouverte, sans trophée, sous la même alarme unique :
 * - `reconnect-timeout` : une place absente n'est pas revenue en 30 s (`reconnectDeadline`, D15) ;
 * - `max-duration` : 4 h depuis la création (`createdAt`), absolues, pause comprise ;
 * - `inactive` : 30 min sans activité utile (`lastActivityAt`), manches sans aucun choix comprises (D17).
 * Une échéance égale à `now` est échue : une commande ou une reconnexion arrivée à l'instant exact est
 * trop tardive. `ping`, refus et reprises de place ne déplacent aucune de ces échéances.
 */

/** Fermetures décidées par l'horloge, dans l'ordre retenu quand plusieurs échéances tombent au même instant. */
const TIMED_CLOSURES = ['reconnect-timeout', 'max-duration', 'inactive'] as const satisfies readonly CloseReason[];

export type TimedClosure = (typeof TIMED_CLOSURES)[number];

/** Échéance de chaque fermeture pour cette room ; `null` si elle ne s'applique pas. */
function closureDeadlines(room: PersistedRoom): Readonly<Record<TimedClosure, number | null>> {
  return {
    'reconnect-timeout': room.reconnectDeadline,
    'max-duration': room.createdAt + ROOM_MAX_DURATION_MS,
    inactive: room.lastActivityAt + ROOM_IDLE_TIMEOUT_MS,
  };
}

/**
 * Motif de la fermeture due à `now`, ou `null`. Si plusieurs échéances sont dues (alarme en retard, room
 * réveillée après une perte d'instance), le motif est celle survenue la première ; à instant égal,
 * l'ordre de `TIMED_CLOSURES`.
 */
export function dueClosure(room: PersistedRoom, now: number): TimedClosure | null {
  if (room.phase === 'closed') return null;
  const deadlines = closureDeadlines(room);
  let first: { readonly reason: TimedClosure; readonly at: number } | null = null;
  for (const reason of TIMED_CLOSURES) {
    const at = deadlines[reason];
    if (at !== null && at <= now && (first === null || at < first.at)) first = { reason, at };
  }
  return first?.reason ?? null;
}

/** Plus proche échéance de fermeture, pour l'alarme unique : toute room ouverte en a au moins deux. */
export function nextClosureDeadline(room: PersistedRoom): number | null {
  if (room.phase === 'closed') return null;
  return Math.min(...Object.values(closureDeadlines(room)).filter((deadline) => deadline !== null));
}

/**
 * Activité utile à `now` (D16) : l'échéance d'inactivité repart pour 30 min. Jamais en arrière, même si
 * l'horloge recule ; la transition qui porte l'activité consomme seule la révision.
 */
export function recordActivity(room: PersistedRoom, now: number): PersistedRoom {
  return now > room.lastActivityAt ? { ...room, lastActivityAt: now } : room;
}
