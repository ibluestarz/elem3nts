import { describe, expect, it } from 'vitest';
import { codeFromInput, codeFromPath, formatCode, inviteLink } from '../../../src/client/online/invite.ts';
import { CODE, TOKEN } from './onlineFakes.ts';

describe('PFC-015-AC1 — invitation sans token', () => {
  it('groupe le code 4·4 pour la lecture', () => {
    expect(formatCode(CODE)).toBe('K7M2·Q9XA');
  });

  it('le lien ne contient que l’origine et le code, jamais le token', () => {
    const link = inviteLink(CODE, 'https://elem3nts.example');
    expect(link).toBe('https://elem3nts.example/p/K7M2Q9XA');
    expect(link).not.toContain(TOKEN);
  });

  it('lit le code d’un chemin d’invitation, normalisé, et refuse tout autre chemin', () => {
    expect(codeFromPath('/p/k7m2q9xa')).toBe(CODE);
    expect(codeFromPath('/p/K7M2Q9XA/')).toBe(CODE);
    expect(codeFromPath('/p/K7M2')).toBeNull();
    expect(codeFromPath('/p/%E0%A4%A')).toBeNull();
    expect(codeFromPath('/p/K7M2Q9XA/extra')).toBeNull();
    expect(codeFromPath('/')).toBeNull();
  });
});

describe('PFC-015-AC3 — saisie du code reçu', () => {
  it('tolère casse, espaces et séparateurs', () => {
    for (const text of [' k7m2·q9xa ', 'K7M2-Q9XA', 'K7M2 Q9XA', 'k7m2q9xa']) {
      expect(codeFromInput(text)).toEqual({ ok: true, code: CODE });
    }
  });

  it('accepte un lien d’invitation collé tel quel', () => {
    expect(codeFromInput('https://elem3nts.example/p/K7M2Q9XA')).toEqual({ ok: true, code: CODE });
  });

  it('nomme chaque erreur sans jamais corriger en silence', () => {
    expect(codeFromInput('  ')).toEqual({ ok: false, error: 'empty' });
    expect(codeFromInput('K7M2')).toEqual({ ok: false, error: 'incomplete' });
    expect(codeFromInput('K7M2Q9XAB')).toEqual({ ok: false, error: 'too-long' });
    // I, O, 0 et 1 n'existent pas dans l'alphabet des codes (dictée sans ambiguïté).
    for (const text of ['K7M2Q9X0', 'K7M2Q9XO', 'K7M2Q9X1', 'K7M2Q9XI', 'K7M2Q9X!']) {
      expect(codeFromInput(text)).toEqual({ ok: false, error: 'invalid-character' });
    }
  });
});
