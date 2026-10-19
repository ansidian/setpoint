// `npm test`: lint, typecheck and Vitest, stopping at the first that fails. A whole run that passes
// is recorded for the content it ran on (passes.ts), unless the files changed meanwhile, so
// release:check doesn't run it again. `npm test -- <args>` passes them to Vitest and isn't recorded.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {record, treeOf} from './passes.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const tree = treeOf();

// Lint and typecheck keep what they found per file under node_modules/.cache, so a run redoes only
// the files that changed (SV-103): the lint rules each read one file, and the cache is keyed by
// content and the config, not file times, so a branch switch can't fool it.
const LINT = ['eslint', '.', '--cache', '--cache-strategy', 'content', '--cache-location', 'node_modules/.cache/eslint/'];
for (const [command, ...rest] of [LINT, ['npm', 'run', 'typecheck'], ['vitest', 'run', ...args]] as [string, ...string[]][]) {
  const {status} = spawnSync(command, rest, {cwd: ROOT, stdio: 'inherit'});
  if (status !== 0) process.exit(status ?? 1);
}
if (!args.length) {
  if (treeOf() === tree) record(tree, {check: 'unit'});
  else console.log('The files changed during the run, so it isn\'t recorded for release:check.');
}
