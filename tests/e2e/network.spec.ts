import { readdirSync, readFileSync } from 'node:fs';
import { join as joinPath } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { parseServerMessage, type PublicState } from '../../src/shared/protocol/index.ts';
import { hudStatus, join, player, startDuel, toSelection, type Player } from './online-driver.ts';

/**
 * PFC-019 — recette multijoueur contre le Worker local réel (workerd) servant le build de production :
 * deux contextes de navigateur indépendants, un troisième pour la room pleine, vraies sockets, horloge
 * réelle du serveur (fenêtre de 5 s). Toutes les trames reçues par les deux joueurs sont inspectées.
 * Les cas adverses déterministes (horloge figée, alarmes à la main) sont dans
 * `tests/integration/adversarial.test.ts`.
 */

/** Deux parties réelles en X = 1 (≈ 15 s chacune) et une revanche. */
test.setTimeout(120_000);
const GAME = { timeout: 20_000 };

const ELEMENT = /"(fire|water|plant)"/;
const LABEL = { fire: 'Feu', water: 'Eau', plant: 'Plante' } as const;
const KEY = { fire: 'KeyA', water: 'KeyS', plant: 'KeyD' } as const;
type Element = keyof typeof LABEL;

const endTitle = (page: Page) => page.locator('.end__title');
const trophies = (page: Page) => page.getByRole('group', { name: 'Trophées de la session' });

function receivedStates(p: Player): PublicState[] {
  return p.frames
    .filter(({ direction }) => direction === 'received')
    .map(({ payload }) => parseServerMessage(payload))
    .flatMap((parsed) => (parsed.ok && parsed.message.type === 'state' ? [parsed.message] : []));
}

/**
 * PFC-019-S2 sur les trames reçues par un joueur : chacune respecte le schéma serveur ; un élément n'y
 * apparaît que dans `revealedChoices` d'un état de résultat ou de fin ; et chaque partie a verrouillé les
 * deux choix (état `selecting` publié avec deux verrous) avant sa révélation. Rend les révélations par partie.
 */
function expectNoChoiceBeforeReveal(p: Player): Map<string, PublicState['revealedChoices']> {
  const reveals = new Map<string, PublicState['revealedChoices']>();
  const lockedBeforeReveal = new Set<string>();
  for (const { direction, payload } of p.frames) {
    if (direction !== 'received') continue;
    const parsed = parseServerMessage(payload);
    expect(parsed.ok, payload).toBe(true);
    if (!parsed.ok || parsed.message.type !== 'state') {
      expect(payload).not.toMatch(ELEMENT);
      continue;
    }
    const state = parsed.message;
    const { revealedChoices, ...rest } = state;
    expect(JSON.stringify(rest)).not.toMatch(ELEMENT);
    if (revealedChoices === undefined) {
      if (state.phase === 'selecting' && state.choiceLocked[0] && state.choiceLocked[1] && state.matchId !== null) {
        lockedBeforeReveal.add(state.matchId);
      }
      continue;
    }
    expect(['round-result', 'match-ended']).toContain(state.phase);
    if (state.matchId !== null && !reveals.has(state.matchId)) {
      // Première révélation de la partie : les deux verrous avaient été publiés sans élément.
      expect(lockedBeforeReveal.has(state.matchId)).toBe(true);
      reveals.set(state.matchId, revealedChoices);
    }
  }
  return reveals;
}

/**
 * PFC-019-AC3 côté navigateur : aucun token (le sien ni l'adverse) dans les trames reçues, les états,
 * l'adresse, le DOM, le localStorage ou la console ; le sien seulement sous l'entrée de reprise de l'onglet.
 */
