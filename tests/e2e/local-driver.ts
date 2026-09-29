import { expect, type Page } from '@playwright/test';
import { CYCLE, clashDelays, type ClashKind } from './timing.ts';

/**
 * Pilote d'une partie locale au vrai clavier, horloge Playwright figée (`openFrozen`) et avancée
 * phase par phase : chaque échéance est posée dans le rendu de sa phase, attendu avant d'avancer
 * (docs/TESTING.md). Aucune attente arbitraire : seulement des états observables.
 */

export const status = (page: Page, player: 0 | 1) => page.locator('.arena__status').nth(player);
export const scores = (page: Page) => page.locator('.arena__score');
export const banner = (page: Page) => page.locator('.arena__banner');
export const trophies = (page: Page) =>
  page.getByRole('group', { name: 'Trophées de la session' }).locator('.end__trophy-count');

/** Touches physiques (D10) : J1 Q/S/D (KeyA/KeyS/KeyD), J2 J/K/L ; ordre Feu, Eau, Plante. */
export const KEYS = {
  p1: { fire: 'KeyA', water: 'KeyS', plant: 'KeyD' },
  p2: { fire: 'KeyJ', water: 'KeyK', plant: 'KeyL' },
} as const;

/** Bannière d'ouverture (1,8 s) puis attente (0,4 s) jusqu'à la sélection de la manche 1. */
export async function toSelection(page: Page): Promise<void> {
  await expect(page.getByText('Que le duel commence')).toBeVisible();
  await page.clock.runFor(CYCLE.banner);
  await expect(page.getByText('Que le duel commence')).toHaveCount(0);
  await page.clock.runFor(CYCLE.ready);
  await expect(status(page, 0)).toHaveText('Choix en cours…');
}

/** Suite attendue après le résultat d'une manche. */
export type RoundOutcome = 'next' | 'sudden' | 'end';

/**
 * Joue une manche depuis sa sélection ouverte : frappes, fin de la fenêtre de 5 s, révélation,
 * effet jusqu'à l'impact, puis la suite : manche suivante, « Mort subite » puis manche suivante,
 * ou écran de fin. Rend la main sur la sélection suivante ou sur l'écran « Fin de partie ».
 */
export async function playRound(page: Page, keys: readonly string[], kind: ClashKind, outcome: RoundOutcome): Promise<void> {
  for (const key of keys) await page.keyboard.press(key);
  await page.clock.runFor(CYCLE.selection);
  await expect(status(page, 0)).not.toHaveText(/^Choix/);
  await page.clock.runFor(kind === 'void' ? CYCLE.revealEmpty : CYCLE.reveal);
  await expect(page.locator('[data-phase="clash"]')).toBeAttached();
  await page.clock.runFor(clashDelays(kind).toImpact);
  await expect(banner(page)).not.toHaveClass(/arena__banner--hidden/);
  await page.clock.runFor(clashDelays(kind).afterImpact);

  if (outcome === 'sudden') {
    await expect(banner(page).locator('.arena__banner-title')).toHaveText('Mort subite');
    await page.clock.runFor(CYCLE.sudden);
    await expect(banner(page)).toHaveClass(/arena__banner--hidden/);
    await page.clock.runFor(CYCLE.suddenPause);
    await expect(status(page, 0)).toHaveText('Choix en cours…');
    return;
  }
  await expect(banner(page)).toHaveClass(/arena__banner--hidden/);
  if (outcome === 'end') {
    await expect(page.getByText('Fin de partie')).toHaveCount(0);
    await page.clock.runFor(CYCLE.closing);
    await expect(page.getByText('Fin de partie')).toBeVisible();
    return;
  }
  await page.clock.runFor(CYCLE.pause);
  await expect(status(page, 0)).toHaveText('Choix en cours…');
}
