import { describe, expect, it } from 'vitest';
import { ELEMENTS, EMPTY_SELECTION, lockChoice, lockedPlayers } from '../../../src/domain/index.ts';

describe('PFC-005 — verrouillage du premier choix (D08)', () => {
  it('PFC-005-S1 — J1 feu puis J2 plante : deux choix verrouillés', () => {
    const first = lockChoice(EMPTY_SELECTION, 0, 'fire');
    const second = lockChoice(first.selection, 1, 'plant');

    expect(first.locked).toBe(true);
    expect(second).toEqual({ selection: ['fire', 'plant'], locked: true });
    expect(lockedPlayers(second.selection)).toEqual([true, true]);
  });

  it('PFC-005-S2 — un second choix de la même place ne remplace pas le premier', () => {
    const fire = lockChoice(EMPTY_SELECTION, 0, 'fire').selection;
    for (const element of ELEMENTS) {
      const again = lockChoice(fire, 0, element);
      expect(again.locked).toBe(false);
      expect(again.selection).toBe(fire);
    }
  });

  it('est symétrique et n’affecte jamais l’autre place', () => {
    for (const element of ELEMENTS) {
      expect(lockChoice(EMPTY_SELECTION, 0, element).selection).toEqual([element, null]);
      expect(lockChoice(EMPTY_SELECTION, 1, element).selection).toEqual([null, element]);
    }
  });

  it('ne modifie pas la sélection d’entrée et renvoie des objets gelés', () => {
    const { selection } = lockChoice(EMPTY_SELECTION, 1, 'water');

    expect(EMPTY_SELECTION).toEqual([null, null]);
    expect(Object.isFrozen(selection)).toBe(true);
    expect(lockedPlayers(EMPTY_SELECTION)).toEqual([false, false]);
    expect(lockedPlayers(selection)).toEqual([false, true]);
  });
});
