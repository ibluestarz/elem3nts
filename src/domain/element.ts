/** Les trois éléments, dans l'ordre d'affichage. Noms alignés sur le protocole (`"element": "fire"`). */
export const ELEMENTS = ['fire', 'water', 'plant'] as const;

export type Element = (typeof ELEMENTS)[number];

/** Chaque élément bat exactement celui-ci : l'eau éteint le feu, le feu brûle la plante, la plante absorbe l'eau. */
const BEATS: Readonly<Record<Element, Element>> = Object.freeze({
  water: 'fire',
  fire: 'plant',
  plant: 'water',
});

export function isElement(value: unknown): value is Element {
  return typeof value === 'string' && (ELEMENTS as readonly string[]).includes(value);
}

/** Vrai si `attacker` bat `defender` ; faux pour deux éléments identiques. */
export function beats(attacker: Element, defender: Element): boolean {
  return BEATS[attacker] === defender;
}
