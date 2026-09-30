import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { expectAccessible, measureTextContrast, measuresContrast, type ContrastSample } from './audit.ts';
import { KEYS, banner, playRound, scores, status, toSelection as toLocalSelection } from './local-driver.ts';
import { hudStatus, host, join, lobbyTitle, player, toSelection as toOnlineSelection } from './online-driver.ts';
import { VIEWPORTS, isolatedContext, openFrozen, stubScene, trackProblems } from './support.ts';
import { CYCLE, clashDelays } from './timing.ts';

/**
 * PFC-021 — accessibilité de la version complète, sur le build de production servi par le Worker local :
 * parcours au clavier seul avec focus toujours visible et jamais perdu (S1), mouvements réduits (S2), repli
 * sans WebGL, contrôles tactiles en ligne sur petit écran, et audit automatisé (axe-core WCAG 2.2 AA + contraste
 * mesuré sur le rendu, tests/e2e/audit.ts) de chaque écran local et en ligne. Écarts documentés : D46.
 */

const { p1, p2 } = KEYS;

/**
 * Contextes ouverts par un test (joueurs en ligne) : fermés après chaque test, même en échec. Laissés ouverts, leurs
 * sockets, minuteries et rendus continuaient dans le processus et ralentissaient les tests suivants (mesuré au gate).
 */
const opened: BrowserContext[] = [];
function track<T extends { readonly context: BrowserContext }>(owner: T): T {
  opened.push(owner.context);
  return owner;
}
test.afterEach(async () => {
  await Promise.all(opened.splice(0).map((context) => context.close()));
});

/** Écart de la maquette (D46) : le raccourci de l'accueil respire entre 50 % et 100 % d'opacité. */
const HOME_HINT = ['p.home__hint', 'kbd.home__key'];

const localButton = (page: Page) => page.getByRole('button', { name: 'Jouer en local' });
const setupHeading = (page: Page) => page.getByRole('heading', { name: 'Préparer le duel' });
const targetInput = (page: Page) => page.getByRole('spinbutton', { name: 'Score cible' });

interface FocusState {
  readonly onBody: boolean;
  readonly name: string;
  /** Titre d'écran focalisé par programme (annonce) : non interactif, sans anneau par conception. */
  readonly heading: boolean;
  readonly outlineStyle: string;
  readonly outlineWidth: number;
}

function focusState(page: Page): Promise<FocusState> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement) || element === document.body) {
      return { onBody: true, name: '', heading: false, outlineStyle: 'none', outlineWidth: 0 };
    }
    const style = getComputedStyle(element);
    return {
      onBody: false,
      name: (element.getAttribute('aria-label') ?? element.textContent).trim().replace(/\s+/g, ' ').slice(0, 60),
      heading: element.hasAttribute('data-focus-target'),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
}

/** Le focus est sur un élément de la page (jamais le <body>) et, s'il est interactif, son anneau se voit. */
async function expectFocusVisible(page: Page, label: string): Promise<FocusState> {
  const focus = await focusState(page);
  expect(focus.onBody, `${label} : focus perdu sur <body>`).toBe(false);
  if (!focus.heading) {
    expect(focus.outlineStyle, `${label} : anneau de « ${focus.name} »`).not.toBe('none');
    expect(focus.outlineWidth, `${label} : épaisseur de l'anneau de « ${focus.name} »`).toBeGreaterThanOrEqual(2);
  }
  return focus;
}

/**
 * Tab depuis le dernier contrôle : le focus quitte la page. Chromium le rend au <body> ; Firefox (sans fenêtre) le
 * garde sur le dernier contrôle, document toujours « focalisé » (mesuré). Détection commune : Tab n'a pas déplacé
 * le focus vers un autre élément de la page.
 */
async function pressTab(page: Page): Promise<'moved' | 'left'> {
  const before = await page.evaluateHandle(() => document.activeElement);
  await page.keyboard.press('Tab');
  const moved = await before.evaluate(
    (previous) => document.activeElement !== previous && document.activeElement !== null && document.activeElement !== document.body,
  );
  await before.dispose();
  return moved ? 'moved' : 'left';
}

