import { expect, test, type Page } from '@playwright/test';
import { KEYS } from './local-driver.ts';
import { openFrozen, stubScene, trackProblems } from './support.ts';
import { CYCLE, clashDelays } from './timing.ts';

/**
 * PFC-025 — local sur un seul téléphone, tour par tour (3 navigateurs, build de production) : voile de chaque
 * joueur, 5 s de choix au toucher, révélation par le choix ou l'échéance de Joueur 2, et passage bureau ↔
 * téléphone sans perte d'état ni double résolution. Horloge figée, avancée phase par phase.
 */

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };

const statuses = (page: Page) => page.locator('.arena-m__status, .arena__status');
const scores = (page: Page) => page.locator('.arena-m__score, .arena__score');
const banner = (page: Page) => page.locator('.arena__banner');
const picks = (page: Page) => page.getByRole('group', { name: 'Votre élément' });

/** Préparation X = 3 puis « Commencer » ; la manche 1 s'ouvre 1,8 s + 0,4 s plus tard. */
async function startMatch(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Jouer en local', exact: true }).click();
  await page.getByRole('button', { name: 'Score cible 3', exact: true }).click();
  await page.getByRole('button', { name: /^Commencer/ }).click();
  await expect(page.getByText('Que le duel commence')).toBeVisible();
  await page.clock.runFor(CYCLE.banner);
  await expect(page.getByText('Que le duel commence')).toHaveCount(0);
  await page.clock.runFor(CYCLE.ready);
}

/** Révélation déjà lancée : effet jusqu'à l'impact, l'explication s'affiche. */
async function toImpact(page: Page, kind: Parameters<typeof clashDelays>[0], title: string): Promise<void> {
  await page.clock.runFor(kind === 'void' ? CYCLE.revealEmpty : CYCLE.reveal);
  await expect(page.locator('[data-phase="clash"]')).toBeAttached();
  await page.clock.runFor(clashDelays(kind).toImpact);
  await expect(banner(page)).toContainText(title);
}

