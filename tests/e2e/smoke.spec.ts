import { expect, test } from '@playwright/test';
import { holdSplash, trackProblems, waitForFonts, stubScene } from './support.ts';

test.describe('PFC-001 — socle', () => {
  test.beforeEach(async ({ page }) => {
    await stubScene(page);
  });

  test('PFC-001-S1 / AC1 — le build affiche la page française minimale sans erreur', async ({ page }) => {
    const problems = trackProblems(page);
    await holdSplash(page);

    await page.goto('/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
    await expect(page).toHaveTitle('ELEM3NTS');
    await expect(page.getByRole('heading', { level: 1, name: 'ELEM3NTS' })).toBeVisible();
    await expect(page.getByRole('status')).toHaveText('Invocation de l’arène…');
    await expect(page.getByRole('main', { name: 'ELEM3NTS' })).toBeVisible();

    await waitForFonts(page);
    const fontsLoaded = await page.evaluate(() => ({
      cinzel: document.fonts.check('700 34px Cinzel'),
      caps: document.fonts.check('500 11px "Alegreya Sans SC"'),
    }));
    expect(fontsLoaded).toEqual({ cinzel: true, caps: true });

    expect(problems).toEqual([]);
  });

  test('PFC-001-AC1 — mouvement réduit : aucune animation d’apparition', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await holdSplash(page);
    await page.goto('/');

    const title = page.getByRole('heading', { level: 1 });
    await expect(title).toBeVisible();
    await expect(title).toHaveCSS('animation-name', 'none');
    await expect(title).toHaveCSS('opacity', '1');
  });
});
