// @vitest-environment node
import { readFileSync } from 'node:fs';
import browserslist from 'browserslist';
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import postcssConfig from '../../postcss.config.js';
import { BUILD_TARGET } from '../../vite.config.ts';

const REQUIRED_BROWSERSLIST = ['defaults and fully supports es6-module', 'maintained node versions'];
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  browserslist: unknown;
};

/** Familles Browserslist dont le moteur est connu de Vite/Rolldown → préfixe de cible. */
const FAMILY_TO_TARGET: Record<string, string> = {
  chrome: 'chrome',
  edge: 'edge',
  firefox: 'firefox',
  safari: 'safari',
  ios_saf: 'ios',
  opera: 'opera',
};

function minimumVersions(): Map<string, number> {
  const minimum = new Map<string, number>();
  for (const entry of browserslist(REQUIRED_BROWSERSLIST)) {
    const [family = '', range = ''] = entry.split(' ');
    const target = FAMILY_TO_TARGET[family];
    if (target === undefined) continue;
    const version = Number.parseFloat(range.split('-')[0] ?? '');
    const current = minimum.get(target);
    if (current === undefined || version < current) minimum.set(target, version);
  }
  return minimum;
}

describe('PFC-001-AC3 — navigateurs, préfixes et cible JS', () => {
  it('conserve exactement le champ browserslist exigé', () => {
    expect(pkg.browserslist).toStrictEqual(REQUIRED_BROWSERSLIST);
  });

  it('résout la requête vers des navigateurs Chromium, Gecko et WebKit', () => {
    const families = new Set(browserslist(REQUIRED_BROWSERSLIST).map((b) => b.split(' ')[0]));

    for (const family of ['chrome', 'firefox', 'safari', 'ios_saf', 'node']) {
      expect(families.has(family), family).toBe(true);
    }
  });

  it('active Autoprefixer via la configuration PostCSS du projet', async () => {
    expect(postcssConfig.plugins.some((plugin) => plugin.postcssPlugin === 'autoprefixer')).toBe(true);

    const { css } = await postcss(postcssConfig.plugins).process('.t{background-clip:text}', {
      from: undefined,
    });

    expect(css).toContain('-webkit-background-clip:text');
  });

  it('déclare une cible JS Vite qui couvre chaque moteur résolu', () => {
    const declared = new Map(
      BUILD_TARGET.map((t) => {
        const match = /^([a-z]+)([\d.]+)$/.exec(t);
        if (!match?.[1] || !match[2]) throw new Error(`Cible invalide : ${t}`);
        return [match[1], Number.parseFloat(match[2])] as const;
      }),
    );

    for (const [engine, version] of minimumVersions()) {
      const target = declared.get(engine);
      expect(target, `${engine} absent de build.target`).toBeDefined();
      expect(target, `${engine}${String(version)} non couvert`).toBeLessThanOrEqual(version);
    }
  });
});
