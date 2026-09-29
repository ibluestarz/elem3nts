/**
 * Déploiement explicite de l'artefact déjà vérifié (PFC-022, D48) : aucun build ici, pour publier exactement ce
 * que le gate a testé. Refuse un artefact construit pour une autre cible, et en production un arbre git modifié
 * (version non traçable). La version publiée porte le commit en tag et en message : `wrangler versions list`
 * puis `wrangler rollback` la retrouvent (docs/RUNBOOK.md).
 *
 * Usage : CLOUDFLARE_ENV=staging npm run verify && npm run deploy:staging
 * Accès : `npx wrangler login`, ou CLOUDFLARE_API_TOKEN et CLOUDFLARE_ACCOUNT_ID (CI) lus par wrangler lui-même ;
 * ce script ne lit ni n'affiche aucun jeton.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { ARTIFACT_CONFIG, TARGETS, artifactProblem, isTarget, verifyCommand } from './deploy-target.ts';

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const target = process.argv[2];
if (!isTarget(target)) fail('Usage : node scripts/deploy.ts <staging|production>');
if (!existsSync(ARTIFACT_CONFIG)) fail(`Aucun artefact (${ARTIFACT_CONFIG}) : lancer d'abord « ${verifyCommand(target)} ».`);

const problem = artifactProblem(JSON.parse(readFileSync(ARTIFACT_CONFIG, 'utf8')), target);
if (problem !== null) fail(problem);

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const commit = git('rev-parse', 'HEAD');
const modified = git('status', '--porcelain') !== '';
if (modified && target === 'production') fail('Arbre git modifié : la production ne publie qu’un commit exact.');

const { worker, url } = TARGETS[target];
console.log(`→ ${worker} depuis ${ARTIFACT_CONFIG} (commit ${commit.slice(0, 12)}${modified ? ', arbre modifié' : ''})`);
const deploy = spawnSync(
  'wrangler',
  [
    'deploy',
    '--config',
    ARTIFACT_CONFIG,
    // Refuse d'écraser un changement fait hors dépôt (tableau de bord) depuis le dernier déploiement.
    '--strict',
    '--tag',
    commit.slice(0, 12),
    '--message',
    `${target} ${commit}${modified ? ' + modifications locales' : ''}`,
  ],
  { stdio: 'inherit' },
);
if (deploy.error) fail(`wrangler introuvable (${deploy.error.message}) : passer par « npm run deploy:${target} ».`);
if (deploy.status !== 0) process.exit(deploy.status ?? 1);
if (url !== undefined) console.log(`✓ ${url} — smoke : SMOKE_URL=${url} npm run test:smoke`);
