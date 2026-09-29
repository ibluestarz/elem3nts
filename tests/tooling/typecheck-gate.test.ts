// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { typecheckFixture as typecheck } from './typecheck-fixture.ts';

describe('PFC-001-S2 — échec de type', () => {
  it('fait échouer le typecheck avec un code non nul sur une erreur volontaire', () => {
    const result = typecheck('type-error');

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/erreur-volontaire\.ts\(2,\d+\): error TS2322/);
  });

  it('réussit avec la même configuration quand le code est valide', () => {
    const result = typecheck('valid');

    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe('');
    expect(result.status).toBe(0);
  });
});
