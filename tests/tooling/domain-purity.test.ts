// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { typecheckFixture } from './typecheck-fixture.ts';

describe('PFC-002-AC3 — domaine sans dépendance d’environnement', () => {
  it('refuse DOM, minuteurs et API Node dans le projet TypeScript du domaine', () => {
    const result = typecheckFixture('domain-purity');

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/impur\.ts\(2,\d+\): error TS2584: Cannot find name 'document'/);
    expect(result.stdout).toMatch(/impur\.ts\(3,\d+\): error TS2304: Cannot find name 'setTimeout'/);
    expect(result.stdout).toMatch(/impur\.ts\(4,\d+\): error TS2591: Cannot find name 'process'/);
  });
});
