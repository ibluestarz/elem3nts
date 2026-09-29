import {
  lockedPlayers,
  type Choices,
  type Match,
  type MatchSettings,
  type PlayerIndex,
  type RoundKind,
  type RoundResolution,
  type Scores,
  type Selection,
  type Trophies,
} from '../../domain/index.ts';
import { PROTOCOL_VERSION } from './limits.ts';
import { freezePair } from './schema.ts';

/**
 * Phases serveur (PROTOCOL « Machine à états serveur »). `starting` : ouverture d'une partie
 * (bannière D09, `MATCH_INTRO_MS`) avant la sélection de la manche 1 ; aucun choix n'y est accepté.
 */
export const PHASES = ['lobby', 'starting', 'selecting', 'round-result', 'match-ended', 'paused', 'closed'] as const;

export type Phase = (typeof PHASES)[number];

export function isPhase(value: unknown): value is Phase {
  return (PHASES as readonly unknown[]).includes(value);
}

/**
 * Phases qu'une déconnexion met en pause et qu'une reconnexion reprend (D15). `starting` compris
 * (PFC-017, D42) : une absence pendant l'ouverture ferait perdre la première manche à l'absent.
 */
export const RESUMABLE_PHASES = ['starting', 'selecting', 'round-result'] as const;

export type ResumablePhase = (typeof RESUMABLE_PHASES)[number];

export function isResumablePhase(value: unknown): value is ResumablePhase {
  return (RESUMABLE_PHASES as readonly unknown[]).includes(value);
}

export type Flags = readonly [p1: boolean, p2: boolean];

/** Manche révélée : ses choix ne deviennent publics qu'à partir de sa révélation. */
export interface RevealedRound {
  readonly roundId: number;
  readonly choices: Choices;
  readonly resolution: RoundResolution;
}

/**
 * Vue d'une room telle que la projection la lit. Le stockage (PFC-011/014) peut porter bien plus
 * (tokens hashés, file d'idempotence, échéances internes) : la projection ne lit que ces champs,
 * un par un, et n'en recopie aucun sans le reconstruire.
 */
export interface RoomView {
  readonly revision: number;
  readonly roomCode: string;
  readonly phase: Phase;
  /** Phase sauvegardée, renseignée seulement en `paused`. */
  readonly resumePhase: ResumablePhase | null;
  readonly settings: MatchSettings;
  readonly settingsRevision: number;
  /** Partie en cours ou terminée ; `null` au lobby avant la première partie. */
  readonly match: Match | null;
  readonly roundId: number | null;
  /** Choix privés de la manche en cours : seule leur présence est publiée, jamais leur valeur. */
  readonly selection: Selection;
  readonly lastRound: RevealedRound | null;
  readonly trophies: Trophies;
  /** Prêts au lobby, confirmations de revanche en fin de partie. */
  readonly ready: Flags;
  readonly connected: Flags;
  /** Échéance absolue de la phase (ouverture, sélection, résultat, reconnexion), en ms serveur. */
  readonly deadline: number | null;
}

/** Résultat public d'une manche, après sa révélation (D25 : nature, gagnant, delta effectif). */
export interface PublicRoundResult {
  readonly kind: RoundKind;
  readonly winner: PlayerIndex | null;
  readonly delta: readonly [p1: number, p2: number];
}

export type PublicMatchResult =
  | { readonly status: 'won'; readonly winner: PlayerIndex }
  | { readonly status: 'draw' };

/** Message `state` : unique vue publique d'une room, propre à une place (`yourSlot`). */
export interface PublicState {
  readonly v: typeof PROTOCOL_VERSION;
  readonly type: 'state';
  readonly revision: number;
  readonly serverNow: number;
  readonly roomCode: string;
  readonly yourSlot: PlayerIndex;
  readonly phase: Phase;
  readonly resumePhase?: ResumablePhase;
  readonly matchId: string | null;
  readonly roundId: number | null;
  readonly settings: MatchSettings;
  readonly settingsRevision: number;
  readonly scores: Scores;
  readonly trophies: Trophies;
  readonly ready: Flags;
  readonly connected: Flags;
  /** Qui a verrouillé un choix, sans jamais dire lequel. */
  readonly choiceLocked: Flags;
  readonly deadline?: number;
  readonly revealedChoices?: Choices;
  readonly result?: PublicRoundResult;
  readonly matchResult?: PublicMatchResult;
}

const TIMED_PHASES: readonly Phase[] = ['starting', 'selecting', 'round-result', 'paused'];

/**
 * Vrai si les choix de la manche courante sont publics : résultat, fin de partie, ou pause
 * survenue pendant le résultat. En sélection et en pause de sélection, jamais.
 */
export function isRevealedPhase(phase: Phase, resumePhase: ResumablePhase | null): boolean {
  return phase === 'round-result' || phase === 'match-ended' || (phase === 'paused' && resumePhase === 'round-result');
}

/**
 * Construit le `state` d'une place par allowlist explicite : chaque champ est relu et reconstruit,
 * rien n'est sérialisé depuis le stockage. Fonction pure ; `serverNow` est injecté.
 *
 * Garanties : aucun élément choisi avant révélation (ni celui de l'adversaire, ni le sien), aucun
 * token ni hash ; une manche révélée n'est publiée que si elle est la manche courante.
 */
export function projectState(room: RoomView, yourSlot: PlayerIndex, serverNow: number): PublicState {
  const { phase, match, lastRound } = room;
  const resumePhase = phase === 'paused' ? room.resumePhase : null;
  const revealed =
    isRevealedPhase(phase, resumePhase) && lastRound !== null && lastRound.roundId === room.roundId ? lastRound : null;
  const deadline = room.deadline !== null && TIMED_PHASES.includes(phase) ? room.deadline : null;
  const matchResult = phase === 'match-ended' && match !== null ? publicMatchResult(match) : null;

  return Object.freeze({
    v: PROTOCOL_VERSION,
    type: 'state',
    revision: room.revision,
    serverNow,
    roomCode: room.roomCode,
    yourSlot,
    phase,
    ...(resumePhase === null ? {} : { resumePhase }),
    matchId: match?.id ?? null,
    roundId: room.roundId,
    settings: Object.freeze({ target: room.settings.target, drawEnabled: room.settings.drawEnabled }),
    settingsRevision: room.settingsRevision,
    scores: match === null ? freezePair(0, 0) : freezePair(match.scores[0], match.scores[1]),
    trophies: freezePair(room.trophies[0], room.trophies[1]),
    ready: freezePair(room.ready[0], room.ready[1]),
    connected: freezePair(room.connected[0], room.connected[1]),
    choiceLocked: lockedPlayers(room.selection),
    ...(deadline === null ? {} : { deadline }),
    ...(revealed === null
      ? {}
      : {
          revealedChoices: freezePair(revealed.choices[0], revealed.choices[1]),
          result: Object.freeze({
            kind: revealed.resolution.kind,
            winner: revealed.resolution.winner,
            delta: freezePair(revealed.resolution.delta[0], revealed.resolution.delta[1]),
          }),
        }),
    ...(matchResult === null ? {} : { matchResult }),
  });
}

function publicMatchResult(match: Match): PublicMatchResult | null {
  const { result } = match;
  switch (result.status) {
    case 'won':
      return Object.freeze({ status: 'won', winner: result.winner });
    case 'draw':
      return Object.freeze({ status: 'draw' });
    case 'playing':
    case 'cancelled':
      return null;
  }
}
