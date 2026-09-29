import { useLayoutEffect, useState } from 'react';
import { AppShell } from './components/AppShell.tsx';
import { Splash } from './components/Splash.tsx';
import { SceneContext } from './scene/sceneContext.ts';
import { useSceneHost } from './scene/useSceneHost.ts';
import Stage from './Stage.tsx';
import './App.css';

/** Graisses utilisées par les écrans ; attendues pour éviter un saut de police à l'apparition. */
const SCREEN_FONTS = [
  '700 34px Cinzel',
  '600 15px Cinzel',
  '500 15px Cinzel',
  '400 15px "Alegreya Sans"',
  '500 15px "Alegreya Sans"',
  '700 15px "Alegreya Sans"',
  '500 11px "Alegreya Sans SC"',
  '700 11px "Alegreya Sans SC"',
];

/** Au-delà, les écrans s'affichent même si une police tarde (repli sur les polices système). */
const FONT_TIMEOUT_MS = 3000;

/** Durée minimale de l'écran d'ouverture : pas de flash de l'écran de marque sur cache chaud. */
export const SPLASH_MIN_MS = 600;

const delay = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

/** Ne rejette jamais : une police absente ou lente ne bloque pas l'application. */
function fontsReady(): Promise<void> {
  // Absent de certains environnements (jsdom, navigateurs anciens).
  const fonts = (document as { fonts?: FontFaceSet }).fonts;
  if (!fonts) return Promise.resolve();
  const loading = Promise.all(SCREEN_FONTS.map((font) => fonts.load(font))).then(() => undefined);
  return Promise.race([loading, delay(FONT_TIMEOUT_MS)]).catch(() => undefined);
}

/**
 * Écran d'ouverture (PFC-001) au moins 600 ms, jusqu'à ce que les polices des écrans soient prêtes
 * et que la scène 3D soit prête ou en repli (PFC-008, D33), puis les écrans.
 */
export function App() {
  const [ready, setReady] = useState(false);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const scene = useSceneHost(canvas);

  // Posé dans le commit de l'écran d'ouverture : sa durée minimale court dès qu'il est affiché.
  useLayoutEffect(() => {
    let active = true;
    void Promise.all([fontsReady(), delay(SPLASH_MIN_MS)]).then(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  // Comme la maquette (`ready` après l'initialisation du moteur) : écrans une fois la scène prête ou en repli.
  const shown = ready && scene.status !== 'loading';

  return (
    <AppShell>
      <canvas ref={setCanvas} className="scene-canvas" aria-hidden="true" data-scene={scene.status} />
      <SceneContext.Provider value={scene}>{shown ? <Stage /> : <Splash />}</SceneContext.Provider>
    </AppShell>
  );
}
