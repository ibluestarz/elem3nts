import react from '@vitejs/plugin-react';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        // Domaine pur : Node sans DOM ni setup Testing Library, pour prouver l'absence de dépendance environnement.
        test: {
          name: 'domain',
          environment: 'node',
          include: ['tests/unit/domain/**/*.test.ts'],
          restoreMocks: true,
        },
      },
      {
        // Contrat réseau partagé par le client et le Worker : Node pur, comme le domaine.
        test: {
          name: 'protocol',
          environment: 'node',
          include: ['tests/unit/protocol/**/*.test.ts'],
          restoreMocks: true,
        },
      },
      {
        // Intégration Worker : runtime Workers local réel (workerd), piloté depuis Node par l'API de test
        // de wrangler ; @cloudflare/vitest-pool-workers exige encore Vitest 4 (DECISIONS D35).
        test: {
          name: 'worker',
          environment: 'node',
          include: ['tests/integration/**/*.test.ts'],
          restoreMocks: true,
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/tooling/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'tests/unit/domain/**', 'tests/unit/protocol/**'],
          setupFiles: ['tests/setup.ts'],
          restoreMocks: true,
        },
      },
    ],
  },
});
