/** Typage de l'API publique du moteur porté depuis la maquette (engine.js, D33). */

export type SceneName = 'home' | 'arena';
export type EngineElement = 'fire' | 'water' | 'plant';
export type EngineQuality = 'low' | 'medium' | 'high';
export type ClashKind = 'wave' | 'burn' | 'grow' | 'flare' | 'siphon' | 'thrive' | 'balance' | 'solo' | 'void';

/** Position écran d'un élément de la « trinité » (étiquettes et zones tactiles de la maquette). */
export interface TrinityPoint {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

export class Engine {
  /** Construit la scène sans rendre aucune image : `warm` démarre la boucle (PFC-027). */
  constructor(canvas: HTMLCanvasElement);
  /**
   * Compile les programmes de la scène sans bloquer le fil principal (`KHR_parallel_shader_compile` ; sans
   * l'extension, résolu aussitôt), puis démarre la boucle d'image. Au-delà de `budgetMs`, démarre quand même (les
   * programmes restants se compilent au premier rendu). Moteur détruit ou contexte perdu : résolu sans rien démarrer.
   */
  warm(budgetMs: number): Promise<void>;
  /** Appelé quand les positions écran de la trinité changent (toutes les 0,25 s au plus). */
  onTrinity?: (points: readonly TrinityPoint[]) => void;
  /** Appelé si le contexte WebGL est perdu : le rendu s'arrête, le jeu continue dans le DOM. */
  onContextLost?: () => void;
  setScene(scene: SceneName): void;
  setLock(player: 0 | 1, locked: boolean): void;
  reveal(p1: EngineElement | null, p2: EngineElement | null): void;
  /** Chorégraphie de la manche ; les rappels ne pilotent jamais le jeu (le reducer décide). */
  clash(kind: ClashKind, winner: 0 | 1, onImpact?: () => void, onDone?: () => void): void;
  reset(): void;
  /** Célébration de fin : place gagnante, -1 pour un nul, `null` pour arrêter. */
  celebrate(winner: 0 | 1 | -1 | null): void;
  setQuality(quality: EngineQuality): void;
  setReduced(reduced: boolean): void;
  setMobile(mobile: boolean): void;
  getTrinity(): readonly TrinityPoint[];
  destroy(): void;
}
