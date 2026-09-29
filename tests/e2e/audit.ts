import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/**
 * Audit d'accessibilité des E2E (PFC-021) : règles axe-core WCAG 2.2 A/AA et bonnes pratiques, puis contraste
 * du texte mesuré sur le rendu réel.
 */

const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * Violations axe de l'état affiché, animations d'entrée terminées (sinon un fondu en cours fausse les
 * couleurs). Mode « legacy » : tout s'exécute dans la page (pas de page auxiliaire). Sous horloge figée
 * (`openFrozen`), les minuteries internes d'axe attendent l'horloge : elle avance d'1 ms tant que l'analyse
 * est en cours (quelques dizaines de ms au total, sans effet sur une phase de jeu).
 */
/**
 * Attend la fin des animations finies en cours. Contrairement à `waitForAnimations`, une animation annulée
 * (élément retiré par un changement de phase, en ligne) ne fait pas échouer l'attente.
 */
function settleAnimations(page: Page): Promise<void> {
  return page.evaluate(async () => {
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
  });
}

export async function axeViolations(page: Page, frozen: boolean): Promise<string[]> {
  await settleAnimations(page);
  const state = { done: false };
  const analysis = new AxeBuilder({ page })
    .setLegacyMode(true)
    .withTags(AXE_TAGS)
    .analyze()
    .finally(() => {
      state.done = true;
    });
  while (frozen && !state.done) await page.clock.runFor(1);
  const { violations } = await analysis;
  return violations.map((violation) => `${violation.id} : ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
}

/**
 * Rendu de référence du contraste : Chromium, comme la parité visuelle (D33). Le contraste est une propriété des
 * couleurs de la maquette ; Firefox et WebKit peignent autrement le texte masqué de la mesure (texte en dégradé
 * `background-clip: text`, `-webkit-text-fill-color`), ce qui fausserait le fond mesuré (constaté, D46).
 */
export const measuresContrast = (page: Page) => page.context().browser()?.browserType().name() === 'chromium';

/**
 * Écran conforme : aucune violation axe (tous navigateurs), aucun texte sous son seuil de contraste AA (rendu de
 * référence). `exempt` : sélecteurs (forme de `ContrastSample.selector`) d'écarts documentés dans D46.
 */
export async function expectAccessible(page: Page, label: string, options: { frozen: boolean; exempt?: readonly string[] }): Promise<void> {
  expect(await axeViolations(page, options.frozen), `${label} : axe`).toEqual([]);
  if (!measuresContrast(page)) return;
  const exempt = options.exempt ?? [];
  const below = belowAA(await measureTextContrast(page)).filter((sample) => !exempt.includes(sample.selector));
  expect(below, `${label} : contraste`).toEqual([]);
}

/**
 * Contraste réel du texte (WCAG 1.4.3). axe-core laisse ce critère « incomplet » sur cette interface :
 * dégradés, voiles et canvas 3D derrière le texte. Ici, le fond est **mesuré** : capture de la page texte
 * masqué, puis, pour chaque texte visible, contraste entre sa couleur (opacité cumulée des ancêtres comprise)
 * et chaque pixel de fond sous sa boîte. Le 10e centile des pixels est retenu : quelques pixels clairs d'un
 * dégradé n'annulent pas le verdict, une zone entière de fond insuffisant le fait. Le halo (`text-shadow`) reste
 * dans la capture du fond : la compréhension WCAG de 1.4.3 l'admet comme partie du fond du texte. Contrôles
 * désactivés exclus (WCAG : composants inactifs).
 */

export interface ContrastSample {
  readonly selector: string;
  readonly text: string;
  readonly ratio: number;
  readonly required: number;
}

interface TextBox {
  readonly selector: string;
  readonly text: string;
  readonly rgba: readonly [number, number, number, number];
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly required: number;
}

/** Textes visibles de la page, avec couleur effective et seuil applicable (texte large : 3:1). */
function collectText(): TextBox[] {
  const boxes: TextBox[] = [];
  const describe = (element: Element) => {
    const classes = [...element.classList].slice(0, 2).map((name) => `.${name}`).join('');
    return `${element.tagName.toLowerCase()}${classes}`;
  };
  const opacityOf = (element: Element | null) => {
    let opacity = 1;
    for (let node = element; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
    return opacity;
  };
  const inactive = (element: Element) => element.closest('[disabled], [aria-disabled="true"]') !== null;
  for (const element of document.body.querySelectorAll('*')) {
    const text = [...element.childNodes]
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent ?? '')
      .join('')
      .trim();
    if (text === '' || inactive(element)) continue;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    // Texte réservé aux lecteurs d'écran (boîte 1×1) ou hors de la fenêtre : sans objet.
    if (style.visibility !== 'visible' || rect.width < 2 || rect.height < 2) continue;
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) continue;
    const match = /rgba?\(([\d.]+), ([\d.]+), ([\d.]+)(?:, ([\d.]+))?\)/.exec(style.color);
    if (!match) continue;
    const alpha = Number(match[4] ?? 1) * opacityOf(element);
    if (alpha === 0) continue;
    const size = Number.parseFloat(style.fontSize);
    const bold = Number(style.fontWeight) >= 700;
    boxes.push({
      selector: describe(element),
      text: text.slice(0, 40),
      rgba: [Number(match[1]), Number(match[2]), Number(match[3]), alpha],
      x: Math.max(0, Math.floor(rect.left)),
      y: Math.max(0, Math.floor(rect.top)),
      width: Math.ceil(Math.min(rect.width, innerWidth - rect.left)),
      height: Math.ceil(Math.min(rect.height, innerHeight - rect.top)),
      required: size >= 24 || (bold && size >= 18.66) ? 3 : 4.5,
    });
  }
  return boxes;
}

/** Contraste mesuré de chaque texte visible ; la capture est décodée dans une page vierge (CSP, PFC-020). */
export async function measureTextContrast(page: Page): Promise<ContrastSample[]> {
  // Instantané cohérent : transitions finies attendues, animations infinies figées le temps de la mesure (la
  // couleur relevée et la capture montrent alors la même image), puis relancées.
  await settleAnimations(page);
  const frozen = await page.evaluateHandle(() => {
    const infinite = document.getAnimations().filter((animation) => animation.playState === 'running');
    for (const animation of infinite) animation.pause();
    return infinite;
  });
  const boxes = await page.evaluate(collectText);
  const sheet = await page.evaluateHandle(() => {
    const hidden = new CSSStyleSheet();
    hidden.replaceSync(
      '* { color: transparent !important; -webkit-text-fill-color: transparent !important; caret-color: transparent !important; }',
    );
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, hidden];
    return hidden;
  });
  const capture = await page.screenshot({ animations: 'allow', scale: 'css' });
  await sheet.evaluate((hidden) => {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((adopted) => adopted !== hidden);
  });
  await frozen.evaluate((animations) => {
    for (const animation of animations) animation.play();
  });

  const scratch = await page.context().newPage();
  try {
    return await scratch.evaluate(
      async ([src, items]) => {
        const image = await new Promise<HTMLImageElement>((resolve) => {
          const element = new Image();
          element.onload = () => {
            resolve(element);
          };
          element.src = src;
        });
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas 2D indisponible.');
        context.drawImage(image, 0, 0);
        const channel = (value: number) => {
          const c = value / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        const luminance = (r: number, g: number, b: number) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        return items.map((box) => {
          const data = context.getImageData(box.x, box.y, Math.max(1, box.width), Math.max(1, box.height)).data;
          const [r, g, b, a] = box.rgba;
          const ratios: number[] = [];
          for (let index = 0; index < data.length; index += 4 * 3) {
            const br = data[index] ?? 0;
            const bg = data[index + 1] ?? 0;
            const bb = data[index + 2] ?? 0;
            // Couleur du texte composée sur ce pixel de fond (opacité effective).
            const text = luminance(r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a));
            const back = luminance(br, bg, bb);
            ratios.push((Math.max(text, back) + 0.05) / (Math.min(text, back) + 0.05));
          }
          ratios.sort((left, right) => left - right);
          const ratio = ratios[Math.floor(ratios.length * 0.1)] ?? 21;
          return { selector: box.selector, text: box.text, ratio: Math.round(ratio * 100) / 100, required: box.required };
        });
      },
      [`data:image/png;base64,${capture.toString('base64')}`, boxes] as const,
    );
  } finally {
    await scratch.close();
  }
}

/** Textes sous leur seuil WCAG AA. */
export const belowAA = (samples: readonly ContrastSample[]) => samples.filter((sample) => sample.ratio < sample.required);
