import type { Match, RoundKind } from '../domain/index.ts';

/**
 * Chronologie d'une partie (D09), partagée par le cycle local (`client/state/game.ts`) et la room en
 * ligne (`worker/game.ts`) : les mêmes échéances avec ou sans 3D, en local comme en ligne. La scène
 * suit le jeu, jamais l'inverse. Durées reprises de la maquette avec son moteur 3D (D09, D33) :
 * ouverture, sélection (D08), révélation, résultat après la fin de l'effet, pause, mort subite et fin.
 */
export const CYCLE_MS = Object.freeze({
  banner: 1800,
  ready: 400,
  selection: 5000,
  reveal: 1100,
  revealEmpty: 500,
  /** Résultat maintenu après la fin de la chorégraphie (maquette : 1,6 s). */
  afterEffect: 1600,
  pause: 800,
  sudden: 2200,
  suddenPause: 300,
  closing: 700,
});

/**
 * Chorégraphie de chaque confrontation (moteur de la maquette) : durée totale et instant de l'impact
 * en fraction de cette durée. L'impact est le moment où scores, deltas et explication apparaissent.
 */
export const CLASH_TIMING: Readonly<Record<RoundKind, { readonly duration: number; readonly impact: number }>> =
  Object.freeze({
    wave: { duration: 3400, impact: 0.58 },
    burn: { duration: 3600, impact: 0.47 },
    grow: { duration: 3800, impact: 0.62 },
    flare: { duration: 3000, impact: 0.45 },
    siphon: { duration: 3400, impact: 0.62 },
    thrive: { duration: 3200, impact: 0.6 },
    balance: { duration: 3000, impact: 0.5 },
    solo: { duration: 2400, impact: 0.42 },
    void: { duration: 2000, impact: 0.5 },
  });

/** Ouverture d'une partie : bannière « Que le duel commence », puis sélection 0,4 s plus tard. */
export const MATCH_INTRO_MS = CYCLE_MS.banner + CYCLE_MS.ready;

/** Délais d'une confrontation : du début de l'effet à l'impact, puis de l'impact à la suite (ms). */
export function clashDelays(kind: RoundKind): { readonly toImpact: number; readonly afterImpact: number } {
  const { duration, impact } = CLASH_TIMING[kind];
  const toImpact = Math.round(duration * impact);
  return { toImpact, afterImpact: duration - toImpact + CYCLE_MS.afterEffect };
}

/** Révélation : plus courte quand aucun élément n'est à montrer (R12). */
export function revealDelay(kind: RoundKind): number {
  return kind === 'void' ? CYCLE_MS.revealEmpty : CYCLE_MS.reveal;
}

/**
 * Suite d'une manche résolue (`match` après la manche) : fin de partie, mort subite (égalité au-delà
 * de X, seul le nul OFF la permet : R07 terminerait en nul) ou manche suivante.
 */
export type RoundFollowUp = 'end' | 'sudden' | 'next';

export function roundFollowUp(match: Match): RoundFollowUp {
  if (match.result.status !== 'playing') return 'end';
  const [s1, s2] = match.scores;
  return s1 === s2 && s1 >= match.settings.target ? 'sudden' : 'next';
}

/**
 * Durée totale d'un résultat de manche, de l'échéance de sélection à la phase suivante (nouvelle
 * sélection ou écran de fin) : révélation, effet jusqu'à l'impact, résultat, puis pause, mort subite
 * ou fermeture. Le serveur en fait l'échéance de `round-result` ; un client en déduit l'instant de
 * révélation (`deadline - roundResultMs`), identique au cycle local.
 */
export function roundResultMs(kind: RoundKind, followUp: RoundFollowUp): number {
  const { toImpact, afterImpact } = clashDelays(kind);
  const tail =
    followUp === 'end' ? CYCLE_MS.closing : followUp === 'sudden' ? CYCLE_MS.sudden + CYCLE_MS.suddenPause : CYCLE_MS.pause;
  return revealDelay(kind) + toImpact + afterImpact + tail;
}
