// The check ahead (SV-194): `release:check --keep-going` on origin/master as last pushed, in the
// background, in a worktree of its own (.claude/worktrees/check-ahead), so a release finds it done.
// Every pass it records counts for any checkout with the same content (passes.ts), and its
// release:check holds the browser lock while it runs anything (release.ts), so it never runs beside
// another browser run and a release:check started meanwhile waits for it, then finds it all passed.
//
// A reference-transaction hook starts it whenever origin/master moves on this Mac: a push to master
// from any checkout, or a fetch that brings one. One runs at a time; a push while it runs is checked
// once it's done. `npm run ahead` runs it now, `-- install` puts the hook in, `-- status` says how the
// last one went and where its log is (setpoint-ahead.log in the repository's git directory).
import {execFileSync, spawn, spawnSync} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
// A hook runs with git's own variables, which would point every git call here at the pushing checkout.
for (const name of Object.keys(process.env)) if (name.startsWith('GIT_')) delete process.env[name];

const git = (args: string[], cwd = ROOT) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();
const COMMON = git(['rev-parse', '--path-format=absolute', '--git-common-dir']);
const MAIN = path.dirname(COMMON);
const WORKTREE = path.join(MAIN, '.claude', 'worktrees', 'check-ahead');
const LOG = path.join(COMMON, 'setpoint-ahead.log');
const STATE = path.join(COMMON, 'setpoint-ahead.json');
const LOCK = path.join(COMMON, 'setpoint-ahead.lock');
const BRANCH = 'refs/remotes/origin/master';

interface State {
  rev: string;
  state: 'running' | 'ready' | 'failed';
  at: string;
  log: string;
}

const HOOK = `#!/bin/sh
# Setpoint's check ahead (web/tests/ahead.ts, SV-194): when origin/master moves, release:check runs
# in the background. Installed by \`npm run ahead -- install\`.
[ "$1" = committed ] || exit 0
grep -q ' ${BRANCH}$' || exit 0
main="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
[ -f "$main/web/tests/ahead.ts" ] && node "$main/web/tests/ahead.ts" --detach >/dev/null 2>&1
exit 0
`;

function readState(): State | null {
  try {
    return JSON.parse(fs.readFileSync(STATE, 'utf8')) as State;
  } catch {
    return null;
  }
}

const writeState = (state: State) => fs.writeFileSync(STATE, `${JSON.stringify(state, null, 2)}\n`);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Takes the one-at-a-time lock, or says who has it; a lock whose process has gone is taken over. */
function lock(): number | null {
  for (;;) {
    try {
      fs.writeFileSync(LOCK, String(process.pid), {flag: 'wx'});
      process.on('exit', () => {
        try {
          if (fs.readFileSync(LOCK, 'utf8') === String(process.pid)) fs.rmSync(LOCK, {force: true});
        } catch {
          // Already gone.
        }
      });
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = Number(fs.readFileSync(LOCK, 'utf8'));
      if (holder && alive(holder)) return holder;
      fs.rmSync(LOCK, {force: true});
    }
  }
}

/** The worktree at `rev`, with exactly its content (ignored files such as node_modules kept). */
function checkOut(rev: string) {
  if (!fs.existsSync(path.join(WORKTREE, '.git'))) {
    git(['worktree', 'prune'], MAIN);
    git(['worktree', 'add', '--detach', WORKTREE, rev], MAIN);
  } else {
    git(['checkout', '--detach', '--force', rev], WORKTREE);
    git(['clean', '-fd'], WORKTREE);
  }
  // A worktree needs its own install (npm ci), done again only when the lockfile changes.
  const stamp = path.join(WORKTREE, 'node_modules', '.ahead-lockfile');
  const lockfile = crypto.createHash('sha256').update(fs.readFileSync(path.join(WORKTREE, 'package-lock.json'))).digest('hex');
  if (fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8') === lockfile) return;
  const {status} = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], {cwd: WORKTREE, stdio: ['ignore', fs.openSync(LOG, 'a'), fs.openSync(LOG, 'a')]});
  if (status !== 0) throw new Error(`npm ci failed in ${WORKTREE}; see ${LOG}.`);
  fs.writeFileSync(stamp, lockfile);
}

/** Runs release:check on origin/master, then again for each push that came meanwhile. */
function checkAhead() {
  const holder = lock();
  if (holder) {
    console.log(`A check ahead is already running (pid ${holder}); it checks the latest push when it's done.`);
    return;
  }
  for (;;) {
    const rev = git(['rev-parse', BRANCH]);
    const last = readState();
    if (last?.rev === rev && last.state !== 'running') return;
    fs.writeFileSync(LOG, `Check ahead of ${rev}, ${new Date().toISOString()}\n`);
    writeState({rev, state: 'running', at: new Date().toISOString(), log: LOG});
    let ok = false;
    try {
      checkOut(rev);
      const out = fs.openSync(LOG, 'a');
      ok = spawnSync(process.execPath, ['web/tests/release.ts', '--keep-going'], {cwd: WORKTREE, stdio: ['ignore', out, out]}).status === 0;
    } catch (error) {
      fs.appendFileSync(LOG, `\n${(error as Error).message}\n`);
    }
    writeState({rev, state: ok ? 'ready' : 'failed', at: new Date().toISOString(), log: LOG});
  }
}

function status() {
  const last = readState();
  if (!last) {
    console.log('No check ahead has run yet.');
    return;
  }
  const short = last.rev.slice(0, 7);
  const at = new Date(last.at).toLocaleString('en-GB', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
  const said = {running: `running since ${at}`, ready: `ready to release, ${at}`, failed: `failed, ${at}`}[last.state];
  console.log(`Check ahead of ${short}: ${said}. Log: ${last.log}`);
  if (last.state === 'failed') console.log(fs.readFileSync(last.log, 'utf8').trim().split('\n').slice(-12).join('\n'));
}

const [command] = process.argv.slice(2);
if (command === 'install') {
  const file = path.join(git(['rev-parse', '--path-format=absolute', '--git-path', 'hooks']), 'reference-transaction');
  if (fs.existsSync(file) && !fs.readFileSync(file, 'utf8').includes('web/tests/ahead.ts')) {
    console.error(`${file} is someone else's hook; add this one's lines to it by hand:\n\n${HOOK}`);
    process.exit(1);
  }
  fs.writeFileSync(file, HOOK, {mode: 0o755});
  console.log(`Installed ${file}: release:check runs ahead whenever origin/master moves.`);
} else if (command === 'status') {
  status();
} else if (command === '--detach') {
  // From the hook: start in the background and let the push finish.
  spawn(process.execPath, [SELF], {detached: true, stdio: 'ignore', env: process.env}).unref();
} else if (!command) {
  checkAhead();
} else {
  console.error('npm run ahead [-- install | status]');
  process.exit(1);
}
