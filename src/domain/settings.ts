/** Bornes de l'objectif X (D07). */
export const TARGET_MIN = 1;
export const TARGET_MAX = 10;

/** Réglages d'une partie, partagés par le mode local et le serveur (contrat PFC-004). */
export interface MatchSettings {
  /** Objectif X : entier de 1 à 10. */
  readonly target: number;
  /** Nul ON (R07) ou OFF (R08, « mort subite »). */
  readonly drawEnabled: boolean;
}

/** Réglages initiaux (D07) : X = 3, nul ON. */
export const DEFAULT_SETTINGS: MatchSettings = Object.freeze({ target: 3, drawEnabled: true });

/** Raison d'un refus de saisie de X ; le texte affiché est choisi par l'interface. */
export type TargetInputError = 'empty' | 'not-integer' | 'not-a-number' | 'out-of-range';

export type TargetInput =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: TargetInputError };

/**
 * Valide une saisie libre de X sans jamais l'arrondir ni la borner en silence :
 * seuls des chiffres (espaces de bord tolérés) formant un entier de 1 à 10 sont acceptés.
 */
export function parseTargetInput(raw: string): TargetInput {
  const text = raw.trim();
  if (text === '') return { ok: false, error: 'empty' };
  if (/^-?\d+$/.test(text)) {
    const value = Number(text);
    return value >= TARGET_MIN && value <= TARGET_MAX ? { ok: true, value } : { ok: false, error: 'out-of-range' };
  }
  if (/^-?\d*[.,]\d+$/.test(text)) return { ok: false, error: 'not-integer' };
  return { ok: false, error: 'not-a-number' };
}

/** Garde runtime des réglages (X entier de 1 à 10, nul booléen). */
export function assertSettings(settings: MatchSettings): void {
  const target: unknown = settings.target;
  const drawEnabled: unknown = settings.drawEnabled;
  if (typeof target !== 'number' || !Number.isInteger(target) || target < TARGET_MIN || target > TARGET_MAX) {
    throw new RangeError(`Objectif X invalide : entier de ${String(TARGET_MIN)} à ${String(TARGET_MAX)} attendu.`);
  }
  if (typeof drawEnabled !== 'boolean') {
    throw new RangeError('Réglage du nul invalide : booléen attendu.');
  }
}
