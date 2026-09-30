import { expect, test, type Page } from '@playwright/test';
import {
  SCENE_HOME_FRAMES_MS,
  SCENE_TOLERANCE,
  SPLASH_MIN_MS,
  awaitScene,
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
  await awaitScene(page);
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
    await awaitScene(page);
    await expect(page.locator('canvas.scene-canvas')).toHaveAttribute('data-scene', 'ready');
    await page.clock.runFor(SCENE_HOME_FRAMES_MS);
    await hideInterface(page);

    await expect(page).toHaveScreenshot('scene-home-1280x800.png', SCENE_TOLERANCE);
  });

  /**
   * Compilation parallèle des shaders (PFC-027). SwiftShader (gate, CI) n'expose pas `KHR_parallel_shader_compile` :
   * le chemin S1 y est simulé (extension présente, chaque programme prêt à sa 3e interrogation) pour exercer le suivi
   * sans blocage ; le vrai GPU est mesuré par `npm run measure:load` (D46). S2 retire l'extension.
   */
  for (const mode of ['simulated', 'hidden'] as const) {
    const title =
      mode === 'simulated'
        ? 'PFC-027-S1 — compilation suivie sans bloquer, scène prête une fois les programmes compilés'
        : 'PFC-027-S2 — navigateur sans compilation parallèle : comportement d’avant, sans erreur';
    test(title, async ({ page }) => {
      const problems = trackProblems(page);
      await page.addInitScript((simulate: boolean) => {
        const NAME = 'KHR_parallel_shader_compile';
        const COMPLETION_STATUS_KHR = 0x91b1;
        const stats = { queries: 0, programs: 0, linkedInLoop: 0 };
        Object.defineProperty(window, '__compile', { value: stats });
        const proto = WebGL2RenderingContext.prototype;
        const original = (name: string) =>
          Object.getOwnPropertyDescriptor(proto, name)?.value as (this: WebGL2RenderingContext, ...args: unknown[]) => unknown;
        const [getExtension, getSupportedExtensions, getProgramParameter] = [
          original('getExtension'),
          original('getSupportedExtensions'),
          original('getProgramParameter'),
        ];
        const asked = new WeakMap<WebGLProgram, number>();
        const define = (name: string, value: (this: WebGL2RenderingContext, ...args: never[]) => unknown) => {
          Object.defineProperty(proto, name, { configurable: true, value });
        };
        define('getExtension', function (this: WebGL2RenderingContext, name: string) {
          if (name !== NAME) return getExtension.call(this, name);
          return simulate ? { COMPLETION_STATUS_KHR } : null;
        });
        define('getSupportedExtensions', function (this: WebGL2RenderingContext) {
          const names = ((getSupportedExtensions.call(this) as string[] | null) ?? []).filter((name) => name !== NAME);
          return simulate ? [...names, NAME] : names;
        });
        // Programmes liés par une image de la boucle (pile : méthode `step` du moteur, nom conservé par la minification).
        const linkProgram = original('linkProgram');
        define('linkProgram', function (this: WebGL2RenderingContext, program: WebGLProgram) {
          const limit = Error.stackTraceLimit;
          Error.stackTraceLimit = 100;
          if (/\.step\b/.test(new Error().stack ?? '')) stats.linkedInLoop += 1;
          Error.stackTraceLimit = limit;
          return linkProgram.call(this, program);
        });
        define('getProgramParameter', function (this: WebGL2RenderingContext, program: WebGLProgram, name: number) {
          if (name !== COMPLETION_STATUS_KHR) return getProgramParameter.call(this, program, name);
          stats.queries += 1;
          const count = (asked.get(program) ?? 0) + 1;
          if (count === 1) stats.programs += 1;
          asked.set(program, count);
          return count >= 3;
        });
      }, mode === 'simulated');
      await openHome(page);
      await expect(page.locator('canvas.scene-canvas')).toHaveAttribute('data-scene', 'ready');
      await page.clock.runFor(100);

      const { queries, programs, linkedInLoop } = await page.evaluate(
        () => (window as unknown as { __compile: { queries: number; programs: number; linkedInLoop: number } }).__compile,
      );
      // Tout ce que la 1re image dessine est compilé par `warm`, sauf les 3 programmes de profondeur des ombres (qualité
      // haute), internes à three.js (D51). Visibilité des acteurs ou variantes de transmission oubliées : +10 à +30.
      expect(linkedInLoop).toBeLessThanOrEqual(3);
      if (mode === 'simulated') {
        // Chaque programme interrogé jusqu'à sa 3e réponse : prêt seulement après plusieurs tours de suivi.
        expect(programs).toBeGreaterThan(10);
        expect(queries).toBeGreaterThanOrEqual(programs * 3);
      } else {
        // Sans l'extension, three.js tient chaque programme pour prêt : aucune interrogation, rendu comme avant.
        expect(queries).toBe(0);
      }
      await page.getByRole('button', { name: 'Jouer en local' }).click();
      await expect(page.getByRole('button', { name: /^Commencer/ })).toBeVisible();
      expect(appProblems(problems)).toEqual([]);
    });
  }

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
