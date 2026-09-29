import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_BINDINGS } from '../../../src/client/input/keys.ts';
import { STORAGE_KEY, defaultPreferences, parsePreferences, updatePreferences } from '../../../src/client/state/preferences.ts';

describe('PFC-004 — préférences mémorisées', () => {
  it('revient aux défauts si rien n’est stocké ou si le JSON est corrompu', () => {
    for (const raw of [null, '', '{', 'null', '42', '"texte"']) {
      expect(parsePreferences(raw)).toEqual(defaultPreferences());
    }
  });

  it('valide chaque champ indépendamment', () => {
    const parsed = parsePreferences(
      JSON.stringify({
        bindings: [{ fire: 'Space' }],
        learnedLabels: { KeyF: 'F', KeyG: 42, KeyH: 'TROPLONG' },
        displayLayout: 'dvorak',
        drawEnabled: false,
        quality: 'ultra',
        reducedMotion: 'oui',
      }),
    );

    expect(parsed).toEqual({
      bindings: DEFAULT_BINDINGS,
      learnedLabels: { KeyF: 'F' },
      displayLayout: 'azerty',
      drawEnabled: false,
      quality: 'high',
      reducedMotion: false,
    });
  });

  it('PFC-005 — relit la disposition affichée QWERTY', () => {
    expect(parsePreferences(JSON.stringify({ displayLayout: 'qwerty' })).displayLayout).toBe('qwerty');
  });

  it('persiste chaque modification dans localStorage', () => {
    updatePreferences({ ...defaultPreferences(), quality: 'low', drawEnabled: false });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({ quality: 'low', drawEnabled: false });
    expect(parsePreferences(localStorage.getItem(STORAGE_KEY))).toMatchObject({ quality: 'low', drawEnabled: false });
  });

  it('reste utilisable si le stockage refuse l’écriture', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(() => {
      updatePreferences({ quality: 'medium' });
    }).not.toThrow();
    expect(setItem).toHaveBeenCalled();
  });
});
