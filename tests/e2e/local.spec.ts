import { expect, test, type Locator, type Page } from '@playwright/test';
import { KEYS, banner, playRound, scores, status, toSelection, trophies } from './local-driver.ts';
import { openFrozen, stubScene, trackProblems } from './support.ts';
import { CYCLE, clashDelays } from './timing.ts';

/**
 * Recette locale (PFC-009) : parcours complets au vrai clavier, sur le build de production, dans
 * les trois navigateurs. Les briques unitaires restent prouvées par les suites PFC-004 à PFC-007 ;
 * ici, elles sont enchaînées comme un joueur les enchaîne.
 */

const { p1, p2 } = KEYS;
const setupHeading = (page: Page) => page.getByRole('heading', { name: 'Préparer le duel' });
const targetInput = (page: Page) => page.getByRole('spinbutton', { name: 'Score cible' });
const arenaHeading = (page: Page, round: number, target: number) =>
  page.getByRole('heading', { name: `Arène · manche ${String(round)} · premier à ${String(target)}` });
const roundLabel = (page: Page) => page.locator('.arena__round');
const endScores = (page: Page) => page.getByRole('group', { name: 'Score final' }).locator('.end__score');
const trophyGroup = (page: Page) => page.getByRole('group', { name: 'Trophées de la session' });

/** Avance au clavier (Tab) jusqu'à la cible : l'ordre de tabulation réel est parcouru, borné. */
async function tabTo(page: Page, target: Locator, max = 20): Promise<void> {
  for (let presses = 0; presses < max; presses++) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}

/** Accueil → préparation (Espace) → X (Début/Fin du champ) → Réglages → nul OFF → retour au titre. */
async function prepareByKeyboard(page: Page, bound: 'Home' | 'End'): Promise<void> {
  await expect(page.getByRole('button', { name: 'Jouer en local' })).toBeVisible();
  await page.keyboard.press('Space');
  await expect(setupHeading(page)).toBeFocused();

  await tabTo(page, targetInput(page));
  await page.keyboard.press(bound);
  const target = bound === 'Home' ? 1 : 10;
  await expect(targetInput(page)).toHaveValue(String(target));
  // Bornes : le pas qui sortirait de 1–10 est indisponible.
  const blocked = bound === 'Home' ? 'Diminuer le score cible' : 'Augmenter le score cible';
  await expect(page.getByRole('button', { name: blocked })).toHaveAttribute('aria-disabled', 'true');

  await tabTo(page, page.getByRole('button', { name: 'Modifier les touches' }));
  await page.keyboard.press('Enter');
  const drawer = page.getByRole('dialog', { name: 'Réglages' });
  await expect(drawer).toBeVisible();
  const draw = drawer.getByRole('switch', { name: 'Match nul' });
  await tabTo(page, draw);
  await page.keyboard.press('Space');
  await expect(draw).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(setupHeading(page)).toBeFocused();
  await expect(page.getByText(`Premier à ${String(target)} point`)).toBeVisible();

  await page.keyboard.press('Space');
  await expect(arenaHeading(page, 1, target)).toBeFocused();
}