async function expectNoSecrets(p: Player, tokens: readonly string[], own: string): Promise<void> {
  const received = p.frames.filter(({ direction }) => direction === 'received').map(({ payload }) => payload);
  const exposed = [received.join('\n'), JSON.stringify(p.states), p.page.url(), await p.page.content(), p.logs.join('\n')];
  const storage = await p.page.evaluate(() => ({
    local: JSON.stringify(Object.entries(localStorage)),
    session: Object.entries(sessionStorage).map(([key, value]): [string, string] => [key, String(value)]),
  }));
  for (const token of tokens) {
    for (const place of [...exposed, storage.local]) expect(place).not.toContain(token);
  }
  expect(storage.session.filter(([, value]) => tokens.some((token) => value.includes(token))).map(([key, value]) => [key, value.includes(own)])).toEqual([
    ['elem3nts.room.v1', true],
  ]);
}

/** Les deux joueurs verrouillent au clavier dans la fenêtre ouverte ; chacun ne voit que le verrou adverse. */
async function lockBoth(j1: Player, j2: Player, choices: readonly [Element, Element]): Promise<void> {
  await toSelection(j1.page);
  await toSelection(j2.page);
  await j1.page.keyboard.press(KEY[choices[0]]);
  await j2.page.keyboard.press(KEY[choices[1]]);
  for (const [p, own] of [[j1, choices[0]], [j2, choices[1]]] as const) {
    await expect(hudStatus(p.page, 0)).toHaveText(`Choix verrouillé · ${LABEL[own]}`);
    await expect(hudStatus(p.page, 1)).toHaveText('Choix verrouillé');
  }
}

test.describe('PFC-019 — recette multijoueur et tests adverses', () => {
  test('PFC-019-AC1 / S2 — deux joueurs jusqu’au trophée, room pleine en pleine partie, revanche jouée jusqu’au second trophée ; aucun choix avant révélation, aucun token', async ({
    browser,
  }) => {
    const j1 = await player(browser);
    const j2 = await player(browser, { width: 390, height: 844 });
    const { code, tokens } = await startDuel(j1, j2, 1);

    // Partie 1 : eau (J2) bat feu (J1). Les deux choix sont verrouillés avant l'échéance du serveur.
    await lockBoth(j1, j2, ['fire', 'water']);

    // Un troisième contexte tente d'entrer en pleine partie : refusé, sans effet sur la partie.
    const j3 = await player(browser);
    await join(j3.page, code);
    await expect(j3.page.getByRole('alert')).toHaveText('Cette partie est déjà complète.');
    await expect(j3.page.getByLabel('Code reçu')).toBeFocused();
    expect(j3.frames).toEqual([]);

    await expect(hudStatus(j1.page, 1)).toHaveText(LABEL.water, GAME);
    await expect(hudStatus(j2.page, 1)).toHaveText(LABEL.fire, GAME);
    await expect(endTitle(j2.page)).toHaveText('Victoire', GAME);
    await expect(endTitle(j1.page)).toHaveText('Défaite', GAME);
    await expect(trophies(j1.page)).toContainText('Vous : 0');
    await expect(trophies(j1.page)).toContainText('Joueur 2 : 1');
    await expect(trophies(j2.page)).toContainText('Vous : 1');
    const first = receivedStates(j1).at(-1);
    expect(first).toMatchObject({ phase: 'match-ended', matchResult: { status: 'won', winner: 1 }, trophies: [0, 1] });

    // Revanche à deux confirmations : nouvelle partie, trophées conservés.
    await j1.page.getByRole('button', { name: 'Rejouer' }).click();
    await expect(j2.page.getByRole('status').filter({ hasText: 'Joueur 1 veut rejouer.' })).toBeVisible();
    await j2.page.getByRole('button', { name: 'Rejouer' }).click();
    for (const { page } of [j1, j2]) await expect(page.getByText('Que le duel commence')).toBeVisible();

    // Partie 2 : eau (J1) bat feu (J2). Le second trophée va à J1.
    await lockBoth(j1, j2, ['water', 'fire']);
    await expect(hudStatus(j1.page, 1)).toHaveText(LABEL.fire, GAME);
    await expect(endTitle(j1.page)).toHaveText('Victoire', GAME);
    await expect(endTitle(j2.page)).toHaveText('Défaite', GAME);
    for (const { page } of [j1, j2]) {
      await expect(trophies(page)).toContainText('Vous : 1');
      await expect(trophies(page)).toContainText(/Joueur [12] : 1/);
    }
    const [end1, end2] = [receivedStates(j1).at(-1), receivedStates(j2).at(-1)];
    expect(end1).toMatchObject({ phase: 'match-ended', matchResult: { status: 'won', winner: 0 }, trophies: [1, 1] });
    expect(end1?.matchId).not.toBe(first?.matchId);
    expect(end2 && { ...end2, yourSlot: 0, serverNow: 0 }).toEqual(end1 && { ...end1, serverNow: 0 });

    // S2 : trames des deux joueurs, deux parties, révélations identiques chez les deux.
    const reveals1 = expectNoChoiceBeforeReveal(j1);
    const reveals2 = expectNoChoiceBeforeReveal(j2);
    expect([...reveals1.values()]).toEqual([
      ['fire', 'water'],
      ['water', 'fire'],
    ]);
    expect(reveals2).toEqual(reveals1);

    for (const [p, own] of [[j1, tokens[0]], [j2, tokens[1]]] as const) await expectNoSecrets(p, tokens, own);
    expect(j1.problems).toEqual([]);
    expect(j2.problems).toEqual([]);
    // J3 : le seul refus attendu (409 sur la jonction, que chaque navigateur signale aussi à sa façon en
    // console), aucune erreur de page et aucune socket ouverte.
    expect(j3.problems).toContainEqual(expect.stringMatching(new RegExp(`^HTTP 409: .*/api/rooms/${code}/join$`)));
    expect(j3.problems.filter((problem) => problem.startsWith('pageerror') || problem.startsWith('HTTP'))).toHaveLength(1);
    expect(j3.frames).toEqual([]);
    await Promise.all([j1.context.close(), j2.context.close(), j3.context.close()]);
  });
});

