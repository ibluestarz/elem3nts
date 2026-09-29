import { TARGET_MAX, TARGET_MIN, isElement, type Choices, type PlayerIndex, type RoundKind } from '../../domain/index.ts';
import { isRevision } from './limits.ts';

/** Objet JSON simple (ni tableau, ni instance), lu uniquement par ses propres clés. */
export type JsonObject = Readonly<Record<string, unknown>>;

export function isJsonObject(value: unknown): value is JsonObject {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Vrai si `object` porte toutes les clés requises et aucune autre que les optionnelles.
 * `JSON.parse` crée `__proto__` comme clé propre : elle est donc refusée comme champ inconnu.
 */
export function hasExactKeys(
  object: JsonObject,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  if (!required.every((key) => Object.hasOwn(object, key))) return false;
  return Object.keys(object).every((key) => required.includes(key) || optional.includes(key));
}

/** Paire J1/J2 de booléens (prêts, présences, verrous). */
export function isFlagPair(value: unknown): value is readonly [boolean, boolean] {
  return Array.isArray(value) && value.length === 2 && value.every((flag) => typeof flag === 'boolean');
}

export function freezePair<T>(first: T, second: T): readonly [T, T] {
  return Object.freeze([first, second] as const);
}

/** Natures de confrontation (D25), dans l'ordre du domaine. */
export const ROUND_KINDS: readonly RoundKind[] = ['wave', 'burn', 'grow', 'thrive', 'solo', 'flare', 'siphon', 'balance', 'void'];

export function isRoundKind(value: unknown): value is RoundKind {
  return (ROUND_KINDS as readonly unknown[]).includes(value);
}

/** Place J1 (0) ou J2 (1). */
export function isSlot(value: unknown): value is PlayerIndex {
  return value === 0 || value === 1;
}

/** Réglages exacts : X entier de 1 à 10, nul booléen, aucune autre clé. */
export function isSettings(value: unknown): boolean {
  if (!isJsonObject(value) || !hasExactKeys(value, ['target', 'drawEnabled'])) return false;
  const target = value['target'];
  return (
    Number.isInteger(target) &&
    (target as number) >= TARGET_MIN &&
    (target as number) <= TARGET_MAX &&
    typeof value['drawEnabled'] === 'boolean'
  );
}

/** Paire J1/J2 d'entiers sûrs ≥ 0 (scores, trophées). */
export function isCounterPair(value: unknown): value is readonly [number, number] {
  return Array.isArray(value) && value.length === 2 && value.every((count) => isRevision(count));
}

/** Paire J1/J2 d'éléments, `null` pour une place sans choix. */
export function isChoicePair(value: unknown): value is Choices {
  return Array.isArray(value) && value.length === 2 && value.every((choice) => choice === null || isElement(choice));
}

/** Gèle récursivement une valeur JSON validée (objets et tableaux). */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
