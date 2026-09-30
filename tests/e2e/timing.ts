/**
 * Chronologie des manches partagée par les tests E2E et le script de capture (sans React ni CSS) :
 * reflet de CYCLE_MS et CLASH_TIMING de src/client/state/game.ts, vérifié par
 * tests/unit/client/timing-sync.test.ts.
 */
export const CYCLE = {
  banner: 1800,
  ready: 400,
  selection: 5000,
  reveal: 1100,
  revealEmpty: 500,
  afterEffect: 1600,
  pause: 800,
  sudden: 2200,
  suddenPause: 300,
  closing: 700,
} as const;

export const CLASH_TIMING = {
  wave: { duration: 3400, impact: 0.58 },
  burn: { duration: 3600, impact: 0.47 },
  grow: { duration: 3800, impact: 0.62 },
  flare: { duration: 3000, impact: 0.45 },
  siphon: { duration: 3400, impact: 0.62 },
  thrive: { duration: 3200, impact: 0.6 },
  balance: { duration: 3000, impact: 0.5 },
  solo: { duration: 2400, impact: 0.42 },
  void: { duration: 2000, impact: 0.5 },
} as const;

export type ClashKind = keyof typeof CLASH_TIMING;

/** Du début de l'effet à l'impact, puis de l'impact à la suite (ms), comme `clashDelays`. */
export function clashDelays(kind: ClashKind): { readonly toImpact: number; readonly afterImpact: number } {
  const { duration, impact } = CLASH_TIMING[kind];
  const toImpact = Math.round(duration * impact);
  return { toImpact, afterImpact: duration - toImpact + CYCLE.afterEffect };
}

/** Démo des confrontations : verrous montrés 0,7 s avant la révélation (`DEMO_ARM_MS`, src/client/state/demo.ts). */
export const DEMO_ARM_MS = 700;
