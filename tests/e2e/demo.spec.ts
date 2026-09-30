import { expect, test, type Locator, type Page } from '@playwright/test';
import { expectAccessible } from './audit.ts';
import { openFrozen, stubScene, trackProblems } from './support.ts';
import { CYCLE, DEMO_ARM_MS, clashDelays } from './timing.ts';

/**
 * PFC-026 — démo des confrontations, sur le build de production servi par le Worker local (3 navigateurs) :
 * parcours au clavier seul, garde pendant un effet, retour à l'accueil, repli sans WebGL et audit. Horloge
 * figée avancée phase par phase (TESTING) ; scène bouchonnée, sauf pour le repli.
 */

const demoHeading = (page: Page) => page.getByRole('heading', { name: 'Démo des confrontations' });
const confrontation = (page: Page, name: string) =>
  page.getByRole('group', { name: 'Confrontations' }).getByRole('button', { name, exact: true });
const statuses = (page: Page) => page.locator('.arena__status');
const scores = (page: Page) => page.locator('.arena__score');
const arena = (page: Page) => page.locator('.arena');

/** Avance l'horloge figée d'une phase puis attend son rendu : l'échéance suivante est posée dans ce rendu. */
async function step(page: Page, ms: number, rendered: () => Promise<void>): Promise<void> {
  await page.clock.runFor(ms);
  await rendered();
}

/**
 * Tab jusqu'à la cible, borné. Firefox sans fenêtre peut sortir le focus de la page après le dernier contrôle :
 * la tabulation reprend alors au titre de l'écran.
 */
async function tabTo(page: Page, target: Locator, max = 30): Promise<void> {
  for (let press = 0; press < max; press++) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press('Tab');
    await page.evaluate(() => {
      if (document.activeElement === null || document.activeElement === document.body) {
        document.querySelector<HTMLElement>('[data-focus-target]')?.focus();
      }
    });
  }
  await expect(target).toBeFocused();
}

async function openHome(page: Page): Promise<void> {
  await openFrozen(page);
  await expect(page.getByRole('heading', { level: 1, name: 'ELEM3NTS' })).toBeVisible();
}

