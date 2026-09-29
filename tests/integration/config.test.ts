import { readFileSync } from 'node:fs';
import { unstable_readConfig } from 'wrangler';
import { describe, expect, it } from 'vitest';

/**
 * Vue typée des champs vérifiés : le type `Config` de wrangler vient de `@cloudflare/workers-utils`,
 * embarqué sans ses déclarations, donc illisible pour le typecheck.
 */
interface WorkerConfig {
  readonly main: string | undefined;
  readonly compatibility_date: string;
  readonly send_metrics: boolean | undefined;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly assets: unknown;
  readonly durable_objects: { readonly bindings: readonly { readonly name: string; readonly class_name: string }[] };
  readonly migrations: readonly { readonly new_sqlite_classes?: readonly string[]; readonly new_classes?: readonly string[] }[];
  readonly observability: unknown;
}

function readConfig(path: string): WorkerConfig {
  const config: unknown = unstable_readConfig({ config: path });
  return config as WorkerConfig;
}

const production = readConfig('wrangler.jsonc');
const harness = readConfig('tests/integration/harness/wrangler.jsonc');

describe('PFC-011-AC3 — configuration Worker et migration initiale', () => {
  it('sert l’API avant les fichiers statiques et le repli SPA', () => {
    expect(production.main?.endsWith('src/worker/index.ts')).toBe(true);
    expect(production.assets).toEqual({
      not_found_handling: 'single-page-application',
      run_worker_first: ['/api', '/api/*'],
    });
  });

  it('lie ROOMS à Room (migration v1) et LIMITER à Limiter (v2, PFC-020), en SQLite, migrations append-only', () => {
    expect(production.durable_objects.bindings).toEqual([
      { name: 'ROOMS', class_name: 'Room' },
      { name: 'LIMITER', class_name: 'Limiter' },
    ]);
    // v1 reste identique à son déploiement ; v2 s'ajoute après elle.
    expect(production.migrations).toEqual([
      { tag: 'v1', new_sqlite_classes: ['Room'] },
      { tag: 'v2', new_sqlite_classes: ['Limiter'] },
    ]);
    // Chaque classe liée est créée par une migration SQLite (jamais le stockage clé-valeur hérité).
    const sqliteClasses = production.migrations.flatMap((migration) => migration.new_sqlite_classes ?? []);
    for (const { class_name: className } of production.durable_objects.bindings) {
      expect(sqliteClasses).toContain(className);
    }
    expect(production.migrations.flatMap((migration) => migration.new_classes ?? [])).toEqual([]);
  });

  it('exporte les classes liées depuis l’entrée du Worker', () => {
    const entry = readFileSync('src/worker/index.ts', 'utf8');
    expect(entry).toMatch(/^export \{ Room \} from '\.\/room\.ts';$/m);
    expect(entry).toMatch(/^export \{ Limiter \} from '\.\/limiter\.ts';$/m);
  });

  it('PFC-020 — active Workers Logs pour tous les événements (journal structuré)', () => {
    expect(production.observability).toEqual({ enabled: true, head_sampling_rate: 1 });
  });

  it('ne déclare ni variable ni secret, et n’envoie aucune télémétrie', () => {
    expect(production.vars).toEqual({});
    expect(production.send_metrics).toBe(false);
    const ignored = readFileSync('.gitignore', 'utf8').split('\n');
    expect(ignored).toEqual(expect.arrayContaining(['.wrangler/', '.dev.vars*', '.env*']));
  });

  it('ne dépasse pas la date du runtime workerd fourni', () => {
    const { version } = JSON.parse(readFileSync('node_modules/workerd/package.json', 'utf8')) as { version: string };
    const runtimeDate = /^1\.(\d{4})(\d{2})(\d{2})\./.exec(version)?.slice(1).join('-');
    expect(runtimeDate).toBeDefined();
    expect(production.compatibility_date <= String(runtimeDate)).toBe(true);
  });

  it('le Worker de test reprend date, liaison et migration de production', () => {
    expect(harness.compatibility_date).toBe(production.compatibility_date);
    expect(harness.durable_objects.bindings).toEqual(production.durable_objects.bindings);
    expect(harness.migrations).toEqual(production.migrations);
  });
});
