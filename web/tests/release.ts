// `npm run release:check` (SV-83, D274): the release checks, each run only where it hasn't already
// passed on what it reads in HEAD (passes.ts, SV-193): npm test, the image build (SV-188), each
// browser spec file, the same under stress, the page screenshots (pages.ts, D281) and the board
// audit. It says what it skipped and why, and ends by saying whether HEAD is ready to release.
// What's left to run waits for the browser lock (lock.ts) and holds it to the end, so it never runs
// beside another session's browser run, and a release:check started while another runs on the same
// content (ahead.ts, after a push) waits for it and then finds everything passed. With nothing left,
// it takes no lock and answers at once.
//
// `-- pages image` runs only the steps named (unit, image, browser, stress, pages, audit): a slice
// that touches the screen runs those before it lands. `--keep-going` runs every step even after one
// fails, for the check ahead, so a release finds every step that can pass already passed; otherwise
// it stops at the first that fails.
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Check, Pass} from './passes.ts';
import {head, missing, passesOf, record, specsOf} from './passes.ts';
import {acquire, clock, handDown, release} from './browser/lock.ts';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const STEPS = ['unit', 'image', 'browser', 'stress', 'pages', 'audit'] as const;
type Step = (typeof STEPS)[number];

const args = process.argv.slice(2);
const keepGoing = args.includes('--keep-going');
const named = args.filter(arg => arg !== '--keep-going');
for (const name of named) {
  if (!(STEPS as readonly string[]).includes(name)) {
    console.error(`release:check has no step ${name}: name any of ${STEPS.join(', ')}.`);
    process.exit(1);
  }
}
const steps = named.length ? STEPS.filter(step => named.includes(step)) : STEPS;

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

const TITLES: Record<Step, string> = {
  unit: 'npm test', image: 'Image build', browser: 'Browser checks', stress: 'Stress run', pages: 'Page screenshots', audit: 'Board audit',
};

/** A step's state on HEAD: passed (the line saying so), or what's left and how to run it. */
type State = {passed: string} | {running: string; run: () => number; recorded: () => boolean; passing: string};

const npm = (...rest: string[]) => () => spawnSync('npm', rest, {cwd: ROOT, stdio: 'inherit'}).status ?? 1;

// SV-188: the image, built as OPERATIONS.md's deploy builds it, from `git archive` on stdin. A
// tarball context skips .dockerignore, so the web stage's typecheck reads web/tests too, and a file
// they import from outside what it copies fails here rather than at the deploy (SV-174's
// extension/src/words.ts did). It exports nothing, so no image is left behind; this Mac's own
// platform, which a build failure of this kind doesn't depend on.
function buildImage(): number {
  const {status} = spawnSync('bash', ['-o', 'pipefail', '-c', 'git archive --format=tar HEAD | docker build --progress=quiet --output type=cacheonly -'], {cwd: ROOT, stdio: 'inherit'});
  if (status === 0) record(tree, 'image');
  else console.error('The image didn\'t build (is Docker running?).');
  return status ?? 1;
}

function state(step: Step): State {
  const check: Check = step;
  const passes = passesOf(tree, check);
  if (step === 'browser' || step === 'stress') {
    const left = missing(specs, passes);
    const done = all.filter(spec => !left.includes(spec));
    if (!left.length) return {passed: `every spec file passed on what it reads (latest ${when(passes)})`};
    const whole = left.length === all.length;
    return {
      running: `${whole ? 'every spec file' : list(left)}.${done.length ? ` ${list(done)} already passed on what they read (${when(passes)}), skipped.` : ''}`,
      run: npm('run', step === 'browser' ? 'test:browser' : 'test:browser:stress', ...(whole ? [] : ['--', ...left])),
      recorded: () => !missing(specs, passesOf(tree, check)).length,
      passing: `passed, ${left.length} spec file${left.length === 1 ? '' : 's'} run${done.length ? ` and ${done.length} skipped as already passed` : ''}`,
    };
  }
  const recorded = () => passesOf(tree, check).length > 0;
  if (step === 'unit') return passes.length ? {passed: `passed on what it reads ${when(passes)}`} : {running: 'running.', run: npm('test'), recorded, passing: 'passed'};
  if (step === 'image') return passes.length ? {passed: `built from what it reads ${when(passes)}`} : {running: 'running (git archive HEAD | docker build).', run: buildImage, recorded, passing: 'built'};
  if (step === 'pages') return passes.length ? {passed: `matched on what they read ${when(passes)}`} : {running: 'comparing.', run: npm('run', 'test:pages'), recorded, passing: 'matched'};
  return passes.length
    ? {passed: `the goldens and boards are as they were when it ran ${when(passes)}, so its page would be the same`}
    : {running: 'running, as the goldens or boards have changed since it last ran.', run: npm('run', 'audit:boards'), recorded, passing: 'ran. Read test-results/audit/index.html before releasing; it has no pass or fail'};
}

console.log(`release:check for ${rev}${named.length ? `, ${steps.map(step => TITLES[step]).join(', ')} only` : ''}\n`);
const summary: string[] = [];
const failed: Step[] = [];
let locked = false;
process.on('exit', () => release());
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => process.exit(130));

for (const step of steps) {
  let now = state(step);
  if (!('passed' in now) && !locked) {
    // What's left waits for any other browser run, which may be this same check run ahead; what it
    // recorded meanwhile is then skipped.
    const waited = await acquire();
    if (waited > 2000) console.log(`Waited ${clock(waited)} for the test lock.`);
    handDown();
    locked = true;
    now = state(step);
  }
  const title = TITLES[step];
  if ('passed' in now) {
    summary.push(`${title}: skipped, ${now.passed}.`);
    console.log(`${summary.at(-1)}\n`);
    continue;
  }
  console.log(`${title}: ${now.running}`);
  const status = now.run();
  if (status !== 0) {
    summary.push(`${title}: FAILED.`);
    failed.push(step);
    console.error(`\n${title} failed${keepGoing ? ', going on (--keep-going).' : `, so ${rev} isn't ready to release.`}\n`);
    if (!keepGoing) process.exit(status);
    continue;
  }
  if (!now.recorded()) {
    console.error(`\nrelease:check stopped: ${title} passed but wasn't recorded for ${rev} (did the files change while it ran?).`);
    process.exit(1);
  }
  summary.push(`${title}: ${now.passing}.`);
  console.log('');
}
if (locked) release();

const what = named.length ? `${steps.map(step => TITLES[step]).join(', ')} for ${rev}` : rev;
console.log(`${summary.join('\n')}\n\n${failed.length ? `${what}: ${failed.map(step => TITLES[step]).join(', ')} failed, so it isn't ready.` : `${named.length ? `${what} passed` : `${rev} is ready to release`}.`}`);
process.exitCode = failed.length ? 1 : 0;
