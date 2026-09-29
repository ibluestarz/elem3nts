import { describe, expect, it } from 'vitest';
import {
  ELEMENTS,
  resolveRound,
  type Choice,
  type Choices,
  type Element,
  type RoundKind,
  type RoundResolution,
  type Scores,
} from '../../../src/domain/index.ts';

const scores = (p1: number, p2: number): Scores => Object.freeze([p1, p2] as const);
const choices = (p1: Choice, p2: Choice): Choices => Object.freeze([p1, p2] as const);

/**
 * Tous les états 0..12 × 0..12 et les 16 couples (9 confrontations + choix manquants R11/R12),
 * soit 2 704 cas.
 */
const RANGE = Array.from({ length: 13 }, (_, i) => i);
const CHOICES: readonly Choice[] = [...ELEMENTS, null];
const PAIRS = CHOICES.flatMap((a) => CHOICES.map((b) => [a, b] as const));
const ALL_CASES = RANGE.flatMap((s1) =>
  RANGE.flatMap((s2) => PAIRS.map(([c1, c2]) => ({ s: scores(s1, s2), c: choices(c1, c2) }))),
);

/**
 * Oracle indépendant recopié de la table « Mapping exhaustif » de la SPEC : deltas nominaux
 * appliqués sur les scores avant manche, puis plancher zéro.
 */
function specOracle([s1, s2]: Scores, [c1, c2]: Choices): Scores {
  const nominal: Record<`${Element | 'null'}/${Element | 'null'}`, readonly [number, number]> = {
    'null/null': [0, 0],
    'null/fire': [0, 1],
    'null/water': [0, 1],
    'null/plant': [0, 1],
    'fire/null': [1, 0],
    'water/null': [1, 0],
    'plant/null': [1, 0],
    'fire/fire': [1, 1],
    'fire/water': [0, 1],
    'fire/plant': [1, 0],
    'water/fire': [1, 0],
    'water/water': [-1, -1],
    'water/plant': [0, 1],
    'plant/fire': [0, 1],
    'plant/water': [1, 0],
    'plant/plant': [s1 < s2 ? 1 : 0, s2 < s1 ? 1 : 0],
  };
  const [d1, d2] = nominal[`${c1 ?? 'null'}/${c2 ?? 'null'}`];
  return [Math.max(0, s1 + d1), Math.max(0, s2 + d2)];
}

const swap = <T,>([a, b]: readonly [T, T]): readonly [T, T] => [b, a];

describe('PFC-002 — scénarios', () => {
  it('PFC-002-S1 — feu contre plante : 1/2 devient 2/2', () => {
    const result = resolveRound(scores(1, 2), choices('fire', 'plant'));

    expect(result.after).toEqual([2, 2]);
    expect(result).toMatchObject({ kind: 'burn', winner: 0, before: [1, 2], delta: [1, 0] });
  });

  it('PFC-002-S2 — plancher eau : 0/1 devient 0/0', () => {
    const result = resolveRound(scores(0, 1), choices('water', 'water'));

    expect(result.after).toEqual([0, 0]);
    expect(result).toMatchObject({ kind: 'siphon', winner: null, delta: [0, -1] });
  });
});

describe('PFC-002-AC1 — les 9 couples du mapping SPEC', () => {
  it.each<[Element, Element, number, number, RoundKind, 0 | 1 | null]>([
    ['fire', 'fire', 1, 1, 'flare', null],
    ['fire', 'water', 0, 1, 'wave', 1],
    ['fire', 'plant', 1, 0, 'burn', 0],
    ['water', 'fire', 1, 0, 'wave', 0],
    ['water', 'water', -1, -1, 'siphon', null],
    ['water', 'plant', 0, 1, 'grow', 1],
    ['plant', 'fire', 0, 1, 'burn', 1],
    ['plant', 'water', 1, 0, 'grow', 0],
    ['plant', 'plant', 0, 0, 'balance', null],
  ])('%s/%s depuis 5/5 : Δ %i/%i (%s)', (c1, c2, d1, d2, kind, winner) => {
    const result = resolveRound(scores(5, 5), choices(c1, c2));

    expect(result).toEqual({
      kind,
      winner,
      before: [5, 5],
      after: [5 + d1, 5 + d2],
      delta: [d1, d2],
    });
  });

  it('suit la table SPEC sur les 2 704 cas (scores 0 à 12 × 16 couples)', () => {
    for (const { s, c } of ALL_CASES) {
      expect(resolveRound(s, c).after, `${s.join('/')} ${c.join('/')}`).toEqual(specOracle(s, c));
    }
  });
});

describe('PFC-002-AC2 — plante/plante et plancher eau', () => {
  it.each<[string, Scores, Scores, RoundKind, 0 | 1 | null]>([
    ['retard J1', scores(1, 3), scores(2, 3), 'thrive', 0],
    ['retard J2', scores(3, 1), scores(3, 2), 'thrive', 1],
    ['égalité', scores(2, 2), scores(2, 2), 'balance', null],
    ['égalité à zéro', scores(0, 0), scores(0, 0), 'balance', null],
    ['retard d’un point seulement', scores(4, 5), scores(5, 5), 'thrive', 0],
  ])('plante/plante, %s : %j devient %j', (_, before, after, kind, winner) => {
    const result = resolveRound(before, choices('plant', 'plant'));

    expect(result).toMatchObject({ kind, winner, after });
  });

  it.each<[Scores, Scores, readonly [number, number]]>([
    [scores(0, 0), scores(0, 0), [0, 0]],
    [scores(0, 1), scores(0, 0), [0, -1]],
    [scores(1, 0), scores(0, 0), [-1, 0]],
    [scores(3, 3), scores(2, 2), [-1, -1]],
  ])('eau/eau : %j devient %j avec un delta effectif %j', (before, after, delta) => {
    const result = resolveRound(before, choices('water', 'water'));

    expect(result).toMatchObject({ kind: 'siphon', after, delta });
  });

  it('ne plafonne pas les scores à X (R01)', () => {
    expect(resolveRound(scores(12, 12), choices('fire', 'fire')).after).toEqual([13, 13]);
  });
});

