/**
 * Mesure de l'ouverture (PFC-021, D46) sur le build de production servi par le Worker local (`npm run build`,
 * puis `npm run preview` dans un autre terminal) : réseau et processeur bridés comme le profil mobile de
 * Lighthouse (RTT 150 ms, 1,6 Mbit/s, processeur ×4), cache froid puis visite suivante.
 *
 * Relevés : début et fin du téléchargement du moteur 3D (`engine-*.js`), fin de l'écran d'ouverture (accueil
 * interactif), requêtes revalidées (304) à la visite suivante. Chromium avec fenêtre : GPU réel (sans elle,
 * l'initialisation du moteur en rendu logiciel dominerait la mesure). Résultats et variantes comparées : D46.
 *
 * Usage : npm run measure:load            (URL par défaut http://localhost:4173/, 5 passages ; RUNS=9 pour plus)
 */
import { chromium, type Page } from '@playwright/test';

const url = process.argv[2] ?? 'http://localhost:4173/';
const RUNS = Number(process.env['RUNS'] ?? 5);
const NETWORK = { offline: false, latency: 150, downloadThroughput: (1.6384 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 };
const CPU_SLOWDOWN = 4;

interface Load {
  readonly engineStart: number;
  readonly engineEnd: number;
  readonly interactive: number;
  readonly revalidated: number;
}

async function load(page: Page): Promise<Load> {
  let revalidated = 0;
  const onResponse = (response: { status: () => number }) => {
    if (response.status() === 304) revalidated += 1;
  };
  page.on('response', onResponse);
  await page.goto(url, { waitUntil: 'commit' });
  await page.getByRole('button', { name: 'Jouer en local' }).waitFor({ timeout: 60_000 });
  const timing = await page.evaluate(() => {
    const engine = (performance.getEntriesByType('resource') as PerformanceResourceTiming[]).find((entry) =>
      /\/assets\/engine-[^/]+\.js$/.test(entry.name),
    );
    return { engineStart: engine?.startTime ?? -1, engineEnd: engine?.responseEnd ?? -1, interactive: performance.now() };
  });
  page.off('response', onResponse);
  return { ...timing, revalidated };
}

const median = (values: readonly number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const cold: Load[] = [];
const warm: Load[] = [];
try {
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR' });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', NETWORK);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_SLOWDOWN });
    cold.push(await load(page));
    warm.push(await load(page));
    await context.close();
  }
} finally {
  await browser.close();
}

const row = (label: string, loads: readonly Load[]) => {
  const pick = (key: keyof Load) => Math.round(median(loads.map((entry) => entry[key])));
  return `| ${label} | ${String(pick('engineStart'))} | ${String(pick('engineEnd'))} | ${String(pick('interactive'))} | ${String(pick('revalidated'))} |`;
};
console.log(`Ouverture — ${url} — médianes de ${String(RUNS)} passages, RTT 150 ms, 1,6 Mbit/s, processeur ×${String(CPU_SLOWDOWN)}`);
console.log('| Visite | Moteur : début (ms) | Moteur : fin (ms) | Accueil interactif (ms) | Requêtes 304 |');
console.log('| --- | --- | --- | --- | --- |');
console.log(row('cache froid', cold));
console.log(row('visite suivante', warm));
