// The browser checks' harness (`npm run test:browser`; BUILD-PLAN.md › Rules for every slice).
// Each check gets its own Setpoint: a copy of a fresh seed in a scratch data directory, the real
// server on a free port serving the production build (web/dist) with the seed's clock, claimed in
// its template so the browser starts signed in. Under run.ts the server is a bundle of the source
// (bundle.ts), which is a third of the boot. Spec files run side by side (eight at
// once, run.ts), each check on its own port and data. Chromium comes from playwright-core:
// the browser Playwright keeps in its cache, else the installed Google Chrome (darma's way);
// nothing is downloaded.
// A check that fails, or that its timeout cancels, runs again with a trace of its pages (run.ts,
// SV-144), kept under test-results/browser/traces/, saying where in the run's output, to open with
// `npx playwright-core show-trace <file>` (SV-75).
// `rested` takes a one-shot read of a computed style or box once nothing on the check's pages is
// moving (the lint asks).
import {spawn, spawnSync} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {describe as nodeDescribe, test as nodeTest} from 'node:test';
import type {TestContext, TestOptions} from 'node:test';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import type {Browser, BrowserContext, Locator, Page, Request, Response} from 'playwright-core';
import {holdForRun} from './lock.ts';
import {viewport} from '../../src/tokens.ts';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const WEB_DIST = path.join(ROOT, 'web', 'dist');
/** Where a failed check's traces go (run.ts empties it at the start of a run; git ignores it). */
export const TRACES = path.join(ROOT, 'test-results', 'browser', 'traces');

/** The sizes every check runs at: the design target and an iPhone. */
export const SIZES = {
  target: {width: 1677, height: 1050},
  iphone: {width: 390, height: 844},
} as const;
export type SizeName = keyof typeof SIZES;

/** The page's zoom in a window `width` wide (styles.css's steps, tokens.ts › viewport.zoom): window pixels over the page's. */
export const zoomAt = (width: number): number => viewport.zoom.reduce<number>((zoom, step) => width >= step.from ? step.zoom : zoom, 1);
/** The zoom at the design target, where most checks run. */
export const ZOOM = zoomAt(SIZES.target.width);
/** A length in the page's pixels to the nearest half: at a fractional zoom the browser snaps boxes and computed lengths to the device's pixels. */
export const pagePx = (windowPx: number, zoom = ZOOM): number => Math.round(windowPx / zoom * 2) / 2;

export const PASSWORD = 'browser checks only';


let browser: Promise<Browser> | null = null;

/** Chromium, launched once per check file, once its run holds the machine's lock (lock.ts). A file's checks start side by side, so they share the one launch. */
export function launchBrowser(): Promise<Browser> {
  browser ??= (async () => {
    await holdForRun();
    try {
      return await chromium.launch({headless: true});
    } catch (bundled) {
      try {
        return await chromium.launch({channel: 'chrome', headless: true});
      } catch {
        throw new Error(`No Chromium for the browser checks: neither Playwright's (${String((bundled as Error).message).split('\n')[0]}) nor Google Chrome.`);
      }
    }
  })();
  return browser;
}

export async function closeBrowser() {
  const launched = browser;
  browser = null;
  await (await launched?.catch(() => null))?.close();
}

// Each check with the contexts and pages it opened, for its traces and for `rested`. A spec file's
// checks run side by side (SV-102), so the check a page belongs to is the one whose body is running,
// kept in async context rather than in one variable. SETPOINT_BROWSER_TRACE=1 has each context record
// a trace, a failed or timed-out check's being kept. Traces were a third of a run's CPU, so none is
// the default, with what failed run again with one (run.ts, SV-144).
const TRACE = (process.env.SETPOINT_BROWSER_TRACE ?? '0') !== '0';
// Where a failed check is noted, for run.ts.
const FAILED = process.env.SETPOINT_BROWSER_FAILED;
interface Check {
  name: string;
  title: string;
  file: string | undefined;
  contexts: Set<BrowserContext>;
  pages: Set<Page>;
  finished: boolean;
  kept: Promise<string[]> | null;
}
const checks = new AsyncLocalStorage<Check>();

