import { expect, test, type Page } from '@playwright/test';
import { openFrozen, stubScene, trackProblems } from './support.ts';
import { CYCLE, clashDelays } from './timing.ts';

const status = (page: Page, player: 0 | 1) => page.locator('.arena__status').nth(player);
const score = (page: Page, player: 0 | 1) => page.locator('.arena__score').nth(player);

/** Horloge figée, avancée phase par phase : chaque échéance est observée, sans attente arbitraire. */
async function toSelection(page: Page, target: number): Promise<string[]> {
  const problems = trackProblems(page);
  await openFrozen(page);
  await page.getByRole('button', { name: 'Jouer en local' }).click();
  await page.getByRole('button', { name: `Score cible ${String(target)}`, exact: true }).click();
  await page.getByRole('button', { name: /^Commencer/ }).click();
  // Chaque échéance est posée dans le rendu de sa phase : attendre ce rendu avant d'avancer l'horloge.
  await expect(page.getByText('Que le duel commence')).toBeVisible();
  await page.clock.runFor(1800);
  await expect(page.getByText('Que le duel commence')).toHaveCount(0);
  await page.clock.runFor(400);
  await expect(status(page, 0)).toHaveText('Choix en cours…');
  return problems;
}

test.describe('PFC-006 — cycle local', () => {
  test.beforeEach(async ({ page }) => {
    await stubScene(page);
  });

  test('PFC-006-S1 — choix à t=1000, révélation à 5000 seulement, résultat puis manche 2', async ({ page }) => {
    const problems = await toSelection(page, 3);

    await page.clock.runFor(1000);
    await page.keyboard.press('KeyA');
    await page.keyboard.press('KeyL');
    await expect(status(page, 1)).toHaveText('Choix verrouillé');

    await page.clock.runFor(3999);
    await expect(page.getByRole('timer', { includeHidden: true })).toHaveText('1');
    await expect(status(page, 0)).toHaveText('Choix verrouillé');

    await page.clock.runFor(1);
    await expect(status(page, 0)).toHaveText('Feu');
    await expect(status(page, 1)).toHaveText('Plante');
    await expect(score(page, 0)).toHaveText('0');

    // Début de l'effet : éléments et scores d'avant encore affichés, puis impact de « burn ».
    await page.clock.runFor(CYCLE.reveal);
    await expect(page.locator('[data-phase="clash"]')).toBeAttached();
    await expect(score(page, 0)).toHaveText('0');
    await page.clock.runFor(clashDelays('burn').toImpact);
    await expect(page.locator('.arena__banner')).toContainText('Le Feu consume la Plante');
    await expect(score(page, 0)).toHaveText('1');
    await expect(page.locator('.arena__delta').first()).toHaveText('+1');
    await expect(page.getByText('Joueur 1 : Feu, Joueur 2 : Plante.', { exact: false })).toBeAttached();

    await page.clock.runFor(clashDelays('burn').afterImpact);
    await expect(page.locator('.arena__banner')).toHaveClass(/arena__banner--hidden/);
    await page.clock.runFor(CYCLE.pause);
    await expect(page.getByText('Manche 2 · premier à 3', { exact: true })).toBeVisible();
    await expect(status(page, 0)).toHaveText('Choix en cours…');
    expect(problems).toEqual([]);
  });

  test('PFC-006-S2 — seul J1 choisit : un point pour Joueur 1 (R11)', async ({ page }) => {
    await toSelection(page, 3);
    await page.keyboard.press('KeyD');

    await page.clock.runFor(5000);
    await expect(status(page, 1)).toHaveText('Aucun choix');
    await page.clock.runFor(CYCLE.reveal);
    await expect(page.locator('[data-phase="clash"]')).toBeAttached();
    await page.clock.runFor(clashDelays('solo').toImpact);
    await expect(page.locator('.arena__banner')).toContainText('Seul choix de la manche : point pour Joueur 1');
    await expect(score(page, 0)).toHaveText('1');
  });

  test('PFC-006 — fin de partie : écran de la maquette, Échap vers l’accueil', async ({ page }) => {
    const problems = await toSelection(page, 1);
    await page.keyboard.press('KeyA');
    await page.keyboard.press('KeyL');

    await page.clock.runFor(5000);
    await expect(status(page, 0)).toHaveText('Feu');
    await page.clock.runFor(CYCLE.reveal);
    await expect(page.locator('[data-phase="clash"]')).toBeAttached();
    await page.clock.runFor(clashDelays('burn').toImpact);
    await expect(score(page, 0)).toHaveText('1');
    await page.clock.runFor(clashDelays('burn').afterImpact);
    await expect(page.locator('.arena__banner')).toHaveClass(/arena__banner--hidden/);
    await expect(page.getByText('Fin de partie')).toHaveCount(0);
    await page.clock.runFor(CYCLE.closing);

    await expect(page.getByRole('heading', { name: 'Victoire' })).toBeFocused();
    await expect(page.getByText('Joueur 1 remporte la partie')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Jouer en local' })).toBeFocused();
    expect(problems).toEqual([]);
  });
});
