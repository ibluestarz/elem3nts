import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { SPLASH_MIN_MS, awaitScene, freezeClock, trackProblems } from './support.ts';
import { CYCLE, clashDelays } from './timing.ts';

/**
 * PFC-021-AC3 — performance mesurée : aucune fuite de ressources GPU, d'écouteurs, de nœuds ni de boucles
 * d'image après 20 revanches avec la vraie scène 3D, et budget des bundles de production. Les temps d'image
 * sur vrai GPU se mesurent hors gate (`npm run measure:scene`, D46) : le gate n'a que le rendu logiciel.
 */

/** Diagnostic de Chromium en rendu logiciel (SwiftShader), émis par le navigateur de test, pas par l'application. */
const ENVIRONMENT_NOISE = 'GL Driver Message';

const REMATCHES = 20;

/** Ressources WebGL vivantes (créées moins détruites), par type, comptées sur le contexte de la scène. */
const COUNT_WEBGL_OBJECTS = () => {
  const live: Record<string, number> = {};
  Object.defineProperty(window, '__webgl', { value: live });
  const proto = WebGL2RenderingContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const kind of ['Buffer', 'Texture', 'Program', 'Shader', 'Framebuffer', 'Renderbuffer', 'VertexArray']) {
    live[kind] = 0;
    const create = proto[`create${kind}`];
    const remove = proto[`delete${kind}`];
    if (!create || !remove) continue;
    proto[`create${kind}`] = function (this: unknown, ...args: unknown[]) {
      const created = create.apply(this, args);
      if (created) live[kind] = (live[kind] ?? 0) + 1;
      return created;
    };
    proto[`delete${kind}`] = function (this: unknown, ...args: unknown[]) {
      if (args[0]) live[kind] = (live[kind] ?? 0) - 1;
      return remove.apply(this, args);
    };
  }
};

interface Snapshot {
  readonly webgl: Record<string, number>;
  readonly listeners: number;
  readonly nodes: number;
  readonly heapMb: number;
  readonly frameRequests: number;
}

/** Bond d'horloge (une image rendue) puis attente de l'état rendu. */
async function leap(page: Page, ms: number, rendered: () => Promise<unknown>): Promise<void> {
  await page.clock.fastForward(ms);
  await rendered();
}

const phase = (page: Page, name: string) => page.locator(`[data-phase="${name}"]`).waitFor({ state: 'attached' });

/** Une partie X = 1 jusqu'à l'écran de fin : Feu contre Plante, même chorégraphie à chaque fois. */
async function playToEnd(page: Page): Promise<void> {
  await leap(page, CYCLE.banner, () => phase(page, 'ready'));
  await leap(page, CYCLE.ready, () => phase(page, 'selecting'));
  await page.keyboard.press('KeyA');
  await page.keyboard.press('KeyL');
  await leap(page, CYCLE.selection, () => phase(page, 'reveal'));
  await leap(page, CYCLE.reveal, () => phase(page, 'clash'));
  await leap(page, clashDelays('burn').toImpact, () => phase(page, 'result'));
  await leap(page, clashDelays('burn').afterImpact, () => phase(page, 'closing'));
  await leap(page, CYCLE.closing, () => page.getByText('Fin de partie').waitFor());
}

