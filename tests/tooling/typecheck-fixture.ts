import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

/** Compile `tests/tooling/fixtures/<name>/tsconfig.json` avec le vrai `tsc`, sans rien émettre. */
export function typecheckFixture(name: string) {
  const project = fileURLToPath(new URL(`./fixtures/${name}/tsconfig.json`, import.meta.url));
  return spawnSync(process.execPath, [tscBin, '-p', project, '--pretty', 'false'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
}
