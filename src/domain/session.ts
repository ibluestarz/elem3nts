import { DomainError } from './errors.ts';
import type { Match } from './match.ts';

/** Trophées J1/J2 de la session. */
export type Trophies = readonly [p1: number, p2: number];

export interface Session {
  readonly trophies: Trophies;
  /** Parties déjà réglées (récompensées ou annulées), dans l'ordre : aucune ne l'est deux fois (R10). */
  readonly settledMatchIds: readonly string[];
}

export interface Settlement {
  readonly session: Session;
  /** Trophées ajoutés par cet appel : [0, 0] pour une annulation ou un doublon. */
  readonly awarded: Trophies;
  /** Faux si ce matchId était déjà réglé : la session est rendue telle quelle. */
  readonly applied: boolean;
}

const NONE: Trophies = Object.freeze([0, 0] as const);

export function startSession(): Session {
  return Object.freeze({ trophies: NONE, settledMatchIds: Object.freeze([]) });
}

/**
 * Règle une partie terminée une seule fois par matchId (R09/R10) : victoire +1 au gagnant,
 * nul +1 chacun, annulation aucun trophée. Un doublon ou un replay ne change rien.
 */
export function settleMatch(session: Session, match: Match): Settlement {
  if (session.settledMatchIds.includes(match.id)) {
    return Object.freeze({ session, awarded: NONE, applied: false });
  }
  const awarded = rewardOf(match);
  const [t1, t2] = session.trophies;
  return Object.freeze({
    session: Object.freeze({
      trophies: Object.freeze([t1 + awarded[0], t2 + awarded[1]] as const),
      settledMatchIds: Object.freeze([...session.settledMatchIds, match.id]),
    }),
    awarded,
    applied: true,
  });
}

function rewardOf(match: Match): Trophies {
  const { result } = match;
  switch (result.status) {
    case 'won':
      return Object.freeze(result.winner === 0 ? ([1, 0] as const) : ([0, 1] as const));
    case 'draw':
      return Object.freeze([1, 1] as const);
    case 'cancelled':
      return NONE;
    case 'playing':
      throw new DomainError('MATCH_NOT_OVER', `La partie ${match.id} est en cours : aucun trophée avant sa fin.`);
  }
}
