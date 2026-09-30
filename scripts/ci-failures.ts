/**
 * Liste complète des échecs Playwright en une seule annotation publique du run GitHub (PFC-022, D48) : le reporter
 * `github` ne détaille que 10 erreurs par étape, et journaux comme rapport exigent une authentification.
 * Lancé par la CI seulement en cas d'échec ; ne fait jamais échouer l'étape (sortie 0).
 *
 * Usage : node scripts/ci-failures.ts test-results/results.json
 */
import { existsSync, readFileSync } from 'node:fs';

interface Spec {
  readonly title: string;
  readonly file: string;
  readonly line: number;
  readonly tests: readonly { readonly projectName: string; readonly status: string }[];
}

interface Suite {
  readonly suites?: readonly Suite[];
  readonly specs?: readonly Spec[];
}

/** Tests dont le résultat n'est pas celui attendu (`unexpected`), un par projet (navigateur). */
export function failures(suite: Suite): string[] {
  const own = (suite.specs ?? []).flatMap((spec) =>
    spec.tests
      .filter((test) => test.status === 'unexpected')
      .map((test) => `[${test.projectName}] ${spec.file}:${String(spec.line)} ${spec.title}`),
  );
  return [...own, ...(suite.suites ?? []).flatMap(failures)];
}

/** Commande d'annotation GitHub : `%`, retours chariot et sauts de ligne encodés comme l'exige le format. */
export function notice(title: string, lines: readonly string[]): string {
  const escape = (text: string) => text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
  return `::notice title=${escape(title).replaceAll(':', '%3A').replaceAll(',', '%2C')}::${escape(lines.join('\n'))}`;
}

const path = process.argv[2] ?? 'test-results/results.json';
if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  if (!existsSync(path)) {
    console.log(notice('Échecs Playwright', [`Aucun rapport ${path} : l'étape a échoué avant la fin des tests.`]));
  } else {
    const failed = failures(JSON.parse(readFileSync(path, 'utf8')) as Suite);
    console.log(notice(`Échecs Playwright (${String(failed.length)})`, failed.length > 0 ? failed : ['Aucun test en échec.']));
  }
}
