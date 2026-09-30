import { randomInt } from 'node:crypto';
import type { Browser, BrowserContext, BrowserContextOptions, Locator, Page } from '@playwright/test';
import { matchEndedState, pausedState, roomOf, roundResultState, selectingState, startingState } from './online-fake.ts';
import { CYCLE, DEMO_ARM_MS, clashDelays, type ClashKind } from './timing.ts';

/**
 * Adresse cliente d'un contexte de test (PFC-020, D45). Le Worker limite créations, jonctions et sockets par
 * `CF-Connecting-IP` ; en production Cloudflare pose cet en-tête et écrase celui du client, en local il est
 * pris tel quel. Sans lui, tous les navigateurs de la recette partageraient le budget de 127.0.0.1. Un /64
 * aléatoire du préfixe de documentation IPv6 (2001:db8::/32) : deux contextes ne partagent pas de budget.
 */
export function testClientIp(): string {
  return `2001:db8:${randomInt(0x10000).toString(16)}:${randomInt(0x10000).toString(16)}::1`;
}

/** Contexte doté de sa propre adresse cliente : il a ses propres budgets, comme un joueur sur son réseau. */
export function isolatedContext(browser: Browser, options: BrowserContextOptions = {}): Promise<BrowserContext> {
  return browser.newContext({ ...options, extraHTTPHeaders: { ...options.extraHTTPHeaders, 'cf-connecting-ip': testClientIp() } });
}

/** Collecte toute erreur/avertissement console, exception, requête échouée ou réponse HTTP ≥ 400. */
export function trackProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      problems.push(`console.${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`requestfailed: ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`HTTP ${String(response.status())}: ${response.url()}`);
  });
  return problems;
}

/** Polices de l'écran d'ouverture (descripteurs CSS `font`). */
export const SPLASH_FONTS = ['700 34px Cinzel', '500 11px "Alegreya Sans SC"'] as const;

/** Toutes les graisses utilisées par les écrans de la maquette. */
export const SCREEN_FONTS = [
  ...SPLASH_FONTS,
  '500 15px Cinzel',
  '600 15px Cinzel',
  '400 15px "Alegreya Sans"',
  '500 15px "Alegreya Sans"',
  '700 15px "Alegreya Sans"',
  '700 11px "Alegreya Sans SC"',
] as const;

/**
 * Attend le chargement effectif des polices demandées. `document.fonts.ready` n'est pas utilisé :
 * il peut se résoudre avant la demande des fichiers (cache froid) et, à l'inverse, attend aussi
 * les polices sans rapport (dont celle que `holdSplash` retient). Chaque police est ensuite vérifiée.
 */
export async function waitForFonts(page: Page, fonts: readonly string[] = SPLASH_FONTS): Promise<void> {
  const missing = await page.evaluate(async (descriptors) => {
    await Promise.all(descriptors.map((font) => document.fonts.load(font)));
    return descriptors.filter((font) => !document.fonts.check(font));
  }, fonts);
  if (missing.length > 0) throw new Error(`Polices non chargées : ${missing.join(', ')}`);
}

/**
 * Attend la fin réelle des animations en cours. L'option `animations: 'disabled'` de
 * Playwright ne suffit pas pour une animation pas encore démarrée : mesuré 2 captures
 * sur 20 à l’état initial (opacité 0) sans cette attente, 0 sur 20 avec.
 * Les animations infinies sont ignorées (leur promesse `finished` ne se résout jamais).
 */
export async function waitForAnimations(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished));
  });
}

/** État visuel stable : polices chargées puis animations terminées. */
export async function waitForVisualStability(page: Page, fonts: readonly string[] = SPLASH_FONTS): Promise<void> {
  await waitForFonts(page, fonts);
  await waitForAnimations(page);
}

/**
 * Raster Chromium déterministe pour la parité à tolérance nulle. Sans ces options, les coins
 * arrondis des calques composités (`backdrop-filter`) varient d'une capture à l'autre : mesuré sur la
 * maquette, 3 rendus distincts sur 6 pour le tiroir Réglages mobile, 1 sur 6 avec ces options.
 * Communes au script de capture de la maquette et au projet Playwright Chromium.
 */
export const DETERMINISTIC_CHROMIUM_ARGS = [
  '--disable-gpu',
  '--disable-gpu-rasterization',
  '--disable-partial-raster',
  '--num-raster-threads=1',
] as const;

/** Tailles de référence : bureau et mobile (celle de la maquette en mode appareil). */
export const VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 390, height: 844 },
] as const;

export const splashSnapshotName = (viewport: { width: number; height: number }) =>
  `splash-${String(viewport.width)}x${String(viewport.height)}.png`;