describe('PFC-002-AC3 / PFC-024 — propriétés sur les 2 704 cas', () => {
  it('produit des entiers ≥ 0 variant au plus de 1, avec after = before + delta', () => {
    for (const { s, c } of ALL_CASES) {
      const { before, after, delta } = resolveRound(s, c);
      for (const i of [0, 1] as const) {
        expect(Number.isSafeInteger(after[i]) && after[i] >= 0).toBe(true);
        expect(Math.abs(delta[i])).toBeLessThanOrEqual(1);
        expect(after[i]).toBe(before[i] + delta[i]);
      }
    }
  });

  it('est symétrique à l’échange des joueurs', () => {
    const swapWinner = (r: RoundResolution) => (r.winner === null ? null : 1 - r.winner);
    for (const { s, c } of ALL_CASES) {
      const direct = resolveRound(s, c);
      const swapped = resolveRound(swap(s), swap(c));

      expect(swapped.kind).toBe(direct.kind);
      expect(swapped.winner).toBe(swapWinner(direct));
      expect(swapped.after).toEqual(swap(direct.after));
      expect(swapped.delta).toEqual(swap(direct.delta));
    }
  });

  it('est déterministe', () => {
    for (const { s, c } of ALL_CASES) {
      expect(resolveRound(s, c)).toEqual(resolveRound(s, c));
    }
  });

  it('ne modifie pas ses entrées et renvoie un résultat gelé', () => {
    const mutable: [number, number] = [1, 3];
    const picks: [Element, Element] = ['plant', 'plant'];
    const result = resolveRound(mutable, picks);

    expect(mutable).toEqual([1, 3]);
    expect(picks).toEqual(['plant', 'plant']);
    expect(result.before).not.toBe(mutable);
    for (const part of [result, result.before, result.after, result.delta]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
  });

  it('calcule les deux deltas depuis le même état avant manche (R06)', () => {
    // L'oracle SPEC ci-dessus couvre R06 sur tous les cas ; ces exemples l'illustrent.
    // Les deux joueurs reçoivent leur delta dans la même résolution, sans résolution intermédiaire.
    expect(resolveRound(scores(2, 2), choices('fire', 'fire'))).toMatchObject({ before: [2, 2], after: [3, 3] });
    // Plante/plante lit l'écart avant manche : 1/2 → 2/2, J2 n'est pas crédité malgré l'égalité obtenue.
    expect(resolveRound(scores(1, 2), choices('plant', 'plant'))).toMatchObject({ after: [2, 2], delta: [1, 0] });
    // Le plancher s'applique à chacun indépendamment.
    expect(resolveRound(scores(0, 5), choices('water', 'water')).after).toEqual([0, 4]);
  });
});

describe('PFC-024 — choix manquants (R11, R12)', () => {
  it.each<[Choice, Choice, 0 | 1]>([
    ['fire', null, 0],
    ['water', null, 0],
    ['plant', null, 0],
    [null, 'fire', 1],
    [null, 'water', 1],
    [null, 'plant', 1],
  ])('PFC-024-S1 — seul choix %s/%s : +1 au seul joueur ayant choisi', (c1, c2, winner) => {
    const result = resolveRound(scores(2, 2), choices(c1, c2));

    expect(result).toMatchObject({ kind: 'solo', winner });
    expect(result.delta).toEqual(winner === 0 ? [1, 0] : [0, 1]);
  });

  it('PFC-024-S2 — aucun choix : manche annulée, scores inchangés', () => {
    expect(resolveRound(scores(3, 1), choices(null, null))).toEqual({
      kind: 'void',
      winner: null,
      before: [3, 1],
      after: [3, 1],
      delta: [0, 0],
    });
  });

  it('un choix unique rapporte +1 quel que soit l’écart, sans règle plante/plante', () => {
    expect(resolveRound(scores(5, 0), choices('plant', null)).after).toEqual([6, 0]);
    expect(resolveRound(scores(0, 0), choices(null, 'water')).after).toEqual([0, 1]);
  });
});

describe('PFC-002-AC3 — entrées invalides rejetées', () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER, 2 ** 53, '3', null])(
    'rejette le score %s pour J1 comme pour J2',
    (bad) => {
      const invalid = [bad, 0] as unknown as Scores;
      expect(() => resolveRound(invalid, choices('fire', 'fire'))).toThrow(RangeError);
      expect(() => resolveRound(swap(invalid), choices('fire', 'fire'))).toThrow(RangeError);
    },
  );

  it.each(['rock', 'Fire', '', undefined, 0])('rejette l’élément %j', (bad) => {
    const invalid = [bad, 'fire'] as unknown as Choices;
    expect(() => resolveRound(scores(0, 0), invalid)).toThrow(RangeError);
    expect(() => resolveRound(scores(0, 0), swap(invalid))).toThrow(RangeError);
  });

  it('accepte le plus grand score sûr autorisé', () => {
    const top = Number.MAX_SAFE_INTEGER - 1;
    expect(resolveRound(scores(top, 0), choices('fire', 'plant')).after).toEqual([Number.MAX_SAFE_INTEGER, 0]);
  });
});
