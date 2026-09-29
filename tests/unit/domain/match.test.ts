import { describe, expect, it } from 'vitest';
import {
  DomainError,
  TARGET_MAX,
  TARGET_MIN,
  cancelMatch,
  evaluateMatch,
  playRound,
  startMatch,
  type Choices,
  type Element,
  type Match,
  type MatchSettings,
  type MatchVerdict,
  type Scores,
} from '../../../src/domain/index.ts';

const on = (target: number): MatchSettings => ({ target, drawEnabled: true });
const off = (target: number): MatchSettings => ({ target, drawEnabled: false });
const pick = (p1: Element, p2: Element): Choices => [p1, p2];

const FIRE_FIRE = pick('fire', 'fire');
const J1_WINS = pick('fire', 'plant');
const J2_WINS = pick('plant', 'fire');

function play(match: Match, ...rounds: Choices[]): Match {
  return rounds.reduce((current, choices) => playRound(current, choices).match, match);
}

/**
 * Atteint des scores réels en jouant des manches, sans fixture injectant un état (TESTING) :
 * min(a, b) doubles feux, puis des victoires simples pour le joueur en tête.
 */
function reach(settings: MatchSettings, [a, b]: Scores): Match {
  const rounds: Choices[] = [
    ...Array<Choices>(Math.min(a, b)).fill(FIRE_FIRE),
    ...Array<Choices>(Math.abs(a - b)).fill(a > b ? J1_WINS : J2_WINS),
  ];
  const match = play(startMatch('match-test', settings), ...rounds);
  expect(match.scores).toEqual([a, b]);
  expect(match.result.status).toBe('playing');
  return match;
}

/** Oracle indépendant recopié de SPEC R07/R08. */
function rulesOracle([s1, s2]: Scores, { target, drawEnabled }: MatchSettings): MatchVerdict {
  if (drawEnabled) {
    if (s1 >= target && s2 >= target) return { status: 'draw' };
    if (s1 >= target) return { status: 'won', winner: 0 };
    if (s2 >= target) return { status: 'won', winner: 1 };
    return { status: 'playing' };
  }
  if (s1 >= target && s1 > s2) return { status: 'won', winner: 0 };
  if (s2 >= target && s2 > s1) return { status: 'won', winner: 1 };
  return { status: 'playing' };
}

describe('PFC-003 — scénarios', () => {
  it('PFC-003-S1 — nul simultané : X=3, nul ON, 2/2 puis feu/feu → 3/3 nul', () => {
    const { match } = playRound(reach(on(3), [2, 2]), FIRE_FIRE);

    expect(match.scores).toEqual([3, 3]);
    expect(match.result).toEqual({ status: 'draw' });
  });

  it('PFC-003-S2 — prolongation : X=3, nul OFF, 3/3 puis feu/plante → J1 gagne à 4/3', () => {
    const { match } = playRound(reach(off(3), [3, 3]), J1_WINS);

    expect(match.scores).toEqual([4, 3]);
    expect(match.result).toEqual({ status: 'won', winner: 0 });
  });
});

describe('PFC-003 — exemples chiffrés de la SPEC', () => {
  it.each<[MatchSettings, Scores, Choices, Scores, MatchVerdict]>([
    [on(3), [2, 1], pick('fire', 'plant'), [3, 1], { status: 'won', winner: 0 }],
    [on(3), [2, 2], FIRE_FIRE, [3, 3], { status: 'draw' }],
    [off(3), [2, 2], FIRE_FIRE, [3, 3], { status: 'playing' }],
    [off(3), [3, 3], pick('fire', 'plant'), [4, 3], { status: 'won', winner: 0 }],
    [off(3), [3, 3], pick('water', 'water'), [2, 2], { status: 'playing' }],
    [on(3), [0, 1], pick('water', 'water'), [0, 0], { status: 'playing' }],
    [on(5), [1, 3], pick('plant', 'plant'), [2, 3], { status: 'playing' }],
    [on(5), [3, 1], pick('plant', 'plant'), [3, 2], { status: 'playing' }],
    [on(5), [2, 2], pick('plant', 'plant'), [2, 2], { status: 'playing' }],
    [on(1), [0, 0], FIRE_FIRE, [1, 1], { status: 'draw' }],
    [off(10), [9, 9], FIRE_FIRE, [10, 10], { status: 'playing' }],
  ])('%j depuis %j, %j → %j, %j', (settings, before, choices, after, result) => {
    const { match } = playRound(reach(settings, before), choices);

    expect(match.scores).toEqual(after);
    expect(match.result).toEqual(result);
  });
});