/**
 * États d'écran comparés pixel pour pixel à la maquette. Chaque étape part de l'accueil et
 * n'utilise que des noms accessibles communs à la maquette et à l'application : la référence
 * (scripts/capture-mockup-baseline.ts) et le test (visual.spec.ts) suivent le même parcours.
 */
export interface ScreenState {
  readonly name: string;
  readonly reach: (page: Page) => Promise<void>;
  /** Limite l'état au bureau (la sélection au téléphone est tour par tour, PFC-025). */
  readonly desktopOnly?: boolean;
  /** Limite l'état au téléphone (tour par tour sur un seul appareil, PFC-025). */
  readonly mobileOnly?: boolean;
  /**
   * Zone exclue de la comparaison, masquée à l'identique des deux côtés : même boîte, sélecteur
   * propre à chaque rendu. Réservée à un élément pas encore livré (minuteur jusqu'à PFC-006).
   */
  readonly mask?: { readonly mockup: string; readonly app: string };
  /**
   * Zone fixe exclue des deux côtés, pour un ajout sans équivalent dans la maquette (D32 : trophées
   * de fin). `contains` doit y tenir entièrement dans l'application : toute dérive fait échouer le test.
   */
  readonly zone?: Zone;
  /** Plusieurs zones fixes (mêmes règles que `zone`), pour un écran qui en réunit plusieurs. */
  readonly zones?: readonly Zone[];
  /**
   * Parcours propre à l'application, quand la maquette atteint l'écran par une affordance de prototype
   * (adversaire simulé en ligne) : l'application y arrive par une room simulée (`online-fake.ts`).
   */
  readonly appReach?: (page: Page) => Promise<void>;
  /** L'application joue contre une room simulée (`fakeRoom`, installée avant la navigation). */
  readonly fakeRoom?: boolean;
  /**
   * Moteur bouchonné qui situe les trois éléments (`TRINITY_POINTS`), des deux côtés : les zones à
   * toucher de l'arène en ligne (maquette `trinTaps`) sont alors comparées.
   */
  readonly trinity?: boolean;
}

export interface Zone {
  readonly rect: Rect | ((viewport: Viewport) => Rect);
  readonly contains: string;
}

/** Zones fixes d'un état : `zone` et `zones` réunies. */
export const zonesOf = (state: ScreenState): readonly Zone[] => [...(state.zone ? [state.zone] : []), ...(state.zones ?? [])];

/**
 * Positions écran des trois éléments renvoyées par le moteur bouchonné (expression JavaScript évaluée
 * dans la page) : mêmes points dans la maquette et dans l'application.
 */
export const TRINITY_POINTS = `(() => {
  const w = innerWidth, h = innerHeight, r = Math.round(Math.min(w, h) * 0.08);
  return [0.3, 0.5, 0.7].map((f) => ({ x: Math.round(w * f), y: Math.round(h * 0.62), r }));
})()`;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** Boîte de la zone fixe pour une taille d'écran (une zone peut dépendre de la mise en page). */
export function zoneRect(zone: Zone, viewport: Viewport): Rect {
  return typeof zone.rect === 'function' ? zone.rect(viewport) : zone.rect;
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Pose un calque transparent sur la zone et renvoie son sélecteur, à passer au masque de capture. */
export async function markZone(page: Page, rect: Rect): Promise<Locator> {
  await page.evaluate((zone) => {
    const node = document.createElement('div');
    node.dataset['parityZone'] = '';
    Object.assign(node.style, {
      position: 'fixed',
      left: `${String(zone.x)}px`,
      top: `${String(zone.y)}px`,
      width: `${String(zone.width)}px`,
      height: `${String(zone.height)}px`,
      pointerEvents: 'none',
    });
    document.body.append(node);
  }, rect);
  return page.locator('[data-parity-zone]');
}

/**
 * Frappe d'un joueur sur un clavier AZERTY : code physique et caractère produit. La maquette lit
 * le caractère, l'application le code physique (D10) : le même événement sert aux deux.
 */
export async function pressAzerty(page: Page, code: string, key: string): Promise<void> {
  await page.evaluate(
    ([eventCode, eventKey]) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: eventCode, key: eventKey, bubbles: true }));
    },
    [code, key] as const,
  );
}

/** Ouverture de l'arène puis passage en sélection : 1,8 s de bannière et 0,4 s d'attente. */
/**
 * Avance l'horloge figée d'une phase, puis attend son rendu. L'application planifie chaque échéance
 * après le rendu de la précédente ; la maquette les enchaîne dans ses rappels : phase par phase,
 * les deux rendus restent synchronisés.
 */
async function step(page: Page, ms: number, rendered: () => Promise<unknown>): Promise<void> {
  await page.clock.runFor(ms);
  await rendered();
}

