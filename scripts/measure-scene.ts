/**
 * Mesure du temps d'image de la scène 3D réelle sur le GPU du poste (PFC-021, D46), avec la sonde de
 * développement `?perf` (src/client/scene/perfProbe.ts) : qualités basse, moyenne et haute, au repos puis
 * pendant les six chorégraphies, en bureau (1280×800) puis en format téléphone émulé (390×844 @3x) ; puis les éclairs
 * des chorégraphies (WCAG 2.3.1), animations complètes et mouvements réduits.
 *
 * Chromium est lancé **avec fenêtre** : sans elle, il retombe sur SwiftShader (rendu logiciel) même avec les
 * options GPU (mesuré sous WSL2). Le GPU réellement utilisé est relevé dans chaque rapport ; un rapport
 * SwiftShader est signalé comme tel et ne vaut pas mesure GPU. Un vrai téléphone se mesure avec la même
 * sonde (docs/TESTING.md § « Depuis PFC-021 »).
 *
 * Usage : npm run measure:scene            (serveur de développement lancé par le script)
 */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import type { ProbeReport } from '../src/client/scene/perfReport.ts';

const PROFILES = [
  { name: 'bureau', viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  { name: 'téléphone émulé', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
] as const;

const server = await createServer({ server: { port: 5175, strictPort: false }, logLevel: 'warn' });
await server.listen();
const base = server.resolvedUrls?.local[0];
if (base === undefined) throw new Error('Adresse du serveur de développement inconnue.');

const browser = await chromium.launch({ headless: false, args: ['--ignore-gpu-blocklist'] });
const reports: { profile: string; report: ProbeReport }[] = [];
try {
  for (const profile of PROFILES) {
    const { name, ...options } = profile;
    const context = await browser.newContext({ ...options, locale: 'fr-FR' });
    const page = await context.newPage();
    await page.goto(new URL('/?perf', base).href);
    await page.waitForFunction(() => window.__elem3ntsPerf?.status === 'done', undefined, { timeout: 180_000, polling: 1000 });
    const report = await page.evaluate(() => window.__elem3ntsPerf);
    if (!report) throw new Error('Rapport de la sonde absent.');
    reports.push({ profile: name, report });
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}

for (const { profile, report } of reports) {
  const software = /swiftshader|llvmpipe|software/i.test(report.renderer);
  console.log(`\n## ${profile} — ${report.viewport} @${String(report.devicePixelRatio)}x${software ? ' — RENDU LOGICIEL, pas une mesure GPU' : ''}`);
  console.log(`GPU : ${report.renderer}`);
  console.log(`Navigateur : ${report.userAgent}`);
  console.log('| Qualité | Repos médiane / p95 / max (ms) | Effets médiane / p95 / max (ms) |');
  console.log('| --- | --- | --- |');
  for (const { quality, idle, clash } of report.results) {
    console.log(
      `| ${quality} | ${String(idle.medianMs)} / ${String(idle.p95Ms)} / ${String(idle.maxMs)} | ${String(clash.medianMs)} / ${String(clash.p95Ms)} / ${String(clash.maxMs)} |`,
    );
  }
  for (const flash of report.flashes) {
    console.log(
      `Éclairs WCAG 2.3.1 (${flash.reduced ? 'mouvements réduits' : 'animations complètes'}, qualité haute) : ${String(flash.maxPerSecond)}/s au plus par bloc (seuil 3), plus forte variation d'une image à l'autre ${String(flash.maxStep)}`,
    );
  }
}
