import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y-x';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores([
    'dist',
    'node_modules',
    'elem3nts-design',
    'test-results',
    'playwright-report',
    '.wrangler',
    'tests/tooling/fixtures',
    // Moteur 3D de la maquette porté à l'identique (D33) : code tiers de référence visuelle,
    // régénéré par scripts/port-engine.ts ; sa façade typée (engine.d.ts, scene/*.ts) reste lintée.
    'src/client/scene/engine.js',
  ]),
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
  {
    files: ['**/*.{ts,tsx,js}'],
    extends: [js.configs.recommended, tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      ecmaVersion: 2023,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['src/client/**/*.{ts,tsx}', 'tests/unit/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite, jsxA11y.configs.strict],
    languageOptions: { globals: globals.browser },
  },
  {
    // Domaine pur (ARCHITECTURE « Frontières ») : ni UI, ni réseau, ni horloge, ni hasard.
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(react|react-dom|three|cloudflare:|node:|@cloudflare/)',
              message: 'Le domaine reste pur : aucune dépendance UI, rendu, réseau ou runtime.',
            },
            {
              regex: '(^|/)(client|worker|shared)(/|$)',
              message: 'Le domaine ne dépend d’aucune autre couche.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['Date', 'performance', 'crypto', 'globalThis', 'console', 'process'].map((name) => ({
          name,
          message: 'Le domaine est déterministe : temps, hasard et environnement sont injectés.',
        })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Le domaine est déterministe : hasard injecté.' },
      ],
    },
  },
  {
    // Contrat réseau partagé (ARCHITECTURE « Découpage ») : pur comme le domaine, qu'il est seul à importer.
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(react|react-dom|three|cloudflare:|node:|@cloudflare/)',
              message: 'Le contrat partagé reste pur : aucune dépendance UI, rendu, réseau ou runtime.',
            },
            {
              regex: '(^|/)(client|worker)(/|$)',
              message: 'Le contrat partagé ne dépend que du domaine.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['Date', 'performance', 'crypto', 'globalThis', 'console', 'process'].map((name) => ({
          name,
          message: 'Le contrat partagé est déterministe : temps et hasard sont injectés par le serveur.',
        })),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Le contrat partagé est déterministe : hasard injecté.' },
      ],
    },
  },
  {
    // Worker et room Durable Object (ARCHITECTURE « Hébergement », « État et atomicité ») : aucune autorité
    // en mémoire globale du Worker, aucune dépendance UI, aucun journal brut (logs structurés : PFC-020).
    files: ['src/worker/**/*.ts', 'tests/integration/harness/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(react|react-dom|three|node:)',
              message: 'Le Worker ne dépend ni de l’UI, ni du rendu, ni des API Node.',
            },
            {
              regex: '(^|/)client(/|$)',
              message: 'Le Worker ne dépend que du domaine et du contrat partagé.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Program > VariableDeclaration[kind!="const"], Program > ExportNamedDeclaration > VariableDeclaration[kind!="const"]',
          message: 'Aucun état mutable global dans le Worker : l’autorité d’une room vit dans son Durable Object.',
        },
      ],
      'no-console': ['error'],
    },
  },
  {
    files: ['*.config.{ts,js}', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
]);