test.describe('PFC-025 — local mobile tour par tour', () => {
  // Écran tactile : les choix se font au toucher (`tap`), comme sur le téléphone partagé.
  test.use({ hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await stubScene(page);
  });

  test('PFC-025-S1 / AC1–AC2 — J1 prêt puis Feu : voile de J2 sans rien montrer, puis révélation au choix de J2', async ({ page }) => {
    const problems = trackProblems(page);
    await page.setViewportSize(PHONE);
    await openFrozen(page);
    await startMatch(page);

    const gate1 = page.getByRole('dialog', { name: 'Joueur 1, à vous' });
    await expect(gate1).toBeVisible();
    await expect(gate1).toContainText('Manche 1 · tour par tour');
    // Aucune échéance sous le voile : le passage de l'appareil prend le temps qu'il faut.
    await page.clock.runFor(30_000);
    await expect(gate1).toBeVisible();

    await page.getByRole('button', { name: 'Je suis prêt' }).tap();
    await expect(page.getByText('Joueur 1 · touchez un élément')).toBeVisible();
    await expect(statuses(page)).toHaveText(['Choix en cours…', 'En attente']);
    // Le clavier ne choisit pas en tour par tour.
    await page.keyboard.press(KEYS.p1.water);
    await expect(statuses(page)).toHaveText(['Choix en cours…', 'En attente']);

    await picks(page).getByRole('button', { name: 'Feu' }).tap();
    const gate2 = page.getByRole('dialog', { name: 'Passez le téléphone à Joueur 2' });
    await expect(gate2).toContainText('Le choix de Joueur 1 est verrouillé et caché. Joueur 2 aura 5 secondes.');
    // AC2 : aucune trace de l'élément de Joueur 1 dans le DOM avant la révélation.
    expect(await page.locator('main').innerHTML()).not.toMatch(/Feu|fire/);
    await expect(statuses(page)).toHaveText(['Choix verrouillé', 'En attente']);

    await page.getByRole('button', { name: 'Joueur 2 — je suis prêt' }).tap();
    await expect(page.getByText('Joueur 2 · touchez un élément')).toBeVisible();
    await picks(page).getByRole('button', { name: 'Eau' }).tap();
    // Le choix de J2 déclenche la révélation, sans attendre la fin de sa fenêtre.
    await expect(page.locator('[data-phase="reveal"]')).toBeAttached();
    await expect(statuses(page)).toHaveText(['Feu', 'Eau']);
    await toImpact(page, 'wave', 'L’Eau éteint le Feu');
    await expect(scores(page)).toHaveText(['0', '1']);

    // Manche suivante : de nouveau le voile de Joueur 1.
    await page.clock.runFor(clashDelays('wave').afterImpact);
    await page.clock.runFor(CYCLE.pause);
    await expect(page.getByRole('dialog', { name: 'Joueur 1, à vous' })).toContainText('Manche 2 · tour par tour');
    await expect(scores(page)).toHaveText(['0', '1']);
    expect(problems).toEqual([]);
  });

  test('PFC-025-S2 — J1 hors délai, J2 choisit Eau : R11, +1 pour Joueur 2', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openFrozen(page);
    await startMatch(page);
    await page.getByRole('button', { name: 'Je suis prêt' }).tap();
    await page.clock.runFor(CYCLE.selection);

    await expect(page.getByRole('dialog', { name: 'Passez le téléphone à Joueur 2' })).toContainText(
      'Joueur 1 n’a pas choisi à temps. Joueur 2 aura 5 secondes.',
    );
    await expect(statuses(page)).toHaveText(['En attente', 'En attente']);
    await page.getByRole('button', { name: 'Joueur 2 — je suis prêt' }).tap();
    await picks(page).getByRole('button', { name: 'Eau' }).tap();
    await expect(statuses(page)).toHaveText(['Aucun choix', 'Eau']);
    await toImpact(page, 'solo', 'Temps écoulé');
    await expect(banner(page)).toContainText('Seul choix de la manche : point pour Joueur 2');
    await expect(scores(page)).toHaveText(['0', '1']);
  });

  test('AC1 — J2 hors délai : révélation à son échéance, une seule résolution', async ({ page }) => {
    await page.setViewportSize(PHONE);
    await openFrozen(page);
    await startMatch(page);
    await page.getByRole('button', { name: 'Je suis prêt' }).tap();
    await picks(page).getByRole('button', { name: 'Plante' }).tap();
    await page.getByRole('button', { name: 'Joueur 2 — je suis prêt' }).tap();
    await page.clock.runFor(CYCLE.selection - 100);
    await expect(page.locator('[data-phase="selecting"]')).toBeAttached();
    await page.clock.runFor(100);
    await expect(statuses(page)).toHaveText(['Plante', 'Aucun choix']);
    await toImpact(page, 'solo', 'Seul choix de la manche : point pour Joueur 1');
    await expect(scores(page)).toHaveText(['1', '0']);
  });

  test('AC3 — bureau ↔ téléphone : la manche garde son mode, aucune double résolution', async ({ page }) => {
    await page.setViewportSize(DESKTOP);
    await openFrozen(page);
    await startMatch(page);

    // Manche simultanée ouverte au bureau ; passage au téléphone pendant la sélection.
    await expect(statuses(page)).toHaveText(['Choix en cours…', 'Choix en cours…']);
    await page.keyboard.press(KEYS.p1.fire);
    await page.setViewportSize(PHONE);
    await page.keyboard.press(KEYS.p2.plant);
    await expect(statuses(page)).toHaveText(['Choix verrouillé', 'Choix verrouillé']);
    await page.clock.runFor(CYCLE.selection);
    await toImpact(page, 'burn', 'Le Feu consume la Plante');
    await expect(scores(page)).toHaveText(['1', '0']);

    // Manche suivante au téléphone : tour par tour ; retour au bureau sous le voile, puis pendant un tour.
    await page.clock.runFor(clashDelays('burn').afterImpact);
    await page.clock.runFor(CYCLE.pause);
    await expect(page.getByRole('dialog', { name: 'Joueur 1, à vous' })).toBeVisible();
    await page.setViewportSize(DESKTOP);
    await expect(page.getByRole('dialog', { name: 'Joueur 1, à vous' })).toBeVisible();
    await page.getByRole('button', { name: 'Je suis prêt' }).click();
    await picks(page).getByRole('button', { name: 'Eau' }).click();
    await page.setViewportSize(PHONE);
    await page.getByRole('button', { name: 'Joueur 2 — je suis prêt' }).tap();
    await picks(page).getByRole('button', { name: 'Feu' }).tap();
    await toImpact(page, 'wave', 'L’Eau éteint le Feu');
    await expect(scores(page)).toHaveText(['2', '0']);
  });
});