/** Ouverture (1,8 s), attente (0,4 s), puis sélection de la manche 1 avec X donné. */
async function toSelection(page: Page, target = 3): Promise<void> {
  await click(page, 'Jouer en local');
  await click(page, `Score cible ${String(target)}`);
  await click(page, /^Commencer/);
  // Bannière rendue : son échéance est planifiée dans ce même rendu.
  await page.getByText('Que le duel commence').waitFor();
  await step(page, 1800, () => page.getByText('Que le duel commence').waitFor({ state: 'detached' }));
  await step(page, 400, () => page.getByText('Choix en cours…').first().waitFor());
}

/**
 * Fin de la fenêtre de 5 s : les statuts de sélection disparaissent au profit des éléments révélés
 * (les noms d'éléments figurent aussi dans les légendes : ils ne peuvent servir de signal).
 */
const toReveal = (page: Page) =>
  step(page, 5000, () =>
    page
      .getByText(/^Choix (verrouillé|en cours…)$/)
      .first()
      .waitFor({ state: 'detached' }),
  );

/**
 * Début de l'effet (1,1 s, ou 0,5 s sans choix) puis impact (D·I) : scores, deltas et explication.
 * La phase `clash` ne change rien à l'écran : l'application l'expose (`data-phase`), la maquette
 * n'a pas besoin d'être attendue (ses échéances sont enchaînées dans ses rappels). Dans
 * l'application, l'annonce pour lecteurs d'écran reprend l'explication : première occurrence.
 */
async function toImpact(page: Page, kind: ClashKind, subtitle: string): Promise<void> {
  const reveal = kind === 'void' ? CYCLE.revealEmpty : CYCLE.reveal;
  await step(page, reveal, () => page.locator('[data-phase="clash"], body:not(:has([data-phase]))').first().waitFor());
  await step(page, clashDelays(kind).toImpact, () => page.getByText(subtitle).first().waitFor());
}

/** Téléphone : ouverture (1,8 s), attente (0,4 s), puis voile « Joueur 1, à vous » de la manche 1 (PFC-025). */
async function toTurnGate(page: Page): Promise<void> {
  await click(page, 'Jouer en local');
  await click(page, 'Score cible 3');
  await click(page, /^Commencer/);
  await page.getByText('Que le duel commence').waitFor();
  await step(page, 1800, () => page.getByText('Que le duel commence').waitFor({ state: 'detached' }));
  await step(page, 400, () => page.getByText('Joueur 1, à vous').waitFor());
}

/** Voile de Joueur 1 franchi : tour de Joueur 1, zones à toucher et indice de la maquette. */
async function toTurnSelection(page: Page): Promise<void> {
  await toTurnGate(page);
  await click(page, 'Je suis prêt');
  await page.getByText('Joueur 1 · touchez un élément').waitFor();
}

/**
 * Démo des confrontations depuis l'accueil (PFC-026). Sa ligne « premier à X » reprend le X de la
 * préparation (maquette `target`) : X = 3, défaut de l'application (D07), est d'abord réglé des deux côtés.
 */
async function toDemo(page: Page): Promise<void> {
  await toSetup(page);
  await click(page, 'Score cible 3');
  await page.keyboard.press('Escape');
  await click(page, 'Démo des confrontations');
  await page.getByText('Démo · rejouer chaque confrontation').waitFor();
}

/**
 * Démo, confrontation lancée puis révélée 0,7 s plus tard (maquette `runDemo`) : Joueur 1 vainqueur,
 * son élément (Eau pour « Eau › Feu ») apparaît sous son score.
 */
async function toDemoReveal(page: Page, label: string): Promise<void> {
  await toDemo(page);
  await click(page, label);
  await step(page, DEMO_ARM_MS, () => page.getByText('Eau', { exact: true }).first().waitFor());
}

/** Feu (J1, touche Q en AZERTY) contre Plante (J2, touche L). */
async function fireAgainstPlant(page: Page): Promise<void> {
  await pressAzerty(page, 'KeyA', 'q');
  await pressAzerty(page, 'KeyL', 'l');
}

async function click(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('button', { name, exact: typeof name === 'string' }).click();
}

const toSetup = (page: Page) => click(page, 'Jouer en local');

/**
 * Champ « Code reçu » (maquette `onJoining`), agrandi de 6 px pour couvrir l'anneau de focus :
 * le texte indicatif diffère (8 caractères, D16/D39), tout le reste du panneau est comparé.
 */
const JOIN_INPUT_ZONE: Readonly<Record<string, Rect>> = {
  '1280x800': { x: 433, y: 334, width: 414, height: 69 },
  '390x844': { x: 43, y: 356, width: 304, height: 69 },
};

/**
 * Arène en ligne de la maquette : partie créée, X réglé par « − » (défaut 5), adversaire simulé par
 * le bouton de prototype (« Sylve », choix au hasard rendu déterministe : Feu à 0,7 s), puis
 * « Adversaire trouvé » 1,6 s avant l'ouverture de l'arène.
 */
