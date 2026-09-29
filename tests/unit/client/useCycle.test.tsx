import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCycle } from '../../../src/client/state/useCycle.ts';

afterEach(() => {
  vi.useRealTimers();
});

describe('PFC-006-AC3 — horloge du cycle', () => {
  it('une minuterie déclenchée avant l’échéance se réarme au lieu de perdre le tick', () => {
    vi.useFakeTimers();
    let clock = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => clock);
    const dispatch = vi.fn();

    renderHook(() => {
      useCycle(1500, true, dispatch);
    });
    // La minuterie de 500 ms se déclenche, mais l'horloge mesurée n'a avancé que de 499,6 ms.
    clock = 1499.6;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(dispatch).not.toHaveBeenCalled();

    clock = 1500;
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(dispatch).toHaveBeenCalledWith({ type: 'tick', now: 1500, canSelect: true });
  });

  it('ne planifie rien sans échéance, et retire minuterie et écouteur au démontage', () => {
    vi.useFakeTimers();
    const dispatch = vi.fn();
    const removed = vi.spyOn(document, 'removeEventListener');

    const idle = renderHook(() => {
      useCycle(null, true, dispatch);
    });
    expect(vi.getTimerCount()).toBe(0);
    idle.unmount();

    const { unmount } = renderHook(() => {
      useCycle(performance.now() + 5000, true, dispatch);
    });
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(removed).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(dispatch).not.toHaveBeenCalled();
  });
});
