import { readFileSync } from 'node:fs';
import { unstable_readConfig } from 'wrangler';
import { describe, expect, it } from 'vitest';

/**
 * Vue typée des champs vérifiés : le type `Config` de wrangler vient de `@cloudflare/workers-utils`,
 * embarqué sans ses déclarations, donc illisible pour le typecheck.
 */
interface WorkerConfig {
  readonly name: string;
  readonly main: string | undefined;
  readonly workers_dev: boolean | undefined;
  readonly preview_urls: boolean | undefined;
  readonly compatibility_date: string;
  readonly send_metrics: boolean | undefined;
  readonly vars: Readonly<Record<string, unknown>>;
  readonly assets: unknown;
  readonly durable_objects: { readonly bindings: readonly { readonly name: string; readonly class_name: string }[] };
  readonly migrations: readonly { readonly new_sqlite_classes?: readonly string[]; readonly new_classes?: readonly string[] }[];
  readonly observability: unknown;
}

/**
 * Lit la configuration d'un environnement, indépendamment de `CLOUDFLARE_ENV` : wrangler le prend par défaut, et la
 * CI l'exporte pour tout le gate (D48) ; sans ce retrait, la « production » lue ici serait staging.
 */
function readConfig(path: string, env?: string): WorkerConfig {
  const inherited = process.env['CLOUDFLARE_ENV'];
  delete process.env['CLOUDFLARE_ENV'];
  try {
    const config: unknown = unstable_readConfig({ config: path, ...(env === undefined ? {} : { env }) });
    return config as WorkerConfig;
  } finally {
    if (inherited !== undefined) process.env['CLOUDFLARE_ENV'] = inherited;
  }
}

const production = readConfig('wrangler.jsonc');
const staging = readConfig('wrangler.jsonc', 'staging');
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

describe('PFC-022-AC2 — environnement staging isolé de la production', () => {
  it('staging est un Worker distinct (Durable Objects et stockage distincts), servi sur workers.dev sans URL par version', () => {
    expect(production.name).toBe('elem3nts');
    expect(staging.name).toBe('elem3nts-staging');
    expect(staging.workers_dev).toBe(true);
    expect(staging.preview_urls).toBe(false);
  });

  it('staging reprend exactement le code, les liaisons, les migrations et la journalisation de la production', () => {
    for (const key of ['main', 'compatibility_date', 'assets', 'durable_objects', 'migrations', 'observability', 'send_metrics'] as const) {
      expect(staging[key], key).toEqual(production[key]);
    }
  });

  it('staging ne déclare ni variable ni secret : aucun jeton ne peut atteindre le Worker ou le client', () => {
    expect(staging.vars).toEqual({});
  });
});
