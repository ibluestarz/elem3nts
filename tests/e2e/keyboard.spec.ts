import { expect, test, type Page } from '@playwright/test';
import { emulateAzertyLayout, trackProblems, stubScene } from './support.ts';

const ELEMENT_WORDS = /feu|eau|plante|fire|water|plant/i;

async function toSelection(page: Page): Promise<string[]> {
  const problems = trackProblems(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Jouer en local' }).click();
  await page.getByRole('button', { name: /^Commencer/ }).click();
  // Bannière 1,8 s puis sélection 0,4 s plus tard (maquette).
  await expect(page.locator('.arena__status').first()).toHaveText(/Choix en cours…/);
  return problems;
}

const status = (page: Page, player: 0 | 1) => page.locator('.arena__status').nth(player);

/** HTML de l'arène hors légendes des touches : aucun élément ne doit y figurer avant la révélation. */
const arenaWithoutLegends = (page: Page) =>
  page.locator('main').evaluate((main) => {
    const copy = main.cloneNode(true) as HTMLElement;
    // Légendes des touches et étiquettes de la trinité : libellés fixes, jamais des choix.
    for (const label of copy.querySelectorAll('.arena__legend, .arena__trin')) label.remove();
    return copy.innerHTML;
  });

test.describe('PFC-005 — clavier partagé et choix masqués', () => {
  test.beforeEach(async ({ page }) => {
    await stubScene(page);
  });

  test('PFC-005-S1 — J1 KeyA puis J2 KeyL : verrous visibles, éléments absents du DOM', async ({ page }) => {
    const problems = await toSelection(page);

    await page.keyboard.press('KeyA');
    await expect(status(page, 0)).toHaveText(/Choix verrouillé/);
    await expect(status(page, 1)).toHaveText(/Choix en cours…/);
    await page.keyboard.press('KeyL');
    await expect(status(page, 1)).toHaveText(/Choix verrouillé/);

    for (const player of [0, 1] as const) expect(await status(page, player).innerHTML()).not.toMatch(ELEMENT_WORDS);
    expect(await arenaWithoutLegends(page)).not.toMatch(ELEMENT_WORDS);
    expect(problems).toEqual([]);
  });

  test('PFC-005-S2 — une deuxième touche de J1 ne change rien et ne révèle rien', async ({ page }) => {
    await toSelection(page);

    await page.keyboard.press('KeyA');
    await expect(status(page, 0)).toHaveText(/Choix verrouillé/);
    const locked = await status(page, 0).innerHTML();
    await page.keyboard.press('KeyS');
    await page.keyboard.press('KeyD');

    expect(await status(page, 0).innerHTML()).toBe(locked);
    await expect(status(page, 1)).toHaveText(/Choix en cours…/);
    expect(await arenaWithoutLegends(page)).not.toMatch(ELEMENT_WORDS);
  });

  test('PFC-005-AC2 — touche maintenue : un seul verrou, sans effet sur l’autre joueur', async ({ page }) => {
    await toSelection(page);

    await page.keyboard.down('KeyJ');
    await page.keyboard.down('KeyJ');
    await page.keyboard.up('KeyJ');

    await expect(status(page, 1)).toHaveText(/Choix verrouillé/);
    await expect(status(page, 0)).toHaveText(/Choix en cours…/);
  });

  test('PFC-005-AC3 — Espace maintenu à la préparation ne lance qu’une partie', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Jouer en local' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(page.getByRole('heading', { name: 'Préparer le duel' })).toBeFocused();

    await page.keyboard.down('Space');
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await expect(page.getByText('Que le duel commence')).toBeVisible();
    await expect(page.locator('.arena__status').first()).toHaveText(/Choix en cours…/);
    await page.keyboard.press('KeyA');
    await page.keyboard.press('Space');
    // Espace en arène ne relance rien : le verrou et la manche restent.
    await expect(status(page, 0)).toHaveText(/Choix verrouillé/);
    await expect(page.getByText('Manche 1 · premier à 3', { exact: true })).toBeVisible();
  });

  test('PFC-005 — sans disposition fournie : choix AZERTY/QWERTY, libellés corrigés', async ({ page }) => {
    // Aucun des trois moteurs de test ne fournit de disposition exploitable (Chromium : table vide).
    await page.goto('/');
    await page.getByRole('button', { name: 'Réglages' }).click();
    const selector = page.getByRole('group', { name: 'Disposition affichée' });
    await expect(page.getByRole('button', { name: 'Joueur 1, Feu : Q' })).toBeVisible();

    await selector.getByRole('button', { name: 'QWERTY' }).click();
    await expect(selector.getByRole('button', { name: 'QWERTY' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('dialog')).toContainText('Libellés des touches affichés en QWERTY.');
    await page.getByRole('button', { name: 'Fermer' }).click();
    await page.getByRole('button', { name: 'Jouer en local' }).click();
    await expect(page.getByRole('list', { name: 'Touches de Joueur 1' })).toHaveText('AFeuSEauDPlante');
  });

  test('PFC-005 — disposition fournie par le navigateur : libellés réels, aucun choix proposé', async ({ page }) => {
    await emulateAzertyLayout(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Réglages' }).click();

    await expect(page.getByRole('button', { name: 'Joueur 1, Feu : Q' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Disposition affichée' })).toHaveCount(0);
  });

  test('PFC-005 — une frappe réelle corrige le libellé affiché de la touche', async ({ page }) => {
    await toSelection(page);
    const legend = page.getByRole('list', { name: 'Touches de Joueur 1' });
    await expect(legend).toHaveText('QFeuSEauDPlante');

    // Clavier de test QWERTY : KeyA produit « a ».
    await page.keyboard.press('KeyA');
    await expect(legend).toHaveText('AFeuSEauDPlante');
  });

  test('PFC-005 — du téléphone au bureau avant l’ouverture de la manche : sélection au clavier (D47)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Touchez pour jouer' }).click();
    await page.getByRole('button', { name: /^Commencer/ }).click();
    await expect(page.getByText('Que le duel commence')).toBeVisible();

    // Le mode se décide à l'ouverture de la manche (D47) : au bureau à cet instant, elle est simultanée.
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('.arena__status').first()).toHaveText(/Choix en cours…/);
    await page.keyboard.press('KeyD');
    await expect(status(page, 0)).toHaveText(/Choix verrouillé/);
  });
});
