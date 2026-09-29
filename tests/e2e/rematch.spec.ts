import { expect, test, type Page } from '@playwright/test';
import { playRound, toSelection, trophies } from './local-driver.ts';
import { openFrozen, stubScene, trackProblems } from './support.ts';
import type { ClashKind } from './timing.ts';

/** Partie à X = 1 jouée au vrai clavier jusqu'à l'écran de fin (pilote partagé, horloge figée). */
async function playDecisive(page: Page, keys: readonly string[], kind: ClashKind): Promise<void> {
  await toSelection(page);
  await playRound(page, keys, kind, 'end');
}

async function startLocal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Jouer en local' }).click();
  await page.getByRole('button', { name: 'Score cible 1', exact: true }).click();
  await page.getByRole('button', { name: /^Commencer/ }).click();
}

const J1_WINS = ['KeyA', 'KeyL'];
const J2_WINS = ['KeyD', 'KeyJ'];
const DRAW = ['KeyA', 'KeyJ'];

test.describe('PFC-007 — revanche et session locale', () => {
  test.beforeEach(async ({ page }) => {
    await stubScene(page);
  });

  test('PFC-007-S1 / AC1 — série : victoire J1, revanche Espace, victoire J2, nul (nul ON)', async ({ page }) => {
    const problems = trackProblems(page);
    await openFrozen(page);
    await startLocal(page);

    await playDecisive(page, J1_WINS, 'burn');
    await expect(page.getByRole('heading', { name: 'Victoire' })).toBeFocused();
    await expect(page.getByText('Joueur 1 remporte la partie')).toBeVisible();
    await expect(trophies(page)).toHaveText(['1', '0']);

    await page.keyboard.press('Space');
    await expect(page.locator('.arena__score')).toHaveText(['0', '0']);
    await playDecisive(page, J2_WINS, 'burn');
    await expect(page.getByText('Joueur 2 remporte la partie')).toBeVisible();
    await expect(trophies(page)).toHaveText(['1', '1']);

    await page.getByRole('button', { name: 'Rejouer' }).click();
    await playDecisive(page, DRAW, 'flare');
    await expect(page.getByRole('heading', { name: 'Match nul' })).toBeVisible();
    await expect(page.getByText('Les deux joueurs atteignent la cible ensemble')).toBeVisible();
    await expect(trophies(page)).toHaveText(['2', '2']);
    expect(problems).toEqual([]);
  });

  test('PFC-007-AC2 — Espace maintenu sur l’écran de fin : une seule revanche', async ({ page }) => {
    await openFrozen(page);
    await startLocal(page);
    await playDecisive(page, J1_WINS, 'burn');

    await page.keyboard.down('Space');
    await page.keyboard.down('Space');
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await page.keyboard.press('Space');
    await playDecisive(page, J1_WINS, 'burn');
    // Une seule partie supplémentaire : un seul trophée de plus.
    await expect(trophies(page)).toHaveText(['2', '0']);
  });

  test('PFC-007-S2 / AC3 — retour à l’accueil puis local : nouvelle session ; rechargement : session close', async ({ page }) => {
    await openFrozen(page);
    await startLocal(page);
    await playDecisive(page, J1_WINS, 'burn');
    await expect(trophies(page)).toHaveText(['1', '0']);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Jouer en local' })).toBeFocused();
    await startLocal(page);
    await playDecisive(page, J2_WINS, 'burn');
    await expect(trophies(page)).toHaveText(['0', '1']);

    await page.reload();
    await page.getByText('Invocation de l’arène…').waitFor();
    await page.clock.runFor(600);
    await startLocal(page);
    await playDecisive(page, J2_WINS, 'burn');
    await expect(trophies(page)).toHaveText(['0', '1']);
  });
});
