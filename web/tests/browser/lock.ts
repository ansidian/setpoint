// One browser run at a time on this machine (SV-39): other sessions run the checks too, and two
// runs side by side slow each other into failing. The lock is a file in /tmp, not the session's own
// temp directory, so every session sees it; a lock whose process has gone is taken over. Every way
// in takes it: `npm run test:browser` (run.ts) before its build, a `node --test` with the global
// setup in its globalSetup, and anything else (a bare `node --test` of a spec, the board audit)
// when it first launches Chromium (harness.ts › launchBrowser). A checkout from before the lock
// doesn't take it, so a run also waits while a Playwright Chromium outside it is open.
import {execFileSync} from 'node:child_process';
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

/** A Playwright Chromium open outside `owner`'s processes, and the directory of who opened it. */
function unlockedBrowser(owner: number): {pid: number; dir: string} | null {
  let listing: string;
  try {
    listing = execFileSync('ps', ['-Ao', 'pid=,ppid=,command='], {encoding: 'utf8'});
  } catch {
    return null;
  }
  const parent = new Map<number, number>();
  const browsers: number[] = [];
  for (const line of listing.split('\n')) {
    const [, pid, ppid, command] = line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/) ?? [];
    if (!pid || !command) continue;
    parent.set(Number(pid), Number(ppid));
    // The browser process itself, not its renderers and helpers (--type=…).
    if (command.includes('playwright_chromiumdev_profile') && command.includes('--remote-debugging-pipe') && !command.includes('--type=')) browsers.push(Number(pid));
  }
  const ours = (pid: number) => {
    for (let at: number | undefined = pid; at && at > 1; at = parent.get(at)) if (at === owner) return true;
    return false;
  };
  // One whose run has gone (its parent is now launchd) is left over, not running checks.
  const other = browsers.find(pid => parent.get(pid) !== 1 && !ours(pid));
  if (!other) return null;
  let dir = '?';
  try {
    dir = execFileSync('lsof', ['-a', '-p', String(parent.get(other) ?? other), '-d', 'cwd', '-Fn'], {encoding: 'utf8'})
      .split('\n').find(line => line.startsWith('n'))?.slice(1) ?? dir;
  } catch {
    // Its directory is only for the message.
  }
  return {pid: other, dir};
}

/**
 * Takes the lock for the run whose process is `owner`, waiting for another run to finish;
 * resolves with how long it waited. A lock `owner` already holds is kept.
 */
export async function acquire(owner = process.pid): Promise<number> {
  const started = Date.now();
  let told = 0;
  const tell = (message: string) => {
    if (Date.now() - told < 60_000) return;
    told = Date.now();
    console.log(message);
  };
  for (;;) {
    const other = holder();
    if (other?.pid === owner) return Date.now() - started;
    if (other && !alive(other.pid)) {
      // Its run died without letting go. Two waiters seeing this at once could both run, which is
      // only what happened before the lock.
      console.log(`Taking over the lock of a run that has gone (pid ${other.pid}, ${other.dir}).`);
      fs.rmSync(LOCK, {force: true});
      continue;
    }
    const unlocked = other ? null : unlockedBrowser(owner);
    if (!other && !unlocked) {
      try {
        fs.writeFileSync(LOCK, JSON.stringify({pid: owner, dir: ROOT, since: new Date().toISOString()} satisfies Holder), {flag: 'wx'});
        return Date.now() - started;
      } catch (error) {
        // Another run (or another of this run's files) took it first: look again.
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        continue;
      }
    }
    const whose = other ? `the browser run in ${other.dir} (pid ${other.pid}` : `a browser run outside the lock in ${unlocked?.dir} (Chromium pid ${unlocked?.pid}`;
    if (Date.now() - started > WAIT) throw new Error(`Gave up after ${clock(WAIT)} waiting for ${whose}).`);
    tell(`Waiting for ${whose}${other ? `, since ${new Date(other.since).toLocaleTimeString()}` : ''}).`);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

/** Lets go of the lock if `owner` holds it. */
export function release(owner = process.pid) {
  if (holder()?.pid === owner) fs.rmSync(LOCK, {force: true});
}

/** Marks the processes this one starts as part of its run, which holds the lock. */
export function handDown() {
  process.env[HELD] = String(process.pid);
}

let holding = false;

/**
 * The lock for a run that didn't come through run.ts. A spec file under `node --test` belongs to
 * the test runner's run, its parent: the first of the run's files to get here takes the lock for
 * it, the rest find it held, and it's taken over once the runner has gone. Anything else (the
 * runner's global setup, the board audit) holds it itself until it exits, for what it starts too.
 */
export async function holdForRun() {
  const held = Number(process.env[HELD]);
  if (holding || (held && holder()?.pid === held)) return;
  const owner = process.env.NODE_TEST_CONTEXT?.startsWith('child') ? process.ppid : process.pid;
  const waited = await acquire(owner);
  if (waited > 2000) console.log(`Waited ${clock(waited)} for the browser lock.`);
  holding = true;
  if (owner !== process.pid) return;
  handDown();
  process.on('exit', () => release(owner));
}
