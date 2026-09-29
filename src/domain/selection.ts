import type { Element } from './element.ts';
import type { Choices, PlayerIndex } from './round.ts';

/** Choix de la manche en cours ; `null` tant que la place n'a pas choisi. */
export type Selection = Choices;

export const EMPTY_SELECTION: Selection = Object.freeze([null, null] as const);

export interface Lock {
  readonly selection: Selection;
  /** Faux si la place avait déjà choisi : la sélection est rendue telle quelle. */
  readonly locked: boolean;
}

/**
 * Verrouille le premier choix valide d'une place (D08) : un second choix est ignoré sans effet,
 * en local comme sur le serveur.
 */
export function lockChoice(selection: Selection, player: PlayerIndex, element: Element): Lock {
  if (selection[player] !== null) return Object.freeze({ selection, locked: false });
  const next: Selection = Object.freeze(player === 0 ? ([element, selection[1]] as const) : ([selection[0], element] as const));
  return Object.freeze({ selection: next, locked: true });
}

/** Places ayant verrouillé un choix, sans révéler lequel. */
export function lockedPlayers(selection: Selection): readonly [boolean, boolean] {
  return Object.freeze([selection[0] !== null, selection[1] !== null] as const);
}