describe('PFC-003-AC1 — X=1 et X=10, nul ON/OFF, scores au-delà de X', () => {
  it('X=1 nul ON : un seul point suffit, feu/feu depuis 0/0 est un nul immédiat', () => {
    expect(playRound(startMatch('m', on(1)), J2_WINS).match.result).toEqual({ status: 'won', winner: 1 });
    expect(playRound(startMatch('m', on(1)), FIRE_FIRE).match.result).toEqual({ status: 'draw' });
  });

  it('X=1 nul OFF : la partie continue à 1/1 puis 2/2 et se gagne à 3/2, au-delà de X', () => {
    const tied = play(startMatch('m', off(1)), FIRE_FIRE, FIRE_FIRE);
    expect(tied).toMatchObject({ scores: [2, 2], result: { status: 'playing' } });

    const { match } = playRound(tied, J1_WINS);
    expect(match).toMatchObject({ scores: [3, 2], result: { status: 'won', winner: 0 } });
  });

  it('X=10 nul ON : 9/9 puis feu/feu est un nul à 10/10 ; 9/8 puis victoire J1 à 10/8', () => {
    expect(playRound(reach(on(10), [9, 9]), FIRE_FIRE).match.result).toEqual({ status: 'draw' });
    expect(playRound(reach(on(10), [9, 8]), J1_WINS).match.result).toEqual({ status: 'won', winner: 0 });
  });

  it('X=10 nul OFF : 10/10 puis 11/11 continuent, J2 gagne à 11/12', () => {
    const tied = play(reach(off(10), [9, 9]), FIRE_FIRE, FIRE_FIRE);
    expect(tied).toMatchObject({ scores: [11, 11], result: { status: 'playing' } });

    const { match } = playRound(tied, J2_WINS);
    expect(match).toMatchObject({ scores: [11, 12], result: { status: 'won', winner: 1 } });
  });

  it('suit R07/R08 sur tous les scores 0 à 12, X de 1 à 10, nul ON et OFF (2 600 cas)', () => {
    for (let target = TARGET_MIN; target <= TARGET_MAX; target++) {
      for (const drawEnabled of [true, false]) {
        for (let s1 = 0; s1 <= 12; s1++) {
          for (let s2 = 0; s2 <= 12; s2++) {
            const settings = { target, drawEnabled };
            const verdict = evaluateMatch([s1, s2], settings);
            const label = `X=${String(target)} nul=${String(drawEnabled)} ${String(s1)}/${String(s2)}`;

            expect(verdict, label).toEqual(rulesOracle([s1, s2], settings));
            // Symétrie : échanger les joueurs échange le vainqueur.
            const swapped = evaluateMatch([s2, s1], settings);
            expect(swapped, label).toEqual(
              verdict.status === 'won' ? { status: 'won', winner: 1 - verdict.winner } : verdict,
            );
          }
        }
      }
    }
  });
});

describe('PFC-003-AC2 — prolongation sans plafond ni départage', () => {
  it('X=3 nul OFF : 3/3 → eau/eau 2/2 continue, puis feu/plante 3/2 fait gagner J1 (DECISIONS)', () => {
    const lowered = playRound(reach(off(3), [3, 3]), pick('water', 'water')).match;
    expect(lowered).toMatchObject({ scores: [2, 2], result: { status: 'playing' } });

    const { match } = playRound(lowered, J1_WINS);
    expect(match).toMatchObject({ scores: [3, 2], result: { status: 'won', winner: 0 } });
  });

  it('peut redescendre jusqu’à 0/0 après avoir dépassé X, puis repartir', () => {
    const water = pick('water', 'water');
    const floored = play(reach(off(2), [3, 3]), water, water, water, water);
    expect(floored).toMatchObject({ scores: [0, 0], result: { status: 'playing' } });

    expect(play(floored, J2_WINS, J2_WINS).result).toEqual({ status: 'won', winner: 1 });
  });

  it('ne s’arrête jamais sur une égalité en nul OFF, même après 200 doubles feux', () => {
    const match = play(startMatch('m', off(3)), ...Array<Choices>(200).fill(FIRE_FIRE));

    expect(match).toMatchObject({ scores: [200, 200], result: { status: 'playing' } });
  });

  it('plante/plante n’est jamais un départage : 3/3 reste 3/3 en nul OFF', () => {
    expect(playRound(reach(off(3), [3, 3]), pick('plant', 'plant')).match).toMatchObject({
      scores: [3, 3],
      result: { status: 'playing' },
    });
  });
});

