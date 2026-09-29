import { describe, expect, it } from 'vitest';
import { CLASH_TIMING, CYCLE_MS, clashDelays } from '../../../src/client/state/game.ts';
import * as e2e from '../../e2e/timing.ts';

describe('PFC-008 — chronologie des tests E2E alignée sur le jeu', () => {
  it('reprend exactement CYCLE_MS, CLASH_TIMING et clashDelays', () => {
    expect(e2e.CYCLE).toEqual(CYCLE_MS);
    expect(e2e.CLASH_TIMING).toEqual(CLASH_TIMING);
    for (const kind of Object.keys(CLASH_TIMING) as (keyof typeof CLASH_TIMING)[]) {
      expect(e2e.clashDelays(kind)).toEqual(clashDelays(kind));
    }
  });
});