/** Reprise au titre de l'écran (ou au document) quand le focus est sorti de la page (interface de Firefox). */
function refocusScreen(page: Page): Promise<void> {
  return page.evaluate(() => {
    const title = document.querySelector<HTMLElement>('[data-focus-target]');
    if (title) title.focus();
    else {
      window.focus();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
  });
}

/** Avance au clavier (Tab) jusqu'à la cible, borné ; en fin de page, la tabulation reprend au début de l'écran. */
async function tabTo(page: Page, target: Locator, max = 30): Promise<void> {
  for (let press = 0; press < max; press++) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    if ((await pressTab(page)) === 'left') await refocusScreen(page);
  }
  await expect(target).toBeFocused();
}

/**
 * Parcourt l'écran à la touche Tab jusqu'à revenir sur un contrôle déjà vu (ou sortir de la page) et vérifie
 * l'anneau de chaque contrôle atteint. Rend les noms, dans l'ordre de tabulation.
 */
async function tabCycle(page: Page, label: string, max = 40): Promise<string[]> {
  const seen: string[] = [];
  for (let press = 0; press < max; press++) {
    if ((await pressTab(page)) === 'left') break;
    const focus = await focusState(page);
    if (seen.includes(focus.name)) break;
    await expectFocusVisible(page, label);
    seen.push(focus.name);
  }
  // Après le dernier contrôle, Firefox sort le focus vers l'interface du navigateur.
  await refocusScreen(page);
  return seen;
}

/** Aucune animation ni transition en cours d'une durée perceptible (> 1 ms). */
function runningAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => animation.playState === 'running')
      .filter((animation) => Number(animation.effect?.getComputedTiming().duration ?? 0) > 1)
      .map((animation) => (animation as CSSAnimation).animationName || (animation as CSSTransition).transitionProperty || 'animation'),
  );
}

