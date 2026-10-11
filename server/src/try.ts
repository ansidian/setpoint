// A Setpoint to try things in, in one step: builds the web app into data/try/web (not web/dist,
// which may be stale, and which a browser run in this checkout may be serving), seeds data/try
// with BRIEF.md's sample the first time, starts the dev server on its own port and claims it with
// a test password, then prints how to sign in (SV-39).
//
//   npm run try                     http://localhost:7450, data/try
//   npm run try -- --reset          seeds data/try afresh
//   npm run try -- --no-build       skips the build (the last one, as it is)
//   SETPOINT_PORT=7451 npm run try
//
// Its data is the sample's, nothing real, but for News, which is data/news-snapshot/'s real news when
// the checkout has one (src/dev/newsSnapshot.ts). TRY_PASSWORD is a test value for this local copy only.
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newsSnapshotIn} from './dev/newsSnapshot.ts';
import {seedFile} from './dev/seedFile.ts';

export const TRY_PASSWORD = 'setpoint try';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SERVER = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--reset' && arg !== '--no-build');
if (unknown.length) {
  console.error(`Unknown argument: ${unknown.join(' ')}. Usage: npm run try [-- --reset] [--no-build]`);
  process.exit(2);
}
const dataDir = path.join(ROOT, 'data', 'try');
const port = Number(process.env.SETPOINT_PORT ?? 7450);
const base = `http://localhost:${port}`;
const webDir = path.join(dataDir, 'web');
const env = {...process.env, SETPOINT_DATA_DIR: dataDir, SETPOINT_PORT: String(port), SETPOINT_WEB_DIR: webDir};

if (!args.includes('--no-build') || !fs.existsSync(webDir)) {
  const built = spawnSync('npm', ['run', 'build', '-w', 'web', '--', '--outDir', webDir, '--emptyOutDir'], {cwd: ROOT, stdio: 'inherit'});
  if (built.status !== 0) process.exit(built.status ?? 1);
}
const file = path.join(dataDir, 'setpoint.sqlite');
if (args.includes('--reset') || !fs.existsSync(file)) {
  fs.mkdirSync(dataDir, {recursive: true});
  const {emails, items} = seedFile(file, {reset: true, newsSnapshot: newsSnapshotIn(path.join(ROOT, 'data'))});
  console.log(`Seeded ${emails} emails and ${items} calendar items into ${path.relative(ROOT, file)}.`);
}

const server = spawn('npm', ['run', 'dev'], {cwd: SERVER, env, stdio: ['inherit', 'pipe', 'inherit']});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => server.kill(signal));
server.on('exit', code => process.exit(code ?? 0));

let ready = false;
server.stdout.on('data', (chunk: Buffer) => {
  process.stdout.write(chunk);
  if (!ready && chunk.toString().includes('Setpoint listening')) {
    ready = true;
    claim().then(announce, (error: Error) => console.error(`Couldn't claim it: ${error.message}`));
  }
});

/** Claims a fresh copy with the test password; a claimed one is left as it is. */
async function claim() {
  const status = await fetch(`${base}/api/auth/status`).then(response => response.json() as Promise<{claimed: boolean}>);
  if (status.claimed) return;
  const issued = spawnSync(process.execPath, ['src/cli.ts', 'setup-token'], {cwd: SERVER, env, encoding: 'utf8'});
  const token = issued.stdout.trim().split('\n').at(-1)?.trim();
  if (issued.status !== 0 || !token) throw new Error(issued.stderr || 'no setup token');
  const response = await fetch(`${base}/api/auth/claim`, {
    method: 'POST',
    headers: {'Content-Type': 'application/json', Origin: base},
    body: JSON.stringify({setup_token: token, password: TRY_PASSWORD}),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
}

function announce() {
  console.log(`
Setpoint is at ${base}, with the sample's data (its clock is the seed's, ${path.relative(ROOT, dataDir)}).
Sign in with the password "${TRY_PASSWORD}". From a page's console (an agent's browser pane):
  await fetch('/api/auth/sign-in', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({password: '${TRY_PASSWORD}'})}); location.reload();
`);
}
