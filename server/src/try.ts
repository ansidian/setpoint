// The one dev Setpoint, in one step (launch.json's setpoint-dev): Vite on its port, with hot
// reload, proxying /api to the dev server on the next port (SETPOINT_PUBLIC_URL is Vite's, so
// pairing links and sign-in name it); with --build, the web app built into data/dev/web (not
// web/dist, which may be stale, and which a browser run in this checkout may be serving) and served
// by the dev server itself, as prod serves it. It seeds data/dev with BRIEF.md's sample the first time, makes its owner with the password
// "dev" (SV-206), starts the dev server on its own port, then prints how to sign in (SV-39) and a
// link that pairs the iPhone app with it (SV-84). Sessions share it and may change its data.
//
//   npm run try                     http://localhost:7450, data/dev
//   npm run try -- --reset          seeds data/dev afresh
//   npm run try -- --build          the built web app, no hot reload
//   npm run try -- --build --no-build   the last build, as it is
//   SETPOINT_PORT=7451 npm run try
//
// Its data is the sample's, nothing real, but for News, which is data/news-snapshot/'s real news when
// the checkout has one (src/dev/newsSnapshot.ts). DEV_PASSWORD is a test value for this local copy only.
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {cliLine} from './dev/cliLine.ts';
import {ensureDevOwner} from './dev/devOwner.ts';
import {newsSnapshotIn} from './dev/newsSnapshot.ts';
import {seedFile} from './dev/seedFile.ts';

export const DEV_PASSWORD = 'dev';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SERVER = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--reset' && arg !== '--build' && arg !== '--no-build');
if (unknown.length) {
  console.error(`Unknown argument: ${unknown.join(' ')}. Usage: npm run try [-- --reset] [--build [--no-build]]`);
  process.exit(2);
}
const dataDir = path.join(ROOT, 'data', 'dev');
const port = Number(process.env.SETPOINT_PORT ?? 7450);
const base = `http://localhost:${port}`;
const webDir = path.join(dataDir, 'web');
const built = args.includes('--build');
// With hot reload the server sits behind Vite, on the next port.
const apiPort = built ? port : port + 1;
const env = {...process.env, SETPOINT_DATA_DIR: dataDir, SETPOINT_PORT: String(apiPort), ...(built ? {SETPOINT_WEB_DIR: webDir} : {SETPOINT_PUBLIC_URL: base})};

if (built && (!args.includes('--no-build') || !fs.existsSync(webDir))) {
  const built = spawnSync('npm', ['run', 'build', '-w', 'web', '--', '--outDir', webDir, '--emptyOutDir'], {cwd: ROOT, stdio: 'inherit'});
  if (built.status !== 0) process.exit(built.status ?? 1);
}
const file = path.join(dataDir, 'setpoint.sqlite');
if (args.includes('--reset') || !fs.existsSync(file)) {
  fs.mkdirSync(dataDir, {recursive: true});
  const {emails, items} = seedFile(file, {reset: true, newsSnapshot: newsSnapshotIn(path.join(ROOT, 'data'))});
  console.log(`Seeded ${emails} emails and ${items} calendar items into ${path.relative(ROOT, file)}.`);
}
await ensureDevOwner(file, DEV_PASSWORD);

// Each in its own process group, so stopping one stops what npm started under it too.
const server = spawn('npm', ['run', 'dev'], {cwd: SERVER, env, stdio: ['inherit', 'pipe', 'inherit'], detached: true});
const vite = built ? null : spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
  {cwd: path.join(ROOT, 'web'), env: {...process.env, SETPOINT_PORT: String(apiPort)}, stdio: 'inherit', detached: true});
const stop = (signal: NodeJS.Signals = 'SIGTERM') => {
  for (const child of [server, vite]) {
    try {
      if (child?.pid) process.kill(-child.pid, signal);
    } catch {
      // Already gone.
    }
  }
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => stop(signal));
// Either one ending ends both.
for (const child of [server, vite]) child?.on('exit', code => {
  stop();
  process.exit(code ?? 0);
});

let ready = false;
server.stdout.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
  if (!ready && chunk.toString().includes('Setpoint listening')) {
    ready = true;
    announce();
  }
});

function announce() {
  console.log(`
Setpoint is at ${base}${built ? '' : ', hot reloading (its API on :' + apiPort + ')'}, with the sample's data (its clock is the seed's, ${path.relative(ROOT, dataDir)}).
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
