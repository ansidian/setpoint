// `npm test`: lint, typecheck and Vitest, stopping at the first that fails. A whole run that passes
// is recorded for the content it ran on (passes.ts), unless the files changed meanwhile, so
// release:check doesn't run it again. `npm test -- <args>` passes them to Vitest and isn't recorded.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {record, treeOf} from './passes.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2);
const tree = treeOf();

for (const [command, ...rest] of [['eslint', '.'], ['npm', 'run', 'typecheck'], ['vitest', 'run', ...args]] as [string, ...string[]][]) {
  const {status} = spawnSync(command, rest, {cwd: ROOT, stdio: 'inherit'});
  if (status !== 0) process.exit(status ?? 1);
}
if (!args.length) {
  if (treeOf() === tree) record(tree, {check: 'unit'});
  else console.log('The files changed during the run, so it isn\'t recorded for release:check.');
}
