// One browser run at a time on this machine (SV-39): other sessions run the checks too, and two runs
// side by side slow each other into failing. The lock is a file in /tmp, not the session's own
// temp directory, so every session sees it; a lock whose process has gone is taken over. Every way
// in takes it: `npm run test:browser` (run.ts) before its build, a `node --test` with the global
// setup in its globalSetup, release:check (release.ts) for as long as it runs anything, and anything else (a bare `node --test` of a spec) when
// it first launches Chromium (harness.ts › launchBrowser). `npm test` doesn't.
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const LOCK = '/tmp/setpoint-browser-run.lock';
// The pid of the run holding the lock, for the processes it starts, which then don't wait for it.
const HELD = 'SETPOINT_BROWSER_LOCK_PID';
const WAIT = Number(process.env.SETPOINT_BROWSER_WAIT_MIN ?? 45) * 60_000;

interface Holder {
  pid: number;
  dir: string;
  since: string;
}

export const clock = (ms: number) => `${Math.floor(ms / 60_000)}m${String(Math.round((ms % 60_000) / 1000)).padStart(2, '0')}s`;

function holder(): Holder | null {
  try {
    return JSON.parse(fs.readFileSync(LOCK, 'utf8')) as Holder;
  } catch {
    return null;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Takes the lock for the run whose process is `owner`, waiting for another run to finish;
 * resolves with how long it waited. A lock `owner` already holds is kept, and so is one held by the
 * run that started this process (release:check's, for the browser runs it starts).
 */
export async function acquire(owner = process.pid): Promise<number> {
  const started = Date.now();
  const held = Number(process.env[HELD]);
  let told = 0;
  const tell = (message: string) => {
    if (Date.now() - told < 60_000) return;
    told = Date.now();
    console.log(message);
  };
  for (;;) {
    const other = holder();
    if (other && (other.pid === owner || other.pid === held)) return Date.now() - started;
    if (other && !alive(other.pid)) {
      // Its run died without letting go. Two waiters seeing this at once could both run, which is
      // only what happened before the lock.
      console.log(`Taking over the lock of a run that has gone (pid ${other.pid}, ${other.dir}).`);
      fs.rmSync(LOCK, {force: true});
      continue;
    }
    if (!other) {
      try {
        fs.writeFileSync(LOCK, JSON.stringify({pid: owner, dir: ROOT, since: new Date().toISOString()} satisfies Holder), {flag: 'wx'});
        return Date.now() - started;
      } catch (error) {
        // Another run (or another of this run's files) took it first: look again.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        continue;
      }
    }
    const whose = `the test run in ${other.dir} (pid ${other.pid})`;
    if (Date.now() - started > WAIT) throw new Error(`Gave up after ${clock(WAIT)} waiting for ${whose}.`);
    tell(`Waiting for ${whose}, since ${new Date(other.since).toLocaleTimeString()}.`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

/** Lets go of the lock if `owner` holds it. */
export function release(owner = process.pid) {
  if (holder()?.pid === owner) fs.rmSync(LOCK, {force: true});
}

/** Marks the processes this one starts as part of its run, which holds the lock (or a run above it does). */
export function handDown() {
  const held = Number(process.env[HELD]);
  if (!held || holder()?.pid !== held) process.env[HELD] = String(process.pid);
}

let holding = false;

/**
 * The lock for a run that didn't come through run.ts. A spec file under `node --test` belongs to
 * the test runner's run, its parent: the first of the run's files to get here takes the lock for
 * it, the rest find it held, and it's taken over once the runner has gone. Anything else (the
 * runner's global setup) holds it itself until it exits, for what it starts too.
 */
export async function holdForRun() {
  const held = Number(process.env[HELD]);
  if (holding || (held && holder()?.pid === held)) return;
  const owner = process.env.NODE_TEST_CONTEXT?.startsWith('child') ? process.ppid : process.pid;
  const waited = await acquire(owner);
  if (waited > 2000) console.log(`Waited ${clock(waited)} for the test lock.`);
  holding = true;
  if (owner !== process.pid) return;
  handDown();
  process.on('exit', () => release(owner));
}
