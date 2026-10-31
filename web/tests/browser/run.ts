// `npm run test:browser [-- mail search ...]`: builds the web app and runs the browser checks, all
// spec files or the ones named, six at a time, one run at a time on this machine (lock.ts): a run
// waits for the lock, saying whose run it waits for. The build and the checks together get LIMIT
// minutes, then everything is stopped, so a hung run can't sit for hours. At the end it prints the
// run's time against BUDGET and the slowest checks (slowest.ts). Checks run without traces, so what
// failed runs again with them (SV-144), up to RETRACED checks, the run failing whatever that finds:
// its traces are under test-results/browser/traces/ (harness.ts), emptied at the start of each run,
// and a check that passes the second time says so. A run that passes
// records its spec files for the content it ran on (passes.ts), unless the files changed meanwhile
// or it was capturing goldens, so release:check doesn't run them again. With SETPOINT_PAGES
// (`npm run test:pages`, `npm run goldens`) it runs only the checks that take the release's page
// screenshots (pages.ts), and those compare them. `-- settings --only "board 17"` runs only the
// checks whose names start that way, and isn't recorded. A file's checks run side by side, as many as
// SLOTS shared out over the files run (SV-102): one file uses every slot, a whole run one each.
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {record, specName, treeOf} from '../passes.ts';
import {acquire, clock, handDown, release} from './lock.ts';
import {COMPARING, PAGES} from './pages.ts';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const HERE = fileURLToPath(new URL('./', import.meta.url));
const minutes = (name: string, fallback: number) => Number(process.env[name] ?? fallback) * 60_000;
const STRESS = process.env.SETPOINT_BROWSER_STRESS === '1';
// Stress takes 13 alone, and more beside an `npm test`, which takes no lock.
const LIMIT = minutes('SETPOINT_BROWSER_LIMIT_MIN', STRESS ? 25 : 15);
// A full run alone, with some room; past it, the run says so (it doesn't fail).
const BUDGET = minutes('SETPOINT_BROWSER_BUDGET_MIN', 5);
// Checks at once on this machine (the six files a whole run runs side by side).
const SLOTS = 6;
// A failure past this many is the harness or the build, not something a trace of each would show.
const RETRACED = 10;
const FAILED = path.join(ROOT, 'test-results', 'browser', 'failed.jsonl');

/** The spec files to run: those named (`mail`, `mail.spec.ts` or a path), else every one. */
function specs(names: string[]): string[] {
  if (!names.length) return fs.readdirSync(HERE).filter(file => file.endsWith('.spec.ts')).sort().map(file => path.join(HERE, file));
  return names.map(name => {
    const file = name.includes('/') ? path.resolve(name) : path.join(HERE, name.endsWith('.ts') ? name : `${name}.spec.ts`);
    if (!fs.existsSync(file)) throw new Error(`No spec file ${path.relative(ROOT, file)}.`);
    return file;
  });
}

let child: ReturnType<typeof spawn> | null = null;

/** Runs a command in its own process group, so stopping it stops everything it started. */
function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    child = spawn(command, args, {cwd: ROOT, stdio: 'inherit', detached: true});
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

function stop() {
  if (child?.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      // Already gone.
    }
  }
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Node's test runner over spec files, as many at once as a run has slots. */
const checks = (only: string[], files: string[]) => run(process.execPath, [
  '--test', `--test-global-setup=${path.join(HERE, 'globalSetup.ts')}`, `--test-concurrency=${SLOTS}`, '--test-timeout=180000',
  '--test-reporter=spec', '--test-reporter-destination=stdout',
  `--test-reporter=${path.join(HERE, 'slowest.ts')}`, '--test-reporter-destination=stdout',
  ...only, ...files,
]);

interface Failed {
  file: string;
  name: string;
}

/** The checks that failed since the file was last cleared (harness.ts › keepTraces), each once. */
function failures(): Failed[] {
  if (!fs.existsSync(FAILED)) return [];
  const noted = fs.readFileSync(FAILED, 'utf8').trim().split('\n').map(line => JSON.parse(line) as Failed);
  return [...new Map(noted.map(check => [`${check.file} ${check.name}`, check])).values()];
}

