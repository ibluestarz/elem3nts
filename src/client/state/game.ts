import {
  DEFAULT_SETTINGS,
  EMPTY_SELECTION,
  TARGET_MAX,
  TARGET_MIN,
  cancelMatch,
  lockChoice,
  parseTargetInput,
  playRound,
  settleMatch,
  startMatch,
  startSession,
  type Element,
  type Match,
  type PlayerIndex,
  type RoundPlay,
  type Scores,
  type Selection,
  type Session,
  type TargetInput,
} from '../../domain/index.ts';
import { CYCLE_MS, clashDelays, revealDelay, roundFollowUp } from '../../shared/cycle.ts';

/** Chronologie D09 partagée avec la room en ligne (PFC-014) : une seule source des échéances. */
export { CLASH_TIMING, CYCLE_MS, clashDelays } from '../../shared/cycle.ts';

/**
 * - `intro` : bannière « Que le duel commence » ;
 * - `ready` : bannière effacée, sélection imminente ;
 * - `gate` : tour par tour sur un seul téléphone (PFC-025) : voile opaque, le joueur `turn` confirme être prêt ;
 * - `selecting` : fenêtre de 5 s, choix verrouillés et masqués (des deux joueurs, ou du seul joueur `turn`) ;
 * - `reveal` : éléments révélés, résolution déjà appliquée, scores d'avant affichés ;
 * - `clash` : chorégraphie de la confrontation jusqu'à l'impact, scores d'avant toujours affichés ;
 * - `result` : impact, scores, deltas et explication jusqu'à la fin de l'effet (+ 1,6 s) ;
 * - `sudden` : bannière « Mort subite » ; `pause` : avant la manche suivante ;
 * - `closing` puis `ended` : fin de partie, trophées réglés une fois.
 */
export type Phase =
  | 'intro'
  | 'ready'
  | 'gate'
  | 'selecting'
  | 'reveal'
  | 'clash'
  | 'result'
  | 'sudden'
  | 'pause'
  | 'closing'
  | 'ended';

/** État local avant et pendant une partie : saisie de X, cycle de la partie et session (D13). */
export interface GameState {
  /** Dernière valeur de X valide ; seule utilisée pour lancer une partie. */
  readonly target: number;
  /** Saisie en cours, éventuellement invalide (jamais arrondie en silence). */
  readonly draft: string;
  readonly match: Match | null;
  readonly phase: Phase;
  /** Échéance de la phase en cours (horloge injectée), `null` sans échéance. */
  readonly deadline: number | null;
  /** Numéro de la manche en cours ou dernière jouée (0 avant la première). */
  readonly round: number;
  /**
   * Tour par tour (PFC-025, D47) : joueur dont c'est le tour (voile puis 5 s), `null` pour une manche simultanée.
   * Fixé à l'ouverture de la manche : un redimensionnement en cours de manche n'en change pas le mode.
   */
  readonly turn: PlayerIndex | null;
  /** Mort subite annoncée : égalité au-delà de X, nul OFF (R08, D05). */
  readonly sudden: boolean;
  /** Choix de la manche : jamais rendus avant la révélation. */
  readonly selection: Selection;
  /** Choix révélés et résolution de la dernière manche, présents dès la révélation. */
  readonly revealed: Selection | null;
  readonly play: RoundPlay | null;
  readonly session: Session;
  /** Compteur des parties lancées : source des matchId locaux. */
  readonly started: number;
}

