import { expect, test, type Page } from '@playwright/test';
import { fakeRoom } from './online-fake.ts';
import {
  SCREEN_FONTS,
  VIEWPORTS,
  emulateAzertyLayout,
  holdSplash,
  markZone,
  openFrozen,
  parkPointer,
  screenSnapshotName,
  splashSnapshotName,
  statesFor,
  stubScene,
  waitForVisualStability,
  zoneRect,
  zonesOf,
  type ScreenState,
} from './support.ts';

// Exécuté par le seul projet Chromium : les références sont capturées depuis la maquette
// (elem3nts-design/) sous Chromium par scripts/capture-mockup-baseline.ts.
const PIXEL_EXACT = { animations: 'disabled', threshold: 0, maxDiffPixels: 0 } as const;

test.describe('PFC-001 — parité visuelle avec la maquette', () => {
  for (const viewport of VIEWPORTS) {
    test(`PFC-001-AC1 — rendu identique à l’écran de chargement de la maquette (${String(viewport.width)}×${String(viewport.height)})`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      // Écran d'ouverture maintenu : horloge figée avant sa durée minimale.
      await stubScene(page);
      await holdSplash(page);
      await page.goto('/');
      await expect(page.getByRole('status')).toBeVisible();
      await waitForVisualStability(page);

      // Tolérance nulle : le rendu doit être identique pixel pour pixel à la maquette.
      await expect(page).toHaveScreenshot(splashSnapshotName(viewport), PIXEL_EXACT);
    });
  }
});

async function openApp(page: Page, state: ScreenState): Promise<void> {
  await stubScene(page, state.trinity === true);
  if (state.fakeRoom === true) await fakeRoom(page);
  await emulateAzertyLayout(page);
  // Horloge figée comme pour la référence : pulse et bannière d'ouverture restent à leur état initial.
  await openFrozen(page);
  await expect(page.getByText('Le Feu, l’Eau et la Plante s’affrontent')).toBeVisible();
}

test.describe('PFC-004 — parité visuelle avec la maquette', () => {
  for (const viewport of VIEWPORTS) {
    for (const state of statesFor(viewport)) {
      test(`PFC-004 — écran « ${state.name} » identique à la maquette (${String(viewport.width)}×${String(viewport.height)})`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport);
        await openApp(page, state);
        await (state.appReach ?? state.reach)(page);
        await parkPointer(page);
        await waitForVisualStability(page, SCREEN_FONTS);

        const masks = state.mask ? [page.locator(state.mask.app)] : [];
        for (const zone of zonesOf(state)) {
          const { contains } = zone;
          const rect = zoneRect(zone, viewport);
          // L'ajout doit rester entièrement dans sa zone exclue, avec 2 px de marge.
          for (const box of await page.locator(contains).evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON() as DOMRect))) {
            expect(box.left).toBeGreaterThanOrEqual(rect.x + 2);
            expect(box.top).toBeGreaterThanOrEqual(rect.y + 2);
            expect(box.right).toBeLessThanOrEqual(rect.x + rect.width - 2);
            expect(box.bottom).toBeLessThanOrEqual(rect.y + rect.height - 2);
          }
          masks.push(await markZone(page, rect));
        }
        await expect(page).toHaveScreenshot(screenSnapshotName(state.name, viewport), { ...PIXEL_EXACT, mask: masks });
      });
    }
  }
});
