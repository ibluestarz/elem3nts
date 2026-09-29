import { DomainError } from './errors.ts';
import { assertScores, resolveRound, type Choices, type PlayerIndex, type RoundResolution, type Scores } from './round.ts';
import { assertSettings, type MatchSettings } from './settings.ts';

/** Issue calculée par les règles R07/R08. */
export type MatchVerdict =
  | { readonly status: 'playing' }
  | { readonly status: 'won'; readonly winner: PlayerIndex }
  | { readonly status: 'draw' };

/** `cancelled` : partie interrompue (retour accueil, départ, expiration) ; jamais récompensée (R09). */
export type MatchResult = MatchVerdict | { readonly status: 'cancelled' };

export interface Match {
  readonly id: string;
  readonly settings: MatchSettings;
  readonly scores: Scores;
  readonly result: MatchResult;
}

export interface RoundPlay {
  readonly match: Match;
  readonly round: RoundResolution;
}

const PLAYING: MatchVerdict = Object.freeze({ status: 'playing' });
const DRAW: MatchVerdict = Object.freeze({ status: 'draw' });
const WON: readonly [MatchVerdict, MatchVerdict] = [
  Object.freeze({ status: 'won', winner: 0 }),
  Object.freeze({ status: 'won', winner: 1 }),
];
const CANCELLED: MatchResult = Object.freeze({ status: 'cancelled' });

/**
 * Fin de partie sur des scores après manche (R07 nul ON, R08 nul OFF). Aucun plafond ni
 * départage : sans vainqueur, la partie continue, même sous X après une prolongation.
 */
export function evaluateMatch(scores: Scores, settings: MatchSettings): MatchVerdict {
  assertScores(scores);
  assertSettings(settings);
  const [s1, s2] = scores;
  const { target, drawEnabled } = settings;
  const reached1 = s1 >= target;
  const reached2 = s2 >= target;
  if (drawEnabled) {
    if (reached1 && reached2) return DRAW;
    if (reached1) return WON[0];
    if (reached2) return WON[1];
    return PLAYING;
  }
  if (reached1 && s1 > s2) return WON[0];
  if (reached2 && s2 > s1) return WON[1];
  return PLAYING;
}

/** Nouvelle partie à 0/0. `id` est le matchId injecté (jamais généré par le domaine). */
export function startMatch(id: string, settings: MatchSettings): Match {
  assertMatchId(id);
  assertSettings(settings);
  return Object.freeze({
    id,
    settings: Object.freeze({ target: settings.target, drawEnabled: settings.drawEnabled }),
    scores: Object.freeze([0, 0] as const),
    result: PLAYING,
  });
}

/**
 * Transition atomique d'une manche : scores résolus depuis l'état avant manche (R06),
 * puis seulement évaluation de la fin. Refuse une partie déjà terminée ou annulée.
 */
export function playRound(match: Match, choices: Choices): RoundPlay {
  assertPlaying(match);
  const round = resolveRound(match.scores, choices);
  return Object.freeze({
    match: Object.freeze({ ...match, scores: round.after, result: evaluateMatch(round.after, match.settings) }),
    round,
  });
}

/** Annule une partie en cours. Sans effet sur une partie déjà terminée ou annulée. */
export function cancelMatch(match: Match): Match {
  return match.result.status === 'playing' ? Object.freeze({ ...match, result: CANCELLED }) : match;
}

function assertMatchId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0) {
    throw new RangeError('Identifiant de partie invalide : chaîne non vide attendue.');
  }
}

function assertPlaying(match: Match): void {
  if (match.result.status !== 'playing') {
    throw new DomainError('MATCH_OVER', `La partie ${match.id} est terminée : aucune manche supplémentaire.`);
  }
}
