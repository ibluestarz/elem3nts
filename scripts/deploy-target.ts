/**
 * Cibles de déploiement (PFC-022, D48) : chaque cible est un Worker distinct de `wrangler.jsonc`, donc ses propres
 * Durable Objects et son propre stockage. L'environnement se choisit au build (`CLOUDFLARE_ENV`) : l'artefact
 * `dist/elem3nts/wrangler.json` est propre à une cible, et `npm run deploy:*` refuse celui d'une autre.
 */

export const TARGETS = {
  staging: { worker: 'elem3nts-staging', environment: 'staging', url: 'https://elem3nts-staging.bluestarz.workers.dev' },
  production: { worker: 'elem3nts', environment: undefined, url: 'https://elem3nts.bluestarz.workers.dev' },
} as const;

export type Target = keyof typeof TARGETS;

/** Configuration aplatie par `vite build` pour la cible choisie ; seule source lue par `wrangler deploy`. */
export const ARTIFACT_CONFIG = 'dist/elem3nts/wrangler.json';

export function isTarget(value: unknown): value is Target {
  return typeof value === 'string' && Object.hasOwn(TARGETS, value);
}

/** Cible d'un build selon `CLOUDFLARE_ENV` (absent ou vide : production) ; `null` pour un environnement inconnu. */
export function targetForEnvironment(environment: string | undefined): Target | null {
  const wanted = environment === '' ? undefined : environment;
  return (Object.keys(TARGETS) as Target[]).find((target) => TARGETS[target].environment === wanted) ?? null;
}

/** Commande qui construit et vérifie l'artefact d'une cible (même ordre que la CI). */
export function verifyCommand(target: Target): string {
  const { environment } = TARGETS[target];
  return environment === undefined ? 'npm run verify' : `CLOUDFLARE_ENV=${environment} npm run verify`;
}

/**
 * Raison de refuser l'artefact pour la cible, ou `null` s'il lui est destiné. Un artefact construit pour une autre
 * cible porterait un autre nom de Worker : le publier écraserait l'autre environnement.
 */
export function artifactProblem(config: unknown, target: Target): string | null {
  if (typeof config !== 'object' || config === null) return `${ARTIFACT_CONFIG} illisible.`;
  const { name, targetEnvironment } = config as { name?: unknown; targetEnvironment?: unknown };
  const expected = TARGETS[target];
  if (name !== expected.worker || targetEnvironment !== expected.environment) {
    const built = typeof targetEnvironment === 'string' ? `« ${targetEnvironment} »` : 'la production';
    return `Artefact construit pour ${built} (Worker « ${String(name)} »), pas pour ${target} : lancer « ${verifyCommand(target)} ».`;
  }
  return null;
}
