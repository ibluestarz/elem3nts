import { expect, test } from '@playwright/test';
import type { CloseReason } from '../../src/shared/protocol/index.ts';
import { fakeRoom, selectingState } from './online-fake.ts';
import { openFrozen, stubScene } from './support.ts';

/**
 * PFC-018 — fermeture d'une room par le serveur (inactivité, durée maximale), vue d'un vrai navigateur.
 * L'expiration elle-même (30 min, 4 h) est prouvée dans le runtime Workers avec horloge figée
 * (tests/integration/expiry.test.ts) ; ici, la room simulée envoie `room-closed` puis 4404 comme le serveur,
 * horloge de la page figée : le message doit rester lisible bien après une notification brève.
 */

const SESSION_KEY = 'elem3nts.room.v1';

const CASES: readonly { readonly reason: CloseReason; readonly phase: 'lobby' | 'selecting'; readonly text: string }[] = [
  { reason: 'inactive', phase: 'selecting', text: 'Partie fermée après 30 minutes sans activité : aucun trophée attribué.' },
  { reason: 'max-duration', phase: 'lobby', text: 'Partie fermée : durée maximale de 4 heures atteinte, aucun trophée attribué.' },
];

test.describe('PFC-018-AC1 — room expirée : raison lisible, retour au menu en ligne, message gardé jusqu’à sa fermeture', () => {
  for (const { reason, phase, text } of CASES) {
    test(`PFC-018 — « ${reason} » reçu ${phase === 'lobby' ? 'au lobby' : 'en pleine manche'}`, async ({ page }) => {
      await stubScene(page);
      const room = await fakeRoom(page);
      await openFrozen(page);
      await page.getByRole('button', { name: 'Jouer en ligne' }).click();
      await page.getByRole('button', { name: /^Créer une partie/ }).click();
      await room.authenticated;
      if (phase === 'selecting') {
        await room.publish(selectingState({ target: 3, drawEnabled: true }));
        await expect(page.getByText('Réfléchit…')).toBeVisible();
      } else {
        await room.publish(() => ({}));
        await expect(page.getByRole('heading', { name: 'Préparer le duel' })).toBeVisible();
      }

      await room.close(reason);

      await expect(page.getByRole('heading', { name: 'Choisissez' })).toBeVisible();
      const notice = page.getByRole('status').getByText(text);
      await expect(notice).toBeVisible();
      expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_KEY)).toBeNull();

      // Une minute plus tard (horloge de la page), le message est toujours là : le joueur revient d'absence.
      await page.clock.runFor(60_000);
      await expect(notice).toBeVisible();

      // Fermeture au clavier : le bouton de la notification est atteignable et nommé.
      const dismiss = page.getByRole('status').getByRole('button', { name: 'Fermer la notification' });
      await dismiss.focus();
      await page.keyboard.press('Enter');
      await page.clock.runFor(300);
      await expect(notice).toBeHidden();
    });
  }
});