export type GameAction =
  | { readonly type: 'draft'; readonly text: string }
  | { readonly type: 'target'; readonly value: number }
  | { readonly type: 'step'; readonly delta: 1 | -1 }
  | { readonly type: 'start'; readonly drawEnabled: boolean; readonly now: number }
  /**
   * Échéance atteinte : au plus une transition par action, idempotente. `hotseat` (scène de moins de
   * 720 px, un seul téléphone) ouvre la manche suivante en tour par tour (PFC-025).
   */
  | { readonly type: 'tick'; readonly now: number; readonly hotseat: boolean }
  /** Tour par tour : le joueur du voile se déclare prêt, sa fenêtre de 5 s s'ouvre. */
  | { readonly type: 'turn-ready'; readonly now: number }
  /** Choix d'un joueur ; en tour par tour, celui de Joueur 2 déclenche aussitôt la révélation (`now`). */
  | { readonly type: 'choose'; readonly player: PlayerIndex; readonly element: Element; readonly now: number }
  /** Revanche depuis l'écran de fin : mêmes réglages, nouveau matchId, trophées conservés (D12). */
  | { readonly type: 'rematch'; readonly now: number }
  /** Entrée en mode local depuis l'accueil : nouvelle session, trophées à 0/0 (D13). */
  | { readonly type: 'new-session' }
  | { readonly type: 'quit' };

/** Échéance atteinte, émise par l'horloge du cycle (`useCycle`). */
export type CycleTick = Extract<GameAction, { readonly type: 'tick' }>;

const IDLE_CYCLE = {
  phase: 'intro',
  deadline: null,
  round: 0,
  turn: null,
  sudden: false,
  selection: EMPTY_SELECTION,
  revealed: null,
  play: null,
} as const satisfies Partial<GameState>;

export function initialGameState(): GameState {
  return {
    target: DEFAULT_SETTINGS.target,
    draft: String(DEFAULT_SETTINGS.target),
    match: null,
    ...IDLE_CYCLE,
    session: startSession(),
    started: 0,
  };
}

export function draftInput(state: GameState): TargetInput {
  return parseTargetInput(state.draft);
}

/** Une partie commencée et non terminée fige ses réglages (SPEC, PFC-004-AC3). */
export function isMatchInProgress(state: GameState): boolean {
  return state.match?.result.status === 'playing';
}

/** Trophées gagnés par la partie terminée : le vainqueur, ou les deux en cas de nul (R09). */
export function trophiesWon(match: Match): readonly [boolean, boolean] {
  if (match.result.status === 'won') return [match.result.winner === 0, match.result.winner === 1];
  return match.result.status === 'draw' ? [true, true] : [false, false];
}

/** Scores montrés : ceux d'avant la manche pendant la révélation, le résultat ensuite (maquette). */
export function displayedScores(state: GameState): Scores | null {
  if ((state.phase === 'reveal' || state.phase === 'clash') && state.play) return state.play.round.before;
  return state.match?.scores ?? null;
}

/** Résolution unique de la manche (SPEC cycle), choix manquants compris (R11, R12). */
function resolve(state: GameState, match: Match, now: number): GameState {
  const play = playRound(match, state.selection);
  return {
    ...state,
    phase: 'reveal',
    deadline: now + revealDelay(play.round.kind),
    match: play.match,
    revealed: state.selection,
    play,
  };
}

/** Tour par tour : fin du tour de Joueur 1 (choix ou échéance), voile avant celui de Joueur 2. */
const handOver = (state: GameState): GameState => ({ ...state, phase: 'gate', turn: 1, deadline: null });

/**
 * Transition due à l'échéance. Chaque échéance suivante part de `now` : une transition traitée en
 * retard (onglet masqué) ne déclenche pas de rattrapage en rafale (D31).
 */
