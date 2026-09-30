import { expect, test, type Browser, type Page } from '@playwright/test';
import { parseRoomEntry, parseServerMessage, type PublicState } from '../../src/shared/protocol/index.ts';
import { trophies } from '../e2e/local-driver.ts';
import { hudStatus, host, lobbyTitle, playerIn, toSelection, type Player } from '../e2e/online-driver.ts';
import { trackProblems } from '../e2e/support.ts';

/**
 * PFC-022, PFC-023 — smoke d'un Worker déployé, staging puis production (`npm run test:smoke`, cible `SMOKE_URL`).
 * En ligne : deux vrais clients, deux contextes indépendants, horloge réelle du serveur, aucune adresse usurpée ; la
 * scène 3D y est bouchonnée (`playerIn`), le smoke éprouvant l'hébergement (SPA, API, WSS, liaisons Durable Object).
 * En local : la vraie scène, chargée depuis l'environnement publié sous sa CSP.
 */

const GAME = { timeout: 20_000 };
const ELEMENT = /"(fire|water|plant)"/;

const lastState = (p: Player) => p.states.at(-1);
const endTitle = (page: Page) => page.locator('.end__title');

async function smokePlayer(browser: Browser): Promise<{ player: Player; sockets: string[] }> {
  const player = await playerIn(await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR' }));
  const sockets: string[] = [];
  player.page.on('websocket', (socket) => sockets.push(socket.url()));
  return { player, sockets };
}

/** Premier état de résultat reçu, et les trames reçues avant lui. */
function splitAtReveal(p: Player): { before: readonly string[]; reveal: PublicState | undefined } {
  const received = p.frames.filter(({ direction }) => direction === 'received').map(({ payload }) => payload);
  const index = received.findIndex((payload) => {
    const parsed = parseServerMessage(payload);
    return parsed.ok && parsed.message.type === 'state' && parsed.message.phase === 'round-result';
  });
  return { before: received.slice(0, index), reveal: p.states.find((state) => state.phase === 'round-result') };
}

test.describe('PFC-022 — smoke de l’environnement déployé', () => {
  test('PFC-022-S2 / AC2–AC3 — deux clients créent, rejoignent par lien et terminent une partie en WSS, avec reprise et revanche', async ({
    browser,
    baseURL,
  }) => {
    const origin = new URL(String(baseURL));
    const socketScheme = origin.protocol === 'https:' ? 'wss:' : 'ws:';
    const { player: j1, sockets: j1Sockets } = await smokePlayer(browser);
    const { player: j2, sockets: j2Sockets } = await smokePlayer(browser);

    // J1 crée la room (API) ; J2 ouvre le lien d'invitation : chemin profond servi par le repli SPA.
    const { code, token: hostToken } = await host(j1.page);
    const invitation = await j2.page.goto(`/p/${code}`);
    expect(invitation?.status()).toBe(200);
    expect(invitation?.headers()['content-type']).toContain('text/html');
    await expect(j2.page.getByLabel('Code reçu')).toHaveValue(`${code.slice(0, 4)}·${code.slice(4)}`);
    const joined = j2.page.waitForResponse((reply) => reply.url().endsWith(`/api/rooms/${code}/join`) && reply.request().method() === 'POST');
    await j2.page.getByRole('button', { name: 'Rejoindre', exact: true }).click();
    const guest = parseRoomEntry(await (await joined).json());
    if (!guest) throw new Error('Réponse de jonction invalide.');
    await expect(lobbyTitle(j2.page)).toBeVisible();

    // Premier à 1 point, deux confirmations : la partie s'ouvre chez les deux.
    for (let step = 3; step > 1; step -= 1) await j1.page.getByRole('button', { name: 'Diminuer le score cible' }).click();
    await expect(j2.page.getByText('Premier à 1 point')).toBeVisible();
    await j1.page.getByRole('button', { name: /^Prêt/ }).click();
    await expect(j2.page.getByRole('listitem').filter({ hasText: 'Joueur 1' })).toContainText('Prêt');
    await j2.page.getByRole('button', { name: /^Prêt/ }).click();
    for (const { page } of [j1, j2]) await expect(page.getByText('Que le duel commence')).toBeVisible(GAME);

    // J2 choisit feu, puis recharge : pause chez J1, reprise de la même manche avec son verrou (D15, PFC-017).
    await toSelection(j2.page);
    await j2.page.keyboard.press('KeyA');
    await expect(hudStatus(j2.page, 0)).toHaveText('Choix verrouillé · Feu');
    const round = lastState(j2);
    await j2.page.reload();
    await expect.poll(() => j1.states.some((state) => state.phase === 'paused'), GAME).toBe(true);
    await toSelection(j2.page);
    expect(lastState(j2)).toMatchObject({ matchId: round?.matchId, roundId: round?.roundId, choiceLocked: [false, true], yourSlot: 1 });

    // Seul J2 a choisi : J2 gagne 1-0 (R11), trophée attribué une fois.
    await expect(endTitle(j2.page)).toHaveText('Victoire', GAME);
    await expect(endTitle(j1.page)).toHaveText('Défaite', GAME);
    const ended = lastState(j1);
    expect(ended).toMatchObject({ phase: 'match-ended', scores: [0, 1], trophies: [0, 1] });
    // Aucun choix adverse chez J1 avant la révélation, sur l'infrastructure réelle.
    const { before, reveal } = splitAtReveal(j1);
    expect(before.length).toBeGreaterThan(0);
    for (const payload of before) expect(payload).not.toMatch(ELEMENT);
    expect(reveal?.revealedChoices).toEqual([null, 'fire']);

    // Revanche : deux confirmations, nouvelle partie, trophées conservés (D14).
    await j1.page.getByRole('button', { name: 'Rejouer' }).click();
    await expect(j2.page.getByRole('status').filter({ hasText: 'Joueur 1 veut rejouer.' })).toBeVisible(GAME);
    await j2.page.getByRole('button', { name: 'Rejouer' }).click();
    for (const p of [j1, j2]) await expect(p.page.getByText('Que le duel commence')).toBeVisible(GAME);
    expect(lastState(j1)).toMatchObject({ phase: 'starting', scores: [0, 0], trophies: [0, 1] });
    expect(lastState(j1)?.matchId).not.toBe(ended?.matchId);

    // Sockets de même origine en WSS ; aucun token dans une URL ni dans la console (AC2).
    const expectedSocket = `${socketScheme}//${origin.host}/api/rooms/${code}/ws`;
    expect(j1Sockets).toEqual([expectedSocket]);
    expect(j2Sockets).toEqual([expectedSocket, expectedSocket]);
    for (const secret of [hostToken, guest.resumeToken]) {
      for (const seen of [...j1Sockets, ...j2Sockets, j1.page.url(), j2.page.url(), ...j1.logs, ...j2.logs]) {
        expect(seen).not.toContain(secret);
      }
    }
    expect(j1.problems).toEqual([]);
    await Promise.all([j1.context.close(), j2.context.close()]);
  });

  test('PFC-022-AC2 — en-têtes de sécurité, API JSON et fichiers à empreinte servis par le Worker', async ({ request }) => {
    const page = await request.get('/');
    expect(page.status()).toBe(200);
    const headers = page.headers();
    expect(headers['content-security-policy']).toContain("default-src 'self'");
    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['strict-transport-security']).toContain('max-age=');

    // Route API inconnue : JSON 404, jamais la page (run_worker_first, D35).
    const unknown = await request.get('/api/inconnue');
    expect(unknown.status()).toBe(404);
    expect(unknown.headers()['content-type']).toContain('application/json');

    // Script d'entrée : fichier à empreinte, en cache un an (D46).
    const entry = /\/assets\/index-[\w-]+\.js/.exec(await page.text())?.[0];
    expect(entry).toBeDefined();
    const script = await request.get(String(entry));
    expect(script.status()).toBe(200);
    expect(script.headers()['cache-control']).toContain('immutable');
  });
});