test.describe('PFC-009 — recette locale', () => {
  test.beforeEach(async ({ page }) => {
    await stubScene(page);
  });

  test('PFC-009-S1 / AC1 — clavier seul, X = 1, nul OFF : victoire J1, revanche qui garde son trophée', async ({ page }) => {
    const problems = trackProblems(page);
    await openFrozen(page);
    await prepareByKeyboard(page, 'Home');
    await toSelection(page);

    // Choix verrouillés, puis révélation à l'échéance seulement.
    await page.keyboard.press(p1.fire);
    await page.keyboard.press(p2.plant);
    await expect(status(page, 0)).toHaveText('Choix verrouillé');
    await expect(status(page, 1)).toHaveText('Choix verrouillé');
    await page.clock.runFor(CYCLE.selection);
    await expect(status(page, 0)).toHaveText('Feu');
    await expect(status(page, 1)).toHaveText('Plante');
    await page.clock.runFor(CYCLE.reveal);
    await expect(page.locator('[data-phase="clash"]')).toBeAttached();
    await page.clock.runFor(clashDelays('burn').toImpact);
    await expect(banner(page)).toContainText('Le Feu consume la Plante');
    await expect(scores(page)).toHaveText(['1', '0']);
    await page.clock.runFor(clashDelays('burn').afterImpact);
    await expect(banner(page)).toHaveClass(/arena__banner--hidden/);
    await page.clock.runFor(CYCLE.closing);

    await expect(page.getByRole('heading', { name: 'Victoire' })).toBeFocused();
    await expect(page.getByText('Joueur 1 remporte la partie')).toBeVisible();
    await expect(endScores(page)).toHaveText(['1', '0']);
    await expect(trophies(page)).toHaveText(['1', '0']);

    // Revanche à l'Espace : mêmes réglages exacts (X = 1, nul OFF), scores remis à zéro.
    await page.keyboard.press('Space');
    await expect(arenaHeading(page, 1, 1)).toBeFocused();
    await expect(scores(page)).toHaveText(['0', '0']);
    await toSelection(page);
    // Feu + Feu à 0/0 : nul OFF → mort subite (nul ON aurait terminé la partie).
    await playRound(page, [p1.fire, p2.fire], 'flare', 'sudden');
    await expect(scores(page)).toHaveText(['1', '1']);
    await expect(roundLabel(page)).toHaveText('Manche 2 · premier à 1 · mort subite');
    await playRound(page, [p1.fire, p2.water], 'wave', 'end');

    await expect(page.getByText('Joueur 2 remporte la partie')).toBeVisible();
    await expect(endScores(page)).toHaveText(['1', '2']);
    // Le trophée de J1 est conservé ; un seul trophée de plus, pour J2.
    await expect(trophies(page)).toHaveText(['1', '1']);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Jouer en local' })).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('PFC-009-S2 — X = 1, nul OFF, 0/0, Feu + Feu : la partie continue à 1/1 sans trophée', async ({ page }) => {
    const problems = trackProblems(page);
    await openFrozen(page);
    await prepareByKeyboard(page, 'Home');
    await toSelection(page);

    await playRound(page, [p1.fire, p2.fire], 'flare', 'sudden');

    await expect(scores(page)).toHaveText(['1', '1']);
    await expect(page.getByText('Fin de partie')).toHaveCount(0);
    await expect(trophyGroup(page)).toHaveCount(0);
    await expect(roundLabel(page)).toHaveText('Manche 2 · premier à 1 · mort subite');

    // La manche suivante tranche : un seul trophée, attribué au seul gagnant.
    await playRound(page, [p1.fire, p2.water], 'wave', 'end');
    await expect(page.getByRole('heading', { name: 'Victoire' })).toBeFocused();
    await expect(page.getByText('Joueur 2 remporte la partie')).toBeVisible();
    await expect(endScores(page)).toHaveText(['1', '2']);
    await expect(trophies(page)).toHaveText(['0', '1']);

    // Focus clavier de l'écran de fin : Rejouer, puis Retour à l'accueil.
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Rejouer' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Retour à l’accueil' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Jouer en local' })).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('PFC-009-AC2 — borne X = 10, nul OFF : 9/9 continue, 10/10 mort subite, 11/10 victoire', async ({ page }) => {
    const problems = trackProblems(page);
    await openFrozen(page);
    await prepareByKeyboard(page, 'End');
    await toSelection(page);

    // Exemple chiffré de la SPEC : X = 10, nul OFF, 9/9, feu/feu → 10/10, continuer.
    for (let round = 1; round <= 9; round++) {
      await playRound(page, [p1.fire, p2.fire], 'flare', 'next');
      await expect(scores(page)).toHaveText([String(round), String(round)]);
      await expect(roundLabel(page)).toHaveText(`Manche ${String(round + 1)} · premier à 10`);
    }
    await playRound(page, [p1.fire, p2.fire], 'flare', 'sudden');
    await expect(scores(page)).toHaveText(['10', '10']);
    await expect(roundLabel(page)).toHaveText('Manche 11 · premier à 10 · mort subite');
    await expect(trophyGroup(page)).toHaveCount(0);

    await playRound(page, [p1.fire, p2.plant], 'burn', 'end');
    await expect(page.getByRole('heading', { name: 'Victoire' })).toBeFocused();
    await expect(page.getByText('Joueur 1 remporte la partie')).toBeVisible();
    await expect(endScores(page)).toHaveText(['11', '10']);
    await expect(trophies(page)).toHaveText(['1', '0']);
    expect(problems).toEqual([]);
  });

  test('PFC-009-AC2 — une touche frappée après la fenêtre de choix est ignorée', async ({ page }) => {
    const problems = trackProblems(page);
    await openFrozen(page);
    await page.getByRole('button', { name: 'Jouer en local' }).click();
    await page.getByRole('button', { name: /^Commencer/ }).click();
    await toSelection(page);

    await page.keyboard.press(p1.water);
    await page.clock.runFor(CYCLE.selection);
    await expect(status(page, 1)).toHaveText('Aucun choix');
    // Révélation en cours : la frappe tardive de J2 ne verrouille ni ne remplace rien.
    await page.keyboard.press(p2.plant);
    await expect(status(page, 1)).toHaveText('Aucun choix');
    await page.clock.runFor(CYCLE.reveal);
    await expect(page.locator('[data-phase="clash"]')).toBeAttached();
    await page.keyboard.press(p2.fire);
    await page.clock.runFor(clashDelays('solo').toImpact);
    await expect(banner(page)).toContainText('Seul choix de la manche : point pour Joueur 1');
    await expect(scores(page)).toHaveText(['1', '0']);
    expect(problems).toEqual([]);
  });

  test('PFC-009-AC3 — la recette porte sur le build de production', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('main', { name: 'ELEM3NTS' })).toBeAttached();
    // Serveur de développement (ou preview périmé d'un autre mode) : client Vite injecté, sources non hachées.
    await expect(page.locator('script[src*="@vite/client"]')).toHaveCount(0);
    await expect(page.locator('script[type="module"][src^="/src/"]')).toHaveCount(0);
    const entry = await page.locator('script[type="module"][src]').getAttribute('src');
    expect(entry).toMatch(/^\/assets\/index-[\w-]{8,}\.js$/);
  });
});