/** Préparation d'une partie locale au clavier : X = 1 (Début), puis « Commencer ». */
async function startLocalByKeyboard(page: Page): Promise<void> {
  await tabTo(page, targetInput(page));
  await page.keyboard.press('Home');
  await expect(targetInput(page)).toHaveValue('1');
  await tabTo(page, page.getByRole('button', { name: /^Commencer/ }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Arène · manche 1 · premier à 1' })).toBeFocused();
}

test.describe('PFC-021-S1 / AC1 — clavier seul, focus visible et jamais perdu', () => {
  test('local : configurer, jouer, relancer et revenir, chaque contrôle atteint montre son anneau', async ({ page }) => {
    const problems = trackProblems(page);
    await stubScene(page);
    await openFrozen(page);
    await expect(localButton(page)).toBeVisible();

    const home = await tabCycle(page, 'accueil');
    expect(home).toEqual(expect.arrayContaining(['Jouer en local', 'Jouer en ligne', 'Réglages', 'Règles du jeu']));

    await localButton(page).focus();
    await page.keyboard.press('Enter');
    await expect(setupHeading(page)).toBeFocused();
    const setup = await tabCycle(page, 'préparation');
    expect(setup).toEqual(expect.arrayContaining(['Modifier les touches', 'Retour']));

    // Tiroir Réglages : Maj+Tab depuis le titre reste dans le dialogue ; Tab boucle sans en sortir.
    await tabTo(page, page.getByRole('button', { name: 'Modifier les touches' }));
    await page.keyboard.press('Enter');
    const drawer = page.getByRole('dialog', { name: 'Réglages' });
    await expect(drawer.getByRole('heading', { name: 'Réglages' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expectFocusVisible(page, 'réglages, Maj+Tab depuis le titre');
    expect(await drawer.evaluate((node) => node.contains(document.activeElement))).toBe(true);
    for (let press = 0; press < 30; press++) {
      await page.keyboard.press('Tab');
      await expectFocusVisible(page, 'réglages');
      expect(await drawer.evaluate((node) => node.contains(document.activeElement)), 'focus gardé dans le tiroir').toBe(true);
    }
    await page.keyboard.press('Escape');
    // Focus rendu au déclencheur, anneau visible (navigation clavier en cours).
    await expect(page.getByRole('button', { name: 'Modifier les touches' })).toBeFocused();
    await expectFocusVisible(page, 'retour des réglages');

    await startLocalByKeyboard(page);
    await toLocalSelection(page);
    // Un contrôle focalisé n'empêche pas de jouer : les touches d'élément ne doublent aucune action native.
    await tabTo(page, page.getByRole('button', { name: 'Échap · Quitter' }));
    await expectFocusVisible(page, 'arène');
    await playRound(page, [p1.fire, p2.plant], 'burn', 'end');

    const verdict = page.getByRole('heading', { name: 'Victoire' });
    await expect(verdict).toBeFocused();
    await expect(verdict).toHaveAccessibleDescription('Joueur 1 remporte la partie');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Rejouer' })).toBeFocused();
    await expectFocusVisible(page, 'fin de partie');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Arène · manche 1 · premier à 1' })).toBeFocused();
    await toLocalSelection(page);
    await playRound(page, [p1.water, p2.fire], 'wave', 'end');
    await expect(verdict).toBeFocused();

    await tabTo(page, page.getByRole('button', { name: 'Retour à l’accueil' }));
    await page.keyboard.press('Enter');
    await expect(localButton(page)).toBeFocused();
    await expectFocusVisible(page, 'retour à l’accueil');
    expect(problems).toEqual([]);
  });

  test('en ligne : créer, rejoindre, se préparer, jouer et rejouer sans souris', async ({ browser }) => {
    test.setTimeout(120_000);
    const j1 = track(await player(browser));
    const j2 = track(await player(browser, { width: 390, height: 844 }));

    await j1.page.goto('/');
    await tabTo(j1.page, j1.page.getByRole('button', { name: 'Jouer en ligne' }));
    await j1.page.keyboard.press('Enter');
    await expect(j1.page.getByRole('heading', { name: 'Choisissez' })).toBeFocused();
    await tabTo(j1.page, j1.page.getByRole('button', { name: /^Créer une partie/ }));
    await j1.page.keyboard.press('Enter');
    await expect(j1.page.getByText('En attente d’un adversaire')).toBeVisible();
    const code = await j1.page.locator('[data-room-code]').getAttribute('data-room-code');
    expect(code).not.toBeNull();

    await j2.page.goto('/');
    await tabTo(j2.page, j2.page.getByRole('button', { name: 'Jouer en ligne' }));
    await j2.page.keyboard.press('Enter');
    await tabTo(j2.page, j2.page.getByRole('button', { name: /^Rejoindre une partie/ }));
    await j2.page.keyboard.press('Enter');
    await expect(j2.page.getByLabel('Code reçu')).toBeFocused();
    await j2.page.keyboard.type(code ?? '');
    await j2.page.keyboard.press('Enter');
    await expect(lobbyTitle(j2.page)).toBeFocused();
    await expect(lobbyTitle(j1.page)).toBeFocused();

    // Hôte : X = 1 au clavier, puis « Prêt » ; invité : Espace sur le titre.
    const lower = j1.page.getByRole('button', { name: 'Diminuer le score cible' });
    await tabTo(j1.page, lower);
    await expectFocusVisible(j1.page, 'lobby');
    await j1.page.keyboard.press('Enter');
    await j1.page.keyboard.press('Enter');
    await expect(j2.page.getByText('Premier à 1 point')).toBeVisible();
    await tabTo(j1.page, j1.page.getByRole('button', { name: /^Prêt/ }));
    await j1.page.keyboard.press('Enter');
    await j2.page.keyboard.press('Space');

    for (const { page } of [j1, j2]) await toOnlineSelection(page);
    await j1.page.keyboard.press(p1.fire);
    // J2 joue avec les touches de Joueur 1 pour sa propre place (SPEC saisie).
    await j2.page.keyboard.press(p1.plant);
    await expect(hudStatus(j2.page, 0)).toHaveText('Choix verrouillé · Plante');

    for (const { page } of [j1, j2]) {
      await expect(page.locator('.end__title')).toBeFocused({ timeout: 20_000 });
      await expectFocusVisible(page, 'fin en ligne');
    }
    await expect(j2.page.locator('.end__title')).toHaveAccessibleDescription('Joueur 1 remporte la partie');
    // Hôte : les réglages de la revanche précèdent « Rejouer » dans l'ordre de tabulation.
    for (const { page } of [j1, j2]) {
      await tabTo(page, page.getByRole('button', { name: 'Rejouer' }));
      await expectFocusVisible(page, 'rejouer en ligne');
      await page.keyboard.press('Enter');
    }
    for (const { page } of [j1, j2]) await toOnlineSelection(page);

    await j1.page.keyboard.press('Escape');
    await expect(j1.page.getByRole('button', { name: 'Jouer en ligne' })).toBeFocused();
    await expectFocusVisible(j1.page, 'départ de la room');
    expect(j1.problems).toEqual([]);
    expect(j2.problems).toEqual([]);
  });
});

/**
 * Diagnostic (PFC-022) : contraste de l'accueil sous le seuil sur la CI GitHub seulement (runs 36648162703 et
 * 36657980715, 3,69 et 3,88 ; 11,99 et 5,77 à chaque passage local, même sous charge). En CI et en échec seulement,
 * les mesures et un extrait JPEG de la zone partent en annotation publique du run (journaux et rapport exigent une
 * authentification). À retirer une fois la cause établie.
 */
async function publishContrastEvidence(page: Page, area: Locator, samples: readonly ContrastSample[]): Promise<void> {
  if (!process.env['GITHUB_ACTIONS'] || samples.every((sample) => sample.ratio >= sample.required)) return;
  const box = await area.boundingBox();
  const clip = box && { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 20), width: box.width + 80, height: box.height + 40 };
  const image = await page.screenshot({ type: 'jpeg', quality: 80, ...(clip ? { clip } : {}) });
  const measures = samples.map(({ selector, text, ratio, required }) => ({ selector, text, ratio, required }));
  console.log(`::notice title=Diagnostic contraste accueil::${JSON.stringify({ measures, clip })}%0Adata:image/jpeg;base64,${image.toString('base64')}`);
}

test.describe('PFC-021-S2 / AC2 — mouvements réduits', () => {
  test('révélation lisible sans animation ; le choix de l’appareil l’emporte sur la préférence système', async ({ page }) => {
    const problems = trackProblems(page);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await stubScene(page);
    await openFrozen(page);
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');

    // Raccourci de l'accueil : pleinement opaque, contraste AA (écart D46 levé).
    const hint = page.locator('.home__hint');
    await expect(hint).toHaveCSS('opacity', '1');
    if (measuresContrast(page)) {
      const hintContrast = (await measureTextContrast(page)).filter((sample) => HOME_HINT.includes(sample.selector));
      expect(hintContrast.length).toBeGreaterThan(0);
      await publishContrastEvidence(page, hint, hintContrast);
      for (const sample of hintContrast) expect(sample.ratio).toBeGreaterThanOrEqual(sample.required);
    }

    await localButton(page).focus();
    await page.keyboard.press('Enter');
    await startLocalByKeyboard(page);
    await toLocalSelection(page);
    await page.keyboard.press(p1.fire);
    await page.keyboard.press(p2.plant);
    await page.clock.runFor(CYCLE.selection);
    await expect(status(page, 0)).toHaveText('Feu');
    await page.clock.runFor(CYCLE.reveal);
    await page.clock.runFor(clashDelays('burn').toImpact);
    // Résultat immédiatement lisible : bannière, scores et annonce, sans animation perceptible.
    await expect(banner(page)).toContainText('Le Feu consume la Plante');
    await expect(scores(page)).toHaveText(['1', '0']);
    await expect(page.locator('.arena [aria-live="polite"]')).toContainText('Score 1 à 0');
    expect(await runningAnimations(page)).toEqual([]);

    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Réglages' }).click();
    const reduced = page.getByRole('switch', { name: 'Mouvements réduits' });
    await expect(reduced).toHaveAttribute('aria-checked', 'true');
    await reduced.click();
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'false');
    await page.keyboard.press('Escape');
    // Animation voulue par l'appareil malgré la préférence système, y compris après rechargement.
    await expect.poll(async () => (await hint.evaluate((node) => node.getAnimations().length)) > 0).toBe(true);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'false');
    expect(problems).toEqual([]);
  });

  test('sans WebGL et mouvements réduits : partie complète et revanche, rien n’est bloqué', async ({ page }) => {
    const problems = trackProblems(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'WebGL2RenderingContext', { configurable: true, value: undefined });
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFrozen(page);
    await expect(page.locator('canvas.scene-canvas')).toHaveAttribute('data-scene', 'fallback');
    await expect(page.getByRole('status')).toContainText('Scène 3D indisponible sur cet appareil');

    await localButton(page).focus();
    await page.keyboard.press('Enter');
    await startLocalByKeyboard(page);
    await toLocalSelection(page);
    await playRound(page, [p1.plant, p2.water], 'grow', 'end');
    await expect(page.getByRole('heading', { name: 'Victoire' })).toBeFocused();
    await page.keyboard.press('Space');
    await toLocalSelection(page);
    await playRound(page, [p1.fire, p2.water], 'wave', 'end');
    await expect(page.getByText('Joueur 2 remporte la partie')).toBeVisible();
    await expect(page.getByRole('group', { name: 'Trophées de la session' })).toContainText('Joueur 1 : 1');
    expect(problems).toEqual([]);
  });
});

/** Joueur tactile en ligne (contexte propre, adresse cliente propre : limites par IP, PFC-020). */
async function touchPlayer(browser: Browser, viewport: { width: number; height: number }) {
  const context = await isolatedContext(browser, { viewport, hasTouch: true, locale: 'fr-FR' });
  const page = await context.newPage();
  await stubScene(page);
  return { context, page, problems: trackProblems(page) };
}

/** Aucun défilement horizontal (WCAG 1.4.10) et chaque bouton de l'écran est atteignable dans la fenêtre. */
async function expectReflow(page: Page, label: string): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label} : défilement horizontal`).toBe(true);
  for (const button of await page.locator('main button:visible').all()) {
    await button.scrollIntoViewIfNeeded();
    await expect(button, label).toBeInViewport();
  }
}

test.describe('PFC-021-AC1 — contrôles tactiles en ligne sur petit écran', () => {
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    test(`${String(viewport.width)}×${String(viewport.height)} : choisir au toucher, cibles ≥ 44 px, revanche`, async ({ browser }) => {
      test.setTimeout(120_000);
      const j1 = track(await player(browser));
      const j2 = track(await touchPlayer(browser, viewport));
      const { code } = await host(j1.page);
      await join(j2.page, code);
      await expect(lobbyTitle(j2.page)).toBeVisible();
      await expectReflow(j2.page, 'lobby');
      for (let step = 3; step > 1; step -= 1) await j1.page.getByRole('button', { name: 'Diminuer le score cible' }).click();
      await expect(j2.page.getByText('Premier à 1 point')).toBeVisible();
      await j1.page.getByRole('button', { name: /^Prêt/ }).click();
      await j2.page.getByRole('button', { name: /^Prêt/ }).tap();

      await toOnlineSelection(j2.page);
      // Fenêtre réelle de 5 s : géométrie relevée en un seul aller-retour, puis choix au toucher aussitôt.
      const layout = await j2.page.evaluate(() => {
        const controls = [...document.querySelectorAll<HTMLElement>('[role="group"][aria-label="Votre élément"] button, .arena-m__quit')];
        return {
          overflow: document.documentElement.scrollWidth > window.innerWidth,
          controls: controls.map((control) => {
            const box = control.getBoundingClientRect();
            const inside = box.left >= 0 && box.top >= 0 && box.right <= window.innerWidth && box.bottom <= window.innerHeight;
            return { name: control.textContent.trim(), width: box.width, height: box.height, inside };
          }),
        };
      });
      await j2.page.getByRole('group', { name: 'Votre élément' }).getByRole('button', { name: /Plante/ }).tap();
      await toOnlineSelection(j1.page);
      await j1.page.keyboard.press(p1.fire);
      expect(layout.overflow).toBe(false);
      expect(layout.controls.map((control) => control.name).sort()).toEqual(['Eau', 'Feu', 'Plante', 'Quitter']);
      for (const control of layout.controls) {
        expect(control.inside, control.name).toBe(true);
        expect(control.width, control.name).toBeGreaterThanOrEqual(44);
        expect(control.height, control.name).toBeGreaterThanOrEqual(44);
      }

      await expect(j2.page.locator('.arena-m__hint')).toHaveText('Choix verrouillé');
      await expect(hudStatus(j2.page, 0)).toHaveText('Choix verrouillé · Plante');

      await expect(j2.page.getByText('Joueur 1 remporte la partie')).toBeVisible({ timeout: 20_000 });
      await expectReflow(j2.page, 'fin de partie');
      await j2.page.getByRole('button', { name: 'Rejouer' }).tap();
      await j1.page.getByRole('button', { name: 'Rejouer' }).click();
      await toOnlineSelection(j2.page);
      expect(j2.problems).toEqual([]);
    });
  }
});

test.describe('PFC-021-AC1 — audit automatisé (axe WCAG 2.2 AA, contraste mesuré)', () => {
  for (const viewport of VIEWPORTS) {
    test(`écrans locaux ${String(viewport.width)}×${String(viewport.height)}`, async ({ page }) => {
      // Huit analyses axe complètes (plus lentes sous WebKit) et leurs mesures de contraste.
      test.setTimeout(120_000);
      const problems = trackProblems(page);
      await page.setViewportSize(viewport);
      await stubScene(page);
      await openFrozen(page);
      const audit = (label: string, exempt: readonly string[] = []) => expectAccessible(page, label, { frozen: true, exempt });

      await expect(localButton(page)).toBeVisible();
      await audit('accueil', HOME_HINT);
      await page.getByRole('button', { name: 'Règles du jeu' }).click();
      await audit('règles');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Réglages' }).click();
      await audit('réglages');
      await page.keyboard.press('Escape');
      await localButton(page).click();
      await audit('préparation');
      await targetInput(page).fill('11');
      await audit('préparation en erreur');
      await targetInput(page).fill('1');
      await page.getByRole('button', { name: /^Commencer/ }).click();
      await audit('arène, ouverture');
      if (viewport.width < 720) return;

      await toLocalSelection(page);
      await audit('arène, sélection');
      await page.keyboard.press(p1.fire);
      await page.keyboard.press(p2.plant);
      await page.clock.runFor(CYCLE.selection + CYCLE.reveal + clashDelays('burn').toImpact);
      await expect(banner(page)).toContainText('Le Feu consume la Plante');
      await audit('arène, résultat');
      await page.clock.runFor(clashDelays('burn').afterImpact);
      await page.clock.runFor(CYCLE.closing);
      await expect(page.getByRole('heading', { name: 'Victoire' })).toBeVisible();
      await audit('fin de partie');
      expect(problems).toEqual([]);
    });
  }

  test('écrans en ligne : menu, saisie, attente, lobby, arène et fin (bureau et téléphone)', async ({ browser }) => {
    test.setTimeout(120_000);
    const j1 = track(await player(browser));
    const j2 = track(await player(browser, { width: 390, height: 844 }));
    const audit = (page: Page, label: string) => expectAccessible(page, label, { frozen: false });

    await j2.page.goto('/');
    await j2.page.getByRole('button', { name: 'Jouer en ligne' }).click();
    await audit(j2.page, 'menu en ligne');
    await j2.page.getByRole('button', { name: /^Rejoindre une partie/ }).click();
    await audit(j2.page, 'saisie du code');

    const { code } = await host(j1.page);
    await audit(j1.page, 'attente de l’adversaire');
    await j2.page.getByLabel('Code reçu').fill(code);
    await j2.page.getByRole('button', { name: 'Rejoindre', exact: true }).click();
    await expect(lobbyTitle(j2.page)).toBeVisible();
    await audit(j1.page, 'lobby, hôte');
    await audit(j2.page, 'lobby, invité');

    for (let step = 3; step > 1; step -= 1) await j1.page.getByRole('button', { name: 'Diminuer le score cible' }).click();
    await expect(j2.page.getByText('Premier à 1 point')).toBeVisible();
    await j1.page.getByRole('button', { name: /^Prêt/ }).click();
    await j2.page.getByRole('button', { name: /^Prêt/ }).click();
    await toOnlineSelection(j1.page);
    await toOnlineSelection(j2.page);
    // Fenêtre de 5 s réelle : J1 choisit d'abord (verrou affiché), l'arène du téléphone est auditée choix ouverts,
    // puis J2 choisit ; l'arène de bureau est auditée ensuite, quelle qu'en soit la phase.
    await j1.page.keyboard.press(p1.water);
    await audit(j2.page, 'arène en ligne, téléphone');
    // Avant l'échéance, Feu contre Eau ; après (audit lent), choix seul de J1 : J1 gagne dans les deux cas (X = 1).
    await j2.page.keyboard.press(p1.fire);
    await audit(j1.page, 'arène en ligne, bureau');
    await expect(j1.page.getByText('Fin de partie')).toBeVisible({ timeout: 20_000 });
    await expect(j2.page.getByText('Fin de partie')).toBeVisible({ timeout: 20_000 });
    await audit(j1.page, 'fin en ligne, bureau');
    await audit(j2.page, 'fin en ligne, téléphone');
    expect(j1.problems).toEqual([]);
    expect(j2.problems).toEqual([]);
  });

  test('PFC-025 — tour par tour au téléphone : voile et choix audités, voile utilisable au clavier', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await stubScene(page);
    await openFrozen(page);
    await localButton(page).click();
    await page.getByRole('button', { name: /^Commencer/ }).click();
    await page.clock.runFor(CYCLE.banner + CYCLE.ready);
    const gate = page.getByRole('dialog', { name: 'Joueur 1, à vous' });
    await expect(gate).toBeVisible();
    await expectAccessible(page, 'voile de Joueur 1', { frozen: true });
    // Focus sur l'unique action du voile ; Tab reste dans le dialogue ; Entrée ouvre le tour.
    await expect(page.getByRole('button', { name: 'Je suis prêt' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Je suis prêt' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByText('Joueur 1 · touchez un élément')).toBeVisible();
    await expectAccessible(page, 'tour de Joueur 1', { frozen: true });
  });

  test('320×568 (WCAG 1.4.10) : aucun défilement horizontal, chaque bouton atteignable', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await stubScene(page);
    await openFrozen(page);
    await expect(localButton(page)).toBeVisible();
    await expectReflow(page, 'accueil');
    await page.getByRole('button', { name: 'Règles du jeu' }).click();
    await expectReflow(page, 'règles');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Réglages' }).click();
    await expectReflow(page, 'réglages');
    await page.keyboard.press('Escape');
    await localButton(page).click();
    await expectReflow(page, 'préparation');
    await page.getByRole('button', { name: /^Commencer/ }).click();
    await expectReflow(page, 'arène');
  });
});
