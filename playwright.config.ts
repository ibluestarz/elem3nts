import { defineConfig, devices } from '@playwright/test';
import { DETERMINISTIC_CHROMIUM_ARGS, testClientIp } from './tests/e2e/support.ts';

const PORT = 4173;
/** Parité visuelle : référence Chromium uniquement (voir tests/e2e/visual.spec.ts). */
const VISUAL_SPEC = /visual\.spec\.ts$/;
const isCI = Boolean(process.env['CI']);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  // En CI, `github` publie chaque échec en annotation du run, lisible sans télécharger le rapport (PFC-022, D48).
  reporter: [['list'], ...(isCI ? [['github'] as const] : []), ['html', { open: 'never' }]],
  // Références visuelles uniques, capturées depuis la maquette (scripts/capture-mockup-baseline.ts).
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFilePath}/{arg}{ext}',
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    locale: 'fr-FR',
    // Contextes par défaut (`page`, `request`) : une adresse cliente par processus, jamais le budget commun de
    // 127.0.0.1 (limites par IP, PFC-020) ; les contextes multijoueurs prennent la leur (`isolatedContext`).
    extraHTTPHeaders: { 'cf-connecting-ip': testClientIp() },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: { args: [...DETERMINISTIC_CHROMIUM_ARGS] } },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] }, testIgnore: VISUAL_SPEC },
    { name: 'webkit', use: { ...devices['Desktop Safari'] }, testIgnore: VISUAL_SPEC },
  ],
  webServer: {
    // Contre le build de production servi par le Worker local réel (workerd via le plugin Cloudflare, PFC-011).
    command: 'npm run build && npm run preview',
    url: `http://localhost:${String(PORT)}`,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
