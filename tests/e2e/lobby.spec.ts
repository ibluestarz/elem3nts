import { expect, test } from '@playwright/test';
import { host, join, lobbyTitle, openOnline, player } from './online-driver.ts';
import { stubScene } from './support.ts';

/**
 * PFC-015 — créer, rejoindre et lobby synchronisé, contre le Worker local réel (workerd) :
 * deux contextes de navigateur indépendants, vraies rooms et vraies sockets, aucune trame simulée.
 */

test.describe('PFC-015 — interface créer rejoindre et lobby synchronisé', () => {
  test('PFC-015-S1 — J1 puis J2 appuient sur Espace : les deux passent à la même partie', async ({ browser }) => {
    const j1 = await player(browser);
    const j2 = await player(browser, { width: 390, height: 844 });
    const { code } = await host(j1.page);
    await join(j2.page, code);

    await expect(lobbyTitle(j1.page)).toBeFocused();
    await expect(lobbyTitle(j2.page)).toBeFocused();
    await expect(j1.page.getByText('Joueur 2 a rejoint la partie.')).toBeVisible();

    await j1.page.keyboard.press('Space');
    await expect(j2.page.getByRole('listitem').filter({ hasText: 'Joueur 1' })).toContainText('Prêt');
    await expect(j1.page.getByRole('button', { name: /Prêt — en attente de Joueur 2/ })).toBeVisible();
    await j2.page.keyboard.press('Space');

    // Ouverture de la partie (D38) : l'arène et sa bannière, chez les deux joueurs (PFC-016).
    for (const { page } of [j1, j2]) {
      await expect(page.getByRole('heading', { name: 'Arène · manche 1 · premier à 3' })).toBeAttached();
      await expect(page.getByText('Que le duel commence')).toBeVisible();
    }
    const matchIds = await Promise.all([j1, j2].map(({ page }) => page.locator('.arena[data-match-id]').getAttribute('data-match-id')));
    expect(matchIds[0]).toMatch(/^m-\d+$/);
    expect(matchIds[1]).toBe(matchIds[0]);

    // Vérité serveur : les deux sockets reçoivent la même ouverture de partie.
    const starting = [j1, j2].map(({ states }) => states.find((state) => state.phase === 'starting'));
    expect(starting[0]?.matchId).toBe(matchIds[0]);
    expect(starting[1]?.matchId).toBe(matchIds[0]);
    expect(starting.map((state) => state?.yourSlot)).toEqual([0, 1]);
    expect(j1.problems).toEqual([]);
    expect(j2.problems).toEqual([]);
    await Promise.all([j1.context.close(), j2.context.close()]);
  });

  test('PFC-015-S2 / AC2 — J2 est prêt, J1 modifie X : confirmations retirées, nouveaux réglages visibles', async ({ browser }) => {
    const j1 = await player(browser);
    const j2 = await player(browser);
    const { code } = await host(j1.page);
    await join(j2.page, code);
    await expect(lobbyTitle(j2.page)).toBeVisible();

    // L'invité n'a aucun contrôle des réglages.
    await expect(j2.page.getByRole('button', { name: 'Augmenter le score cible' })).toHaveCount(0);
    await expect(j2.page.getByRole('switch', { name: 'Match nul' })).toHaveCount(0);

    await j2.page.getByRole('button', { name: /^Prêt/ }).click();
    await expect(j1.page.getByRole('listitem').filter({ hasText: 'Joueur 2' })).toContainText('Prêt');

    await j1.page.getByRole('button', { name: 'Augmenter le score cible' }).click();
    await j1.page.getByRole('button', { name: 'Augmenter le score cible' }).click();
    await j1.page.getByRole('switch', { name: 'Match nul' }).click();

    await expect(j2.page.getByText('Premier à 5 points')).toBeVisible();
    await expect(j2.page.getByText('Désactivé', { exact: true })).toBeVisible();
    await expect(j2.page.getByText('Joueur 1 a modifié les réglages : confirmez à nouveau.')).toBeVisible();
    for (const { page } of [j1, j2]) await expect(page.getByText('Pas encore prêt')).toHaveCount(2);
    await expect(j2.page.getByRole('button', { name: /^Prêt/ })).toHaveAttribute('aria-disabled', 'false');

    // Vérité serveur : réglages publiés aux deux, plus aucune confirmation.
    await expect.poll(() => j2.states.at(-1)?.settings).toEqual({ target: 5, drawEnabled: false });
    expect(j2.states.at(-1)?.ready).toEqual([false, false]);
    expect(j2.problems).toEqual([]);
    await Promise.all([j1.context.close(), j2.context.close()]);
  });

  test('PFC-015-AC1 — le lien copié ne contient que le code ; le token n’apparaît nulle part hors de la reprise de l’onglet', async ({ browser, browserName }) => {
    // Chromium : vrai presse-papier (lecture accordable) ; Firefox et WebKit : copie observée à l'appel.
    const j1 = await player(browser, undefined, browserName === 'chromium');
    const logs: string[] = [];
    j1.page.on('console', (message) => logs.push(message.text()));
    const { code, token } = await host(j1.page);

    await j1.page.getByRole('button', { name: 'Copier le lien d’invitation' }).click();
    await expect(j1.page.getByRole('button', { name: 'Lien copié' })).toBeVisible();
    const origin = new URL(j1.page.url()).origin;
    expect(await j1.copied()).toEqual([`${origin}/p/${code}`]);

    expect(j1.page.url()).not.toContain(token);
    expect(await j1.page.content()).not.toContain(token);
    // PFC-017 (D42) : le token n'est gardé que par l'onglet, sous sa seule entrée de reprise en sessionStorage ;
    // jamais en localStorage (persistant, partagé entre onglets) ni sous une autre clé.
    const storage = await j1.page.evaluate(() => ({
      local: Object.entries(localStorage).map(([key, value]): [string, string] => [key, String(value)]),
      session: Object.entries(sessionStorage).map(([key, value]): [string, string] => [key, String(value)]),
    }));
    expect(JSON.stringify(storage.local)).not.toContain(token);
    expect(storage.session.filter(([, value]) => value.includes(token))).toEqual([
      ['elem3nts.room.v1', JSON.stringify({ roomCode: code, slot: 0, resumeToken: token })],
    ]);
    expect(logs.join('\n')).not.toContain(token);

    // Le lien ouvre la saisie préremplie chez l'invité, puis l'adresse d'invitation disparaît.
    const j2 = await player(browser);
    await j2.page.goto(`/p/${code}`);
    await expect(j2.page.getByLabel('Code reçu')).toHaveValue(`${code.slice(0, 4)}·${code.slice(4)}`);
    expect(new URL(j2.page.url()).pathname).toBe('/');
    await j2.page.getByRole('button', { name: 'Rejoindre', exact: true }).click();
    await expect(lobbyTitle(j2.page)).toBeVisible();
    await Promise.all([j1.context.close(), j2.context.close()]);
  });

  test('PFC-015-AC3 — presse-papier refusé : repli explicite avec le lien sélectionné', async ({ browser }) => {
    const context = await browser.newContext({ locale: 'fr-FR' });
    const page = await context.newPage();
    await stubScene(page);
    await page.addInitScript(() => {
      const clipboard = navigator.clipboard as Clipboard | undefined;
      if (clipboard) {
        Object.defineProperty(clipboard, 'writeText', {
          configurable: true,
          value: () => Promise.reject(new DOMException('Refusé', 'NotAllowedError')),
        });
      }
    });
    const { code } = await host(page);

    await page.getByRole('button', { name: 'Copier le lien d’invitation' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'Copie automatique impossible' })).toBeVisible();
    const field = page.getByRole('textbox', { name: 'Lien d’invitation' });
    await expect(field).toHaveValue(new RegExp(`/p/${code}$`));
    const selected = await field.evaluate((input: HTMLInputElement) => input.value.slice(input.selectionStart ?? 0, input.selectionEnd ?? 0));
    expect(selected).toBe(await field.inputValue());
    await context.close();
  });

  test('PFC-015-AC3 — double clic sur « Créer une partie » : une seule room créée', async ({ browser }) => {
    const j1 = await player(browser);
    const creations: string[] = [];
    j1.page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().endsWith('/api/rooms')) creations.push(request.url());
    });
    await openOnline(j1.page);

    await j1.page.getByRole('button', { name: /^Créer une partie/ }).dblclick();

    await expect(j1.page.getByText('En attente d’un adversaire')).toBeVisible();
    expect(creations).toHaveLength(1);
    await j1.context.close();
  });

  test('PFC-015-AC3 — room pleine, room absente, code invalide : erreurs explicites', async ({ browser }) => {
    const j1 = await player(browser);
    const j2 = await player(browser);
    const j3 = await player(browser);
    const { code } = await host(j1.page);
    await join(j2.page, code);
    await expect(lobbyTitle(j2.page)).toBeVisible();

    await join(j3.page, code);
    await expect(j3.page.getByRole('alert')).toHaveText('Cette partie est déjà complète.');
    await expect(j3.page.getByLabel('Code reçu')).toBeFocused();

    // Code bien formé mais jamais émis : même réponse qu'une room expirée (aucun oracle).
    const absent = code === 'ABCDEFGH' ? 'HGFEDCBA' : 'ABCDEFGH';
    await j3.page.getByLabel('Code reçu').fill(absent);
    await j3.page.getByRole('button', { name: 'Rejoindre', exact: true }).click();
    await expect(j3.page.getByRole('alert')).toHaveText('Cette partie n’existe pas ou n’est plus disponible.');

    await j3.page.getByLabel('Code reçu').fill('K7M2Q9X0');
    await j3.page.getByRole('button', { name: 'Rejoindre', exact: true }).click();
    await expect(j3.page.getByRole('alert')).toHaveText('Caractère invalide : un code ne contient ni I, ni O, ni 0, ni 1.');
    await Promise.all([j1.context.close(), j2.context.close(), j3.context.close()]);
  });

  test('PFC-015-AC3 — réseau coupé : création et connexion signalées', async ({ browser }) => {
    const j1 = await player(browser);
    await openOnline(j1.page);
    await j1.page.route('**/api/rooms**', (route) => route.abort('internetdisconnected'));

    await j1.page.getByRole('button', { name: /^Créer une partie/ }).click();
    await expect(j1.page.getByText('Connexion impossible : vérifiez votre réseau puis réessayez.')).toBeVisible();
    await expect(j1.page.getByRole('button', { name: /^Créer une partie/ })).toHaveAttribute('aria-disabled', 'false');

    await j1.page.getByRole('button', { name: /^Rejoindre une partie/ }).click();
    await j1.page.getByLabel('Code reçu').fill('K7M2Q9XA');
    await j1.page.getByRole('button', { name: 'Rejoindre', exact: true }).click();
    await expect(j1.page.getByRole('alert')).toHaveText('Connexion impossible : vérifiez votre réseau puis réessayez.');
    await j1.context.close();
  });

  test('PFC-015 — J1 quitte le lobby : la room se ferme, J2 est prévenu', async ({ browser }) => {
    const j1 = await player(browser);
    const j2 = await player(browser);
    const { code } = await host(j1.page);
    await join(j2.page, code);
    await expect(lobbyTitle(j1.page)).toBeVisible();

    await j1.page.getByRole('button', { name: 'Quitter' }).click();

    await expect(j1.page.getByRole('heading', { name: 'Choisissez' })).toBeVisible();
    await expect(j2.page.getByText('Joueur 1 a quitté la partie.')).toBeVisible();
    await expect(j2.page.getByRole('heading', { name: 'Choisissez' })).toBeVisible();

    // La room est effacée : son code n'ouvre plus rien.
    await join(j2.page, code);
    await expect(j2.page.getByRole('alert')).toHaveText('Cette partie n’existe pas ou n’est plus disponible.');
    await Promise.all([j1.context.close(), j2.context.close()]);
  });
});