async function mockupOnlineArena(page: Page, target: number): Promise<void> {
  await click(page, 'Jouer en ligne');
  await page.getByRole('button', { name: /^Créer une partie/ }).click();
  for (let value = 5; value > target; value -= 1) await click(page, '−');
  await page.evaluate(() => {
    Math.random = () => 0;
  });
  await click(page, 'Prototype · simuler l’arrivée d’un adversaire');
  await step(page, 1600, () => page.getByText('Que le duel commence').waitFor());
}

/** Ouverture puis sélection de la manche 1 dans la maquette en ligne. */
async function mockupOnlineSelection(page: Page, target: number): Promise<void> {
  await mockupOnlineArena(page, target);
  await step(page, CYCLE.banner, () => page.getByText('Que le duel commence').waitFor({ state: 'detached' }));
  await step(page, CYCLE.ready, () => page.getByText('Réfléchit…').waitFor());
}

/** Eau (touche S) contre le Feu de l'adversaire simulé, jusqu'à l'impact. */
async function mockupOnlineWave(page: Page, target: number): Promise<void> {
  await mockupOnlineSelection(page, target);
  await pressAzerty(page, 'KeyS', 's');
  await toReveal(page);
  await toImpact(page, 'wave', '+1 pour Vous');
}

/** Arène en ligne de l'application : room simulée, états publiés comme par le serveur (hôte, J1). */
async function appOnlineArena(page: Page, target: number) {
  const room = roomOf(page);
  await click(page, 'Jouer en ligne');
  await page.getByRole('button', { name: /^Créer une partie/ }).click();
  await room.authenticated;
  await room.publish(startingState({ target, drawEnabled: true }));
  await page.getByText('Que le duel commence').waitFor();
  return room;
}

async function appOnlineSelection(page: Page, target: number) {
  const room = await appOnlineArena(page, target);
  await step(page, CYCLE.banner, () => page.getByText('Que le duel commence').waitFor({ state: 'detached' }));
  await room.publish(selectingState({ target, drawEnabled: true }));
  await page.getByText('Réfléchit…').waitFor();
  return room;
}

/**
 * Nom de l'adversaire (maquette : « Sylve », pseudonyme de prototype ; application : « Joueur 2 », D18) et
 * état de la connexion (maquette : latence fictive et bouton de prototype retiré, D39) : zones fixes.
 */
const wide = (viewport: Viewport) => viewport.width >= 720;
/** Nom de l'adversaire et son ombre portée (16 px de flou au bureau, 14 px au téléphone). */
const OPPONENT_ZONE: Zone = {
  rect: (viewport) => (wide(viewport) ? { x: 1140, y: 6, width: 134, height: 52 } : { x: 276, y: 4, width: 110, height: 38 }),
  contains: '.arena__player--p2 .arena__name, .arena-m__player--p2 .arena-m__name',
};
/** Au téléphone : « Quitter » seul (maquette : « Quitter » et le bouton de prototype « Simuler une coupure »). */
const NETWORK_ZONE: Zone = {
  rect: (viewport) => (wide(viewport) ? { x: 978, y: 700, width: 290, height: 90 } : { x: 0, y: 776, width: 390, height: 68 }),
  contains: '.arena-net, .arena-m__quit',
};
const ARENA_ZONES = [OPPONENT_ZONE, NETWORK_ZONE] as const;
/**
 * Sous le voile de « Connexion interrompue » (flou de 6 px), le nom de l'adversaire déborde de sa zone :
 * même zone élargie de la portée du flou.
 */
const VEILED_OPPONENT_ZONE: Zone = {
  rect: (viewport) => (wide(viewport) ? { x: 1128, y: 0, width: 152, height: 70 } : { x: 264, y: 0, width: 126, height: 56 }),
  contains: OPPONENT_ZONE.contains,
};
const VEILED_ARENA_ZONES = [VEILED_OPPONENT_ZONE, NETWORK_ZONE] as const;
/**
 * « Connexion interrompue », adversaire absent (PFC-017, D42) : titre (maquette « Sylve ne répond plus »,
 * application « Joueur 2 ne répond plus ») et sous-titre (maquette : manche « annulée », « 60 secondes » ;
 * application : pause et décompte de l'échéance de reconnexion, règle D15). Carte, bordure et boutons comparés.
 */
const LOST_TEXT_ZONE: Zone = {
  rect: (viewport) => (wide(viewport) ? { x: 450, y: 333, width: 380, height: 93 } : { x: 40, y: 328, width: 310, height: 94 }),
  contains: '.lost__title, .lost__sub',
};
/**
 * Fin de partie en ligne : sous-titre (« Vous remportez » corrige l'accord « Vous remporte » de la maquette),
 * rangée des scores recentrée par le nom de l'adversaire, trophées (D32), puis réglages de la revanche (SPEC).
 */