test.describe('PFC-021-AC3 — 20 revanches avec la vraie scène 3D', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Compteurs CDP et WebGL mesurés sous Chromium.');
  // Rendu logiciel (0,5–1,1 s par image) : chaque bond d'horloge rend une image.
  test.setTimeout(900_000);

  test('ni ressource GPU, ni écouteur, ni nœud, ni boucle d’image en plus ; mémoire stable', async ({ page }, testInfo) => {
    const problems = trackProblems(page);
    await page.addInitScript(COUNT_WEBGL_OBJECTS);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');

    const snapshot = async (): Promise<Snapshot> => {
      await cdp.send('HeapProfiler.collectGarbage');
      const { metrics } = await cdp.send('Performance.getMetrics');
      const metric = (name: string) => metrics.find((entry) => entry.name === name)?.value ?? 0;
      await page.evaluate(() => {
        const counter = window as unknown as { __frames?: number; __wrapped?: boolean };
        // Enveloppe posée une seule fois ; compte les rappels demandés pendant une image (un par boucle active).
        if (!counter.__wrapped) {
          counter.__wrapped = true;
          const request = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (callback) => {
            counter.__frames = (counter.__frames ?? 0) + 1;
            return request(callback);
          };
        }
        counter.__frames = 0;
      });
      await page.clock.fastForward(16);
      return {
        webgl: await page.evaluate(() => ({ ...(window as unknown as { __webgl: Record<string, number> }).__webgl })),
        listeners: metric('JSEventListeners'),
        nodes: metric('Nodes'),
        heapMb: Math.round((metric('JSHeapUsedSize') / 1024 / 1024) * 100) / 100,
        frameRequests: await page.evaluate(() => (window as unknown as { __frames: number }).__frames),
      };
    };

    // Coût du rendu logiciel borné (le gate tourne en parallèle) : fenêtre de bureau réduite (≥ 720 px, mode non
    // compact) et qualité basse. Une fuite ne dépend pas du nombre de pixels : mêmes objets, mêmes écouteurs.
    await page.setViewportSize({ width: 800, height: 450 });
    await page.addInitScript(() => {
      localStorage.setItem('elem3nts.prefs.v1', JSON.stringify({ quality: 'low' }));
    });
    await freezeClock(page);
    await page.goto('/');
    await awaitScene(page);
    await expect(page.locator('canvas.scene-canvas')).toHaveAttribute('data-scene', 'ready');
    // Le chien de garde (D33) mesure 25 images au démarrage : de vraies images de 16 ms, pas des bonds.
    for (let frame = 0; frame < 26; frame++) await page.clock.runFor(16);
    await leap(page, SPLASH_MIN_MS, () => page.getByRole('button', { name: 'Jouer en local' }).waitFor());

    await page.getByRole('button', { name: 'Jouer en local' }).click();
    await page.getByRole('button', { name: 'Score cible 1', exact: true }).click();
    await page.getByRole('button', { name: /^Commencer/ }).click();
    await phase(page, 'intro');
    await playToEnd(page);

    const series: Snapshot[] = [];
    for (let game = 1; game <= REMATCHES; game++) {
      await page.keyboard.press('Space');
      await phase(page, 'intro');
      await playToEnd(page);
      if (game === 2 || game === 10 || game === REMATCHES) series.push(await snapshot());
    }
    const [early, middle, last] = series as [Snapshot, Snapshot, Snapshot];
    testInfo.annotations.push({ type: 'revanche 2', description: JSON.stringify(early) });
    testInfo.annotations.push({ type: 'revanche 10', description: JSON.stringify(middle) });
    testInfo.annotations.push({ type: `revanche ${String(REMATCHES)}`, description: JSON.stringify(last) });

    await expect(page.locator('canvas.scene-canvas')).toHaveAttribute('data-scene', 'ready');
    // Ressources GPU (tampons, textures, cibles de rendu) : constantes d'une revanche à l'autre.
    const resources = ({ Buffer, Texture, Framebuffer, Renderbuffer, Shader }: Record<string, number>) => ({
      Buffer,
      Texture,
      Framebuffer,
      Renderbuffer,
      Shader,
    });
    expect(resources(last.webgl)).toEqual(resources(early.webgl));
    // Programmes et VAO : three.js recompile une fois, vers la 6e partie consécutive, des programmes aux sources
    // identiques (mesuré, cause interne non isolée, D46), puis plus rien : plateau entre la 10e et la 20e revanche.
    // Sous charge, cette recompilation unique peut arriver après la 10e (PFC-023 : +1 programme et +1 VAO une fois en
    // 30 passages) ; 40 revanches mesurées restent à 65 programmes et 261 VAO de la 10e à la 40e. Une fuite par partie
    // donnerait au moins +10 : une seule unité d'écart est admise, jamais davantage.
    for (const kind of ['Program', 'VertexArray']) {
      const growth = (last.webgl[kind] ?? 0) - (middle.webgl[kind] ?? 0);
      expect(growth, `${kind} entre la 10e et la 20e revanche`).toBeGreaterThanOrEqual(0);
      expect(growth, `${kind} entre la 10e et la 20e revanche`).toBeLessThanOrEqual(1);
    }
    // Écouteurs et nœuds re-mesurés jusqu'au retour au niveau de la 2e revanche : un élément éphémère compté à l'instant
    // de la mesure disparaît, une fuite reste (CI 2 cœurs, run 36654697804 : 175 contre 174, jamais reproduit seul).
    await expect.poll(async () => (await snapshot()).listeners, { timeout: 10_000 }).toBeLessThanOrEqual(early.listeners);
    await expect.poll(async () => (await snapshot()).nodes, { timeout: 10_000 }).toBeLessThanOrEqual(early.nodes);
    expect(last.frameRequests).toBe(early.frameRequests);
    // Tas JS après ramasse-miettes : pas de croissance au-delà du bruit d'allocation (mesuré, D46).
    expect(last.heapMb - early.heapMb).toBeLessThan(2);
    expect(problems.filter((problem) => !problem.includes(ENVIRONMENT_NOISE))).toEqual([]);
  });
});

/** Budgets (gzip, ko) : taille mesurée en PFC-021 (D46) plus une marge ; dépassement = décision explicite. */
const BUDGETS_KB = { index: 105, engine: 145, css: 10 } as const;

test('PFC-021-AC3 — budget des bundles de production (gzip)', ({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Mesure des fichiers du build, indépendante du navigateur.');
  const dir = join(process.cwd(), 'dist/client/assets');
  const gzipKb = (prefix: string, extension: string) => {
    const file = readdirSync(dir).find((name) => name.startsWith(prefix) && name.endsWith(extension));
    if (!file) throw new Error(`Fichier ${prefix}*${extension} absent : lancer le build.`);
    return gzipSync(readFileSync(join(dir, file)), { level: 9 }).length / 1024;
  };
  expect(gzipKb('index-', '.js')).toBeLessThan(BUDGETS_KB.index);
  expect(gzipKb('engine-', '.js')).toBeLessThan(BUDGETS_KB.engine);
  expect(gzipKb('index-', '.css')).toBeLessThan(BUDGETS_KB.css);
  // La sonde de temps d'image (développement seulement) n'est jamais livrée.
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.js'))) {
    expect(readFileSync(join(dir, name), 'utf8')).not.toContain('__elem3ntsPerf');
  }
});

test('PFC-021-AC3 — visite suivante : fichiers à empreinte en cache immuable, page toujours revalidée', async ({ request, browserName }) => {
  test.skip(browserName !== 'chromium', 'En-têtes du Worker, indépendants du navigateur.');
  const dir = join(process.cwd(), 'dist/client/assets');
  const hashed = readdirSync(dir).filter((name) => /^(index|engine)-[\w-]+\.(js|css)$/.test(name) || name.endsWith('.woff2'));
  expect(hashed.length).toBeGreaterThan(3);
  for (const name of hashed.slice(0, 6)) {
    const response = await request.get(`/assets/${name}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  }
  // La page désigne les URL courantes : elle reste revalidée à chaque visite.
  const page = await request.get('/');
  expect(page.headers()['cache-control']).not.toContain('immutable');
});