/** Avertissement du pilote GL logiciel (rendu sans GPU du navigateur de test), sans rapport avec l'application. */
const GL_NOISE = 'GL Driver Message';

test.describe('PFC-023 — parcours local sur l’environnement déployé', () => {
  test('PFC-023-S1 — clavier partagé, vraie scène : victoire de J1, trophée de session, revanche', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'fr-FR' });
    const page = await context.newPage();
    const problems = trackProblems(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Jouer en local' }).click();
    await page.getByRole('button', { name: 'Score cible 1', exact: true }).click();
    await page.getByRole('button', { name: /^Commencer/ }).click();

    // Seul J1 choisit (feu, KeyA) : +1 pour lui (R11), X = 1 atteint, trophée de session.
    await page.locator('[data-phase="selecting"]').waitFor({ state: 'attached', timeout: GAME.timeout });
    await page.keyboard.press('KeyA');
    await expect(page.getByText('Joueur 1 remporte la partie')).toBeVisible(GAME);
    await expect(trophies(page)).toHaveText(['1', '0']);

    // Revanche : scores remis à zéro, trophées conservés (SPEC « Session et revanche »).
    await page.getByRole('button', { name: 'Rejouer' }).click();
    await expect(page.locator('.arena__score')).toHaveText(['0', '0'], GAME);
    expect(problems.filter((problem) => !problem.includes(GL_NOISE))).toEqual([]);
    await context.close();
  });
});