const END_ZONES: readonly Zone[] = [
  { rect: { x: 500, y: 176, width: 280, height: 214 }, contains: '.end__sub, .end__scores, .end__trophies' },
  { rect: { x: 424, y: 509, width: 432, height: 164 }, contains: '.end__settings' },
];

export const SCREEN_STATES: readonly ScreenState[] = [
  // L'accueil est l'état initial : aucune action.
  { name: 'home', reach: () => Promise.resolve() },
  {
    name: 'setup-x3',
    reach: async (page) => {
      await toSetup(page);
      await click(page, 'Score cible 3');
    },
  },
  {
    name: 'setup-x10',
    reach: async (page) => {
      await toSetup(page);
      await click(page, 'Score cible 10');
    },
  },
  { name: 'rules', reach: (page) => click(page, 'Règles du jeu') },
  // PFC-015 : menu en ligne et saisie du code (maquette `online`).
  { name: 'online-menu', reach: (page) => click(page, 'Jouer en ligne') },
  {
    name: 'online-join',
    zone: {
      rect: (viewport) => {
        const rect = JOIN_INPUT_ZONE[`${String(viewport.width)}x${String(viewport.height)}`];
        if (!rect) throw new Error('Zone du champ « Code reçu » inconnue pour cette taille.');
        return rect;
      },
      contains: 'input',
    },
    reach: async (page) => {
      await click(page, 'Jouer en ligne');
      await page.getByRole('button', { name: /^Rejoindre une partie/ }).click();
    },
  },
  { name: 'settings', reach: (page) => click(page, 'Réglages') },
  {
    name: 'settings-draw-off',
    reach: async (page) => {
      await click(page, 'Réglages');
      await waitForAnimations(page);
      await page.getByLabel('Match nul', { exact: true }).click();
    },
  },
  {
    name: 'arena-intro',
    reach: async (page) => {
      await toSetup(page);
      await click(page, 'Score cible 3');
      await click(page, /^Commencer/);
    },
  },
  { name: 'select-start', desktopOnly: true, reach: (page) => toSelection(page) },
  {
    name: 'select-p1-locked',
    desktopOnly: true,
    reach: async (page) => {
      await toSelection(page);
      await pressAzerty(page, 'KeyA', 'q');
      await page.getByText('Choix verrouillé').waitFor();
    },
  },
  {
    name: 'select-both-locked',
    desktopOnly: true,
    reach: async (page) => {
      await toSelection(page);
      await pressAzerty(page, 'KeyA', 'q');
      await pressAzerty(page, 'KeyL', 'l');
      await page.getByText('Choix verrouillé').nth(1).waitFor();
    },
  },
  {
    name: 'select-late',
    desktopOnly: true,
    reach: async (page) => {
      await toSelection(page);
      // 4 s après l'ouverture de la fenêtre : 1 s restante, chiffre en or vif.
      await step(page, 4000, () => page.getByText('1', { exact: true }).waitFor());
    },
  },
  {
    name: 'reveal',
    desktopOnly: true,
    reach: async (page) => {
      await toSelection(page);
      await fireAgainstPlant(page);
      await toReveal(page);
    },
  },
  {
    name: 'result',
    desktopOnly: true,
    reach: async (page) => {
      await toSelection(page);
      await fireAgainstPlant(page);
      await toReveal(page);
      await toImpact(page, 'burn', 'Le Feu consume la Plante');
    },
  },
  {
    name: 'result-solo',
    desktopOnly: true,
    reach: async (page) => {
      await toSelection(page);
      await pressAzerty(page, 'KeyA', 'q');
      await toReveal(page);
      await toImpact(page, 'solo', 'Seul choix de la manche : point pour Joueur 1');
    },
  },
  {
    name: 'result-void',
    desktopOnly: true,
    reach: async (page) => {
      await toSelection(page);
      await toReveal(page);
      await toImpact(page, 'void', 'Aucun choix — la manche est annulée');
    },
  },
  {
    name: 'sudden',
    desktopOnly: true,
    reach: async (page) => {
      // Nul OFF puis X = 1 : Feu + Feu mène à 1/1, égalité au-delà de la cible.
      await click(page, 'Réglages');
      await waitForAnimations(page);
      await page.getByLabel('Match nul', { exact: true }).click();
      await click(page, 'Fermer');
      await toSelection(page, 1);
      await pressAzerty(page, 'KeyA', 'q');
      await pressAzerty(page, 'KeyJ', 'j');
      await toReveal(page);
      // Texte commun aux deux rendus : sous-titre dans la maquette, titre dans l'application (D41).
      await toImpact(page, 'flare', 'Les flammes s’embrasent');
      // Fin de l'effet puis 1,6 s de résultat : même chronologie dans la maquette et l'application.
      await step(page, clashDelays('flare').afterImpact, () => page.getByText('Mort subite', { exact: true }).waitFor());
    },
  },
  {
    name: 'end',
    desktopOnly: true,
    // Ligne « Trophées de la session » (D32), sous les scores : zone vide dans la maquette.
    zone: { rect: { x: 536, y: 326, width: 256, height: 56 }, contains: '.end__trophies, .end__trophy-gain' },
    reach: async (page) => {
      await toSelection(page, 1);
      await fireAgainstPlant(page);
      await toReveal(page);
      await toImpact(page, 'burn', 'Le Feu consume la Plante');
      // Fin de l'effet puis résultat, puis écran de fin 0,7 s plus tard.
      await step(page, clashDelays('burn').afterImpact, () =>
        page.getByText('Le Feu consume la Plante').first().waitFor({ state: 'detached' }),
      );
      await step(page, CYCLE.closing, () => page.getByText('Fin de partie').waitFor());
    },
  },
  // PFC-026 : démo des confrontations (maquette `isDemo`), au repos, révélée, à l'impact, puis revenue au repos.
  { name: 'demo', reach: toDemo },
  { name: 'demo-reveal', reach: (page) => toDemoReveal(page, 'Eau › Feu') },
  {
    name: 'demo-result',
    reach: async (page) => {
      await toDemoReveal(page, 'Eau › Feu');
      // Texte commun aux deux rendus (Eau › Feu, D41 ne s'applique qu'aux éléments identiques).
      await toImpact(page, 'wave', '+1 pour Joueur 1');
    },
  },
  {
    name: 'demo-after',
    desktopOnly: true,
    reach: async (page) => {
      await toDemoReveal(page, 'Eau › Feu');
      await toImpact(page, 'wave', '+1 pour Joueur 1');
      await step(page, clashDelays('wave').afterImpact, () =>
        page.getByText('+1 pour Joueur 1').first().waitFor({ state: 'detached' }),
      );
    },
  },
  // PFC-025 : tour par tour sur un seul téléphone (maquette `gate`, `trinTaps`, `mobHint`).
  { name: 'turn-gate-p1', mobileOnly: true, reach: toTurnGate },
  { name: 'turn-select-p1', mobileOnly: true, trinity: true, reach: toTurnSelection },
  {
    name: 'turn-gate-p2',
    mobileOnly: true,
    trinity: true,
    reach: async (page) => {
      await toTurnSelection(page);
      await click(page, 'Feu');
      await page.getByText('Passez le téléphone à Joueur 2').waitFor();
    },
  },
  {
    name: 'turn-gate-p2-late',
    mobileOnly: true,
    reach: async (page) => {
      await toTurnSelection(page);
      await step(page, CYCLE.selection, () => page.getByText('Joueur 1 n’a pas choisi à temps. Joueur 2 aura 5 secondes.').waitFor());
    },
  },
  // PFC-016 : arène en ligne (maquette `isOnline`), adversaire simulé des deux côtés.
  {
    name: 'online-arena-intro',
    fakeRoom: true,
    trinity: true,
    zones: ARENA_ZONES,
    reach: (page) => mockupOnlineArena(page, 3),
    appReach: async (page) => {
      await appOnlineArena(page, 3);
    },
  },
  {
    name: 'online-select',
    fakeRoom: true,
    zones: ARENA_ZONES,
    trinity: true,
    reach: (page) => mockupOnlineSelection(page, 3),
    appReach: async (page) => {
      await appOnlineSelection(page, 3);
    },
  },
  {
    name: 'online-select-locked',
    fakeRoom: true,
    zones: ARENA_ZONES,
    desktopOnly: true,
    trinity: true,
    reach: async (page) => {
      await mockupOnlineSelection(page, 3);
      await pressAzerty(page, 'KeyA', 'q');
      await page.getByText('Choix verrouillé · Feu').waitFor();
    },
    appReach: async (page) => {
      await appOnlineSelection(page, 3);
      await pressAzerty(page, 'KeyA', 'q');
      await page.getByText('Choix verrouillé · Feu').waitFor();
    },
  },
  {
    name: 'online-result',
    fakeRoom: true,
    zones: ARENA_ZONES,
    desktopOnly: true,
    trinity: true,
    reach: (page) => mockupOnlineWave(page, 3),
    appReach: async (page) => {
      const room = await appOnlineSelection(page, 3);
      await pressAzerty(page, 'KeyS', 's');
      // La révélation vient du serveur, à son échéance : l'état de résultat qu'il publie ouvre la chronologie.
      await room.publish(roundResultState({ target: 3, drawEnabled: true }, ['water', 'fire']));
      await page.locator('[data-phase="reveal"]').waitFor();
      await toImpact(page, 'wave', '+1 pour Vous');
    },
  },
  // PFC-017 : « Connexion interrompue » (maquette `isLost`), arène en pause sous le voile.
  {
    name: 'online-lost',
    fakeRoom: true,
    trinity: true,
    zones: [...VEILED_ARENA_ZONES, LOST_TEXT_ZONE],
    reach: async (page) => {
      await mockupOnlineSelection(page, 3);
      await page.getByRole('button', { name: /simuler une coupure/i }).click();
      await page.getByText('Sylve ne répond plus').waitFor();
    },
    appReach: async (page) => {
      const room = await appOnlineSelection(page, 3);
      await room.publish(pausedState({ target: 3, drawEnabled: true }));
      await page.getByText('Joueur 2 ne répond plus').waitFor();
    },
  },
  {
    name: 'online-lost-retry',
    fakeRoom: true,
    trinity: true,
    zones: VEILED_ARENA_ZONES,
    reach: async (page) => {
      await mockupOnlineSelection(page, 3);
      await page.getByRole('button', { name: /simuler une coupure/i }).click();
      await page.getByRole('button', { name: 'Réessayer' }).click();
      await page.getByText('Reconnexion…').waitFor();
    },
    appReach: async (page) => {
      const room = await appOnlineSelection(page, 3);
      await room.drop();
      await page.getByText('Reconnexion…').waitFor();
    },
  },
  {
    name: 'online-end',
    fakeRoom: true,
    zones: END_ZONES,
    desktopOnly: true,
    trinity: true,
    reach: async (page) => {
      await mockupOnlineWave(page, 1);
      await step(page, clashDelays('wave').afterImpact, () => page.getByText('+1 pour Vous').first().waitFor({ state: 'detached' }));
      await step(page, CYCLE.closing, () => page.getByText('Fin de partie').waitFor());
    },
    appReach: async (page) => {
      const room = await appOnlineArena(page, 1);
      await room.publish(matchEndedState({ target: 1, drawEnabled: true }, ['water', 'fire']));
      await page.getByText('Fin de partie').waitFor();
    },
  },
];

