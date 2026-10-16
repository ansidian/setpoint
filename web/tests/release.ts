// `npm run release:check` (SV-83, D274): the release checks, run only where they haven't already
// passed on HEAD's exact content (passes.ts): npm test, each browser spec file in the normal run and
// under stress, and the board audit when its inputs have changed since it last ran. It says what it
// skipped and why, stops at the first check that fails, and ends by saying whether HEAD is ready to
// release. When a release is coming, the session that pushes runs it straight after, so the release
// finds everything recorded.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Pass} from './passes.ts';
import {auditKey, head, missing, passesOf, specName} from './passes.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const BROWSER = path.join(ROOT, 'web', 'tests', 'browser');

const {tree, rev, clean} = head();
if (!clean) {
  console.error('release:check checks HEAD, and the working tree differs from it: commit first (git status).');
  process.exit(1);
}
const all = fs.readdirSync(BROWSER).filter(file => file.endsWith('.spec.ts')).sort().map(specName);

/** When and where the latest of `passes` ran: "16 Oct 18:02 in .claude/worktrees/sv-82". */
function when(passes: Pass[]): string {
  const last = passes.reduce((a, b) => (a.at > b.at ? a : b));
  const at = new Date(last.at).toLocaleString('en-GB', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
  const dir = path.relative(ROOT, last.dir);
  return `${at}${dir ? ` in ${dir}` : ''}`;
}

const list = (names: string[]) => (names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', '));

function run(args: string[]) {
  const {status} = spawnSync('npm', args, {cwd: ROOT, stdio: 'inherit'});
  if (status !== 0) {
    console.error(`\nrelease:check stopped: npm ${args.join(' ')} failed, so ${rev} isn't ready to release.`);
    process.exit(status ?? 1);
  }
}

/** Fails when a run passed but left no record, as when the files changed while it ran. */
function recorded(ok: boolean, what: string) {
  if (ok) return;
  console.error(`\nrelease:check stopped: ${what} passed but wasn't recorded for ${rev} (did the files change while it ran?).`);
  process.exit(1);
}

console.log(`release:check for ${rev}\n`);
const summary: string[] = [];

const units = passesOf(tree).filter(pass => pass.check === 'unit');
if (units.length) {
  summary.push(`npm test: skipped, passed on this content ${when(units)}.`);
  console.log(summary.at(-1));
} else {
  console.log('npm test: running.');
  run(['test']);
  recorded(passesOf(tree).some(pass => pass.check === 'unit'), 'npm test');
  summary.push('npm test: passed.');
}

for (const check of ['browser', 'stress'] as const) {
  const name = check === 'browser' ? 'Browser checks' : 'Stress run';
  const passes = passesOf(tree).filter(pass => pass.check === check);
  const left = missing(all, passes, check);
  const done = all.filter(spec => !left.includes(spec));
  if (!left.length) {
    summary.push(`${name}: skipped, every spec file passed on this content (latest ${when(passes)}).`);
    console.log(`\n${summary.at(-1)}`);
    continue;
  }
  const skipped = done.length ? ` ${list(done)} already passed on this content (${when(passes)}), skipped.` : '';
  console.log(`\n${name}: running ${left.length === all.length ? 'every spec file' : list(left)}.${skipped}`);
  run(['run', check === 'browser' ? 'test:browser' : 'test:browser:stress', ...(left.length === all.length ? [] : ['--', ...left])]);
  recorded(!missing(all, passesOf(tree), check).length, `the ${name.toLowerCase()}`);
  summary.push(`${name}: passed, ${left.length} spec file${left.length === 1 ? '' : 's'} run${done.length ? ` and ${done.length} skipped as already passed` : ''}.`);
}

const key = auditKey(tree);
const audits = passesOf(key);
if (audits.length) {
  summary.push(`Board audit: skipped, the goldens and boards are as they were when it ran ${when(audits)}, so its page would be the same.`);
  console.log(`\n${summary.at(-1)}`);
} else {
  console.log('\nBoard audit: running, as the goldens or boards have changed since it last ran.');
  run(['run', 'audit:boards']);
  recorded(passesOf(key).length > 0, 'the board audit');
  summary.push('Board audit: ran. Read test-results/audit/index.html before releasing; it has no pass or fail.');
}

console.log(`\n${summary.join('\n')}\n\n${rev} is ready to release.`);
