import { expect, test, type Page } from '@playwright/test';
import { parseServerMessage, type PublicState } from '../../src/shared/protocol/index.ts';
import { hudStatus, player, startDuel, toSelection, type Frame, type Player } from './online-driver.ts';

/**
 * PFC-016 — partie en ligne, révélation et revanche, contre le Worker local réel (workerd) : deux
 * contextes indépendants, vraies sockets, horloge réelle du serveur (fenêtre de 5 s, D08). Les trames
 * des deux sockets sont capturées pour prouver qu'aucun choix adverse ne circule avant la révélation.
 */

/** Une manche réelle : ouverture 2,2 s, sélection 5 s, puis résultat et fermeture (≈ 7 s). */
test.setTimeout(120_000);
const GAME = { timeout: 20_000 };

const ELEMENT = /"(fire|water|plant)"/;

/** Trames reçues avant le premier état de résultat de la manche, et cet état. */
function splitAtReveal(frames: readonly Frame[]): { before: readonly Frame[]; reveal: PublicState } {
  const received = frames.filter(({ direction }) => direction === 'received');
  const index = received.findIndex(({ payload }) => {
    const parsed = parseServerMessage(payload);
    return parsed.ok && parsed.message.type === 'state' && parsed.message.phase === 'round-result';
  });
  const at = received[index];
  const parsed = at ? parseServerMessage(at.payload) : null;
  if (!parsed?.ok || parsed.message.type !== 'state') throw new Error('Aucun état de révélation reçu.');
  return { before: received.slice(0, index), reveal: parsed.message };
}

const endTitle = (page: Page) => page.locator('.end__title');
const lastState = (p: Player) => p.states.at(-1);

