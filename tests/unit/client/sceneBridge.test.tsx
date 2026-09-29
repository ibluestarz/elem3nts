import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SceneView } from '../../../src/client/scene/commands.ts';
import type { Engine } from '../../../src/client/scene/engine.js';
import { useSceneBridge } from '../../../src/client/scene/useSceneBridge.ts';
import type { Quality } from '../../../src/client/state/preferences.ts';

function fakeEngine() {
  return {
    setScene: vi.fn(),
    setLock: vi.fn(),
    reveal: vi.fn(),
    clash: vi.fn(),
    reset: vi.fn(),
    celebrate: vi.fn(),
    setQuality: vi.fn(),
    setReduced: vi.fn(),
    setMobile: vi.fn(),
  };
}

const home: SceneView = {
  screen: 'home',
  phase: 'intro',
  matchId: null,
  round: 0,
  locked: [false, false],
  revealed: null,
  clash: null,
  celebrate: null,
};

interface Props {
  readonly engine: Engine | null;
  readonly quality: Quality;
  readonly reducedMotion: boolean;
  readonly compact: boolean;
}

describe('PFC-008-AC2 — préférences transmises au moteur (useSceneBridge)', () => {
  it('mouvements réduits, qualité et mode compact suivent les préférences', () => {
    const fake = fakeEngine();
    const engine = fake as unknown as Engine;
    const { rerender } = renderHook((props: Props) => {
      useSceneBridge(props.engine, home, props);
    }, { initialProps: { engine, quality: 'high', reducedMotion: true, compact: false } });

    expect(fake.setReduced).toHaveBeenLastCalledWith(true);
    expect(fake.setQuality).toHaveBeenLastCalledWith('high');
    expect(fake.setMobile).toHaveBeenLastCalledWith(false);

    rerender({ engine, quality: 'low', reducedMotion: false, compact: true });
    expect(fake.setReduced).toHaveBeenLastCalledWith(false);
    expect(fake.setQuality).toHaveBeenLastCalledWith('low');
    expect(fake.setMobile).toHaveBeenLastCalledWith(true);
  });

  it('moteur arrivé après le rendu : il reçoit l’état courant et les préférences', () => {
    const fake = fakeEngine();
    const { rerender } = renderHook((props: Props) => {
      useSceneBridge(props.engine, home, props);
    }, { initialProps: { engine: null, quality: 'high', reducedMotion: true, compact: false } });

    rerender({ engine: fake as unknown as Engine, quality: 'high', reducedMotion: true, compact: false });
    expect(fake.reset).toHaveBeenCalledOnce();
    expect(fake.setScene).toHaveBeenCalledWith('home');
    expect(fake.setReduced).toHaveBeenCalledWith(true);
  });
});