export const screenSnapshotName = (state: string, viewport: { width: number; height: number }) =>
  `${state}-${String(viewport.width)}x${String(viewport.height)}.png`;

/** Écarte le pointeur : aucun état :hover ne doit subsister au moment de la capture. */
export async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
}

/** Codes physiques → caractères d'un clavier AZERTY français (Keyboard Layout API émulée). */
const AZERTY_LAYOUT: readonly (readonly [string, string])[] = [
  ['KeyA', 'q'],
  ['KeyQ', 'a'],
  ['KeyW', 'z'],
  ['KeyZ', 'w'],
  ['KeyS', 's'],
  ['KeyD', 'd'],
  ['KeyJ', 'j'],
  ['KeyK', 'k'],
  ['KeyL', 'l'],
  ['KeyF', 'f'],
  ['KeyG', 'g'],
  ['KeyH', 'h'],
];

/**
 * Émule un clavier AZERTY, celui pour lequel la maquette affiche Q/S/D : c'est l'environnement
 * du joueur qui est simulé, l'application n'expose aucune fixture.
 */
export async function emulateAzertyLayout(page: Page): Promise<void> {
  await page.addInitScript((entries) => {
    Object.defineProperty(navigator, 'keyboard', {
      configurable: true,
      value: { getLayoutMap: () => Promise.resolve(new Map(entries)) },
    });
  }, AZERTY_LAYOUT as [string, string][]);
}