/**
 * Marqueurs du Worker de test (`tests/integration/harness`), qui ne doivent jamais atteindre le build. PFC-020 :
 * l'en-tête qui impose l'adresse cliente contournerait les limites par IP.
 */
const HARNESS_MARKERS = ['__harness', 'failCommits', 'runAlarm', 'alarmAt', 'harness/entry', 'x-harness-client-ip'];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile())
    .map((entry) => joinPath(entry.parentPath, entry.name));
}

test.describe('PFC-019-AC3 — aucune route de triche dans le build de production', () => {
  test('le build servi (client et Worker, cartes de source comprises) ne contient aucun code du harnais', () => {
    const worker = JSON.parse(readFileSync('dist/elem3nts/wrangler.json', 'utf8')) as { main: string; name: string };
    expect(worker).toMatchObject({ main: 'index.js', name: 'elem3nts' });
    const built = [...files('dist/client'), ...files('dist/elem3nts')].filter((path) => /\.(js|map|html|json)$/.test(path));
    expect(built.some((path) => path.endsWith('.js') && path.includes('client'))).toBe(true);
    for (const path of built) {
      const content = readFileSync(path, 'utf8');
      for (const marker of HARNESS_MARKERS) expect(content.includes(marker), `${marker} dans ${path}`).toBe(false);
    }
  });

  test('les routes du harnais ne répondent jamais : /api → 404 JSON, ailleurs la page de l’application', async ({ request }) => {
    for (const path of ['/api/__harness/clock', '/api/__harness/rooms/ABCDEFGH']) {
      const response = await request.put(path, { data: { now: 0 } });
      expect(response.status(), path).toBe(404);
      expect(await response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    }
    // Hors /api, Static Assets sert le repli SPA (D35) : jamais une réponse du harnais.
    for (const path of ['/__harness/clock', '/__harness/rooms/ABCDEFGH/alarm']) {
      const response = await request.fetch(path, { method: 'POST', data: {} });
      expect(response.headers()['content-type'] ?? '', path).not.toContain('application/json');
      expect(await response.text()).not.toMatch(/"(alarm|state|failed)"/);
    }
  });
});
