export { ELEMENTS, beats, isElement, type Element } from './element.ts';
export { DomainError, type DomainErrorCode } from './errors.ts';
export {
  cancelMatch,
  evaluateMatch,
  playRound,
  startMatch,
  type Match,
  type MatchResult,
  type MatchVerdict,
  type RoundPlay,
} from './match.ts';
export {
  MAX_SCORE,
  assertScores,
  resolveRound,
  type Choice,
  type Choices,
  type PlayerIndex,
  type RoundKind,
  type RoundOutcome,
  type RoundResolution,
  type Scores,
} from './round.ts';
export { settleMatch, startSession, type Session, type Settlement, type Trophies } from './session.ts';
export {
  DEFAULT_SETTINGS,
  TARGET_MAX,
  TARGET_MIN,
  assertSettings,
  parseTargetInput,
  type MatchSettings,
  type TargetInput,
  type TargetInputError,
} from './settings.ts';
export { EMPTY_SELECTION, lockChoice, lockedPlayers, type Lock, type Selection } from './selection.ts';
