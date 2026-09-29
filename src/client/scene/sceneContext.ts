import { createContext, useContext } from 'react';
import type { Engine, TrinityPoint } from './engine.js';

/** `loading` : moteur en chargement ; `ready` : scène 3D active ; `fallback` : jeu sans 3D (D33). */
export type SceneStatus = 'loading' | 'ready' | 'fallback';

/** Cause d'un repli : navigateur sans WebGL2, module en échec, contexte perdu ou rendu trop lent. */
export type FallbackReason = 'unsupported' | 'failed' | 'lost' | 'slow';

export interface SceneState {
  readonly status: SceneStatus;
  readonly reason: FallbackReason | null;
  readonly engine: Engine | null;
  /** Positions écran des trois éléments (étiquettes de l'arène), vides sans scène. */
  readonly trinity: readonly TrinityPoint[];
}

const NO_POINTS: readonly TrinityPoint[] = Object.freeze([]);

export const SCENE_LOADING: SceneState = Object.freeze({ status: 'loading', reason: null, engine: null, trinity: NO_POINTS });

export const sceneFallback = (reason: FallbackReason): SceneState =>
  Object.freeze({ status: 'fallback', reason, engine: null, trinity: NO_POINTS });

/** Hors hôte de scène (tests d'écran), la scène est « en chargement » : aucun appel moteur, aucun repli annoncé. */
export const SceneContext = createContext<SceneState>(SCENE_LOADING);

export function useScene(): SceneState {
  return useContext(SceneContext);
}
