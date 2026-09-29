import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BINDINGS,
  assignKey,
  keyLabel,
  learnedLabel,
  parseBindings,
  resolveBinding,
} from '../../../src/client/input/keys.ts';

describe('PFC-004 — réaffectation des touches (codes physiques, D10)', () => {
  it('par défaut : J1 KeyA/KeyS/KeyD, J2 KeyJ/KeyK/KeyL', () => {
    expect(DEFAULT_BINDINGS).toEqual([
      { fire: 'KeyA', water: 'KeyS', plant: 'KeyD' },
      { fire: 'KeyJ', water: 'KeyK', plant: 'KeyL' },
    ]);
  });

  it('réaffecte une action sans toucher aux autres', () => {
    const result = assignKey(DEFAULT_BINDINGS, { player: 0, element: 'fire' }, 'KeyF');

    expect(result).toEqual({
      ok: true,
      bindings: [
        { fire: 'KeyF', water: 'KeyS', plant: 'KeyD' },
        { fire: 'KeyJ', water: 'KeyK', plant: 'KeyL' },
      ],
    });
    expect(DEFAULT_BINDINGS[0].fire).toBe('KeyA');
  });

  it('refuse une touche déjà attribuée à une autre action, y compris de l’autre joueur', () => {
    expect(assignKey(DEFAULT_BINDINGS, { player: 0, element: 'fire' }, 'KeyL')).toEqual({
      ok: false,
      reason: 'conflict',
      with: { player: 1, element: 'plant' },
    });
  });

  it('accepte de réattribuer sa propre touche', () => {
    expect(assignKey(DEFAULT_BINDINGS, { player: 1, element: 'water' }, 'KeyK').ok).toBe(true);
  });

  it.each(['Space', 'Enter', 'NumpadEnter', 'Tab', 'Escape'])('refuse la touche réservée %s', (code) => {
    expect(assignKey(DEFAULT_BINDINGS, { player: 0, element: 'water' }, code)).toMatchObject({
      ok: false,
      reason: 'reserved',
    });
  });

  it('relit des liaisons stockées valides et rejette les invalides', () => {
    expect(parseBindings(JSON.parse(JSON.stringify(DEFAULT_BINDINGS)))).toEqual(DEFAULT_BINDINGS);
    for (const bad of [
      null,
      [],
      [{ fire: 'KeyA', water: 'KeyS', plant: 'KeyD' }],
      [
        { fire: 'KeyA', water: 'KeyS', plant: 'KeyD' },
        { fire: 'KeyA', water: 'KeyK', plant: 'KeyL' },
      ],
      [
        { fire: 'Space', water: 'KeyS', plant: 'KeyD' },
        { fire: 'KeyJ', water: 'KeyK', plant: 'KeyL' },
      ],
      [
        { fire: 'KeyA', water: 'KeyS' },
        { fire: 'KeyJ', water: 'KeyK', plant: 'KeyL' },
      ],
    ]) {
      expect(parseBindings(bad)).toBeNull();
    }
  });
});

describe('PFC-004 — libellés des touches', () => {
  const layout = new Map([['KeyA', 'q']]);

  it('préfère la disposition réelle, puis le libellé appris, puis le repli AZERTY', () => {
    expect(keyLabel('KeyA', layout, { KeyA: 'Z' })).toBe('Q');
    expect(keyLabel('KeyA', null, { KeyA: 'A' })).toBe('A');
    expect(keyLabel('KeyA', null, {})).toBe('Q');
    expect(keyLabel('KeyS', null, {})).toBe('S');
    expect(keyLabel('KeyQ', null, {})).toBe('A');
  });

  it('nomme les touches non imprimables en français', () => {
    expect(keyLabel('ArrowLeft', null, {})).toBe('←');
    expect(keyLabel('Space', null, {})).toBe('Espace');
    expect(keyLabel('ShiftLeft', null, {})).toBe('Maj');
    expect(keyLabel('Numpad4', null, {})).toBe('4');
  });

  it('apprend un libellé seulement pour un caractère imprimable', () => {
    expect(learnedLabel({ key: 'q' })).toBe('Q');
    expect(learnedLabel({ key: 'Shift' })).toBeNull();
    expect(learnedLabel({ key: ' ' })).toBeNull();
  });
});

describe('PFC-005-AC1 — codes physiques vers actions de jeu', () => {
  it.each([
    ['KeyA', 0, 'fire'],
    ['KeyS', 0, 'water'],
    ['KeyD', 0, 'plant'],
    ['KeyJ', 1, 'fire'],
    ['KeyK', 1, 'water'],
    ['KeyL', 1, 'plant'],
  ] as const)('%s cible J%i · %s', (code, player, element) => {
    expect(resolveBinding(DEFAULT_BINDINGS, code)).toEqual({ player, element });
  });

  it('ignore les touches non liées, dont KeyQ (le « A » d’un clavier AZERTY)', () => {
    for (const code of ['KeyQ', 'KeyF', 'Space', 'Digit1', '']) expect(resolveBinding(DEFAULT_BINDINGS, code)).toBeNull();
  });

  it('suit les liaisons réaffectées', () => {
    const result = assignKey(DEFAULT_BINDINGS, { player: 1, element: 'plant' }, 'Semicolon');
    if (!result.ok) throw new Error('réaffectation refusée');
    expect(resolveBinding(result.bindings, 'Semicolon')).toEqual({ player: 1, element: 'plant' });
    expect(resolveBinding(result.bindings, 'KeyL')).toBeNull();
  });
});

describe('PFC-005 — disposition affichée sans Keyboard Layout API', () => {
  it('AZERTY par défaut, QWERTY sur demande, libellés appris prioritaires', () => {
    expect(['KeyA', 'KeyS', 'KeyD'].map((code) => keyLabel(code, null, {}))).toEqual(['Q', 'S', 'D']);
    expect(['KeyA', 'KeyS', 'KeyD'].map((code) => keyLabel(code, null, {}, 'qwerty'))).toEqual(['A', 'S', 'D']);
    expect(keyLabel('KeyA', null, { KeyA: 'A' }, 'azerty')).toBe('A');
    expect(keyLabel('KeyA', new Map([['KeyA', 'q']]), {}, 'qwerty')).toBe('Q');
  });
});
