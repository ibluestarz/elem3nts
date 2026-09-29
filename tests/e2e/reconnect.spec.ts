import { expect, test, type WebSocketRoute } from '@playwright/test';
import { hudStatus, player, startDuel, toSelection, type Player } from './online-driver.ts';

/**
 * PFC-017 — coupure, pause et reprise contre le Worker local réel (workerd) : deux contextes
 * indépendants, vraies sockets, horloge réelle du serveur (délai de reconnexion de 30 s, D15). Seule la
 * coupure réseau est provoquée (rechargement, fermeture de page, socket coupée par un routage) ; le
 * serveur décide seul de la pause, de la reprise et de la fermeture.
 */

test.setTimeout(120_000);
const GAME = { timeout: 20_000 };

const lastState = (p: Player) => p.states.at(-1);
const lost = (p: Player) => p.page.getByRole('alertdialog');

test.describe('PFC-017 — déconnexion, pause, reprise et session', () => {
  test('PFC-017-AC1 — J2 recharge pendant la sélection : pause chez J1, reprise de la même manche avec son verrou', async ({
    browser,
  }) => {
    const j1 = await player(browser);
    const j2 = await player(browser);
    await startDuel(j1, j2, 1);
    await toSelection(j2.page);
    await j2.page.keyboard.press('KeyA');
    await expect(hudStatus(j2.page, 0)).toHaveText('Choix verrouillé · Feu');
    const round = lastState(j2);

    // Rechargement : la socket se ferme, le serveur met la sélection en pause ; l'onglet reprend sa place.
    await j2.page.reload();
    await expect.poll(() => j1.states.some((state) => state.phase === 'paused' && state.resumePhase === 'selecting'), GAME).toBe(true);
    await toSelection(j2.page);
    // Même partie, même manche ; son verrou vient du serveur (l'élément choisi n'était connu que de l'onglet rechargé).
    expect(lastState(j2)).toMatchObject({ matchId: round?.matchId, roundId: round?.roundId, choiceLocked: [false, true], yourSlot: 1 });
    await expect(hudStatus(j2.page, 0)).toHaveText('Choix verrouillé');
    await expect(lost(j1)).toBeHidden(GAME);

    // La manche se résout avec le choix d'avant la coupure : feu (J2) seul, J2 gagne 1-0 (R11).
    await expect(j2.page.locator('.end__title')).toHaveText('Victoire', GAME);
    await expect(j1.page.locator('.end__title')).toHaveText('Défaite', GAME);
    expect(lastState(j1)).toMatchObject({ phase: 'match-ended', scores: [0, 1], trophies: [0, 1] });
    // La reprise d'onglet n'a jamais transmis le token dans l'URL.
    expect(j2.page.url()).not.toContain('resumeToken');
    expect(j1.problems).toEqual([]);
    await Promise.all([j1.context.close(), j2.context.close()]);
  });

  test('PFC-017-AC1 — socket coupée (réseau) : « Reconnexion… », reprise automatique, « Connexion rétablie. »', async ({ browser }) => {
    const j1 = await player(browser);
    const j2 = await player(browser);
    // Chaque socket de J2 passe par ce routage, relié au vrai serveur : le test peut couper la connexion.
    const routes: { page: WebSocketRoute; server: WebSocketRoute }[] = [];
    await j2.page.routeWebSocket(/\/api\/rooms\/[A-Z0-9]+\/ws$/, (ws) => {
      routes.push({ page: ws, server: ws.connectToServer() });
    });
    await startDuel(j1, j2, 3);
    await toSelection(j1.page);

    const current = routes.at(-1);
    await current?.server.close();
    await current?.page.close({ code: 1001, reason: 'coupure simulée' });

    // J2 voit l'écran de la maquette pendant la reprise ; J1 voit la pause publiée par le serveur.
    await expect(j2.page.getByRole('heading', { name: 'Reconnexion…' }).or(j2.page.getByText('Connexion rétablie.'))).toBeVisible();
    await expect(j2.page.getByText('Connexion rétablie.')).toBeVisible(GAME);
    await expect.poll(() => j1.states.some((state) => state.phase === 'paused'), GAME).toBe(true);
    expect(routes.length).toBeGreaterThanOrEqual(2);
    await expect(lost(j2)).toBeHidden(GAME);
    await expect(lost(j1)).toBeHidden(GAME);
    // La partie continue : même matchId, les deux joueurs connectés.
    await expect.poll(() => lastState(j1)?.connected, GAME).toEqual([true, true]);
    expect(lastState(j2)?.matchId).toBe(lastState(j1)?.matchId);
    await Promise.all([j1.context.close(), j2.context.close()]);
  });

  test('PFC-017-AC2 — J2 ne revient pas : décompte de 30 s chez J1, puis room fermée sans trophée', async ({ browser }) => {
    const j1 = await player(browser);
    const j2 = await player(browser);
    await startDuel(j1, j2, 3);
    await toSelection(j1.page);

    await j2.context.close();

    await expect(lost(j1)).toBeVisible(GAME);
    await expect(lost(j1).getByRole('heading', { name: 'Joueur 2 ne répond plus' })).toBeVisible();
    await expect(lost(j1)).toContainText('La manche est en pause.');
    await expect(lost(j1).getByRole('button', { name: 'Réessayer' })).toBeFocused();
    const count = lost(j1).locator('.lost__count');
    await expect(count).toHaveText(/^(2\d|30) s$/);

    await expect(j1.page.getByText('Partie fermée : Joueur 2 n’est pas revenu dans les 30 secondes.')).toBeVisible({ timeout: 45_000 });
    await expect(j1.page.getByRole('heading', { name: 'Choisissez' })).toBeVisible();
    const trophies = j1.states.map((state) => state.trophies);
    expect(trophies.every(([a, b]) => a === 0 && b === 0)).toBe(true);
    // La place n'est plus gardée : un rechargement ramène à l'accueil.
    await j1.page.reload();
    await expect(j1.page.getByRole('button', { name: 'Jouer en ligne' })).toBeVisible();
    expect(j1.problems).toEqual([]);
    await j1.context.close();
  });
});