/** Runs what failed again with whole traces. The run has failed, whatever this finds. */
async function traceAgain(failed: Failed[]) {
  if (failed.length > RETRACED) {
    console.log(`\n${failed.length} checks failed, so none ran again for a trace: SETPOINT_BROWSER_TRACE=1 traces a run.`);
    return;
  }
  console.log(`\nRunning ${failed.length === 1 ? 'the failed check' : `the ${failed.length} failed checks`} again with traces.`);
  fs.rmSync(FAILED, {force: true});
  process.env.SETPOINT_BROWSER_TRACE = '1';
  await checks(failed.map(check => `--test-name-pattern=^${escape(check.name)}$`), [...new Set(failed.map(check => check.file))]);
  const again = new Set(failures().map(check => check.name));
  for (const {name} of failed) {
    if (!again.has(name)) console.log(`Passed the second time, so it left no trace: ${name}. Stress keeps one the first time (npm run test:browser:stress).`);
  }
}

async function main(): Promise<number> {
  const args = process.argv.slice(2);
  const at = args.indexOf('--only');
  const named = at === -1 ? null : args.splice(at, 2)[1];
  if (at !== -1 && !named) throw new Error('--only takes the start of a check\'s name.');
  if (COMPARING && (args.length || named)) throw new Error('The page screenshots run as a set (pages.ts); name no spec files or checks.');
  const files = specs(COMPARING ? [...new Set(PAGES.map(shot => shot.spec))] : args);
  // The checks that take a page screenshot, or the ones named, by the start of their names.
  const only = (COMPARING ? PAGES.map(shot => shot.test) : named ? [named] : []).map(start => `--test-name-pattern=^${escape(start)}`);
  process.env.SETPOINT_FILE_CONCURRENCY ??= String(Math.max(1, Math.floor(SLOTS / files.length)));
  const waited = await acquire();
  if (waited > 2000) console.log(`Waited ${clock(waited)} for the lock.`);
  handDown();
  fs.rmSync(path.join(ROOT, 'test-results', 'browser', 'traces'), {recursive: true, force: true});
  fs.rmSync(FAILED, {force: true});
  process.env.SETPOINT_BROWSER_FAILED = FAILED;
  const tree = process.env.SETPOINT_UPDATE_GOLDENS === '1' ? null : treeOf();
  const started = Date.now();
  const timer = setTimeout(() => {
    console.error(`\nThe browser run passed its ${clock(LIMIT)} limit (SETPOINT_BROWSER_LIMIT_MIN) and was stopped.`);
    stop();
  }, LIMIT);
  try {
    const built = await run('npm', ['run', 'build']);
    if (built !== 0) return built;
    const building = Date.now() - started;
    const code = await checks(only, files);
    const took = Date.now() - started;
    const whole = !COMPARING && !named && files.length === specs([]).length;
    console.log(`\nBrowser run: ${clock(took)} (build ${clock(building)}, checks ${clock(took - building)})${whole ? `, budget ${clock(BUDGET)}` : ''}.`);
    if (whole && took > BUDGET) console.log('Over budget: look at the slowest checks above before adding more.');
    if (Date.now() - started >= LIMIT) return 1;
    if (code === 0 && tree && !named) {
      if (treeOf() === tree) record(tree, COMPARING ? {check: 'pages'} : {check: process.env.SETPOINT_BROWSER_STRESS === '1' ? 'stress' : 'browser', specs: files.map(specName)});
      else console.log('The files changed during the run, so it isn\'t recorded for release:check.');
    }
    const failed = code === 0 ? [] : failures();
    if (failed.length && !COMPARING && !STRESS && !process.env.SETPOINT_BROWSER_TRACE) await traceAgain(failed);
    return code;
  } finally {
    clearTimeout(timer);
  }
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    stop();
    release();
    process.exit(130);
  });
}
process.on('exit', () => release());

main().then(code => {
  process.exitCode = code;
}, (error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