describe('PFC-003-AC3 — fin unique et annulation', () => {
  it('refuse une manche supplémentaire après la fin (double dispatch) sans modifier la partie', () => {
    const ended = playRound(reach(on(3), [2, 2]), FIRE_FIRE).match;
    const snapshot = structuredClone(ended);

    expect(() => playRound(ended, FIRE_FIRE)).toThrow(DomainError);
    expect(() => playRound(ended, J1_WINS)).toThrow(expect.objectContaining({ code: 'MATCH_OVER' }));
    expect(ended).toEqual(snapshot);
  });

  it('annule une partie en cours sans toucher aux scores, puis refuse toute manche', () => {
    const playing = reach(on(3), [2, 1]);
    const cancelled = cancelMatch(playing);

    expect(cancelled).toMatchObject({ id: playing.id, scores: [2, 1], result: { status: 'cancelled' } });
    expect(playing.result).toEqual({ status: 'playing' });
    expect(() => playRound(cancelled, J1_WINS)).toThrow(expect.objectContaining({ code: 'MATCH_OVER' }));
  });

  it('n’annule pas une partie déjà terminée ou annulée (même objet rendu)', () => {
    const ended = playRound(reach(on(3), [2, 1]), J1_WINS).match;
    const cancelled = cancelMatch(reach(on(3), [0, 0]));

    expect(cancelMatch(ended)).toBe(ended);
    expect(cancelMatch(cancelled)).toBe(cancelled);
  });
});

describe('PFC-024 — choix manquants dans une partie', () => {
  it('un seul choix peut terminer la partie (R11) ; une manche vide ne change rien (R12)', () => {
    const atTwo = reach(on(3), [2, 2]);

    expect(playRound(atTwo, [null, null]).match).toMatchObject({ scores: [2, 2], result: { status: 'playing' } });
    expect(playRound(atTwo, [null, 'water']).match).toMatchObject({
      scores: [2, 3],
      result: { status: 'won', winner: 1 },
    });
  });
});

describe('PFC-003 — pureté, immutabilité et entrées invalides', () => {
  it('ne modifie pas la partie d’entrée et renvoie des objets gelés', () => {
    const before = reach(on(3), [1, 1]);
    const snapshot = structuredClone(before);
    const { match, round } = playRound(before, J1_WINS);

    expect(before).toEqual(snapshot);
    expect(round.after).toBe(match.scores);
    for (const part of [before, before.settings, before.scores, match, match.scores, match.result]) {
      expect(Object.isFrozen(part)).toBe(true);
    }
  });

  it('copie les réglages : une mutation externe ne change pas la partie', () => {
    const settings = { target: 3, drawEnabled: true };
    const match = startMatch('m', settings);
    settings.target = 1;

    expect(playRound(match, J1_WINS).match.result).toEqual({ status: 'playing' });
  });

  it.each([0, 11, 2.5, Number.NaN, '3', null])('refuse X=%j', (target) => {
    const settings = { target, drawEnabled: true } as unknown as MatchSettings;
    expect(() => startMatch('m', settings)).toThrow(RangeError);
    expect(() => evaluateMatch([0, 0], settings)).toThrow(RangeError);
  });

  it.each(['yes', 1, null, undefined])('refuse un réglage du nul %j', (drawEnabled) => {
    const settings = { target: 3, drawEnabled } as unknown as MatchSettings;
    expect(() => startMatch('m', settings)).toThrow(RangeError);
  });

  it.each(['', 42, null])('refuse le matchId %j', (id) => {
    expect(() => startMatch(id as unknown as string, on(3))).toThrow(RangeError);
  });

  it('refuse des scores invalides à l’évaluation', () => {
    expect(() => evaluateMatch([-1, 0], on(3))).toThrow(RangeError);
    expect(() => evaluateMatch([0, 1.5], on(3))).toThrow(RangeError);
  });

  it('accepte les bornes X=1 et X=10', () => {
    expect(startMatch('a', on(TARGET_MIN)).settings.target).toBe(1);
    expect(startMatch('b', off(TARGET_MAX)).settings.target).toBe(10);
  });
});
