// `npm run release:check` (SV-83, D274): the release checks, each run only where it hasn't already
// passed on what it reads in HEAD (passes.ts, SV-193): npm test, the image build (SV-188), each browser spec file in the normal run and
// under stress, the page screenshots (pages.ts, D281), and the board audit. Stress, the screenshots and the audit run only here, not per change. It says what it
// skipped and why, stops at the first check that fails, and ends by saying whether HEAD is ready to
// release. When a release is coming, the session that pushes runs it straight after, so the release
// finds everything recorded.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Pass} from './passes.ts';
import {head, missing, passesOf, record, specsOf} from './passes.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

const {tree, rev, clean} = head();
if (!clean) {
  console.error('release:check checks HEAD, and the working tree differs from it: commit first (git status).');
  process.exit(1);
}
const specs = specsOf(tree);
const all = Object.keys(specs).sort();

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

const units = passesOf(tree, 'unit');
if (units.length) {
  summary.push(`npm test: skipped, passed on what it reads ${when(units)}.`);
  console.log(summary.at(-1));
} else {
  console.log('npm test: running.');
  run(['test']);
  recorded(passesOf(tree, 'unit').length > 0, 'npm test');
  summary.push('npm test: passed.');
}

// SV-188: the image, built as OPERATIONS.md's deploy builds it, from `git archive` on stdin. A
// tarball context skips .dockerignore, so the web stage's typecheck reads web/tests too, and a file
// they import from outside what it copies fails here rather than at the deploy (SV-174's
// extension/src/words.ts did). It exports nothing, so no image is left behind; this Mac's own
// platform, which a build failure of this kind doesn't depend on.
const images = passesOf(tree, 'image');
if (images.length) {
  summary.push(`Image build: skipped, it built from what it reads ${when(images)}.`);
  console.log(`\n${summary.at(-1)}`);
} else {
  console.log('\nImage build: running (git archive HEAD | docker build).');
  const {status} = spawnSync('bash', ['-o', 'pipefail', '-c', 'git archive --format=tar HEAD | docker build --progress=quiet --output type=cacheonly -'], {cwd: ROOT, stdio: 'inherit'});
  if (status !== 0) {
    console.error(`\nrelease:check stopped: the image didn't build from ${rev} (is Docker running?), so it isn't ready to release.`);
    process.exit(status ?? 1);
  }
  record(tree, 'image');
  summary.push('Image build: built.');
}

for (const check of ['browser', 'stress'] as const) {
  const name = check === 'browser' ? 'Browser checks' : 'Stress run';
  const passes = passesOf(tree, check);
  const left = missing(specs, passes);
  const done = all.filter(spec => !left.includes(spec));
  if (!left.length) {
    summary.push(`${name}: skipped, every spec file passed on what it reads (latest ${when(passes)}).`);
    console.log(`\n${summary.at(-1)}`);
    continue;
  }
  const skipped = done.length ? ` ${list(done)} already passed on what they read (${when(passes)}), skipped.` : '';
  console.log(`\n${name}: running ${left.length === all.length ? 'every spec file' : list(left)}.${skipped}`);
  run(['run', check === 'browser' ? 'test:browser' : 'test:browser:stress', ...(left.length === all.length ? [] : ['--', ...left])]);
  recorded(!missing(specs, passesOf(tree, check)).length, `the ${name.toLowerCase()}`);
  summary.push(`${name}: passed, ${left.length} spec file${left.length === 1 ? '' : 's'} run${done.length ? ` and ${done.length} skipped as already passed` : ''}.`);
}

const shots = passesOf(tree, 'pages');
if (shots.length) {
  summary.push(`Page screenshots: skipped, they matched on what they read ${when(shots)}.`);
  console.log(`\n${summary.at(-1)}`);
} else {
  console.log('\nPage screenshots: comparing.');
  run(['run', 'test:pages']);
  recorded(passesOf(tree, 'pages').length > 0, 'the page screenshots');
  summary.push('Page screenshots: matched.');
}

const audits = passesOf(tree, 'audit');
if (audits.length) {
  summary.push(`Board audit: skipped, the goldens and boards are as they were when it ran ${when(audits)}, so its page would be the same.`);
  console.log(`\n${summary.at(-1)}`);
} else {
  console.log('\nBoard audit: running, as the goldens or boards have changed since it last ran.');
  run(['run', 'audit:boards']);
  recorded(passesOf(tree, 'audit').length > 0, 'the board audit');
  summary.push('Board audit: ran. Read test-results/audit/index.html before releasing; it has no pass or fail.');
}

console.log(`\n${summary.join('\n')}\n\n${rev} is ready to release.`);
