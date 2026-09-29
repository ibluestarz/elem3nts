import { expect, test, type Page } from '@playwright/test';
import { trackProblems, stubScene } from './support.ts';

async function openHome(page: Page): Promise<string[]> {
  const problems = trackProblems(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Jouer en local' })).toBeVisible();
  return problems;
}

const targetInput = (page: Page) => page.getByRole('spinbutton', { name: 'Score cible' });
const startButton = (page: Page) => page.getByRole('button', { name: /^Commencer/ });

test.describe('PFC-004 — accueil, règles et réglages', () => {
  test.beforeEach(async ({ page }) => {
    await stubScene(page);
  });

  test('PFC-004-S1 / AC2 — parcours au clavier seul : X = 10, nul OFF, lancement', async ({ page }) => {
    const problems = await openHome(page);

    await page.keyboard.press('Space');
    await expect(page.getByRole('heading', { name: 'Préparer le duel' })).toBeFocused();

    // Tab jusqu'au champ du score cible (après « − »).
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Diminuer le score cible' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(targetInput(page)).toBeFocused();
    await page.keyboard.press('End');
    await expect(targetInput(page)).toHaveValue('10');
    await expect(page.getByText('Premier à 10 points')).toBeVisible();

    // Tiroir Réglages au clavier : nul OFF.
    await page.getByRole('button', { name: 'Modifier les touches' }).focus();
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Réglages' });
    await expect(drawer).toBeVisible();
    const draw = drawer.getByRole('switch', { name: 'Match nul' });
    await draw.focus();
    await page.keyboard.press('Space');
    await expect(draw).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');

    // Focus rendu au bouton d'origine (PFC-021) ; Espace hors bouton lance la partie.
    await expect(page.getByRole('button', { name: 'Modifier les touches' })).toBeFocused();
    await expect(page.getByText('Premier à 10 points')).toBeVisible();
    await page.getByRole('heading', { name: 'Préparer le duel' }).focus();
    await page.keyboard.press('Space');

    await expect(page.getByText('Que le duel commence')).toBeVisible();
    await expect(page.getByText('Premier à 10 points')).toBeVisible();
    // AC3 : aucune commande de réglage dans l'arène.
    await expect(page.getByRole('spinbutton')).toHaveCount(0);
    await expect(page.getByRole('switch')).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Jouer en local' })).toBeFocused();
    await expect(page.getByRole('status')).toHaveText(/Partie annulée : aucun trophée attribué\./);

    // Le nul OFF est mémorisé pour la prochaine partie, y compris après rechargement.
    await page.reload();
    await page.getByRole('button', { name: 'Réglages' }).click();
    await expect(page.getByRole('switch', { name: 'Match nul' })).toHaveAttribute('aria-checked', 'false');
    expect(problems).toEqual([]);
  });

  test('PFC-004-S2 — X = 11 : erreur affichée et lancement indisponible', async ({ page }) => {
    const problems = await openHome(page);
    await page.getByRole('button', { name: 'Jouer en local' }).click();

    await targetInput(page).fill('11');

    await expect(page.getByRole('alert')).toHaveText('Le score cible doit être compris entre 1 et 10.');
    await expect(targetInput(page)).toHaveAttribute('aria-invalid', 'true');
    await expect(startButton(page)).toHaveAttribute('aria-disabled', 'true');
    // Un joueur peut cliquer un bouton `aria-disabled` : Playwright le refuse, d'où `force`.
    await startButton(page).click({ force: true });
    await expect(targetInput(page)).toBeFocused();
    await expect(page.getByText('Que le duel commence')).toHaveCount(0);

    await page.getByRole('heading', { name: 'Préparer le duel' }).focus();
    await page.keyboard.press('Space');
    await expect(page.getByText('Que le duel commence')).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('PFC-004-AC1 — bornes : 1 et 10 acceptés ; 0, vide, décimal et texte refusés', async ({ page }) => {
    await openHome(page);
    await page.getByRole('button', { name: 'Jouer en local' }).click();

    for (const [value, message] of [
      ['0', 'Le score cible doit être compris entre 1 et 10.'],
      ['', 'Indiquez un score cible entre 1 et 10.'],
      ['2.5', 'Le score cible doit être un nombre entier, de 1 à 10.'],
      ['abc', 'Saisissez un nombre entier entre 1 et 10.'],
    ] as const) {
      await targetInput(page).fill(value);
      await expect(page.getByRole('alert')).toHaveText(message);
      await expect(startButton(page)).toHaveAttribute('aria-disabled', 'true');
    }
    for (const value of ['1', '10']) {
      await targetInput(page).fill(value);
      await expect(page.getByRole('alert')).toHaveCount(0);
      await expect(startButton(page)).toHaveAttribute('aria-disabled', 'false');
    }
  });

  test('PFC-004 — Espace sur un bouton ciblé ne déclenche pas en plus le raccourci global', async ({ page }) => {
    await openHome(page);

    await page.getByRole('button', { name: 'Démo des confrontations' }).focus();
    await page.keyboard.press('Space');

    await expect(page.getByRole('status')).toHaveText(/La démo des confrontations arrive bientôt\./);
    await expect(page.getByRole('heading', { name: 'Préparer le duel' })).toHaveCount(0);
  });

  test('PFC-004-AC2 — règles : dialogue modal, focus piégé puis restitué', async ({ page }) => {
    await openHome(page);
    await page.getByRole('button', { name: 'Règles du jeu' }).click();

    const dialog = page.getByRole('dialog', { name: 'Règles du jeu' });
    await expect(dialog).toContainText('Feu + Feu');
    await expect(dialog).toContainText('Les deux joueurs perdent 1 point.');
    for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
    await expect(dialog.locator(':focus')).toHaveCount(1);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Règles du jeu' })).toBeFocused();
  });

  test('PFC-004 — réaffectation d’une touche mémorisée et visible dans la préparation', async ({ page }) => {
    await openHome(page);
    await page.getByRole('button', { name: 'Réglages' }).click();

    await page.getByRole('button', { name: /^Joueur 1, Feu : / }).click();
    await page.keyboard.press('KeyF');
    await expect(page.getByRole('button', { name: 'Joueur 1, Feu : F' })).toBeVisible();

    await page.reload();
    await page.getByRole('button', { name: 'Jouer en local' }).click();
    await expect(page.getByRole('list', { name: 'Touches de Joueur 1' })).toContainText('F');
  });

  test('PFC-004 — mouvements réduits appliqués et mémorisés', async ({ page }) => {
    await openHome(page);
    await page.getByRole('button', { name: 'Réglages' }).click();
    await page.getByRole('switch', { name: 'Mouvements réduits' }).click();

    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Jouer en local' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
    await expect(page.getByText('pour jouer en local')).toHaveCSS('opacity', '1');
  });

  test('PFC-004 — téléphone : bouton tactile et préparation tour par tour', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const problems = await openHome(page);

    await expect(page.getByText('Appuyez sur')).toHaveCount(0);
    await page.getByRole('button', { name: 'Touchez pour jouer' }).click();

    await expect(page.getByText(/Sur un seul téléphone, vous jouez tour par tour/)).toBeVisible();
    await expect(startButton(page)).toHaveText('Commencer');
    await expect(page.getByRole('button', { name: 'Modifier les touches' })).toHaveCount(0);
    await startButton(page).click();
    await expect(page.getByText('Manche 1 · cible 3')).toBeVisible();
    await page.getByRole('button', { name: 'Quitter' }).click();
    await expect(page.getByRole('button', { name: 'Touchez pour jouer' })).toBeVisible();
    expect(problems).toEqual([]);
  });
});
