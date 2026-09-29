import { useSyncExternalStore } from 'react';
import { DEFAULT_BINDINGS, DISPLAY_LAYOUTS, parseBindings, type DisplayLayout, type KeyBindings } from '../input/keys.ts';

export type Quality = 'low' | 'medium' | 'high';
export const QUALITIES: readonly Quality[] = ['low', 'medium', 'high'];

/**
 * Préférences de l'appareil (tiroir Réglages), conservées entre les visites comme dans la maquette.
 * Le score cible X n'en fait pas partie : il revient à D07 à chaque chargement.
 */
export interface Preferences {
  readonly bindings: KeyBindings;
  /** Libellés appris des frappes réelles : réaffectation ou touche de jeu (code physique → caractère). */
  readonly learnedLabels: Readonly<Record<string, string>>;
  /** Disposition supposée sans Keyboard Layout API (SPEC saisie) ; AZERTY par défaut. */
  readonly displayLayout: DisplayLayout;
  /** Nul ON/OFF pour la prochaine partie (R07/R08). */
  readonly drawEnabled: boolean;
  /** Qualité de la scène 3D, appliquée par PFC-008. */
  readonly quality: Quality;
  readonly reducedMotion: boolean;
}

export const STORAGE_KEY = 'elem3nts.prefs.v1';

function systemPrefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function defaultPreferences(): Preferences {
  return Object.freeze({
    bindings: DEFAULT_BINDINGS,
    learnedLabels: Object.freeze({}),
    displayLayout: 'azerty',
    drawEnabled: true,
    quality: 'high',
    reducedMotion: systemPrefersReducedMotion(),
  });
}

/** Relit des préférences stockées ; toute valeur invalide revient à son défaut, champ par champ. */
export function parsePreferences(raw: string | null): Preferences {
  const defaults = defaultPreferences();
  if (raw === null) return defaults;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return defaults;
  }
  if (typeof data !== 'object' || data === null) return defaults;
  const record = data as Record<string, unknown>;
  const labels = record['learnedLabels'];
  const learnedLabels: Record<string, string> = {};
  if (typeof labels === 'object' && labels !== null) {
    for (const [code, label] of Object.entries(labels as Record<string, unknown>)) {
      if (typeof label === 'string' && label.length > 0 && label.length <= 4) learnedLabels[code] = label;
    }
  }
  const quality = record['quality'];
  const displayLayout = record['displayLayout'];
  return Object.freeze({
    bindings: parseBindings(record['bindings']) ?? defaults.bindings,
    learnedLabels: Object.freeze(learnedLabels),
    displayLayout: DISPLAY_LAYOUTS.includes(displayLayout as DisplayLayout)
      ? (displayLayout as DisplayLayout)
      : defaults.displayLayout,
    drawEnabled: typeof record['drawEnabled'] === 'boolean' ? record['drawEnabled'] : defaults.drawEnabled,
    quality: QUALITIES.includes(quality as Quality) ? (quality as Quality) : defaults.quality,
    reducedMotion: typeof record['reducedMotion'] === 'boolean' ? record['reducedMotion'] : defaults.reducedMotion,
  });
}

function read(): Preferences {
  try {
    return parsePreferences(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultPreferences();
  }
}

function write(preferences: Preferences): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Stockage indisponible (navigation privée, quota) : les préférences restent valables pour la visite.
  }
}

let current: Preferences | null = null;
const listeners = new Set<() => void>();

function snapshot(): Preferences {
  current ??= read();
  return current;
}

export function updatePreferences(patch: Partial<Preferences>): void {
  current = Object.freeze({ ...snapshot(), ...patch });
  write(current);
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, snapshot);
}
