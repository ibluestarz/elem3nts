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

describe('PFC-021 — mouvements réduits : préférence système suivie tant qu’aucun choix n’existe', () => {
  /** Module neuf par cas : l'état des préférences et la requête média sont propres au module. */
  async function freshModule(systemReduce: boolean) {
    vi.resetModules();
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const query = {
      matches: systemReduce,
      addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    };
    vi.stubGlobal('matchMedia', () => query);
    const module = await import('../../../src/client/state/preferences.ts');
    const change = (matches: boolean) => {
      query.matches = matches;
      for (const listener of [...listeners]) listener({ matches } as MediaQueryListEvent);
    };
    return { module, change, listeners };
  }

  it('enregistrer un autre réglage ne fige pas la valeur système', async () => {
    localStorage.clear();
    const { module } = await freshModule(true);
    expect(module.readPreferences().reducedMotion).toBe(true);

    module.updatePreferences({ quality: 'low' });
    expect(JSON.parse(localStorage.getItem(module.STORAGE_KEY) ?? '{}')).toMatchObject({ quality: 'low', reducedMotion: null });
    vi.unstubAllGlobals();
  });

  it('suit un changement système pendant la visite, puis plus après un choix explicite', async () => {
    localStorage.clear();
    const { module, change, listeners } = await freshModule(false);
    const seen: boolean[] = [];
    const { renderHook } = await import('@testing-library/react');
    const view = renderHook(() => module.usePreferences());
    seen.push(view.result.current.reducedMotion);

    const { act } = await import('@testing-library/react');
    act(() => {
      change(true);
    });
    seen.push(view.result.current.reducedMotion);
    act(() => {
      module.updatePreferences({ reducedMotion: false });
    });
    act(() => {
      change(true);
    });
    seen.push(view.result.current.reducedMotion);
    expect(seen).toEqual([false, true, false]);
    expect(JSON.parse(localStorage.getItem(module.STORAGE_KEY) ?? '{}')).toMatchObject({ reducedMotion: false });

    view.unmount();
    expect(listeners.size).toBe(0);
    vi.unstubAllGlobals();
  });

  it('un choix enregistré (y compris avant PFC-021) reste prioritaire sur le système', async () => {
    localStorage.setItem('elem3nts.prefs.v1', JSON.stringify({ reducedMotion: false }));
    const { module } = await freshModule(true);
    expect(module.readPreferences().reducedMotion).toBe(false);
    localStorage.clear();
    vi.unstubAllGlobals();
  });
});
