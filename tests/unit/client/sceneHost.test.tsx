import { act, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const engines = vi.hoisted(() => ({ created: 0, destroyed: 0, fail: false, instances: [] as { onContextLost?: () => void }[] }));

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
  Object.assign(engines, { created: 0, destroyed: 0, fail: false, instances: [] });
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
