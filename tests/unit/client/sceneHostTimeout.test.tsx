import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Module 3D qui n'arrive jamais (réseau bloqué) : le délai doit libérer l'écran d'ouverture.
vi.mock('../../../src/client/scene/engine.js', async () => {
  await new Promise(() => undefined);
  return {};
});

const { SCENE_LOAD_TIMEOUT_MS, useSceneHost } = await import('../../../src/client/scene/useSceneHost.ts');

/** Présence du constructeur global suffit à `webgl2Available` ; le contexte est simulé par `getContext`. */
class WebGL2Stub {
  readonly simulated = true;
}

function Host() {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const { status } = useSceneHost(canvas);
  return <canvas ref={setCanvas} data-testid="scene" data-scene={status} />;
}

const status = () => screen.getByTestId('scene').dataset['scene'];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('PFC-008-AC2 — module 3D trop lent', () => {
  it('bascule en repli après 8 s au lieu de bloquer', () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebGL2RenderingContext', WebGL2Stub);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ getExtension: () => null } as never);
    render(<Host />);
    expect(status()).toBe('loading');
    act(() => {
      vi.advanceTimersByTime(SCENE_LOAD_TIMEOUT_MS - 1);
    });
    expect(status()).toBe('loading');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(status()).toBe('fallback');
  });
});
