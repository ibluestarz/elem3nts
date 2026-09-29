import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { host, join, lobbyTitle, player } from './online-driver.ts';
import { SPLASH_MIN_MS, freezeClock, isolatedContext, stubScene } from './support.ts';

/**
 * PFC-020 — durcissement vu d'un vrai navigateur, contre le build de production servi par workerd :
 * en-têtes de sécurité des pages (`public/_headers`), CSP compatible avec la scène 3D et la socket de même
 * origine, refus d'un autre site, limites de débit par IP et leur message à l'écran (D45).
 */

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'self'; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const PAGE_HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()',
  'strict-transport-security': 'max-age=31536000',
};

const RATE_LIMITED_TEXT = 'Trop de tentatives : patientez une minute puis réessayez.';

/**
 * Violations CSP relevées par la page (`securitypolicyviolation`), dès son premier script, remontées au test
 * au fil de l'eau : aucune lecture finale dans la page, que le rendu 3D logiciel peut occuper longuement.
 */
async function recordViolations(page: Page): Promise<string[]> {
  const seen: string[] = [];
  await page.exposeFunction('__reportCsp', (violation: string) => {
    seen.push(violation);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      void (window as unknown as { __reportCsp: (violation: string) => Promise<void> }).__reportCsp(
        `${event.effectiveDirective} ${event.blockedURI}`,
      );
    });
  });
  return seen;
}

test.describe('PFC-020-AC3 — en-têtes de sécurité et CSP', () => {
  test('PFC-020-AC3 — accueil, repli SPA d’une invitation, fichier du build et icône portent les en-têtes', async ({ page, request }) => {
    const home = await page.goto('/');
    expect(home?.headers()).toMatchObject(PAGE_HEADERS);
    // Script d'entrée lu dans la réponse HTTP, pas dans le DOM : la scène 3D réelle (non bouchonnée ici) peut bloquer
    // le fil principal du rendu logiciel plus de 30 s pendant la compilation des shaders sous charge (PFC-027).
    const script = /<script type="module"[^>]* src="([^"]+)"/.exec((await home?.text()) ?? '')?.[1];
    expect(script).toMatch(/^\/assets\//);

    for (const path of ['/p/K7M2Q9XA', script ?? '', '/favicon.svg']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers(), path).toMatchObject(PAGE_HEADERS);
    }
    // Les règles elles-mêmes ne sont jamais servies : `/_headers` retombe sur la SPA.
    const rules = await request.get('/_headers');
    expect(rules.headers()['content-type']).toBe('text/html; charset=utf-8');
    expect(await rules.text()).not.toContain('Content-Security-Policy');
  });

  test('PFC-020-AC3 — scène 3D réelle sous CSP : aucune violation, aucune erreur de page', async ({ page }) => {
    const violations = await recordViolations(page);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));

    // Même ouverture que scene.spec.ts : horloge figée, splash franchi d'un bond (rendu logiciel lent).
    await freezeClock(page);
    await page.goto('/');
    await page.getByText('Invocation de l’arène…').waitFor();
    await page.locator('canvas.scene-canvas:not([data-scene="loading"])').waitFor({ state: 'attached' });
    await page.clock.fastForward(SPLASH_MIN_MS);
    await page.getByRole('button', { name: 'Jouer en local' }).waitFor();
    await expect(page.locator('canvas.scene-canvas')).toHaveAttribute('data-scene', 'ready');

    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('PFC-020-AC3 — lobby en ligne sous CSP : API et socket de même origine, aucune violation', async ({ browser }) => {
    const j1 = await player(browser);
    const j2 = await player(browser);
    const violations = [await recordViolations(j1.page), await recordViolations(j2.page)];

    const { code } = await host(j1.page);
    await join(j2.page, code);

    await expect(lobbyTitle(j1.page)).toBeVisible();
    await expect(lobbyTitle(j2.page)).toBeVisible();
    expect(violations.flat()).toEqual([]);
    expect([...j1.problems, ...j2.problems]).toEqual([]);
    await Promise.all([j1.context.close(), j2.context.close()]);
  });
});

