import { beats, isElement, type Element } from './element.ts';

/** Index de place : 0 = Joueur 1, 1 = Joueur 2. */
export type PlayerIndex = 0 | 1;

/** Scores J1/J2 : entiers ≥ 0, sans plafond (R01). */
export type Scores = readonly [p1: number, p2: number];

/** Choix verrouillé d'un joueur, ou `null` s'il n'a pas choisi avant l'échéance (R11/R12). */
export type Choice = Element | null;

export type Choices = readonly [p1: Choice, p2: Choice];

/**
 * Nature de la confrontation, consommée par l'UI (explication) et la scène (effet) sans
 * qu'elles recalculent la règle. Vocabulaire de la maquette, voir DECISIONS D25.
 */
export type RoundOutcome =
  | { readonly kind: 'wave' | 'burn' | 'grow' | 'thrive' | 'solo'; readonly winner: PlayerIndex }
  | { readonly kind: 'flare' | 'siphon' | 'balance' | 'void'; readonly winner: null };

export type RoundKind = RoundOutcome['kind'];

export type RoundResolution = RoundOutcome & {
  readonly before: Scores;
  readonly after: Scores;
  /** Variation réellement appliquée (`after - before`), plancher zéro compris. */
  readonly delta: readonly [p1: number, p2: number];
};

/** Plus grand score accepté : garantit que `score + 1` reste un entier sûr. */
export const MAX_SCORE = Number.MAX_SAFE_INTEGER - 1;

const VICTORY_KIND = { water: 'wave', fire: 'burn', plant: 'grow' } as const satisfies Record<
  Element,
  RoundKind
>;

/**
 * Résout une manche (SPEC R02–R06, R11–R12) : les deux deltas sont calculés à partir des mêmes
 * scores avant manche puis appliqués ensemble. Fonction pure ; lève une RangeError sur entrée invalide.
 */
export function resolveRound(scores: Scores, choices: Choices): RoundResolution {
  assertScores(scores);
  const [s1, s2] = scores;
  const [c1, c2] = choices;
  assertChoice(c1, 'J1');
  assertChoice(c2, 'J2');

  const outcome = outcomeOf(s1, s2, c1, c2);
  const after = scoresAfter(outcome, s1, s2);
  return Object.freeze({
    ...outcome,
    before: pair(s1, s2),
    after,
    delta: pair(after[0] - s1, after[1] - s2),
  });
}

function outcomeOf(s1: number, s2: number, c1: Choice, c2: Choice): RoundOutcome {
  // R12 : aucun choix, la manche est annulée ; R11 : un seul choix rapporte +1 à ce joueur.
  if (c1 === null) return c2 === null ? { kind: 'void', winner: null } : { kind: 'solo', winner: 1 };
  if (c2 === null) return { kind: 'solo', winner: 0 };
  if (c1 !== c2) {
    const winner: PlayerIndex = beats(c1, c2) ? 0 : 1;
    return { kind: VICTORY_KIND[winner === 0 ? c1 : c2], winner };
  }
  switch (c1) {
    case 'fire':
      return { kind: 'flare', winner: null };
    case 'water':
      return { kind: 'siphon', winner: null };
    case 'plant':
      // R05 : seul le joueur strictement en retard avant la manche gagne.
      return s1 === s2 ? { kind: 'balance', winner: null } : { kind: 'thrive', winner: s1 < s2 ? 0 : 1 };
  }
}

function scoresAfter(outcome: RoundOutcome, s1: number, s2: number): Scores {
  switch (outcome.kind) {
    case 'flare':
      return pair(s1 + 1, s2 + 1);
    case 'siphon':
      return pair(Math.max(0, s1 - 1), Math.max(0, s2 - 1));
    case 'balance':
    case 'void':
      return pair(s1, s2);
    case 'wave':
    case 'burn':
    case 'grow':
    case 'thrive':
    case 'solo':
      return outcome.winner === 0 ? pair(s1 + 1, s2) : pair(s1, s2 + 1);
  }
}

function pair(p1: number, p2: number): Scores {
  return Object.freeze([p1, p2] as const);
}

/** Garde runtime R01 : deux entiers de 0 à `MAX_SCORE`. */
export function assertScores(scores: Scores): void {
  assertScore(scores[0], 'J1');
  assertScore(scores[1], 'J2');
}

function assertScore(value: unknown, player: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > MAX_SCORE) {
    throw new RangeError(`Score ${player} invalide : entier de 0 à ${String(MAX_SCORE)} attendu.`);
  }
}

function assertChoice(value: unknown, player: string): asserts value is Choice {
  if (value !== null && !isElement(value)) {
    throw new RangeError(`Élément ${player} invalide : fire, water, plant ou null attendu.`);
  }
}