/** Runs a check's body as its own Check: keeps its traces if it fails, and closes its contexts after. */
async function asCheck(t: TestContext, body: (t: TestContext) => unknown): Promise<void> {
  const check: Check = {name: t.fullName, title: t.name, file: t.filePath, contexts: new Set(), pages: new Set(), finished: false, kept: null};
  const close = () => Promise.all([...check.contexts].map(context => context.close().catch(() => {})));
  // node --test cancels a check at its timeout by aborting its signal; it aborts the signal after
  // every check too, so a finished one is left alone. Closing the contexts ends what the body still
  // waits on.
  t.signal.addEventListener('abort', () => {
    if (!check.finished) void keepTraces(check).then(close);
  });
  try {
    await checks.run(check, () => body(t));
  } catch (error) {
    check.finished = true;
    await keepTraces(check);
    throw error;
  } finally {
    check.finished = true;
    await close();
  }
}

// How many of a spec file's checks run at once: run.ts sets it from how many files it runs, so a run
// of one file uses every slot and a whole run stays at about eight checks at a time (SV-102).
const WIDTH = Math.max(1, Number(process.env.SETPOINT_FILE_CONCURRENCY ?? 1));
const queued: (() => void)[] = [];
let replaying = false;

/**
 * Holds a file's top-level checks and suites until it has loaded, then registers them in one suite of
 * WIDTH, named for the spec file: the reporters see harness.ts as every check's file, so the slowest
 * list (slowest.ts) takes each check's from the suite that ends after it.
 */
function register(entry: () => void) {
  if (replaying) {
    entry();
    return;
  }
  if (!queued.length) {
    queueMicrotask(() => void nodeDescribe(path.basename(process.argv[1] ?? ''), {concurrency: WIDTH}, () => {
      replaying = true;
      try {
        for (const next of queued) next();
      } finally {
        replaying = false;
      }
    }));
  }
  queued.push(entry);
}

type Body = (t: TestContext) => unknown;

/** node:test's `test` for the browser checks: each is its own Check, and a file's run side by side (SV-102). */
export function test(name: string, ...rest: [Body] | [TestOptions, Body]): void {
  const body = rest.at(-1) as Body;
  const options = rest.length > 1 ? rest[0] as TestOptions : {};
  register(() => void nodeTest(name, options, t => asCheck(t, body)));
}

/** node:test's `describe` for the browser checks, so a suite's checks go with the file's. */
export function describe(name: string, body: () => void): void {
  register(() => void nodeDescribe(name, body));
}

