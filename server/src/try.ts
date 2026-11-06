// The one dev Setpoint, in one step (launch.json's setpoint-dev): Vite on its port, with hot
// reload, proxying /api to the dev server on the next port (SETPOINT_PUBLIC_URL is Vite's, so
// pairing links and sign-in name it); with --build, the web app built into data/dev/web (not
// web/dist, which may be stale, and which a browser run in this checkout may be serving) and served
// by the dev server itself, as prod serves it. It seeds data/dev with BRIEF.md's sample the first time, makes its owner with the password
// "dev" (SV-206), starts the dev server on its own port, then prints how to sign in (SV-39) and a
// link that pairs the iPhone app with it (SV-84). Sessions share it and may change its data.
//
// From a git worktree (SV-212) it's that worktree's web app in front of setpoint-dev's API: only
// its Vite, on the next free port from 7460, proxying to the API on 7451 and passing its own page's
// changes on as setpoint-dev's page's, so sign-in works, the data is the shared one, and a cookie
// from either port serves both (cookies don't keep to a port). The API is the main checkout's code;
// a slice that changes the server runs --own: a whole Setpoint of its own on a copy of data/dev in a
// temporary directory, on free ports, the copy removed when it stops.
//
//   npm run try                     http://localhost:7450, data/dev
//   npm run try -- --reset          seeds data/dev afresh
//   npm run try -- --build          the built web app, no hot reload
//   npm run try -- --build --no-build   the last build, as it is
//   SETPOINT_PORT=7451 npm run try
//   npm run try                     (in a worktree) this worktree's web app on setpoint-dev's data
//   npm run try -- --own [--reset] [--build]   (in a worktree) its own Setpoint on a copy of data/dev
//
// Its data is the sample's, nothing real, but for News, which is data/news-snapshot/'s real news when
// the checkout has one (src/dev/newsSnapshot.ts). DEV_PASSWORD is a test value for this local copy only.
import {spawn, spawnSync} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const DEV_PASSWORD = 'dev';

/** setpoint-dev's port, its API on the next one. */
const SHARED_PORT = 7450;
/** Where a worktree's own ports start. */
const WORKTREE_PORTS = 7460;

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SERVER = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const flags = ['--reset', '--build', '--no-build', '--own'];
const unknown = args.filter(arg => !flags.includes(arg));
if (unknown.length) fail(`Unknown argument: ${unknown.join(' ')}. Usage: npm run try [-- --reset] [--build [--no-build]] [--own, in a worktree]`, 2);

// A worktree's .git is a file naming the main checkout's.
const worktree = fs.statSync(path.join(ROOT, '.git'), {throwIfNoEntry: false})?.isFile() ?? false;
const own = args.includes('--own');
if (own && !worktree) fail('--own is for a worktree; here, npm run try is the one dev Setpoint.', 2);
// Before any package is imported: in a worktree inside the main checkout they'd come from its node_modules,
// @setpoint/shared included, which is the main checkout's shared/.
if (worktree && !fs.existsSync(path.join(ROOT, 'node_modules', 'vite'))) fail(`This worktree has no node_modules of its own. Run npm ci in ${ROOT}, then npm run try again.`);
const {default: Database} = await import('better-sqlite3');
const {cliLine} = await import('./dev/cliLine.ts');
const {ensureDevOwner} = await import('./dev/devOwner.ts');
const {newsSnapshotIn} = await import('./dev/newsSnapshot.ts');
const {seedFile} = await import('./dev/seedFile.ts');

if (worktree && !own) await frontShared();
else await runOwn();

/** This worktree's Vite in front of setpoint-dev's API. */
async function frontShared() {
  if (args.length) fail('In a worktree, --reset and --build are for a Setpoint of its own: npm run try -- --own …', 2);
  const apiPort = SHARED_PORT + 1;
  if (!await listening(apiPort)) {
    fail(`setpoint-dev isn't running (nothing on :${apiPort}). Start it in the main checkout (${mainCheckout()}: npm run try), or run one of this worktree's own: npm run try -- --own.`);
  }
  const port = process.env.SETPOINT_PORT ? Number(process.env.SETPOINT_PORT) : await freePorts(WORKTREE_PORTS, 1);
  const base = `http://localhost:${port}`;
  const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: path.join(ROOT, 'web'), stdio: 'inherit', detached: true,
    env: {...process.env, SETPOINT_PORT: String(apiPort), SETPOINT_PAGE_ORIGIN: `http://localhost:${SHARED_PORT}`},
  });
  supervise([vite]);
  console.log(`
This worktree's web app is at ${base}, hot reloading, on setpoint-dev's API and data (:${apiPort}, the main checkout's server code).
Open ${base} itself, not the setpoint-dev entry, which is the main checkout's page. Signed in on :${SHARED_PORT}, you're signed in here;
otherwise sign in with the password "${DEV_PASSWORD}". From a page's console (an agent's browser pane):
  await fetch('/api/auth/sign-in', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password: '${DEV_PASSWORD}'})}); location.reload();
A change to the server needs its own: npm run try -- --own.
`);
}

