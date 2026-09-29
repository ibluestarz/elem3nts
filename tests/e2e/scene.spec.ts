import { expect, test, type Page } from '@playwright/test';
import {
  SCENE_HOME_FRAMES_MS,
  SCENE_TOLERANCE,
  SPLASH_MIN_MS,
  freezeClock,
  hideInterface,
  seedRandomOnWebGL,
  strongDiffRatio,
  trackProblems,
} from './support.ts';
import { CYCLE, clashDelays, type ClashKind } from './timing.ts';

/** Diagnostic de Chromium en rendu logiciel (SwiftShader), émis par le navigateur de test, pas par l'application. */
const ENVIRONMENT_NOISE = 'GL Driver Message';
const appProblems = (problems: readonly string[]) => problems.filter((problem) => !problem.includes(ENVIRONMENT_NOISE));

/**
 * Avance d'une échéance par bond (`fastForward` : minuteries dues une fois, une image rendue) puis
 * attend le rendu de la phase, qui pose l'échéance suivante. En rendu logiciel (0,5–1,1 s par
 * image), piloter image par image rendrait ces tests trop longs.
 */
async function leap(page: Page, ms: number, rendered: () => Promise<unknown>): Promise<void> {
  await page.clock.fastForward(ms);
  await rendered();
}

async function openHome(page: Page): Promise<void> {
  await freezeClock(page);
  await page.goto('/');
  await page.getByText('Invocation de l’arène…').waitFor();
  await page.locator('canvas.scene-canvas:not([data-scene="loading"])').waitFor({ state: 'attached' });
  await leap(page, SPLASH_MIN_MS, () => page.getByRole('button', { name: 'Jouer en local' }).waitFor());
}

const phase = (page: Page, name: string) => page.locator(`[data-phase="${name}"]`).waitFor({ state: 'attached' });

async function startMatch(page: Page, target: number): Promise<void> {
  await page.getByRole('button', { name: 'Jouer en local' }).click();
  await page.getByRole('button', { name: `Score cible ${String(target)}`, exact: true }).click();
  await page.getByRole('button', { name: /^Commencer/ }).click();
  await phase(page, 'intro');
  await leap(page, CYCLE.banner, () => phase(page, 'ready'));
  await leap(page, CYCLE.ready, () => phase(page, 'selecting'));
}

/** Manche jusqu'à l'impact de l'effet voulu, touches physiques des deux joueurs. */
async function playToImpact(page: Page, target: number, keys: readonly string[], kind: ClashKind): Promise<void> {
  await startMatch(page, target);
  await roundToImpact(page, keys, kind);
}

/** Depuis la sélection : choix des deux joueurs, révélation puis impact de l'effet. */
async function roundToImpact(page: Page, keys: readonly string[], kind: ClashKind): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
  await leap(page, CYCLE.selection, () => phase(page, 'reveal'));
  await leap(page, CYCLE.reveal, () => phase(page, 'clash'));
  await leap(page, clashDelays(kind).toImpact, () => phase(page, 'result'));
}

/** Images de moteur (0,25 s chacune) entre l'impact et la capture, au plein de l'effet. */
const FULL_EFFECT_MS = 4 * 250;

/** Scène seule au plein de l'effet, interface réaffichée ensuite. */
async function captureEffect(page: Page): Promise<Buffer> {
  for (let elapsed = 0; elapsed < FULL_EFFECT_MS; elapsed += 250) await page.clock.fastForward(250);
  const showInterface = await hideInterface(page);
  const capture = await page.screenshot({ animations: 'disabled' });
  await showInterface();
  return capture;
}

/** Nouvelle page, première manche jouée jusqu'au plein de l'effet voulu. */
async function captureImpact(page: Page, keys: readonly string[], kind: ClashKind): Promise<Buffer> {
  await openHome(page);
  await expect(page.locator('canvas.scene-canvas')).toHaveAttribute('data-scene', 'ready');
  await playToImpact(page, 3, keys, kind);
  return captureEffect(page);
}