/**
 * Fige l'horloge avant le chargement : `clock.install()` seul laisse le temps s'écouler, si bien
 * que pulse, bannière et délais avanceraient pendant la capture.
 */
export async function freezeClock(page: Page): Promise<void> {
  const now = Date.now();
  await page.clock.install({ time: now });
  await page.clock.pauseAt(now + 1000);
}

/** Durée minimale de l'écran d'ouverture (`SPLASH_MIN_MS`, src/client/App.tsx). */
export const SPLASH_MIN_MS = 600;

/** Maintient l'écran d'ouverture : horloge figée, sa durée minimale ne s'écoule jamais. */
export const holdSplash = freezeClock;

/**
 * Horloge figée puis avancée juste assez pour quitter l'écran d'ouverture. L'écran d'ouverture est
 * attendu d'abord : sa durée minimale est planifiée dans le même rendu.
 */
export async function openFrozen(page: Page): Promise<void> {
  await freezeClock(page);
  await page.goto('/');
  await page.getByText('Invocation de l’arène…').waitFor();
  await page.clock.runFor(SPLASH_MIN_MS);
}

/** États applicables à une taille d'écran (bureau à partir de 720 px, seuil de la maquette). */
export const statesFor = (viewport: { width: number }): readonly ScreenState[] =>
  SCREEN_STATES.filter((state) => (viewport.width >= 720 ? state.mobileOnly !== true : state.desktopOnly !== true));

