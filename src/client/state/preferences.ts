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
  /**
   * Mouvements réduits effectifs : le choix explicite de l'utilisateur s'il existe, sinon la préférence
   * système, suivie en direct (D29, PFC-021). Seul un choix explicite est mémorisé.
   */
  readonly reducedMotion: boolean;
}

export const STORAGE_KEY = 'elem3nts.prefs.v1';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/** Une seule liste de requête : l'écouteur `change` doit être retiré de l'objet même où il a été posé. */
let motionQuery: MediaQueryList | null | undefined;

function reducedMotionQuery(): MediaQueryList | null {
  if (motionQuery !== undefined) return motionQuery;
  try {
    motionQuery = window.matchMedia(REDUCED_MOTION_QUERY);
  } catch {
    motionQuery = null;
  }
  return motionQuery;
}

function systemPrefersReducedMotion(): boolean {
  return reducedMotionQuery()?.matches ?? false;
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
  return parseStored(raw).preferences;
}

/**
 * `reducedMotion` booléen = choix explicite (y compris les enregistrements antérieurs à PFC-021, qui le
 * mémorisaient toujours : leur comportement est conservé) ; absent ou `null` = préférence système.
 */
function parseStored(raw: string | null): { readonly preferences: Preferences; readonly explicitReducedMotion: boolean } {
  const defaults = defaultPreferences();
  const fallback = { preferences: defaults, explicitReducedMotion: false };
  if (raw === null) return fallback;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof data !== 'object' || data === null) return fallback;
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
  const reducedMotion = record['reducedMotion'];
  const explicitReducedMotion = typeof reducedMotion === 'boolean';
  const preferences: Preferences = Object.freeze({
    bindings: parseBindings(record['bindings']) ?? defaults.bindings,
    learnedLabels: Object.freeze(learnedLabels),
    displayLayout: DISPLAY_LAYOUTS.includes(displayLayout as DisplayLayout)
      ? (displayLayout as DisplayLayout)
      : defaults.displayLayout,
    drawEnabled: typeof record['drawEnabled'] === 'boolean' ? record['drawEnabled'] : defaults.drawEnabled,
    quality: QUALITIES.includes(quality as Quality) ? (quality as Quality) : defaults.quality,
    reducedMotion: explicitReducedMotion ? reducedMotion : defaults.reducedMotion,
  });
  return { preferences, explicitReducedMotion };
}

/** Vrai dès que l'utilisateur a choisi « Mouvements réduits » ; sinon la préférence système fait foi. */
let explicitReducedMotion = false;

function read(): Preferences {
  try {
    const stored = parseStored(window.localStorage.getItem(STORAGE_KEY));
    explicitReducedMotion = stored.explicitReducedMotion;
    return stored.preferences;
  } catch {
    return defaultPreferences();
  }
}

function write(preferences: Preferences): void {
  try {
    const stored = { ...preferences, reducedMotion: explicitReducedMotion ? preferences.reducedMotion : null };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
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

function notify(): void {
  for (const listener of listeners) listener();
}

/** Préférences effectives au premier rendu (attribut `data-reduced-motion` posé avant l'écran d'ouverture). */
export function readPreferences(): Preferences {
  return snapshot();
}

export function updatePreferences(patch: Partial<Preferences>): void {
  const base = snapshot();
  // Seul un changement réel est un choix : réenregistrer les autres réglages ne fige pas la valeur système.
  if (patch.reducedMotion !== undefined && patch.reducedMotion !== base.reducedMotion) explicitReducedMotion = true;
  current = Object.freeze({ ...base, ...patch });
  write(current);
  notify();
}

/** Tant qu'aucun choix explicite n'existe, la préférence système est suivie pendant la visite. */
function onSystemReducedMotion(event: MediaQueryListEvent): void {
  if (explicitReducedMotion || snapshot().reducedMotion === event.matches) return;
  current = Object.freeze({ ...snapshot(), reducedMotion: event.matches });
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) reducedMotionQuery()?.addEventListener('change', onSystemReducedMotion);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) reducedMotionQuery()?.removeEventListener('change', onSystemReducedMotion);
  };
}

export function usePreferences(): Preferences {
  return useSyncExternalStore(subscribe, snapshot);
}
