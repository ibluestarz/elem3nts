import type { EngineQuality } from './engine.js';

/** Rapport de la sonde de temps d'image (PFC-021), partagé avec `scripts/measure-scene.ts`. */
export interface FrameStats {
  readonly frames: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface QualityResult {
  readonly quality: EngineQuality;
  readonly idle: FrameStats;
  readonly clash: FrameStats;
}

/**
 * Éclairs (WCAG 2.3.1) : paires de variations opposées de luminance relative ≥ 0,1, l'état sombre sous 0,8, comptées
 * par bloc d'une grille 4×4 de l'image (≈ un bloc par champ de 10°), maximum sur toute fenêtre d'une seconde.
 */
export interface FlashResult {
  readonly reduced: boolean;
  /** Plus grand nombre d'éclairs d'un bloc dans une seconde, toutes chorégraphies confondues (seuil WCAG : 3). */
  readonly maxPerSecond: number;
  /** Plus forte variation de luminance d'une image à la suivante (0–1). */
  readonly maxStep: number;
}

export interface ProbeReport {
  readonly status: 'running' | 'done';
  readonly flashes: readonly FlashResult[];
  readonly renderer: string;
  readonly userAgent: string;
  readonly viewport: string;
  readonly devicePixelRatio: number;
  readonly results: readonly QualityResult[];
}

declare global {
  interface Window {
    __elem3ntsPerf?: ProbeReport;
  }
}
