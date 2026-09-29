/**
 * Capture les références visuelles de tests/e2e/visual.spec.ts depuis la maquette
 * elem3nts-design/ELEM3NTS.dc.html (source de vérité produit), et non depuis l'application.
 *
 * - Écran « loading » (PFC-001) : le moteur Three.js de la maquette est bloqué, elle reste en chargement.
 * - Écrans d'interface (PFC-004) : le moteur est remplacé par un bouchon qui ne dessine rien.
 *   La scène 3D (PFC-008) est ainsi exclue et les panneaux DOM deviennent déterministes.
 *   Les minuteries sont maîtrisées par `page.clock`, comme dans le test de l'application.
 *
 * Nécessite un accès réseau (React/Babel via unpkg et Google Fonts, chargés par la maquette elle-même).
 * Usage : npm run baseline:mockup
 *         npm run baseline:mockup -- --only online-   (seuls les états dont le nom commence par ce préfixe :
 *         les références existantes ne sont pas réécrites quand seuls des états sont ajoutés)
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser } from '@playwright/test';
import { CLASH_TIMING } from '../tests/e2e/timing.ts';
import {
  DETERMINISTIC_CHROMIUM_ARGS,
  SCREEN_FONTS,
  SCENE_HOME_FRAMES_MS,
  VIEWPORTS,
  freezeClock,
  hideInterface,
  seedRandomOnWebGL,
  markZone,
  parkPointer,
  screenSnapshotName,
  splashSnapshotName,
  statesFor,
  waitForVisualStability,
  zoneRect,
  zonesOf,
  TRINITY_POINTS,
  type ScreenState,
} from '../tests/e2e/support.ts';

const root = fileURLToPath(new URL('..', import.meta.url));
const mockupDir = resolve(root, 'elem3nts-design');
const outputDir = resolve(root, 'tests/e2e/__screenshots__/visual.spec.ts');
const sceneDir = resolve(root, 'tests/e2e/__screenshots__/scene.spec.ts');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.jpg': 'image/jpeg',
};

/**
 * Moteur factice : toute méthode est un no-op, `getTrinity` ne renvoie aucun élément à étiqueter (états `trinity` : `TRINITY_POINTS`),
 * et `clash` suit la chronologie du vrai moteur (impact à D·I, fin à D, horloge figée) : celle que
 * l'application applique (D09, D33). Timings : CLASH_TIMING, src/client/state/game.ts.
 */
const engineStub = (trinity: boolean) => `
const noop = () => {};
const TIMING = ${JSON.stringify(CLASH_TIMING)};
window.Elem3ntsEngine = class {
  clash(kind, winner, onImpact, onDone) {
    const { duration, impact } = TIMING[kind];
    setTimeout(onImpact, Math.round(duration * impact));
    setTimeout(onDone, duration);
  }
  constructor() {
    return new Proxy(this, { get: (target, key) => (key in target ? target[key] : key === 'getTrinity' ? () => ${trinity ? TRINITY_POINTS : '[]'} : noop) });
  }
};
window.dispatchEvent(new Event('elem3nts-engine'));
`;

const server = createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  const file = normalize(join(mockupDir, pathname === '/' ? 'ELEM3NTS.dc.html' : pathname));
  if (!file.startsWith(mockupDir)) {
    response.writeHead(403).end();
    return;
  }
  readFile(file)
    .then((body) => {
      response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
      response.end(body);
    })
    .catch(() => response.writeHead(404).end());
});

await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('Adresse du serveur inconnue.');
const baseUrl = `http://127.0.0.1:${String(address.port)}/`;

async function captureSplash(browser: Browser, viewport: (typeof VIEWPORTS)[number]) {
  const page = await browser.newPage({ viewport, locale: 'fr-FR' });
  await page.route('**/elem3nts-engine.js', (route) => route.abort());
  await page.goto(baseUrl);
  await page.getByText('Invocation de l’arène…').waitFor();
  await waitForVisualStability(page);
  const path = join(outputDir, splashSnapshotName(viewport));
  await page.screenshot({ path, animations: 'disabled' });
  console.log(`Référence écrite : ${path}`);
  await page.close();
}

async function captureScreen(browser: Browser, viewport: (typeof VIEWPORTS)[number], state: ScreenState) {
  const page = await browser.newPage({ viewport, locale: 'fr-FR' });
  await page.route('**/elem3nts-engine.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: engineStub(state.trinity === true) }),
  );
  // Horloge figée : ni pulse « Appuyez sur Espace », ni fin de la bannière d'ouverture.
  await freezeClock(page);
  await page.goto(baseUrl);
  await page.getByText('Le Feu, l’Eau et la Plante s’affrontent').waitFor();
  await state.reach(page);
  await parkPointer(page);
  await waitForVisualStability(page, SCREEN_FONTS);
  if (state.name === 'home' && viewport.width >= 720) {
    // Garde : la référence doit montrer le pulse dans son état initial (tick 0, opacité 0,5).
    const opacity = await page.getByText('pour jouer en local').evaluate((node) => getComputedStyle(node).opacity);
    if (opacity !== '0.5') throw new Error(`Pulse inattendu dans la maquette : opacité ${opacity}.`);
  }
  const path = join(outputDir, screenSnapshotName(state.name, viewport));
  const masks = state.mask ? [page.locator(state.mask.mockup)] : [];
  for (const zone of zonesOf(state)) masks.push(await markZone(page, zoneRect(zone, viewport)));
  await page.screenshot({ path, animations: 'disabled', mask: masks });
  console.log(`Référence écrite : ${path}`);
  await page.close();
}

/** Référence 3D : vrai moteur de la maquette (three depuis son CDN), interface masquée (D33). */
async function captureScene(browser: Browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR' });
  await seedRandomOnWebGL(page);
  await freezeClock(page);
  await page.goto(baseUrl);
  await page.getByText('Le Feu, l’Eau et la Plante s’affrontent').waitFor({ timeout: 60_000 });
  await page.clock.runFor(SCENE_HOME_FRAMES_MS);
  await hideInterface(page);
  const path = join(sceneDir, 'scene-home-1280x800.png');
  await page.screenshot({ path, animations: 'disabled' });
  console.log(`Référence écrite : ${path}`);
  await page.close();
}

const onlyIndex = process.argv.indexOf('--only');
const only = onlyIndex === -1 ? null : (process.argv[onlyIndex + 1] ?? '');

const browser = await chromium.launch({ args: [...DETERMINISTIC_CHROMIUM_ARGS] });
try {
  await mkdir(outputDir, { recursive: true });
  await mkdir(sceneDir, { recursive: true });
  if (only === null) await captureScene(browser);
  for (const viewport of VIEWPORTS) {
    if (only === null) await captureSplash(browser, viewport);
    for (const state of statesFor(viewport)) {
      if (only === null || state.name.startsWith(only)) await captureScreen(browser, viewport, state);
    }
  }
} finally {
  await browser.close();
  server.close();
}