test.describe('PFC-016 — partie en ligne révélation et revanche', () => {
  test('PFC-016-S1 / AC1 — J2 presse KeyA : feu est soumis pour J2 ; aucun choix adverse avant la révélation', async ({
    browser,
  }) => {
    const j1 = await player(browser);
    const j2 = await player(browser, { width: 390, height: 844 });
    await startDuel(j1, j2, 1);
    await toSelection(j1.page);
    await toSelection(j2.page);

    // J2 joue avec les touches de Joueur 1 pour sa propre place (D11, SPEC saisie).
    await j2.page.keyboard.press('KeyA');
    await expect(hudStatus(j2.page, 0)).toHaveText('Choix verrouillé · Feu');
    // J1 voit le verrou de J2, jamais son élément ; puis choisit Plante.
    await expect(hudStatus(j1.page, 1)).toHaveText('Choix verrouillé');
    await j1.page.keyboard.press('KeyD');
    await expect(hudStatus(j1.page, 0)).toHaveText('Choix verrouillé · Plante');
    await expect(hudStatus(j2.page, 1)).toHaveText('Choix verrouillé');

    // Le choix envoyé ne désigne aucune place : le serveur la tire de la socket authentifiée.
    const submitted = j2.frames
      .filter(({ direction }) => direction === 'sent')
      .map(({ payload }) => JSON.parse(payload) as Record<string, unknown>)
      .filter((frame) => frame['type'] === 'submit-choice');
    expect(submitted).toHaveLength(1);
    expect(Object.keys(submitted[0] ?? {}).sort()).toEqual(['matchId', 'payload', 'requestId', 'roundId', 'type', 'v']);
    expect(submitted[0]?.['payload']).toEqual({ element: 'fire' });

    // Révélation à l'échéance du serveur, identique chez les deux joueurs.
    await expect(hudStatus(j1.page, 1)).toHaveText('Feu', GAME);
    await expect(hudStatus(j2.page, 1)).toHaveText('Plante', GAME);

    // Vérité serveur : feu attribué à J2 (place 1), plante à J1, dans les deux projections.
    for (const p of [j1, j2]) {
      const { before, reveal } = splitAtReveal(p.frames);
      expect(before.length).toBeGreaterThan(0);
      for (const { payload } of before) expect(payload).not.toMatch(ELEMENT);
      expect(reveal.revealedChoices).toEqual(['plant', 'fire']);
      expect(reveal.result).toEqual({ kind: 'burn', winner: 1, delta: [0, 1] });
    }

    // Même fin chez les deux : J2 gagne 1-0 et reçoit le trophée, vu de chaque côté.
    await expect(endTitle(j2.page)).toHaveText('Victoire', GAME);
    await expect(endTitle(j1.page)).toHaveText('Défaite', GAME);
    await expect(j2.page.getByText('Vous remportez la partie')).toBeVisible();
    await expect(j1.page.getByText('Joueur 2 remporte la partie')).toBeVisible();
    await expect(j1.page.getByRole('group', { name: 'Score final' })).toHaveText(/Vous\s*0\s*Joueur 2\s*1/);
    await expect(j2.page.getByRole('group', { name: 'Score final' })).toHaveText(/Vous\s*1\s*Joueur 1\s*0/);
    await expect(j1.page.getByRole('group', { name: 'Trophées de la session' })).toContainText('Vous : 0');
    await expect(j1.page.getByRole('group', { name: 'Trophées de la session' })).toContainText('Joueur 2 : 1');
    await expect(j2.page.getByRole('group', { name: 'Trophées de la session' })).toContainText('Vous : 1');
    const [end1, end2] = [lastState(j1), lastState(j2)];
    expect(end1?.phase).toBe('match-ended');
    expect(end2 && { ...end2, yourSlot: 0, serverNow: 0 }).toEqual(end1 && { ...end1, serverNow: 0 });
    expect(end1?.matchResult).toEqual({ status: 'won', winner: 1 });
    expect(end1?.trophies).toEqual([0, 1]);

    expect(j1.problems).toEqual([]);
    expect(j2.problems).toEqual([]);
    await Promise.all([j1.context.close(), j2.context.close()]);
  });

  test('PFC-016-S2 / AC3 — seul J1 confirme : attente sans remise à zéro ; deux confirmations : nouvelle partie, trophées conservés', async ({
    browser,
  }) => {
    const j1 = await player(browser);
    const j2 = await player(browser);
    await startDuel(j1, j2, 1);
    await toSelection(j1.page);
    // Seul J1 choisit : un seul choix rapporte le point (R11), J1 gagne 1-0.
    await j1.page.getByRole('button', { name: /^Feu/ }).click();
    await expect(endTitle(j1.page)).toHaveText('Victoire', GAME);
    await expect(endTitle(j2.page)).toHaveText('Défaite', GAME);
    const ended = lastState(j1);
    expect(ended?.scores).toEqual([1, 0]);

    await j1.page.keyboard.press('Space');
    await expect(j1.page.getByRole('button', { name: 'En attente de Joueur 2…' })).toBeVisible();
    await expect(j2.page.getByRole('status').filter({ hasText: 'Joueur 1 veut rejouer.' })).toBeVisible();
    // Les deux restent sur la fin de partie : même matchId, scores intacts, une seule confirmation.
    await expect.poll(() => lastState(j2)?.ready).toEqual([true, false]);
    for (const p of [j1, j2]) {
      expect(lastState(p)).toMatchObject({ phase: 'match-ended', matchId: ended?.matchId, scores: [1, 0], trophies: [1, 0] });
      await expect(p.page.getByRole('group', { name: 'Score final' })).toBeVisible();
    }

    // L'hôte change X avant la revanche (SPEC) : sa confirmation est retirée, J2 voit la nouvelle cible.
    await j1.page.getByRole('button', { name: 'Augmenter le score cible' }).click();
    await expect(j2.page.getByRole('group', { name: 'Réglages de la revanche' })).toContainText('Premier à 2 points');
    await expect.poll(() => lastState(j2)?.ready).toEqual([false, false]);
    // Confirmation possible dès que le changement de l'hôte est publié et acquitté.
    await expect(j1.page.getByRole('button', { name: 'Rejouer' })).not.toHaveAttribute('aria-busy', 'true');

    // Le focus est sur « + » : Espace y garde son action native (SPEC saisie), on confirme au bouton.
    await j1.page.getByRole('button', { name: 'Rejouer' }).click();
    await expect(j2.page.getByRole('status').filter({ hasText: 'Joueur 1 veut rejouer.' })).toBeVisible();
    await j2.page.getByRole('button', { name: 'Rejouer' }).click();

    for (const p of [j1, j2]) {
      await expect(p.page.getByText('Que le duel commence')).toBeVisible();
      await expect(p.page.getByText('Premier à 2 points')).toBeVisible();
      await expect(p.page.locator('.arena__score')).toHaveText(['0', '0']);
    }
    const next = lastState(j1);
    expect(next?.phase).toBe('starting');
    expect(next?.matchId).not.toBe(ended?.matchId);
    expect(next?.scores).toEqual([0, 0]);
    expect(next?.trophies).toEqual([1, 0]);
    expect(lastState(j2)?.matchId).toBe(next?.matchId);
    expect(j1.problems).toEqual([]);
    expect(j2.problems).toEqual([]);
    await Promise.all([j1.context.close(), j2.context.close()]);
  });

  test('PFC-016 — quitter en pleine partie : annulée sans trophée, l’adversaire est prévenu', async ({ browser }) => {
    const j1 = await player(browser);
    const j2 = await player(browser);
    await startDuel(j1, j2, 3);
    await toSelection(j2.page);

    await j2.page.keyboard.press('Escape');

    await expect(j2.page.getByText('Partie annulée : aucun trophée attribué.')).toBeVisible();
    await expect(j2.page.getByRole('button', { name: 'Jouer en ligne' })).toBeVisible();
    await expect(j1.page.getByText('Joueur 2 a quitté la partie.')).toBeVisible();
    await expect(j1.page.getByRole('heading', { name: 'Choisissez' })).toBeVisible();
    expect(j1.problems).toEqual([]);
    await Promise.all([j1.context.close(), j2.context.close()]);
  });
});
