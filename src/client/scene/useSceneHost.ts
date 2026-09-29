import { useLayoutEffect, useState } from 'react';
import type { Engine } from './engine.js';
import { SCENE_LOADING, sceneFallback, type SceneState } from './sceneContext.ts';

/** Au-delà, le jeu démarre sans 3D plutôt que de rester sur l'écran d'ouverture (D33). */
export const SCENE_LOAD_TIMEOUT_MS = 8000;

/**
 * Garde de performance (D33) : sans accélération GPU, une image coûte 0,5 à 1,1 s (mesuré en rendu
 * logiciel), le jeu devient injouable. Médiane de 20 images après 5 de chauffe ; au-delà du seuil,
 * repli DOM et moteur détruit pour libérer le processeur.
 */
export const SLOW_FRAME_MS = 150;
const WARMUP_FRAMES = 5;
const SAMPLE_FRAMES = 20;

/** Surveille la cadence d'affichage ; `onSlow` si la médiane dépasse le seuil. Renvoie l'arrêt. */
export function watchFrameRate(onSlow: () => void): () => void {
  const intervals: number[] = [];
  let frames = 0;
  let last: number | null = null;
  let id = 0;
  const sample = (time: number) => {
    if (document.hidden) {
      // Un onglet masqué suspend l'affichage : l'intervalle suivant ne mesurerait pas la scène.
      last = null;
    } else {
      if (last !== null) {
        frames += 1;
        if (frames > WARMUP_FRAMES) intervals.push(time - last);
      }
      last = time;
    }
    if (intervals.length < SAMPLE_FRAMES) {
      id = requestAnimationFrame(sample);
      return;
    }
    const sorted = [...intervals].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    if (median > SLOW_FRAME_MS) onSlow();
  };
  id = requestAnimationFrame(sample);
  return () => {
    cancelAnimationFrame(id);
  };
}

/**
 * WebGL2 (requis par three 0.160) disponible ? Sondé sur un canvas jetable, laissé au ramasse-miettes :
 * le canvas de la scène garde ses attributs (antialias) et aucune erreur n'est journalisée sans
 * WebGL. Pas de `loseContext` : Firefox journalise alors « WebGL context was lost » (mesuré en E2E).
 */
export function webgl2Available(): boolean {
  if (typeof WebGL2RenderingContext === 'undefined') return false;
  try {
    return document.createElement('canvas').getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

/**
 * Crée l'unique moteur 3D sur le canvas, chargé à la demande, et le détruit au démontage
 * (StrictMode compris : un démontage avant l'arrivée du module n'en crée aucun). Échec, délai
 * dépassé ou contexte perdu : repli DOM, le jeu continue.
 *
 * Le canvas est reçu par ref-callback : StrictMode (React 19) détache puis rattache les refs, un
 * canvas absent signifie « pas encore monté », jamais « pas de 3D » (mesuré : repli à tort sinon).
 */
const UNSUPPORTED = sceneFallback('unsupported');
const noop = (): void => undefined;

export function useSceneHost(canvas: HTMLCanvasElement | null): SceneState {
  // Sondé une fois : sans WebGL2, le module 3D n'est jamais chargé.
  const [available] = useState(webgl2Available);
  const [state, setState] = useState<SceneState>(SCENE_LOADING);

  useLayoutEffect(() => {
    if (!canvas || !available) return undefined;
    let active = true;
    let engine: Engine | null = null;
    let stopWatch = noop;
    const timeout = window.setTimeout(() => {
      if (!engine) {
        active = false;
        setState(sceneFallback('failed'));
      }
    }, SCENE_LOAD_TIMEOUT_MS);

    import('./engine.js')
      .then((module) => {
        if (!active) return;
        const created = new module.Engine(canvas);
        engine = created;
        window.clearTimeout(timeout);
        created.onTrinity = (points) => {
          setState((current) => (current.engine === created ? { ...current, trinity: points } : current));
        };
        created.onContextLost = () => {
          stopWatch();
          setState(sceneFallback('lost'));
        };
        if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('perf')) {
          // Sonde de temps d'image (PFC-021, développement seulement) : le chien de garde ne coupe pas la mesure.
          void import('./perfProbe.ts').then((probe) => probe.runProbe(created, canvas));
        } else {
          stopWatch = watchFrameRate(() => {
            if (engine !== created) return;
            created.destroy();
            engine = null;
            setState(sceneFallback('slow'));
          });
        }
        setState({ status: 'ready', reason: null, engine: created, trinity: created.getTrinity() });
      })
      .catch(() => {
        if (active) setState(sceneFallback('failed'));
      });

    return () => {
      active = false;
      window.clearTimeout(timeout);
      stopWatch();
      engine?.destroy();
      engine = null;
    };
  }, [canvas, available]);

  return available ? state : UNSUPPORTED;
}