/** Writes the check's traces under test-results/browser/traces/, once, and says where (the reporter has the failure's words by then). */
function keepTraces(check: Check): Promise<string[]> {
  check.kept ??= (async () => {
    if (FAILED) fs.appendFileSync(FAILED, `${JSON.stringify({file: check.file, name: check.title})}\n`);
    const files: string[] = [];
    const slug = check.name.replace(/\W+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    fs.mkdirSync(TRACES, {recursive: true});
    let n = 0;
    for (const context of check.contexts) {
      n += 1;
      const file = path.join(TRACES, `${slug}${n > 1 ? `-${n}` : ''}.zip`);
      try {
        await context.tracing.stop({path: file});
        files.push(path.relative(ROOT, file));
      } catch {
        // The context went with its check.
      }
    }
    if (files.length) console.log(`${check.name}: trace ${files.join(', ')} (npx playwright-core show-trace <file>)`);
    return files;
  })();
  return check.kept;
}

/**
 * Reads once nothing on the check's pages is moving (`still`), for a one-shot read of a computed
 * style or box: an element mid-entrance, mid-fade or mid-slide measures as it passes, not where it
 * rests (SV-75; the lint asks). A read that polls until a value holds (`until`) needs no rest; one
 * meant to catch motion says so on the line before it.
 */
export async function rested<T>(read: () => Promise<T>): Promise<T> {
  for (const page of checks.getStore()?.pages ?? []) if (!page.isClosed()) await still(page);
  return read();
}

// Every Setpoint a check started and hasn't stopped. A check that fails or times out (node --test
// --test-timeout cancels it) may never reach its own `stop()`; each spec's `after(cleanUp)` stops
// what's left, and if the process exits anyway its servers are killed with it.
const running = new Map<ChildProcess, () => Promise<void>>();
process.on('exit', () => {
  for (const server of running.keys()) server.kill('SIGKILL');
});

/** Each spec's `after` hook: stops every Setpoint still running and closes Chromium, whatever happened. */
export async function cleanUp() {
  await Promise.allSettled([...running.values()].map(stop => stop()));
  await closeBrowser();
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

export interface Setpoint {
  base: string;
  dataDir: string;
  // The owner's session cookie, once claimed.
  cookie: {name: string; value: string} | null;
  /** A JSON API call as the signed-in owner. */
  api: <T = unknown>(method: string, apiPath: string, body?: unknown) => Promise<T>;
  /**
   * A browser page at `size` (or any desktop viewport), signed in when claimed. Its `goto` and
   * `reload` return once the page is ready (`ready`): its first data in and drawn, and its fonts.
   */
  page: (size: SizeName | {width: number; height: number}) => Promise<Page>;
  // Uncaught errors in its pages, which a check asserts are none.
  pageErrors: string[];
  /**
   * Resolves once none of its pages has an /api request in flight, so what the browser last sent
   * (an edit saved, a drop) has reached the server and been answered, before a check reads it there.
   */
  idle: () => Promise<void>;
  stop: () => Promise<void>;
}

// The bundles of this run, from run.ts (bundle.ts); anything else runs the source.
const BUNDLE = process.env.SETPOINT_BROWSER_BUNDLE;
const SERVER = BUNDLE ? path.join(BUNDLE, 'server.mjs') : 'server/src/server.ts';
const TEMPLATE = BUNDLE ? path.join(BUNDLE, 'template.mjs') : 'server/src/dev/template.ts';

function run(args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync(process.execPath, args, {cwd: ROOT, env, encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`node ${args.join(' ')} failed:\n${result.stderr}`);
  return result.stdout;
}

// Seeded data directories to copy, one per set of fixtures, each with its setup token issued: the
// seed, the fixtures and the token are the same every time, so they run once per set rather than
// once per check. The run's global setup (globalSetup.ts) shares one directory of them across spec
// files; a spec run on its own keeps its own, removed when it exits.
let templateRoot = process.env.SETPOINT_BROWSER_TEMPLATES ?? null;
const templates = new Map<string, Template>();

interface Template {
  dataDir: string;
  setupToken: string;
  cookie: Setpoint['cookie'];
}

function template(fixtures: string[], claim: boolean, env: NodeJS.ProcessEnv): Template {
  const key = ['seed', ...fixtures, ...(claim ? ['claimed'] : [])].join('+');
  const known = templates.get(key);
  if (known) return known;
  if (!templateRoot) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-templates-'));
    process.on('exit', () => fs.rmSync(root, {recursive: true, force: true}));
    templateRoot = root;
  }
  const dir = path.join(templateRoot, key);
  if (!fs.existsSync(dir)) {
    // Built aside and renamed into place, so spec files building the same set at once don't collide.
    const building = fs.mkdtempSync(`${dir}.building-`);
    const buildEnv = {...env, SETPOINT_DATA_DIR: path.join(building, 'data')};
    // The sample's News, never the checkout's snapshot of real news: the checks are the sample's.
    // Claimed here, so a check has its signed-in session without a claim of its own (SV-143).
    fs.writeFileSync(path.join(building, 'template.json'), run([TEMPLATE, ...(claim ? ['--claim', PASSWORD] : []), ...fixtures], buildEnv));
    try {
      fs.renameSync(building, dir);
    } catch {
      // Another spec file got there first; its copy is the same.
      fs.rmSync(building, {recursive: true, force: true});
    }
  }
  const made: Template = {dataDir: path.join(dir, 'data'), ...JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8')) as Omit<Template, 'dataDir'>};
  templates.set(key, made);
  return made;
}

export interface StartOptions {
  // `false` leaves it for the sign-in card to claim.
  claim?: boolean;
  // Board fixtures layered on the seed (server/src/dev/fixtures/, decision D3).
  fixtures?: string[];
  // `seed` runs on from the seed's moment; `frozen` holds there.
  clock?: 'seed' | 'frozen';
  // More of the server's environment (SETPOINT_DEV_AI_URL for a fake model).
  env?: Record<string, string>;
}

/** A fresh Setpoint on the seed, with board fixtures if asked. */
export async function startSetpoint({claim = true, fixtures = [], clock = 'seed', env: extra = {}}: StartOptions = {}): Promise<Setpoint & {setupToken: string}> {
  if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) throw new Error('web/dist has no build: run `npm run build` first.');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-browser-'));
  // The compile cache takes about a quarter off the CPU of a server's boot, and a check boots one (SV-143).
  const env: NodeJS.ProcessEnv = {
    NODE_COMPILE_CACHE: path.join(ROOT, 'node_modules', '.cache', 'node-compile'),
    ...process.env, SETPOINT_DATA_DIR: dataDir, SETPOINT_CLOCK: clock, SETPOINT_WEB_DIR: WEB_DIST, ...extra,
  };
  delete env.NODE_ENV;
  delete env.SETPOINT_PUBLIC_URL;
  const seeded = template(fixtures, claim, env);
  // The database and News's image copies (news-images/).
  fs.cpSync(seeded.dataDir, dataDir, {recursive: true, mode: fs.constants.COPYFILE_FICLONE});
  const {setupToken} = seeded;

  // Ready when it says it's listening on its port. Spec files run side by side, so another's server
  // can take the port between freePort and the listen; that start is retried on a new one. The
  // limit is a backstop for a server that hangs, not a measure: a start took up to 30 s on two busy
  // cores with the browser slowed 4× (the timing report, 2026-10-11), against 2–3 s alone.
  let port = 0;
  let server!: ChildProcess;
  let errors = '';
  for (let attempt = 1; ; attempt += 1) {
    port = await freePort();
    env.SETPOINT_PORT = String(port);
    server = spawn(process.execPath, [SERVER], {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
    errors = '';
    server.stderr!.on('data', chunk => (errors += chunk));
    const listening = `Setpoint listening on http://127.0.0.1:${port} `;
    const started = await new Promise<boolean>((resolve, reject) => {
      let out = '';
      const onData = (chunk: Buffer) => {
        out += chunk;
        if (out.includes(listening)) done(true);
      };
      // 'close', not 'exit': by then its stderr has all arrived.
      const onClose = () => done(false);
      const timer = setTimeout(() => {
        server.kill('SIGKILL');
        reject(new Error(`Setpoint didn't answer on http://127.0.0.1:${port}:\n${errors}`));
      }, 90_000);
      function done(ok: boolean) {
        clearTimeout(timer);
        server.stdout!.off('data', onData);
        server.off('close', onClose);
        // Keeps its later output flowing, unread.
        server.stdout!.resume();
        resolve(ok);
      }
      server.stdout!.on('data', onData);
      server.once('close', onClose);
    });
    if (started) break;
    if (!errors.includes('EADDRINUSE') || attempt === 3) throw new Error(`Setpoint exited:\n${errors}`);
  }
  const base = `http://127.0.0.1:${port}`;

  let cookie = seeded.cookie;
  const api = async <T,>(method: string, apiPath: string, body?: unknown): Promise<T> => {
    const response = await fetch(`${base}/api${apiPath}`, {
      method,
      headers: {Origin: base, Accept: 'application/json', ...(body === undefined ? {} : {'Content-Type': 'application/json'}), ...(cookie ? {Cookie: `${cookie.name}=${cookie.value}`} : {})},
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = response.headers.getSetCookie().map(line => /^([^=]+)=([^;]*)/.exec(line)).find(match => match && match[2]);
    if (set) cookie = {name: set[1]!, value: set[2]!};
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${apiPath}: ${response.status} ${text}`);
    return (text ? JSON.parse(text) : undefined) as T;
  };
  const contexts: BrowserContext[] = [];
  // Each page's /api requests in flight (the live stream aside).
  const loadingByPage = new Map<Page, Set<Request>>();
  const pageErrors: string[] = [];
  const stop = async () => {
    running.delete(server);
    // Its pages close before the server goes, so nothing asks a port that's gone; within a check the
    // contexts stay open, with their traces, for its end (asCheck), which keeps a failed check's and
    // closes them. Outside one (cleanUp) they close here.
    if (checks.getStore()) await Promise.all(contexts.flatMap(context => context.pages()).map(page => page.close().catch(() => {})));
    else await Promise.all(contexts.map(context => context.close().catch(() => {})));
    if (server.exitCode === null && server.signalCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve));
      server.kill('SIGTERM');
      // A server that won't stop in 5 s is killed.
      const timer = setTimeout(() => server.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
    fs.rmSync(dataDir, {recursive: true, force: true});
  };
  running.set(server, stop);
  return {
    base, dataDir, setupToken, pageErrors,
    get cookie() {
      return cookie;
    },
    api,
    async idle() {
      for (const [page, loading] of loadingByPage) if (!page.isClosed()) await answered(page, loading);
    },
    async page(size) {
      const chromium = await launchBrowser();
      const iphone = size === 'iphone';
      const context = await chromium.newContext({
        viewport: typeof size === 'string' ? SIZES[size] : size, deviceScaleFactor: 1, isMobile: iphone, hasTouch: iphone,
        timezoneId: 'America/Los_Angeles', locale: 'en-US', colorScheme: 'dark',
      });
      contexts.push(context);
      if (TRACE) await context.tracing.start({screenshots: true, snapshots: true});
      checks.getStore()?.contexts.add(context);
      if (cookie) await context.addCookies([{name: cookie.name, value: cookie.value, url: base}]);
      const page = await context.newPage();
      checks.getStore()?.pages.add(page);
      page.on('pageerror', error => pageErrors.push(String(error)));
      const loading = new Set<Request>();
      loadingByPage.set(page, loading);
      page.on('request', request => {
        const {pathname} = new URL(request.url());
        if (pathname.startsWith('/api/') && pathname !== '/api/events') loading.add(request);
      });
      page.on('requestfinished', request => loading.delete(request));
      page.on('requestfailed', request => loading.delete(request));
      // A new document drops what the last one was loading, which may never say it failed.
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) loading.clear();
      });
      const [goto, reload] = [page.goto.bind(page), page.reload.bind(page)];
      page.goto = async (...args) => {
        const response = await goto(...args);
        await ready(page, loading);
        return response;
      };
      page.reload = async (...args) => {
        const response = await reload(...args);
        await ready(page, loading);
        return response;
      };
      return page;
    },
    stop,
  };
}

/**
 * Resolves once a page that just loaded is ready to read: no /api request in flight (the live
 * stream aside) across two drawn frames, so what the first answers asked for has come too, and
 * every web font loaded, so text has its real widths (SV-40). The fonts are loaded rather than
 * awaited: `document.fonts.ready` is already settled before the first text asks for them.
 */
async function ready(page: Page, loading: Set<Request>) {
  await answered(page, loading, 'the page\'s first data');
  await page.evaluate(() => Promise.all([...document.fonts].map(face => face.load())));
}

/** Resolves once `page` has no /api request in flight across two drawn frames. */
async function answered(page: Page, loading: Set<Request>, what = 'the page\'s requests answered') {
  await until(what, async () => {
    if (!loading.size) await drawnTwice(page);
    return [...loading].map(request => new URL(request.url()).pathname);
  }, pending => pending.length === 0, 15_000);
}

/**
 * Two frames drawn. Under a clock the check has installed (page.clock) requestAnimationFrame fires
 * only as the clock runs, which a paused one doesn't, so there it's two turns of the page's own task
 * queue instead, which React's renders are scheduled on (a MessageChannel, which the clock leaves alone).
 */
async function drawnTwice(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (!('__pwClock' in window)) return new Promise(drawn => requestAnimationFrame(() => requestAnimationFrame(drawn)));
    const turn = () => new Promise(next => {
      const channel = new MessageChannel();
      channel.port1.onmessage = next;
      channel.port2.postMessage(null);
    });
    return turn().then(turn);
  });
}

/**
 * A response the check waited for (`waitForResponse`, `page.on('response')`) read whole and drawn:
 * those resolve on its headers, before the app has its body, so a read straight after can find the
 * page as it was (SV-195).
 */
export async function drawn(page: Page, response: Response): Promise<void> {
  await response.finished();
  await drawnTwice(page);
}

/**
 * Stops the page's clock, installed by the check (page.clock.install), at about now, so what it
 * reads by the minute ("in 10m", the now-line's time) or a window such as the toast's Undo doesn't
 * run on with real time on a busy machine (SV-195). The check then moves it on itself (`runFor`,
 * `fastForward`). pauseAt stops the clock and then runs it on to the time given; a time real time
 * has already passed is refused, and is asked again from the stopped clock's own now.
 */
export async function pauseClock(page: Page): Promise<void> {
  for (let tries = 0; ; tries++) {
    try {
      await page.clock.pauseAt(await page.evaluate(() => Date.now()) + 250);
      return;
    } catch (error) {
      if (tries === 2 || !String(error).includes('past')) throw error;
    }
  }
}

/**
 * Holds the toast showing so its time (and its Undo) waits while the check reads the server before
 * pressing Undo: its 6 s run on real time otherwise, which a busy machine can use up (SV-195). The
 * toast no longer waits under the pointer (D506), so this sets the app's test-only hold, which the
 * toast's going clears. Answers the toast.
 */
export async function holdToast(page: Page): Promise<Locator> {
  const toast = page.locator('.toast:not(.leaving)');
  await toast.waitFor();
  await page.evaluate(() => document.documentElement.setAttribute('data-hold-toast', ''));
  return toast;
}

/** Waits until `check` holds, polling; throws with what it last saw. */
export async function until<T>(what: string, read: () => Promise<T>, check: (value: T) => boolean, timeoutMs = 5000): Promise<T> {
  const ends = Date.now() + timeoutMs;
  let value = await read();
  while (!check(value)) {
    if (Date.now() > ends) throw new Error(`${what}: still ${JSON.stringify(value)} after ${timeoutMs} ms`);
    await new Promise(resolve => setTimeout(resolve, 50));
    value = await read();
  }
  return value;
}

/**
 * Points at a mail row (or group header) as the user would before a key that acts on the cursor: the
 * hover moves the cursor in a later render than the key's, so this waits until the row is it.
 */
export async function point(row: Locator): Promise<void> {
  await row.hover();
  await until('the cursor on the row', () => row.getAttribute('class'), classes => Boolean(classes?.split(' ').includes('cur')));
}

/**
 * Resolves once nothing on the page is moving: every entrance, exit, fold and fade (a finite
 * animation or transition under 2 s; the toast's Undo clock and spinners aside) has run its course,
 * and the page has drawn twice since, so what `rested` reads is where it rests
 * (an overlay mid-entrance is scaled and offset, and drawn on a layer of its own). Not for a check to
 * call: a check doesn't wait out a motion it started (D416).
 */
async function still(page: Page): Promise<void> {
  await until('nothing moving', () => page.evaluate(() => document.getAnimations()
    .filter(animation => animation.playState === 'running' && (animation.effect?.getComputedTiming().endTime as number) < 2000)
    .map(animation => (animation as CSSAnimation).animationName ?? animation.constructor.name)), moving => moving.length === 0);
  await drawnTwice(page);
}

/**
 * Opens every unread Security email through the API: Mark all as read leaves Security (UX #4), so a
 * check that wants an empty Inbox reads those first.
 */
export async function readSecurity(setpoint: Setpoint): Promise<void> {
  const inbox = await setpoint.api<{groups: {group: string; rows: {id: number; unread: boolean}[]}[]}>('GET', '/mail/inbox');
  for (const row of inbox.groups.find(group => group.group === 'security')?.rows ?? []) {
    if (row.unread) await setpoint.api('POST', `/mail/messages/${row.id}/open`, {});
  }
}


/** Picks a choice in a Settings select: its chip opens the shared menu (no browser list), by label or position. */
export async function choose(page: Page, select: string, option: string | number) {
  const settings = page.locator('.settings');
  await settings.getByRole('button', {name: select, exact: true}).click();
  const menu = settings.getByRole('menu', {name: select, exact: true});
  const items = menu.getByRole('menuitemradio');
  await (typeof option === 'number' ? items.nth(option) : menu.getByRole('menuitemradio', {name: option, exact: true})).click();
  await menu.waitFor({state: 'detached'});
}
