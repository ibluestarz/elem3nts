import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  TARGET_MAX,
  TARGET_MIN,
  assertSettings,
  parseTargetInput,
  type TargetInputError,
} from '../../../src/domain/index.ts';

describe('PFC-004-AC1 — validation pure de la saisie de X', () => {
  it.each(['1', '10', '3', ' 7 ', '03'])('accepte %j', (raw) => {
    expect(parseTargetInput(raw)).toEqual({ ok: true, value: Number(raw.trim()) });
  });

  it('PFC-004-S1 — accepte la borne haute 10', () => {
    expect(parseTargetInput('10')).toEqual({ ok: true, value: 10 });
  });

  it('PFC-004-S2 — refuse 11 sans le ramener à 10', () => {
    expect(parseTargetInput('11')).toEqual({ ok: false, error: 'out-of-range' });
  });

  it.each<[string, TargetInputError]>([
    ['0', 'out-of-range'],
    ['11', 'out-of-range'],
    ['-1', 'out-of-range'],
    ['100', 'out-of-range'],
    ['99999999999999999999', 'out-of-range'],
    ['', 'empty'],
    ['   ', 'empty'],
    ['2.5', 'not-integer'],
    ['3,5', 'not-integer'],
    ['.5', 'not-integer'],
    ['abc', 'not-a-number'],
    ['trois', 'not-a-number'],
    ['1e1', 'not-a-number'],
    ['+3', 'not-a-number'],
    ['3a', 'not-a-number'],
    ['0x3', 'not-a-number'],
    ['Infinity', 'not-a-number'],
  ])('refuse %j (%s)', (raw, error) => {
    expect(parseTargetInput(raw)).toEqual({ ok: false, error });
  });

  it('accepte exactement les entiers de 1 à 10 parmi -5..20', () => {
    for (let n = -5; n <= 20; n++) {
      expect(parseTargetInput(String(n)).ok, String(n)).toBe(n >= TARGET_MIN && n <= TARGET_MAX);
    }
  });
});

describe('PFC-004 — réglages par défaut (D07)', () => {
  it('X = 3 et nul ON, valides et gelés', () => {
    expect(DEFAULT_SETTINGS).toEqual({ target: 3, drawEnabled: true });
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
    expect(() => {
      assertSettings(DEFAULT_SETTINGS);
    }).not.toThrow();
  });
});