function advance(state: GameState, now: number, hotseat: boolean): GameState {
  const { match } = state;
  if (!match) return state;
  switch (state.phase) {
    case 'intro':
      return { ...state, phase: 'ready', deadline: now + CYCLE_MS.ready };
    case 'ready':
    case 'pause': {
      const round = { round: state.round + 1, selection: EMPTY_SELECTION, revealed: null, play: null };
      // Un seul téléphone : voile de Joueur 1, sans échéance (il se déclare prêt).
      if (hotseat) return { ...state, ...round, phase: 'gate', turn: 0, deadline: null };
      return { ...state, ...round, phase: 'selecting', turn: null, deadline: now + CYCLE_MS.selection };
    }
    case 'gate':
      return state;
    case 'selecting':
      return state.turn === 0 ? handOver(state) : resolve(state, match, now);
    case 'reveal':
      if (!state.play) return state;
      return { ...state, phase: 'clash', deadline: now + clashDelays(state.play.round.kind).toImpact };
    case 'clash':
      if (!state.play) return state;
      return { ...state, phase: 'result', deadline: now + clashDelays(state.play.round.kind).afterImpact };
    case 'result': {
      const followUp = roundFollowUp(match);
      if (followUp === 'end') return { ...state, phase: 'closing', deadline: now + CYCLE_MS.closing };
      // Égalité au-delà de X, nul OFF (R08, D05) : bannière « Mort subite » avant la manche suivante.
      return followUp === 'sudden'
        ? { ...state, phase: 'sudden', sudden: true, deadline: now + CYCLE_MS.sudden }
        : { ...state, phase: 'pause', deadline: now + CYCLE_MS.pause };
    }
    case 'sudden':
      return { ...state, phase: 'pause', deadline: now + CYCLE_MS.suddenPause };
    case 'closing':
      // Trophées une seule fois par matchId (R09, R10).
      return { ...state, phase: 'ended', deadline: null, session: settleMatch(state.session, match).session };
    case 'ended':
      return state;
  }
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case 'draft': {
      if (isMatchInProgress(state)) return state;
      const input = parseTargetInput(action.text);
      return { ...state, draft: action.text, target: input.ok ? input.value : state.target };
    }
    case 'target': {
      if (isMatchInProgress(state)) return state;
      const value = Math.min(TARGET_MAX, Math.max(TARGET_MIN, action.value));
      return { ...state, target: value, draft: String(value) };
    }
    case 'step':
      return gameReducer(state, { type: 'target', value: state.target + action.delta });
    case 'start': {
      if (isMatchInProgress(state)) return state;
      const input = draftInput(state);
      if (!input.ok) return state;
      const started = state.started + 1;
      const match = startMatch(`local-${String(started)}`, { target: input.value, drawEnabled: action.drawEnabled });
      return { ...state, ...IDLE_CYCLE, target: input.value, match, started, deadline: action.now + CYCLE_MS.banner };
    }
    case 'tick':
      if (state.deadline === null || action.now < state.deadline) return state;
      return advance(state, action.now, action.hotseat);
    case 'turn-ready':
      if (state.phase !== 'gate' || state.turn === null) return state;
      return { ...state, phase: 'selecting', deadline: action.now + CYCLE_MS.selection };
    case 'choose': {
      const { match } = state;
      if (!match || !isMatchInProgress(state) || state.phase !== 'selecting') return state;
      // Tour par tour : seul le joueur dont c'est le tour choisit.
      if (state.turn !== null && action.player !== state.turn) return state;
      // Premier choix verrouillé (D08) : un second choix rend l'état inchangé.
      const lock = lockChoice(state.selection, action.player, action.element);
      if (!lock.locked) return state;
      const locked = { ...state, selection: lock.selection };
      // Le choix clôt le tour : voile de Joueur 2, ou révélation immédiate après celui de Joueur 2 (SPEC).
      if (state.turn === 0) return handOver(locked);
      return state.turn === 1 ? resolve(locked, match, action.now) : locked;
    }
    case 'rematch': {
      // Seulement depuis une partie terminée : un second appui (Espace maintenu, double clic) est sans effet.
      if (state.phase !== 'ended' || !state.match) return state;
      const started = state.started + 1;
      const match = startMatch(`local-${String(started)}`, state.match.settings);
      return { ...state, ...IDLE_CYCLE, match, started, deadline: action.now + CYCLE_MS.banner };
    }
    case 'new-session':
      if (isMatchInProgress(state)) return state;
      return { ...state, ...IDLE_CYCLE, match: null, session: startSession() };
    case 'quit': {
      if (state.match === null) return state;
      // Quitter une partie en cours l'annule sans trophée (R09) ; une partie terminée est déjà réglée.
      const session = isMatchInProgress(state) ? settleMatch(state.session, cancelMatch(state.match)).session : state.session;
      return { ...state, ...IDLE_CYCLE, match: null, session };
    }
  }
}