/** A whole Setpoint: setpoint-dev in the main checkout, or a worktree's own (--own) on a copy of its data. */
async function runOwn() {
  const built = args.includes('--build');
  const dataDir = own ? copyOfShared() : path.join(ROOT, 'data', 'dev');
  const port = process.env.SETPOINT_PORT ? Number(process.env.SETPOINT_PORT) : own ? await freePorts(WORKTREE_PORTS, 2) : SHARED_PORT;
  const base = `http://localhost:${port}`;
  const webDir = path.join(dataDir, 'web');
  // With hot reload the server sits behind Vite, on the next port.
  const apiPort = built ? port : port + 1;
  const env = {...process.env, SETPOINT_DATA_DIR: dataDir, SETPOINT_PORT: String(apiPort), ...(built ? {SETPOINT_WEB_DIR: webDir} : {SETPOINT_PUBLIC_URL: base})};
  if (own) process.on('exit', () => fs.rmSync(dataDir, {recursive: true, force: true}));

  if (built && (!args.includes('--no-build') || !fs.existsSync(webDir))) {
    const build = spawnSync('npm', ['run', 'build', '-w', 'web', '--', '--outDir', webDir, '--emptyOutDir'], {cwd: ROOT, stdio: 'inherit'});
    if (build.status !== 0) process.exit(build.status ?? 1);
  }
  const file = path.join(dataDir, 'setpoint.sqlite');
  if (args.includes('--reset') || !fs.existsSync(file)) {
    fs.mkdirSync(dataDir, {recursive: true});
    const {emails, items} = seedFile(file, {reset: true, newsSnapshot: newsSnapshotIn(path.join(own ? mainCheckout() : ROOT, 'data'))});
    console.log(`Seeded ${emails} emails and ${items} calendar items into ${own ? file : path.relative(ROOT, file)}.`);
  }
  await ensureDevOwner(file, DEV_PASSWORD);

  // Each in its own process group, so stopping one stops what npm started under it too.
  const server = spawn('npm', ['run', 'dev'], {cwd: SERVER, env, stdio: ['inherit', 'pipe', 'inherit'], detached: true});
  const vite = built ? null : spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    {cwd: path.join(ROOT, 'web'), env: {...process.env, SETPOINT_PORT: String(apiPort)}, stdio: 'inherit', detached: true});
  supervise([server, vite]);

  let ready = false;
  server.stdout.on('data', (chunk: Buffer) => {
    process.stdout.write(chunk);
    if (!ready && chunk.toString().includes('Setpoint listening')) {
      ready = true;
      announce();
    }
  });

  function announce() {
    const where = own ? `a copy of setpoint-dev's data in ${dataDir}, removed when this stops` : path.relative(ROOT, dataDir);
    console.log(`
Setpoint is at ${base}${built ? '' : ', hot reloading (its API on :' + apiPort + ')'}, with the sample's data (its clock is the seed's, ${where}).
Sign in with the password "${DEV_PASSWORD}". From a page's console (an agent's browser pane):
  await fetch('/api/auth/sign-in', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password: '${DEV_PASSWORD}'})}); location.reload();
${pairingLink()}`);
  }

  /** A one-time link pairing the iPhone app (in the Simulator, which reaches this Mac's localhost). */
  function pairingLink(): string {
    const issued = spawnSync(process.execPath, ['src/cli.ts', 'pair-link'], {cwd: SERVER, env, encoding: 'utf8'});
    const link = issued.stdout.match(/^setpoint:\/\/pair\?\S+$/m)?.[0];
    if (issued.status !== 0 || !link) return `Couldn't make a pairing link: ${issued.stderr.trim() || 'no link'}\n`;
    return `Pair the iPhone app (once; a new link: ${cliLine(dataDir, port, 'pair-link')}):
  xcrun simctl openurl booted '${link}'
`;
  }
}

/**
 * setpoint-dev's data copied for a worktree's own Setpoint: its database whole (VACUUM INTO, so a
 * write in flight on the live one can't tear it), its key and News's images. Without data/dev, none:
 * the caller seeds the copy.
 */
function copyOfShared(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-try-'));
  const shared = path.join(mainCheckout(), 'data', 'dev');
  const file = path.join(shared, 'setpoint.sqlite');
  if (!fs.existsSync(file)) return dir;
  const sqlite = new Database(file, {readonly: true, fileMustExist: true});
  try {
    sqlite.prepare('VACUUM INTO ?').run(path.join(dir, 'setpoint.sqlite'));
  } finally {
    sqlite.close();
  }
  for (const name of ['setpoint.key', 'news-images', 'news-local-sources.json']) {
    const from = path.join(shared, name);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(dir, name), {recursive: true});
  }
  console.log(`Copied setpoint-dev's data into ${dir}.`);
  return dir;
}

/** The main checkout this worktree belongs to (git's common directory's parent). */
function mainCheckout(): string {
  const common = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {cwd: ROOT, encoding: 'utf8'});
  if (common.status !== 0) fail(`Couldn't find the main checkout: ${common.stderr.trim()}`);
  return path.dirname(common.stdout.trim());
}

/** Stops every child when this is stopped, and all of them when any one ends. */
function supervise(children: (ChildProcess | null)[]) {
  const stop = (signal: NodeJS.Signals = 'SIGTERM') => {
    for (const child of children) {
      try {
        if (child?.pid) process.kill(-child.pid, signal);
      } catch {
        // Already gone.
      }
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => stop(signal));
  for (const child of children) child?.on('exit', code => {
    stop();
    process.exit(code ?? 0);
  });
}

/** Whether something takes connections on 127.0.0.1:`port`. */
function listening(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const socket = net.connect({host: '127.0.0.1', port});
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

/** Whether 127.0.0.1:`port` can be listened on now. */
function free(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.listen({host: '127.0.0.1', port}, () => probe.close(() => resolve(true)));
  });
}

/** The first port from `from` with `count` free in a row. */
async function freePorts(from: number, count: number): Promise<number> {
  for (let port = from; port < from + 100; port += 1) {
    let all = true;
    for (let next = port; next < port + count && all; next += 1) all = await free(next);
    if (all) return port;
  }
  return fail(`No free port from ${from} to ${from + 99}.`);
}

function fail(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}