test.describe('PFC-020-AC1 — limites par IP vues du navigateur', () => {
  test('PFC-020-S1 — 10 tentatives épuisées : la création suivante est refusée, message explicite, nouvel essai possible', async ({
    browser,
  }) => {
    const context = await isolatedContext(browser, { locale: 'fr-FR' });
    const page = await context.newPage();
    await stubScene(page);
    // Même adresse cliente que la page : 10 créations hors interface épuisent son budget.
    for (let index = 0; index < 10; index += 1) {
      expect((await context.request.post('/api/rooms')).status()).toBe(201);
    }
    await page.goto('/');
    await page.getByRole('button', { name: 'Jouer en ligne' }).click();
    const refused = page.waitForResponse((reply) => reply.url().endsWith('/api/rooms') && reply.request().method() === 'POST');

    await page.getByRole('button', { name: /^Créer une partie/ }).click();

    expect((await refused).status()).toBe(429);
    await expect(page.getByText(RATE_LIMITED_TEXT)).toBeVisible();
    await expect(page.getByRole('button', { name: /^Créer une partie/ })).toHaveAttribute('aria-disabled', 'false');
    await expect(page.locator('[data-room-code]')).toHaveCount(0);
    await context.close();
  });

  test('PFC-020-AC1 — 60 ouvertures de socket par minute : la 61e échoue avant toute room, une autre IP n’est pas touchée', async ({
    browser,
  }) => {
    const [flooder, other] = await Promise.all([isolatedContext(browser), isolatedContext(browser)]);
    const [flooding, legit] = await Promise.all([flooder.newPage(), other.newPage()]);
    for (const page of [flooding, legit]) {
      await stubScene(page);
      await page.goto('/');
    }
    /** Ouvre `count` sockets l'une après l'autre sur une room absente ; rend leurs codes de fermeture. */
    const open = (page: Page, count: number) =>
      page.evaluate(async (total) => {
        const codes: number[] = [];
        for (let index = 0; index < total; index += 1) {
          codes.push(
            await new Promise<number>((resolve) => {
              const socket = new WebSocket(`ws://${location.host}/api/rooms/ABCDEFGH/ws`);
              socket.addEventListener('close', (event) => {
                resolve(event.code);
              });
            }),
          );
        }
        return codes;
      }, count);

    const codes = await open(flooding, 61);

    // 1 à 60 : acceptées par la room, qui répond « absente » (4404). 61e : refus HTTP 429, lu 1006 par le navigateur.
    expect(new Set(codes.slice(0, 60))).toEqual(new Set([4404]));
    expect(codes[60]).toBe(1006);
    expect(await open(legit, 1)).toEqual([4404]);
    await Promise.all([flooder.close(), other.close()]);
  });
});

test.describe('PFC-020-AC3 — requête d’un autre site', () => {
  test('PFC-020-AC3 — un site tiers qui poste vers l’API : 403 sans room, budget du navigateur visé intact', async ({ browser, baseURL }) => {
    const apiOrigin = new URL(baseURL ?? '').origin;
    // Site tiers : autre origine et autre site (127.0.0.1 au lieu de localhost), page simulée sans notre CSP,
    // qui bloquerait elle-même ses requêtes. Seules ses requêtes vers l'API atteignent le vrai serveur.
    const attacker = `${apiOrigin.replace('localhost', '127.0.0.1')}/attaque`;
    const context = await isolatedContext(browser);
    const page = await context.newPage();
    await page.route(attacker, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><title>Site tiers</title>' }));
    const sent: string[] = [];
    const statuses: number[] = [];
    page.on('request', (request) => {
      if (request.url().startsWith(`${apiOrigin}/api/`)) sent.push(request.method());
    });
    page.on('response', (reply) => {
      if (reply.url().startsWith(`${apiOrigin}/api/`)) statuses.push(reply.status());
    });
    await page.goto(attacker);

    // Réponse opaque au mieux, bloquée par `Cross-Origin-Resource-Policy` sinon : le site tiers ne lit rien.
    const outcomes = await page.evaluate(async (target) => {
      const results: string[] = [];
      for (let index = 0; index < 12; index += 1) {
        results.push(
          await fetch(`${target}/api/rooms`, { method: 'POST', mode: 'no-cors', credentials: 'include' }).then(
            (response) => response.type,
            () => 'bloquée',
          ),
        );
      }
      return results;
    }, apiOrigin);

    expect(sent).toEqual(Array<string>(12).fill('POST'));
    for (const outcome of outcomes) expect(['opaque', 'bloquée']).toContain(outcome);
    // Statut lu quand le navigateur le remonte (une réponse bloquée par CORP peut ne pas l'être) : toujours 403.
    for (const status of statuses) expect(status).toBe(403);
    // Les 12 requêtes, parties de la même adresse cliente, n'ont rien consommé ni rien créé : 10 créations
    // de même origine passent encore, la 11e est limitée.
    for (let index = 0; index < 10; index += 1) {
      expect((await context.request.post(`${apiOrigin}/api/rooms`)).status()).toBe(201);
    }
    expect((await context.request.post(`${apiOrigin}/api/rooms`)).status()).toBe(429);
    await context.close();
  });
});

/** Formes de secrets qui ne doivent jamais figurer dans un fichier livré (build client et Worker). */
const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /CLOUDFLARE_API_(TOKEN|KEY)|CF_API_(TOKEN|KEY)/,
  /\bBearer [A-Za-z0-9._~+/-]{20,}/,
  /\b(api[_-]?key|client[_-]?secret|password)\s*[:=]\s*["'][^"']{8,}["']/i,
];

test.describe('PFC-020-AC3 — aucun secret dans le build livré', () => {
  test('dist/ (client, Worker, cartes de source, configuration) ne porte ni secret ni variable', () => {
    const built = readdirSync('dist', { withFileTypes: true, recursive: true })
      .filter((entry) => entry.isFile())
      .map((entry) => joinPath(entry.parentPath, entry.name))
      .filter((path) => !/\.(woff2?|png|jpe?g|webp|ico)$/.test(path));
    expect(built.length).toBeGreaterThan(3);
    for (const path of built) {
      const content = readFileSync(path, 'utf8');
      for (const pattern of SECRET_PATTERNS) expect(pattern.test(content), `${String(pattern)} dans ${path}`).toBe(false);
    }
    expect(built.some((path) => /(^|\/)\.(dev\.vars|env)/.test(path))).toBe(false);
    const worker = JSON.parse(readFileSync('dist/elem3nts/wrangler.json', 'utf8')) as { vars?: Record<string, unknown> };
    expect(worker.vars ?? {}).toEqual({});
    expect(existsSync('dist/client/_headers')).toBe(true);
  });
});
