import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke d'un Worker déployé (PFC-022, D48) : `SMOKE_URL=https://… npm run test:smoke`. Aucun serveur lancé, aucune
 * adresse cliente usurpée (Cloudflare pose `CF-Connecting-IP`) : deux vrais clients contre l'environnement publié.
 * HTTP n'est admis que sur la machine locale, pour éprouver la suite contre `npm run preview` avant un déploiement.
 */
const target = process.env['SMOKE_URL'];
if (target === undefined || target === '') {
  throw new Error('SMOKE_URL requis (ex. https://elem3nts-staging.elem3nts.workers.dev) : aucun smoke sans cible.');
}
const { protocol, hostname, origin } = new URL(target);
if (protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(hostname)) {
  throw new Error(`SMOKE_URL doit être en HTTPS (sockets WSS) : ${origin}`);
}

export default defineConfig({
  testDir: 'tests/smoke',
  forbidOnly: true,
  retries: 0,
  // Une seule partie à la fois : le smoke ne consomme que 2 entrées du budget par IP (D45).
  workers: 1,
  // Une manche réelle dure ≈ 7 s (D08, D09), plus la pause de reconnexion et la revanche, sur un réseau réel.
  timeout: 120_000,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/smoke' }]],
  outputDir: 'test-results/smoke',
  use: {
    baseURL: origin,
    locale: 'fr-FR',
    // Pas de trace : son journal réseau contiendrait les tokens de reprise de rooms réelles (artefact CI, TESTING).
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
