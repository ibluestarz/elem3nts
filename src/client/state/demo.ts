import {
  EMPTY_SELECTION,
  resolveRound,
  type Choices,
  type PlayerIndex,
  type RoundKind,
  type RoundResolution,
  type Scores,
} from '../../domain/index.ts';
import type { SceneView } from '../scene/commands.ts';
import { clashDelays, revealDelay } from '../../shared/cycle.ts';

/**
 * Démo des confrontations (maquette `runDemo`, PFC-026) : une confrontation imposée rejouée hors partie.
 * Aucune session, aucun trophée, aucune manche suivante ; textes et deltas viennent du moteur pur (D25).
 *
 * - `idle` : au repos, confrontations disponibles ;
 * - `armed` : choix verrouillés, 0,7 s avant la révélation (maquette) ;
 * - `reveal`, `clash`, `result` : mêmes échéances que la partie (D09), puis retour au repos.
 */
export type DemoPhase = 'idle' | 'armed' | 'reveal' | 'clash' | 'result';

/** Verrous montrés avant la révélation (maquette : `after(700, doReveal)`). */
export const DEMO_ARM_MS = 700;

/** Les neuf confrontations, dans l'ordre des boutons de la maquette. */
export const DEMO_KINDS: readonly RoundKind[] = Object.freeze([
  'wave',
  'burn',
  'grow',
  'flare',
  'siphon',
  'thrive',
  'balance',
  'solo',
  'void',
]);

/** Choix imposés (maquette) : élément du côté vainqueur, puis celui de l'autre côté. */
const PAIRS: Readonly<Record<RoundKind, readonly [Choices[0], Choices[1]]>> = {
  wave: ['water', 'fire'],
  burn: ['fire', 'plant'],
  grow: ['plant', 'water'],
  flare: ['fire', 'fire'],
  siphon: ['water', 'water'],
  thrive: ['plant', 'plant'],
  balance: ['plant', 'plant'],
  solo: ['fire', null],
  void: [null, null],
};

export interface DemoState {
  /** Côté vainqueur choisi (« À gauche » = Joueur 1). */
  readonly side: PlayerIndex;
  readonly phase: DemoPhase;
  readonly deadline: number | null;
  /** Nombre de confrontations lancées : identifie chacune pour la scène. */
  readonly run: number;
  /** Choix imposés de la confrontation en cours ou dernière jouée. */
  readonly choices: Choices;
  /** Résolution du moteur pur, calculée au lancement ; `null` avant la première. */
  readonly round: RoundResolution | null;
}

export type DemoAction =
  | { readonly type: 'side'; readonly side: PlayerIndex }
  | { readonly type: 'run'; readonly kind: RoundKind; readonly now: number }
  | { readonly type: 'tick'; readonly now: number };

export function initialDemoState(): DemoState {
  return { side: 0, phase: 'idle', deadline: null, run: 0, choices: EMPTY_SELECTION, round: null };
}

/** Scores et choix de départ d'une confrontation (maquette) : 2/2, écart 1/3 ou 3/1 pour `thrive`. */
export function demoSetup(kind: RoundKind, side: PlayerIndex): { readonly scores: Scores; readonly choices: Choices } {
  const [winning, other] = PAIRS[kind];
  const choices: Choices = side === 0 ? [winning, other] : [other, winning];
  // Plante + Plante avec écart : le vainqueur est celui qui est en retard.
  const scores: Scores = kind === 'thrive' ? (side === 0 ? [1, 3] : [3, 1]) : [2, 2];
  return { scores, choices };
}

/** Transition due à l'échéance ; l'échéance suivante part de `now` (D31). */
function advance(state: DemoState, now: number): DemoState {
  const { round } = state;
  if (!round) return state;
  switch (state.phase) {
    case 'armed':
      return { ...state, phase: 'reveal', deadline: now + revealDelay(round.kind) };
    case 'reveal':
      return { ...state, phase: 'clash', deadline: now + clashDelays(round.kind).toImpact };
    case 'clash':
      return { ...state, phase: 'result', deadline: now + clashDelays(round.kind).afterImpact };
    case 'result':
      // Maquette `afterRound` en démo : retour au repos, jamais de manche suivante.
      return { ...state, phase: 'idle', deadline: null };
    case 'idle':
      return state;
  }
}

export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case 'side':
      return state.side === action.side ? state : { ...state, side: action.side };
    case 'run': {
      // Une confrontation à la fois : un clic pendant un effet est ignoré.
      if (state.phase !== 'idle') return state;
      const { scores, choices } = demoSetup(action.kind, state.side);
      return {
        ...state,
        phase: 'armed',
        deadline: action.now + DEMO_ARM_MS,
        run: state.run + 1,
        choices,
        round: resolveRound(scores, choices),
      };
    }
    case 'tick':
      if (state.deadline === null || action.now < state.deadline) return state;
      return advance(state, action.now);
  }
}

/** Scores affichés : ceux d'avant jusqu'à l'impact, le résultat ensuite (0/0 avant toute confrontation). */
export function demoScores(state: DemoState): Scores {
  const { round } = state;
  if (!round) return [0, 0];
  return state.phase === 'result' || state.phase === 'idle' ? round.after : round.before;
}

/** Phases où les éléments sont révélés. */
export const isDemoRevealed = (phase: DemoPhase): boolean => phase === 'reveal' || phase === 'clash' || phase === 'result';

/**
 * Projection pour la scène, au vocabulaire du cycle : les verrous comme une sélection, les éléments
 * seulement à la révélation, le repos après une confrontation comme l'après-manche (remise à zéro).
 */
export function demoSceneView(state: DemoState): SceneView {
  const { round } = state;
  const revealed = isDemoRevealed(state.phase);
  const phase =
    state.phase === 'armed' ? 'selecting' : state.phase === 'idle' ? (round ? 'pause' : 'intro') : state.phase;
  return {
    screen: 'demo',
    phase,
    matchId: round ? `demo-${String(state.run)}` : null,
    round: 1,
    locked: [state.choices[0] !== null, state.choices[1] !== null],
    revealed: revealed ? state.choices : null,
    // Place « gagnante » de l'effet : celle de la maquette (0 pour les effets symétriques).
    clash: round && revealed ? { kind: round.kind, winner: round.winner ?? 0 } : null,
    celebrate: null,
  };
}