test.describe('PFC-008-S2 / AC2 — sans WebGL, le jeu reste jouable dans le DOM', () => {
  test('WebGL2 absent : repli annoncé, manche jouée et expliquée dans le DOM', async ({ page }) => {
    const problems = trackProblems(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'WebGL2RenderingContext', { configurable: true, value: undefined });
    });
    await openHome(page);

    await expect(page.locator('canvas.scene-canvas')).toHaveAttribute('data-scene', 'fallback');
    await expect(page.getByRole('status')).toContainText('Scène 3D indisponible sur cet appareil : la partie se joue sans effets.');

    await playToImpact(page, 1, ['KeyS', 'KeyK'], 'siphon');
    await expect(page.locator('.arena__banner')).toContainText('La mer engloutit tout');
    await expect(page.locator('.arena__score')).toHaveText(['0', '0']);
    expect(appProblems(problems)).toEqual([]);
  });
});

test.describe('PFC-008 — scène 3D réelle (Chromium, rendu logiciel)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Rendu WebGL mesuré et comparé sous Chromium.');
  // Rendu logiciel mesuré à 0,5–1,1 s par image, deux à trois fois plus lent sous la charge du gate parallèle.
  test.setTimeout(480_000);

  test('PFC-008 — accueil 3D fidèle à la maquette (tolérance calibrée, D33)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await seedRandomOnWebGL(page);
    await freezeClock(page);
    await page.goto('/');
    await page.locator('canvas.scene-canvas[data-scene="ready"]').waitFor({ state: 'attached' });
    await page.clock.runFor(SCENE_HOME_FRAMES_MS);
    await hideInterface(page);

    await expect(page).toHaveScreenshot('scene-home-1280x800.png', SCENE_TOLERANCE);
  });

  test('PFC-008-AC1 / S1 — feu+feu, eau+eau et plante+plante : effets distincts et explications', async ({ page }, testInfo) => {
    const effects: [string, readonly string[], ClashKind, string][] = [
      ['feu-feu', ['KeyA', 'KeyJ'], 'flare', 'Les flammes s’embrasent'],
      ['eau-eau', ['KeyS', 'KeyK'], 'siphon', 'La mer engloutit tout'],
      ['plante-plante', ['KeyD', 'KeyL'], 'balance', 'Rien ne se passe'],
    ];
    const captures: Buffer[] = [];
    // Une seule partie (X = 3) : 0/0 → 1/1 → 0/0 → 0/0, sans recharger la scène entre les effets.
    await openHome(page);
    await expect(page.locator('canvas.scene-canvas')).toHaveAttribute('data-scene', 'ready');
    await startMatch(page, 3);
    for (const [name, keys, kind, explanation] of effects) {
      if (captures.length > 0) await leap(page, CYCLE.pause, () => phase(page, 'selecting'));
      await roundToImpact(page, keys, kind);
      await expect(page.locator('.arena__banner')).toContainText(explanation);
      const capture = await captureEffect(page);
      await leap(page, clashDelays(kind).afterImpact - FULL_EFFECT_MS, () => phase(page, 'pause'));
      await testInfo.attach(`effet-${name}.png`, { body: capture, contentType: 'image/png' });
      captures.push(capture);
    }
    const [flare, siphon, balance] = captures;
    if (!flare || !siphon || !balance) throw new Error('Captures manquantes.');
    for (const [left, right] of [
      [flare, siphon],
      [flare, balance],
      [siphon, balance],
    ] as const) {
      expect(await strongDiffRatio(page, left, right)).toBeGreaterThan(0.01);
    }
  });

  test('PFC-008-AC2 — mouvements réduits (préférence système) : effet atténué par le moteur', async ({ page }, testInfo) => {
    await seedRandomOnWebGL(page);
    const full = await captureImpact(page, ['KeyA', 'KeyJ'], 'flare');
    // Préférences de l'appareil effacées : la valeur par défaut redevient la préférence système.
    await page.evaluate(() => {
      localStorage.clear();
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reduced = await captureImpact(page, ['KeyA', 'KeyJ'], 'flare');
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
    await testInfo.attach('flare-complet.png', { body: full, contentType: 'image/png' });
    await testInfo.attach('flare-reduit.png', { body: reduced, contentType: 'image/png' });

    const ratio = await strongDiffRatio(page, full, reduced);
    testInfo.annotations.push({ type: 'écarts forts', description: ratio.toFixed(4) });
    expect(ratio).toBeGreaterThan(0.01);
  });

  test('PFC-008-AC2 — contexte WebGL perdu en jeu : repli annoncé, la partie continue', async ({ page }) => {
    await openHome(page);
    await expect(page.locator('canvas.scene-canvas')).toHaveAttribute('data-scene', 'ready');
    await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas.scene-canvas');
      canvas?.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
    });

    await expect(page.locator('canvas.scene-canvas')).toHaveAttribute('data-scene', 'fallback');
    await expect(page.getByRole('status')).toContainText('Scène 3D interrompue : la partie continue sans effets.');
    await playToImpact(page, 1, ['KeyA', 'KeyL'], 'burn');
    await expect(page.locator('.arena__banner')).toContainText('Le Feu consume la Plante');
  });

  test('ARCHITECTURE — onglet masqué : aucune image rendue, reprise au retour', async ({ page }) => {
    await page.addInitScript(() => {
      const counter = { draws: 0 };
      Object.defineProperty(window, '__draws', { value: counter });
      const proto = WebGL2RenderingContext.prototype;
      for (const name of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced'] as const) {
        const original = Object.getOwnPropertyDescriptor(proto, name)?.value as (...args: unknown[]) => void;
        Object.defineProperty(proto, name, {
          configurable: true,
          value(this: WebGL2RenderingContext, ...args: unknown[]) {
            counter.draws += 1;
            original.apply(this, args);
          },
        });
      }
    });
    const draws = () => page.evaluate(() => (window as unknown as { __draws: { draws: number } }).__draws.draws);
    await openHome(page);

    await page.clock.fastForward(16);
    const visible = await draws();
    expect(visible).toBeGreaterThan(0);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const hiddenStart = await draws();
    for (let index = 0; index < 5; index++) await page.clock.fastForward(200);
    expect(await draws()).toBe(hiddenStart);

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.clock.fastForward(16);
    expect(await draws()).toBeGreaterThan(hiddenStart);
  });

  test('PFC-008-AC3 — revanches et retours : un seul contexte WebGL, aucune boucle en plus', async ({ page }) => {
    await page.addInitScript(() => {
      const stats = { sceneContexts: 0, frameRequests: 0 };
      Object.defineProperty(window, '__stats', { value: stats });
      const getContext = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')?.value as (
        this: HTMLCanvasElement,
        ...args: unknown[]
      ) => unknown;
      Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
        configurable: true,
        value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
          if (type.startsWith('webgl') && this.classList.contains('scene-canvas')) stats.sceneContexts += 1;
          return getContext.call(this, type, ...rest);
        },
      });
    });
    const stats = () =>
      page.evaluate(() => ({ ...(window as unknown as { __stats: { sceneContexts: number } }).__stats }));
    /** Rappels d'image demandés pendant une image : un par boucle active. */
    const requestsPerFrame = async () => {
      await page.evaluate(() => {
        const counter = (window as unknown as { __stats: { frameRequests: number; wrapped?: boolean } }).__stats;
        // Enveloppe posée une seule fois : sinon chaque mesure compterait en double.
        if (!counter.wrapped) {
          counter.wrapped = true;
          const request = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (callback) => {
            counter.frameRequests += 1;
            return request(callback);
          };
        }
        counter.frameRequests = 0;
      });
      await page.clock.fastForward(16);
      return page.evaluate(() => (window as unknown as { __stats: { frameRequests: number } }).__stats.frameRequests);
    };

    await openHome(page);
    const before = await requestsPerFrame();
    expect(before).toBeGreaterThan(0);

    await playToImpact(page, 1, ['KeyA', 'KeyL'], 'burn');
    for (let game = 0; game < 2; game++) {
      await leap(page, clashDelays('burn').afterImpact, () => phase(page, 'closing'));
      await leap(page, CYCLE.closing, () => page.getByText('Fin de partie').waitFor());
      await page.keyboard.press('Space');
      await phase(page, 'intro');
      await leap(page, CYCLE.banner, () => phase(page, 'ready'));
      await leap(page, CYCLE.ready, () => phase(page, 'selecting'));
      await page.keyboard.press('KeyA');
      await page.keyboard.press('KeyL');
      await leap(page, CYCLE.selection, () => phase(page, 'reveal'));
      await leap(page, CYCLE.reveal, () => phase(page, 'clash'));
      await leap(page, clashDelays('burn').toImpact, () => phase(page, 'result'));
    }
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Jouer en local' }).click();
    await page.getByRole('button', { name: 'Retour' }).click();

    expect(await stats()).toMatchObject({ sceneContexts: 1 });
    await expect(page.locator('canvas.scene-canvas')).toHaveCount(1);
    expect(await requestsPerFrame()).toBe(before);
  });
});