/**
 * Scène 3D neutralisée pour les tests d'interface et de parcours, comme le moteur de la maquette :
 * le module du moteur est remplacé par un bouchon sans rendu. C'est l'environnement qui est
 * simulé (rendu logiciel mesuré à 0,5–1,1 s par image) ; l'application n'expose aucune fixture.
 */
const appEngineStub = (trinity: boolean) => `
const noop = () => {};
export class Engine {
  constructor() {
    return new Proxy(this, { get: (target, key) => (key in target ? target[key] : key === 'getTrinity' ? () => ${trinity ? TRINITY_POINTS : '[]'} : noop) });
  }
}
`;

export async function stubScene(page: Page, trinity = false): Promise<void> {
  await page.route('**/assets/engine-*.js', (route) =>
    route.fulfill({ contentType: 'text/javascript', body: appEngineStub(trinity) }),
  );
}

/**
 * Aléa déterministe pour la 3D : `Math.random` est remplacé par un générateur à graine, remise à zéro
 * à chaque création de contexte WebGL. Maquette et application consomment alors la même suite.
 */
export async function seedRandomOnWebGL(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let seed = 1;
    Math.random = () => {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext')?.value as (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) => unknown;
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        if (type.startsWith('webgl')) seed = 1;
        return original.call(this, type, ...rest);
      },
    });
  });
}

/** Masque tout ce qui recouvre le canvas 3D (maquette et application : canvas premier enfant). */
/**
 * Masque l'interface pour capturer la scène seule ; renvoie de quoi la réafficher. Feuille construite (CSSOM,
 * `adoptedStyleSheets`) et non balise `<style>` : la CSP de production (`style-src 'self'`, PFC-020) refuse tout style
 * inline, y compris celui d'un outil de test ; la règle s'applique de même aux éléments ajoutés ensuite.
 */
export async function hideInterface(page: Page): Promise<() => Promise<void>> {
  const sheet = await page.evaluateHandle(() => {
    const hidden = new CSSStyleSheet();
    hidden.replaceSync('canvas ~ * { visibility: hidden !important; }');
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, hidden];
    return hidden;
  });
  return async () => {
    await sheet.evaluate((hidden) => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((adopted) => adopted !== hidden);
    });
  };
}

/** Rendu 3D de l'accueil comparé à la maquette : 10 images après l'initialisation du moteur. */
export const SCENE_HOME_FRAMES_MS = 160;

/**
 * Tolérance 3D calibrée (D33) : entre ses propres rendus, la maquette diffère sur 3,9 % des pixels,
 * dont au plus 0,013 % de plus de 25 niveaux. Seuil couleur 0,1 et 0,05 % de pixels au-delà.
 */
export const SCENE_TOLERANCE = { animations: 'disabled', threshold: 0.1, maxDiffPixelRatio: 0.0005 } as const;

/**
 * Part de pixels différant de plus de 25 niveaux entre deux captures PNG, calculée dans le navigateur. Le calcul se
 * fait dans une page vierge du même contexte (`about:blank`, sans CSP) : la page de l'application refuse les images
 * `data:` (`img-src 'self'`, PFC-020) et sa scène 3D occupe son fil principal.
 */
export async function strongDiffRatio(page: Page, first: Buffer, second: Buffer): Promise<number> {
  const scratch = await page.context().newPage();
  try {
    return await diffInBlankPage(scratch, first, second);
  } finally {
    await scratch.close();
  }
}

function diffInBlankPage(page: Page, first: Buffer, second: Buffer): Promise<number> {
  return page.evaluate(
    async ([a, b]) => {
      const load = (src: string) =>
        new Promise<HTMLImageElement>((resolve) => {
          const image = new Image();
          image.onload = () => {
            resolve(image);
          };
          image.src = src;
        });
      const pixels = (image: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D indisponible.');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height).data;
      };
      const [left, right] = await Promise.all([load(a), load(b)]);
      const x = pixels(left);
      const y = pixels(right);
      let strong = 0;
      for (let index = 0; index < x.length; index += 4) {
        const delta = Math.max(
          Math.abs((x[index] ?? 0) - (y[index] ?? 0)),
          Math.abs((x[index + 1] ?? 0) - (y[index + 1] ?? 0)),
          Math.abs((x[index + 2] ?? 0) - (y[index + 2] ?? 0)),
        );
        if (delta > 25) strong += 1;
      }
      return strong / (x.length / 4);
    },
    [`data:image/png;base64,${first.toString('base64')}`, `data:image/png;base64,${second.toString('base64')}`] as const,
  );
}
