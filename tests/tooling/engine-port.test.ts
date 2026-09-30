// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ENGINE_PATCHES, ENGINE_SOURCE, ENGINE_TARGET, portEngine } from '../../scripts/port-engine.ts';

describe('PFC-008 — moteur 3D porté depuis la maquette (D33)', () => {
  it('le fichier porté est exactement la sortie du portage : aucune retouche manuelle ni dérive', async () => {
    const [source, ported] = await Promise.all([readFile(ENGINE_SOURCE, 'utf8'), readFile(ENGINE_TARGET, 'utf8')]);
    expect(ported).toBe(portEngine(source));
  });

  it('chaque correctif s’applique une seule fois ; le reste du moteur est inchangé', async () => {
    const source = await readFile(ENGINE_SOURCE, 'utf8');
    const ported = portEngine(source);
    for (const patch of ENGINE_PATCHES) {
      expect(source.split(patch.from)).toHaveLength(2);
      if (patch.to !== '') expect(ported).toContain(patch.to);
    }
    // Le code (hors en-tête explicatif) n'a plus ni CDN ni global.
    const code = ported.slice(ported.indexOf('*/') + 2);
    expect(code).not.toMatch(/cdn\.jsdelivr|window\.__e3|window\.Elem3ntsEngine/);
    expect(code).toContain('forceContextLoss()');
    // PFC-027 : la boucle n'est demandée que par `warm` (après compilation) et par elle-même, jamais à la construction.
    expect(code.split('requestAnimationFrame(this._loop)')).toHaveLength(3);
    expect(code).toMatch(/\n warm\(ms\)\{[^\n]*requestAnimationFrame\(this\._loop\)/);
    expect(code).toMatch(/\n loop\(\)\{this\.raf=requestAnimationFrame\(this\._loop\)/);
  });

  it('refuse une maquette où un correctif ne trouve plus sa cible', () => {
    expect(() => portEngine('class Engine{\n')).toThrow(/occurrence/);
  });
});
