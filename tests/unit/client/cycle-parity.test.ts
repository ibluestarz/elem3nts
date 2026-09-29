import { describe, expect, it } from 'vitest';
import type { Choices, PlayerIndex } from '../../../src/domain/index.ts';
import { gameReducer, initialGameState, type GameState } from '../../../src/client/state/game.ts';
import { MATCH_INTRO_MS, roundFollowUp, roundResultMs } from '../../../src/shared/cycle.ts';

/**
 * Traite chaque échéance à son instant exact jusqu'à ce que `until` soit vrai ; rend l'état atteint et
 * l'instant de la transition qui l'a produit.
 */
function advanceUntil(state: GameState, until: (next: GameState) => boolean): { state: GameState; at: number } {
  let current = state;
  let at = 0;
  while (!until(current)) {
    if (current.deadline === null) throw new Error(`Aucune échéance en ${current.phase}.`);
    at = current.deadline;
    current = gameReducer(current, { type: 'tick', now: at, hotseat: false });
  }
  return { state: current, at };
}

function started(target: number, drawEnabled: boolean): GameState {
  const draft = gameReducer(initialGameState(), { type: 'draft', text: String(target) });
  return gameReducer(draft, { type: 'start', drawEnabled, now: 0 });
}

describe('PFC-014 — chronologie D09 partagée entre le cycle local et la room en ligne', () => {
  it('ouverture : la sélection de la manche 1 s’ouvre à MATCH_INTRO_MS, en local comme sur le serveur', () => {
    expect(advanceUntil(started(3, true), (state) => state.phase === 'selecting').at).toBe(MATCH_INTRO_MS);
  });

  it.each<[string, number, boolean, Choices]>([
    ['burn, manche suivante', 3, true, ['fire', 'plant']],
    ['wave, manche suivante', 3, true, ['fire', 'water']],
    ['grow, manche suivante', 3, true, ['water', 'plant']],
    ['flare, manche suivante', 3, true, ['fire', 'fire']],
    ['siphon, manche suivante', 3, true, ['water', 'water']],
    ['balance, manche suivante', 3, true, ['plant', 'plant']],
    ['solo, manche suivante', 3, true, [null, 'plant']],
    ['void, manche suivante', 3, true, [null, null]],
    ['burn, fin de partie', 1, true, ['fire', 'plant']],
    ['flare, nul à X', 1, true, ['fire', 'fire']],
    ['flare, mort subite', 1, false, ['fire', 'fire']],
  ])('%s : roundResultMs égale la durée locale, de l’échéance de sélection à la phase suivante', (_label, target, draw, choices) => {
    let state = advanceUntil(started(target, draw), (next) => next.phase === 'selecting').state;
    choices.forEach((element, player) => {
      if (element !== null) state = gameReducer(state, { type: 'choose', player: player as PlayerIndex, element, now: 0 });
    });
    const revealed = advanceUntil(state, (next) => next.phase === 'reveal');
    const { play, match } = revealed.state;
    if (play === null || match === null) throw new Error('Manche non résolue.');

    // Écran de fin (`ended`) ou sélection de la manche suivante : la phase suivante côté serveur.
    const following = advanceUntil(revealed.state, (next) => next.phase === 'ended' || next.phase === 'selecting');
    expect(following.at - revealed.at).toBe(roundResultMs(play.round.kind, roundFollowUp(match)));
  });
});
