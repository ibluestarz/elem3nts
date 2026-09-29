import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SLOW_FRAME_MS, watchFrameRate } from '../../../src/client/scene/useSceneHost.ts';

let queue: FrameRequestCallback[] = [];
const frame = (time: number) => {
  const pending = queue;
  queue = [];
  for (const callback of pending) callback(time);
};
const run = (count: number, step: number, start = 0) => {
  for (let index = 0; index < count; index++) frame(start + index * step);
};

beforeEach(() => {
  queue = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => queue.push(callback));
  vi.stubGlobal('cancelAnimationFrame', () => {
    queue = [];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PFC-008-AC2 — garde de performance de la scène (D33)', () => {
  it('cadence normale (60 i/s) : aucune bascule, surveillance terminée', () => {
    const onSlow = vi.fn();
    watchFrameRate(onSlow);
    run(40, 16);
    expect(onSlow).not.toHaveBeenCalled();
    expect(queue).toHaveLength(0);
  });

  it('rendu logiciel (0,5 s par image) : bascule une seule fois après chauffe et échantillon', () => {
    const onSlow = vi.fn();
    watchFrameRate(onSlow);
    run(25, 500);
    expect(onSlow).not.toHaveBeenCalled();
    run(1, 500, 25 * 500);
    expect(onSlow).toHaveBeenCalledTimes(1);
    run(10, 500, 26 * 500);
    expect(onSlow).toHaveBeenCalledTimes(1);
  });

  it('juste au seuil : pas de bascule', () => {
    const onSlow = vi.fn();
    watchFrameRate(onSlow);
    run(30, SLOW_FRAME_MS);
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('les longues pauses d’un onglet masqué ne comptent pas', () => {
    const onSlow = vi.fn();
    watchFrameRate(onSlow);
    let time = 0;
    for (let index = 0; index < 40; index++) {
      const hidden = index % 2 === 1;
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);
      time += hidden ? 10_000 : 16;
      frame(time);
    }
    expect(onSlow).not.toHaveBeenCalled();
  });

  it('l’arrêt annule la surveillance en cours', () => {
    const onSlow = vi.fn();
    const stop = watchFrameRate(onSlow);
    stop();
    expect(queue).toHaveLength(0);
  });
});