test.describe('PFC-026 — démo des confrontations', () => {
  test('PFC-026-S1 / S2 / AC2 — au clavier seul : Eau + Eau rejouée, autre confrontation ignorée, Échap rend l’accueil', async ({
    page,
  }) => {
    const problems = trackProblems(page);
    await stubScene(page);
    await openHome(page);

    const origin = page.getByRole('button', { name: 'Démo des confrontations' });
    await tabTo(page, origin);
    await page.keyboard.press('Enter');
    await expect(demoHeading(page)).toBeFocused();
    await expect(page.getByRole('status')).toBeEmpty();
    await expect(page.getByRole('button', { name: 'À gauche' })).toHaveAttribute('aria-pressed', 'true');
    await expect(scores(page)).toHaveText(['0', '0']);

    // S1 : Eau + Eau, vainqueur à gauche.
    const siphon = confrontation(page, 'Eau + Eau');
    await tabTo(page, siphon);
    await page.keyboard.press('Enter');
    await expect(statuses(page)).toHaveText(['Choix verrouillé', 'Choix verrouillé']);
    await expect(scores(page)).toHaveText(['2', '2']);
    for (const button of await page.getByRole('group', { name: 'Confrontations' }).getByRole('button').all()) {
      await expect(button).toHaveAttribute('aria-disabled', 'true');
    }

    await step(page, DEMO_ARM_MS, () => expect(statuses(page)).toHaveText(['Eau', 'Eau']));
    // S2 : une autre confrontation pendant l'effet est ignorée, au clavier comme au pointeur.
    // Contrôle suivant dans l'ordre de tabulation (Firefox ne reboucle pas après le dernier).
    const other = confrontation(page, 'Plante + Plante · écart');
    await tabTo(page, other);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Space');
    // Un pointeur atteint le bouton atténué (`aria-disabled`, pas `disabled`) : Playwright le jugerait inactif.
    await other.click({ force: true });
    await expect(statuses(page)).toHaveText(['Eau', 'Eau']);

    await step(page, CYCLE.reveal, () => expect(arena(page)).toHaveAttribute('data-phase', 'clash'));
    await step(page, clashDelays('siphon').toImpact, () => expect(page.locator('.arena__banner')).toContainText('La mer engloutit tout'));
    await expect(page.locator('.arena__banner')).toContainText('−1 pour les 2 joueurs');
    await expect(scores(page)).toHaveText(['1', '1']);

    // Retour au repos : aucune manche suivante, boutons de nouveau actifs, focus conservé.
    await step(page, clashDelays('siphon').afterImpact, () => expect(arena(page)).toHaveAttribute('data-phase', 'idle'));
    await expect(other).toHaveAttribute('aria-disabled', 'false');
    await expect(other).toBeFocused();
    await expect(scores(page)).toHaveText(['1', '1']);
    await page.clock.runFor(10_000);
    await expect(arena(page)).toHaveAttribute('data-phase', 'idle');
    await expect(statuses(page)).toHaveText(['', '']);

    await page.keyboard.press('Escape');
    await expect(origin).toBeFocused();
    expect(problems).toEqual([]);
  });

  test('PFC-026-AC1 — vainqueur à droite : Plante + Plante avec écart, point au plus faible (Joueur 2)', async ({ page }) => {
    await stubScene(page);
    await openHome(page);
    await page.getByRole('button', { name: 'Démo des confrontations' }).click();
    await page.getByRole('button', { name: 'À droite' }).click();
    await expect(page.getByRole('button', { name: 'À droite' })).toHaveAttribute('aria-pressed', 'true');

    await confrontation(page, 'Plante + Plante · écart').click();
    await expect(scores(page)).toHaveText(['3', '1']);
    await step(page, DEMO_ARM_MS, () => expect(statuses(page)).toHaveText(['Plante', 'Plante']));
    await step(page, CYCLE.reveal, () => expect(arena(page)).toHaveAttribute('data-phase', 'clash'));
    await step(page, clashDelays('thrive').toImpact, () =>
      expect(page.locator('.arena__banner')).toContainText('Le plus faible grandit : +1 pour Joueur 2'),
    );
    await expect(scores(page)).toHaveText(['3', '2']);

    await page.getByRole('button', { name: 'Accueil' }).click();
    await expect(page.getByRole('button', { name: 'Démo des confrontations' })).toBeFocused();
  });

  test('PFC-026 — sans WebGL : repli annoncé, confrontation rejouée et expliquée dans le DOM', async ({ page }) => {
    const problems = trackProblems(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'WebGL2RenderingContext', { configurable: true, value: undefined });
    });
    await openHome(page);
    await expect(page.getByRole('status')).toContainText('Scène 3D indisponible sur cet appareil : la partie se joue sans effets.');

    await page.getByRole('button', { name: 'Démo des confrontations' }).click();
    await confrontation(page, 'Temps écoulé').click();
    await step(page, DEMO_ARM_MS, () => expect(statuses(page)).toHaveText(['Feu', 'Aucun choix']));
    await step(page, CYCLE.reveal, () => expect(arena(page)).toHaveAttribute('data-phase', 'clash'));
    await step(page, clashDelays('solo').toImpact, () =>
      expect(page.locator('.arena__banner')).toContainText('Seul choix de la manche : point pour Joueur 1'),
    );
    await expect(scores(page)).toHaveText(['3', '2']);
    expect(problems).toEqual([]);
  });

  test('PFC-026-AC3 — accessible au repos et pendant un effet (axe WCAG 2.2 AA, contraste mesuré)', async ({ page }) => {
    await stubScene(page);
    await openHome(page);
    await page.getByRole('button', { name: 'Démo des confrontations' }).click();
    await expect(demoHeading(page)).toBeFocused();
    await expectAccessible(page, 'démo au repos', { frozen: true });

    await confrontation(page, 'Eau › Feu').click();
    await step(page, DEMO_ARM_MS, () => expect(statuses(page)).toHaveText(['Eau', 'Feu']));
    await step(page, CYCLE.reveal, () => expect(arena(page)).toHaveAttribute('data-phase', 'clash'));
    await step(page, clashDelays('wave').toImpact, () => expect(page.locator('.arena__banner')).toContainText('L’Eau éteint le Feu'));
    await expectAccessible(page, 'démo pendant un effet', { frozen: true });
  });
});
