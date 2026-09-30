import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engines = vi.hoisted(() => ({
  created: 0,
  destroyed: 0,
  fail: false,
  instances: [] as { onContextLost?: () => void }[],
  /** Journal des appels (qualité, compilation) ; `hold` retient la compilation jusqu'à `release`. */
  calls: [] as string[],
  hold: false,
  release: (): void => undefined,
}));

vi.mock('../../../src/client/scene/engine.js', () => ({
  Engine: class {
    onContextLost?: () => void;
    onTrinity?: () => void;
    constructor() {
      if (engines.fail) throw new Error('shader');
      engines.created += 1;
      engines.instances.push(this);
    }
    getTrinity() {
      return [];
    }
    setQuality(quality: string) {
      engines.calls.push(`quality:${quality}`);
    }
    warm(budgetMs: number) {
      engines.calls.push(`warm:${String(budgetMs > 0 && budgetMs <= 8000)}`);
      if (!engines.hold) return Promise.resolve();
      return new Promise<void>((resolve) => {
        engines.release = resolve;
      });
    }
    destroy() {
      engines.destroyed += 1;
    }
  },
}));

const { useSceneHost } = await import('../../../src/client/scene/useSceneHost.ts');

/** Présence du constructeur global suffit à `webgl2Available` ; le contexte est simulé par `getContext`. */
class WebGL2Stub {
  readonly simulated = true;
}

function Host() {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const { status, reason } = useSceneHost(canvas);
  return <canvas ref={setCanvas} data-testid="scene" data-scene={status} data-reason={reason ?? ''} />;
}

const status = () => screen.getByTestId('scene').dataset['scene'];

/** Attend l'arrivée du module 3D (import dynamique) et la fin de l'initialisation. */
const settle = () =>
  waitFor(() => {
    expect(status()).not.toBe('loading');
  });

beforeEach(() => {
  Object.assign(engines, { created: 0, destroyed: 0, fail: false, instances: [], calls: [], hold: false, release: () => undefined });
  localStorage.clear();
  vi.stubGlobal('WebGL2RenderingContext', WebGL2Stub);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ getExtension: () => null } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PFC-008-AC3 — hôte de scène', () => {
  it('StrictMode : un seul moteur créé, détruit au démontage', async () => {
    const { unmount } = render(
      <StrictMode>
        <Host />
      </StrictMode>,
    );
    await settle();
    expect(status()).toBe('ready');
    expect(engines.created).toBe(1);
    unmount();
    expect(engines.destroyed).toBe(1);
  });

  it('PFC-008-AC2 — perte de contexte : repli, le moteur reste détruit au démontage', async () => {
    const { unmount } = render(<Host />);
    await settle();
    act(() => {
      engines.instances[0]?.onContextLost?.();
    });
    expect(status()).toBe('fallback');
    unmount();
    expect(engines.destroyed).toBe(1);
  });

  it('PFC-008-AC2 — rendu trop lent (sans GPU) : moteur détruit, repli « slow »', async () => {
    let frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    render(<Host />);
    await settle();
    expect(status()).toBe('ready');
    act(() => {
      for (let index = 0; index < 30; index++) {
        const pending = frames;
        frames = [];
        for (const callback of pending) callback(index * 600);
      }
    });
    expect(status()).toBe('fallback');
    expect(screen.getByTestId('scene').dataset['reason']).toBe('slow');
    expect(engines.destroyed).toBe(1);
  });

  it('constructeur en échec (shader, mémoire) : repli sans moteur', async () => {
    engines.fail = true;
    render(<Host />);
    await settle();
    expect(status()).toBe('fallback');
    expect(engines.created).toBe(0);
  });

  it('PFC-008-S2 — sans WebGL2 : repli immédiat, module 3D jamais chargé', () => {
    vi.unstubAllGlobals();
    render(<Host />);
    expect(status()).toBe('fallback');
    expect(engines.created).toBe(0);
  });
});

describe('PFC-027 — compilation des programmes pendant l’écran d’ouverture', () => {
  /** Le module 3D est arrivé et le moteur construit : la compilation est en cours. */
  const compiling = () =>
    waitFor(() => {
      expect(engines.calls).toContain('warm:true');
    });

  it('reste « en chargement » tant que la compilation n’est pas terminée, puis prêt', async () => {
    engines.hold = true;
    render(<Host />);
    await compiling();
    expect(status()).toBe('loading');
    await act(async () => {
      engines.release();
      await Promise.resolve();
    });
    await settle();
    expect(status()).toBe('ready');
  });

  it('compile dans la qualité enregistrée, appliquée avant la compilation, budget dans les 8 s', async () => {
    localStorage.setItem('elem3nts.prefs.v1', JSON.stringify({ quality: 'low' }));
    vi.resetModules();
    const fresh = await import('../../../src/client/scene/useSceneHost.ts');
    function FreshHost() {
      const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
      const { status: current } = fresh.useSceneHost(canvas);
      return <canvas ref={setCanvas} data-testid="scene" data-scene={current} />;
    }
    render(<FreshHost />);
    await settle();
    expect(engines.calls).toEqual(['quality:low', 'warm:true']);
  });

  it('démontage pendant la compilation : moteur détruit, jamais prêt', async () => {
    engines.hold = true;
    const { unmount } = render(<Host />);
    await compiling();
    unmount();
    expect(engines.destroyed).toBe(1);
    await act(async () => {
      engines.release();
      await Promise.resolve();
    });
    expect(engines.destroyed).toBe(1);
  });

  it('contexte perdu pendant la compilation : repli « lost », jamais prêt ensuite', async () => {
    engines.hold = true;
    const { unmount } = render(<Host />);
    await compiling();
    act(() => {
      engines.instances[0]?.onContextLost?.();
    });
    await act(async () => {
      engines.release();
      await Promise.resolve();
    });
    expect(status()).toBe('fallback');
    expect(screen.getByTestId('scene').dataset['reason']).toBe('lost');
    unmount();
    expect(engines.destroyed).toBe(1);
  });
});
