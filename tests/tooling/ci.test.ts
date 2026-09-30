// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { failures, notice } from '../../scripts/ci-failures.ts';
import { TARGETS, artifactProblem, isTarget, targetForEnvironment, verifyCommand } from '../../scripts/deploy-target.ts';

/**
 * PFC-022 — contrat de la CI (.github/workflows/ci.yml) et garde de déploiement. Le workflow est lu par son
 * indentation (format écrit ici, aucune dépendance YAML ajoutée) ; sa syntaxe l'est par GitHub à chaque run.
 */

const workflow = readFileSync(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  scripts: Record<string, string>;
};

/** Section `jobs:` (les déclencheurs `on:` ont la même indentation que les jobs). */
const jobs = workflow.slice(workflow.indexOf('\njobs:\n'));

/** Bloc d'un job : de `  <nom>:` jusqu'au job suivant (indentation 2) ou la fin du fichier. */
function job(name: string): string {
  const lines = jobs.split('\n');
  const start = lines.indexOf(`  ${name}:`);
  expect(start, `job ${name}`).toBeGreaterThan(-1);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

const jobNames = [...jobs.matchAll(/^ {2}([\w-]+):$/gm)].map((match) => match[1]);
/** Commandes des étapes `run:`, sans l'écran virtuel qui enveloppe les E2E (`xvfb-run -a`). */
const runs = (block: string) =>
  [...block.matchAll(/^\s+(?:- )?run: (.+)$/gm)].map((match) => String(match[1]).replace(/^xvfb-run -a /, ''));
const verifyJob = job('verify');
const deployJob = job('deploy-staging');

describe('PFC-022-S1 / AC1 — gates de la CI dans l’ordre imposé, aucun déploiement sur échec', () => {
  it('la CI ne contient que le job de gates et le job de déploiement staging', () => {
    expect(jobNames).toEqual(['verify', 'deploy-staging']);
  });

  it('npm ci puis exactement les étapes de `npm run verify`, dans le même ordre, chacune bloquante', () => {
    const verifySteps = [...(pkg.scripts['verify'] ?? '').matchAll(/npm run ([\w:]+)/g)].map((match) => `npm run ${String(match[1])}`);
    expect(verifySteps).toEqual(['npm run build', 'npm run test:functional', 'npm run lint', 'npm run test:e2e']);
    const steps = runs(verifyJob);
    expect(steps[0]).toBe('npm ci');
    expect(steps.filter((step) => step.startsWith('npm run '))).toEqual(verifySteps);
    // Navigateurs installés avant les E2E ; aucune étape tolérante à l'échec.
    expect(steps.findIndex((step) => step.startsWith('npx playwright install'))).toBeLessThan(steps.indexOf('npm run test:e2e'));
    expect(workflow).not.toMatch(/continue-on-error|\|\| true/);
    // Firefox headless n'a WebGL2 qu'avec un serveur d'affichage, comme sur le poste de référence.
    expect(verifyJob).toMatch(/^ {6}- run: xvfb-run -a npm run test:e2e$/m);
  });

  it('l’artefact n’est publié qu’après tous les gates ; le rapport Playwright seulement en cas d’échec', () => {
    const e2e = verifyJob.indexOf('run: xvfb-run -a npm run test:e2e');
    const artifact = verifyJob.indexOf('name: dist-staging');
    expect(e2e).toBeGreaterThan(-1);
    expect(artifact).toBeGreaterThan(e2e);
    expect(verifyJob).toMatch(/if: failure\(\)\n\s+uses: actions\/upload-artifact@\w+ # [\w.]+\n\s+with:\n\s+name: playwright-report/);
    expect([...workflow.matchAll(/retention-days: (\d+)/g)].map((match) => Number(match[1]))).toEqual([7, 7, 7]);
  });

  it('gates et smoke sur Ubuntu 22.04, la distribution du poste qui capture les références visuelles', () => {
    expect([...workflow.matchAll(/^ {4}runs-on: (.+)$/gm)].map((match) => match[1])).toEqual(['ubuntu-22.04', 'ubuntu-22.04']);
  });

  it('en échec, la liste complète des tests en erreur est publiée sans bloquer ni masquer l’échec', () => {
    expect(verifyJob).toMatch(/if: failure\(\)\n\s+run: node scripts\/ci-failures\.ts test-results\/results\.json/);
    expect(failures({ suites: [{ specs: [
      { title: 'a', file: 'x.spec.ts', line: 3, tests: [
        { projectName: 'chromium', status: 'unexpected', results: [{ annotations: [{ type: 'revanche 2', description: '{"listeners":174}' }] }] },
        { projectName: 'webkit', status: 'expected' },
      ] },
    ], suites: [{ specs: [{ title: 'b', file: 'y.spec.ts', line: 9, tests: [{ projectName: 'firefox', status: 'flaky' }] }] }] }] }))
      .toEqual(['[chromium] x.spec.ts:3 a', '    revanche 2 : {"listeners":174}']);
    expect(notice('Échecs, 2: fin', ['a 100%', 'b'])).toBe('::notice title=Échecs%2C 2%3A fin::a 100%25%0Ab');
  });

  it('un clone propre sort en LF quel que soit `core.autocrlf` du poste (sinon le gate échoue en CRLF)', () => {
    const attributes = readFileSync(new URL('../../.gitattributes', import.meta.url), 'utf8');
    expect(attributes.split('\n')).toContain('* text=auto eol=lf');
  });

  it('le déploiement dépend du job verify, à la demande seulement, depuis main', () => {
    expect(deployJob).toMatch(/^ {4}needs: verify$/m);
    expect(deployJob).toMatch(
      /^ {4}if: github\.event_name == 'workflow_dispatch' && inputs\.deploy_staging && github\.ref == 'refs\/heads\/main'$/m,
    );
    expect(workflow).not.toMatch(/pull_request_target|workflow_run/);
  });

  it('publie l’artefact vérifié sans le reconstruire, puis lance le smoke contre l’adresse staging', () => {
    const steps = runs(deployJob);
    expect(steps).toEqual(['npm ci', 'npm run deploy:staging', 'npx playwright install --with-deps chromium', 'npm run test:smoke']);
    expect(deployJob.indexOf('name: dist-staging')).toBeLessThan(deployJob.indexOf('run: npm run deploy:staging'));
    expect(verifyJob).toMatch(new RegExp(`^ {6}CLOUDFLARE_ENV: ${TARGETS.staging.environment}$`, 'm'));
    expect(deployJob).toContain(`SMOKE_URL: ${TARGETS.staging.url}`);
    expect(deployJob).toContain(`url: ${TARGETS.staging.url}`);
    expect(workflow).not.toMatch(/deploy:production|wrangler deploy/);
  });

  it('secrets Cloudflare dans la seule étape de publication ; droits minimaux ; actions figées par commit', () => {
    const secrets = [...workflow.matchAll(/\$\{\{ secrets\.(\w+) \}\}/g)].map((match) => match[1]);
    expect(secrets).toEqual(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
    const publish = deployJob.slice(deployJob.indexOf('name: Publication staging'), deployJob.indexOf('run: npx playwright install'));
    expect(publish).toContain('secrets.CLOUDFLARE_API_TOKEN');
    expect(publish).toContain('secrets.CLOUDFLARE_ACCOUNT_ID');
    expect(workflow).toMatch(/^permissions:\n {2}contents: read$/m);
    const actions = [...workflow.matchAll(/uses: (\S+)/g)].map((match) => String(match[1]));
    expect(actions.length).toBeGreaterThan(0);
    for (const action of actions) expect(action).toMatch(/^actions\/[\w-]+@[0-9a-f]{40}$/);
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(2);
  });
});

describe('PFC-022-AC2 — garde de déploiement : un artefact ne part que vers sa cible', () => {
  const staging = { name: 'elem3nts-staging', targetEnvironment: 'staging', topLevelName: 'elem3nts' };
  const production = { name: 'elem3nts', topLevelName: 'elem3nts' };

  it('accepte l’artefact construit pour la cible demandée', () => {
    expect(artifactProblem(staging, 'staging')).toBeNull();
    expect(artifactProblem(production, 'production')).toBeNull();
  });

  it('refuse un artefact d’une autre cible et indique la commande qui construit le bon', () => {
    expect(artifactProblem(production, 'staging')).toBe(
      'Artefact construit pour la production (Worker « elem3nts »), pas pour staging : lancer « CLOUDFLARE_ENV=staging npm run verify ».',
    );
    expect(artifactProblem(staging, 'production')).toBe(
      'Artefact construit pour « staging » (Worker « elem3nts-staging »), pas pour production : lancer « npm run verify ».',
    );
    // Nom renommé à la main sans environnement : refusé aussi.
    expect(artifactProblem({ ...production, name: 'elem3nts-staging' }, 'staging')).not.toBeNull();
  });

  it('refuse une configuration illisible et une cible inconnue', () => {
    expect(artifactProblem(null, 'staging')).toBe('dist/elem3nts/wrangler.json illisible.');
    expect(artifactProblem('elem3nts', 'production')).not.toBeNull();
    expect(isTarget('staging')).toBe(true);
    expect(isTarget('preview')).toBe(false);
    expect(isTarget('toString')).toBe(false);
    expect(verifyCommand('staging')).toBe('CLOUDFLARE_ENV=staging npm run verify');
    expect(targetForEnvironment(undefined)).toBe('production');
    expect(targetForEnvironment('')).toBe('production');
    expect(targetForEnvironment('staging')).toBe('staging');
    expect(targetForEnvironment('preview')).toBeNull();
  });

  it('les scripts npm passent par le garde, jamais par wrangler directement', () => {
    expect(pkg.scripts['deploy:staging']).toBe('node scripts/deploy.ts staging');
    expect(pkg.scripts['deploy:production']).toBe('node scripts/deploy.ts production');
    expect(pkg.scripts['test:smoke']).toBe('playwright test --config playwright.smoke.config.ts');
  });
});
