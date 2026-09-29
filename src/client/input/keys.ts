import { ELEMENTS, type Element, type PlayerIndex } from '../../domain/index.ts';

/** Touches d'un joueur, en codes physiques (`KeyboardEvent.code`) : indépendantes de la disposition (D10). */
export type PlayerKeys = Readonly<Record<Element, string>>;
export type KeyBindings = readonly [p1: PlayerKeys, p2: PlayerKeys];

/** D10 : J1 A/S/D, J2 J/K/L (positions physiques ; Q/S/D affichés sur un clavier AZERTY). */
export const DEFAULT_BINDINGS: KeyBindings = Object.freeze([
  Object.freeze({ fire: 'KeyA', water: 'KeyS', plant: 'KeyD' }),
  Object.freeze({ fire: 'KeyJ', water: 'KeyK', plant: 'KeyL' }),
]);

export const PLAYER_NAMES = ['Joueur 1', 'Joueur 2'] as const;
export const ELEMENT_NAMES: Readonly<Record<Element, string>> = { fire: 'Feu', water: 'Eau', plant: 'Plante' };

/** Touches réservées : actions du menu (Espace, Entrée) et navigation au clavier (Tab, Échap). */
const RESERVED: Readonly<Record<string, string>> = {
  Space: 'au menu',
  Enter: 'au menu',
  NumpadEnter: 'au menu',
  Tab: 'à la navigation au clavier',
  Escape: 'à l’annulation',
};

export function reservedReason(code: string): string | null {
  return RESERVED[code] ?? null;
}

/** Libellés lisibles des touches non imprimables (repris de la maquette). */
const NAMED: Readonly<Record<string, string>> = {
  Space: 'Espace',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Enter: 'Entrée',
  NumpadEnter: 'Entrée',
  ShiftLeft: 'Maj',
  ShiftRight: 'Maj',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt Gr',
  Tab: 'Tab',
  Backspace: 'Retour',
  Escape: 'Échap',
};

/**
 * Repli sans Keyboard Layout API : disposition AZERTY, celle de l'interface française (D19).
 * Seules les touches qui diffèrent du QWERTY sont listées.
 */
const AZERTY: Readonly<Record<string, string>> = {
  KeyA: 'Q',
  KeyQ: 'A',
  KeyW: 'Z',
  KeyZ: 'W',
  KeyM: ',',
  Semicolon: 'M',
  Digit1: '&',
  Digit2: 'É',
  Digit3: '"',
  Digit4: '\'',
  Digit5: '(',
  Digit6: '-',
  Digit7: 'È',
  Digit8: '_',
  Digit9: 'Ç',
  Digit0: 'À',
};

export type LayoutLabels = ReadonlyMap<string, string>;

/** Disposition supposée quand le navigateur ne fournit pas la Keyboard Layout API (SPEC saisie). */
export type DisplayLayout = 'azerty' | 'qwerty';
export const DISPLAY_LAYOUTS: readonly DisplayLayout[] = ['azerty', 'qwerty'];

/**
 * Libellé affiché pour un code physique : disposition réelle (API), sinon libellé appris d'une
 * frappe réelle, sinon repli selon la disposition choisie (AZERTY par défaut).
 */
export function keyLabel(
  code: string,
  layout: LayoutLabels | null,
  learned: Readonly<Record<string, string>>,
  fallback: DisplayLayout = 'azerty',
): string {
  const named = NAMED[code];
  if (named !== undefined) return named;
  const fromLayout = layout?.get(code);
  if (fromLayout !== undefined && fromLayout.trim() !== '') return fromLayout.toUpperCase();
  const fromLearned = learned[code];
  if (fromLearned !== undefined) return fromLearned;
  const azerty = fallback === 'azerty' ? AZERTY[code] : undefined;
  if (azerty !== undefined) return azerty;
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter?.[1] !== undefined) return letter[1];
  const digit = /^(?:Digit|Numpad)(\d)$/.exec(code);
  if (digit?.[1] !== undefined) return digit[1];
  return code;
}

/** Libellé appris depuis l'événement clavier réel (`event.key`), s'il est imprimable. */
export function learnedLabel(event: Pick<KeyboardEvent, 'key'>): string | null {
  return event.key.length === 1 && event.key.trim() !== '' ? event.key.toUpperCase() : null;
}

export interface KeySlot {
  readonly player: PlayerIndex;
  readonly element: Element;
}

/** Action de jeu associée à un code physique, ou `null` si la touche n'est pas liée. */
export function resolveBinding(bindings: KeyBindings, code: string): KeySlot | null {
  for (const player of [0, 1] as const) {
    for (const element of ELEMENTS) {
      if (bindings[player][element] === code) return { player, element };
    }
  }
  return null;
}

export type AssignResult =
  | { readonly ok: true; readonly bindings: KeyBindings }
  | { readonly ok: false; readonly reason: 'reserved'; readonly detail: string }
  | { readonly ok: false; readonly reason: 'conflict'; readonly with: KeySlot };

/** Réaffecte une action à un code, sans doublon ni touche réservée. */
export function assignKey(bindings: KeyBindings, slot: KeySlot, code: string): AssignResult {
  const reserved = reservedReason(code);
  if (reserved !== null) return { ok: false, reason: 'reserved', detail: reserved };
  for (const player of [0, 1] as const) {
    for (const element of ELEMENTS) {
      const isSelf = player === slot.player && element === slot.element;
      if (!isSelf && bindings[player][element] === code) {
        return { ok: false, reason: 'conflict', with: { player, element } };
      }
    }
  }
  const next = bindings.map((keys, player) =>
    Object.freeze(player === slot.player ? { ...keys, [slot.element]: code } : keys),
  ) as unknown as KeyBindings;
  return { ok: true, bindings: Object.freeze(next) };
}

/** Valide des liaisons relues du stockage ; `null` si incomplètes, en double ou réservées. */
export function parseBindings(value: unknown): KeyBindings | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const seen = new Set<string>();
  const players: PlayerKeys[] = [];
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return null;
    const record = raw as Record<string, unknown>;
    const keys: Partial<Record<Element, string>> = {};
    for (const element of ELEMENTS) {
      const code = record[element];
      if (typeof code !== 'string' || code === '' || reservedReason(code) !== null || seen.has(code)) return null;
      seen.add(code);
      keys[element] = code;
    }
    players.push(Object.freeze(keys as Record<Element, string>));
  }
  const [p1, p2] = players;
  return p1 && p2 ? Object.freeze([p1, p2] as const) : null;
}
