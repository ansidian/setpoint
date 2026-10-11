// The browser checks' harness (`npm run test:browser`; BUILD-PLAN.md › Rules for every slice).
// Each check gets its own Setpoint: a copy of a fresh seed in a scratch data directory, the real
// server on a free port serving the production build (web/dist) with the seed's clock, claimed with
// a setup token from the CLI so the browser starts signed in. Spec files run side by side (six at
// once, run.ts), each check on its own port and data. Chromium comes from playwright-core:
// the browser Playwright keeps in its cache, else the installed Google Chrome (darma's way);
// nothing is downloaded.
import {spawn, spawnSync} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import type {Browser, BrowserContext, Locator, Page, Request} from 'playwright-core';
import {holdForRun} from './lock.ts';

export const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const WEB_DIST = path.join(ROOT, 'web', 'dist');
/** Where each run's screenshots and diffs go (git ignores it). */
export const OUTPUT = path.join(ROOT, 'test-results', 'browser');
/** The approved screenshots of the app the checks compare with (SV-33, D69). */
export const GOLDENS = fileURLToPath(new URL('./goldens/', import.meta.url));

/** The sizes every check runs at: the design target, the larger MacBook, and an iPhone. */
export const SIZES = {
  target: {width: 1677, height: 1050},
  large: {width: 1728, height: 1117},
  iphone: {width: 390, height: 844},
} as const;
export type SizeName = keyof typeof SIZES;

export const PASSWORD = 'browser checks only';

/**
 * `npm run test:browser:stress` (SV-40): every page runs on a CPU slowed 4×, the web fonts arrive
 * 2 s late, and /api answers slowly and out of order: requests sent together (a page's first data,
 * the refetches after a change) are held until no more come for 25 ms, then sent one at a time, the
 * last asked first, each 150 ms after the one before is in and drawn. So a check that waits for one
 * resource and then reads another (the Inbox's rows, then the counts in the title), reads the
 * server before the browser's change has reached it, or reads text widths before the fonts are in,
 * fails every time rather than only when the machine is busy. The normal run is unchanged.
 */
const STRESS = process.env.SETPOINT_BROWSER_STRESS === '1';
const STRESS_CPU_RATE = 4;
const STRESS_QUIET_MS = 25;
const STRESS_API_GAP_MS = 150;
const STRESS_STEP_LIMIT_MS = 2000;
const STRESS_FONT_DELAY_MS = 2000;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

let browser: Browser | null = null;

/** Chromium, launched once per check file, once its run holds the machine's lock (lock.ts). */
export async function launchBrowser(): Promise<Browser> {
  if (browser) return browser;
  await holdForRun();
  try {
    browser = await chromium.launch({headless: true});
  } catch (bundled) {
    try {
      browser = await chromium.launch({channel: 'chrome', headless: true});
    } catch {
      throw new Error(`No Chromium for the browser checks: neither Playwright's (${String((bundled as Error).message).split('\n')[0]}) nor Google Chrome.`);
    }
  }
  return browser;
}

export async function closeBrowser() {
  await browser?.close();
  browser = null;
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
const templates = new Map<string, {dataDir: string; setupToken: string}>();

function template(fixtures: string[], env: NodeJS.ProcessEnv): {dataDir: string; setupToken: string} {
  const key = ['seed', ...fixtures].join('+');
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
    // The sample's News, never the checkout's snapshot of real news: the checks and goldens are the sample's.
    run(['server/src/seed.ts', '--sample-news'], buildEnv);
    if (fixtures.length) run(['server/src/dev/fixtures/index.ts', ...fixtures], buildEnv);
    const setupToken = run(['server/src/cli.ts', 'setup-token'], buildEnv).trim().split('\n').at(-1)!.trim();
    fs.writeFileSync(path.join(building, 'setup-token'), setupToken);
    try {
      fs.renameSync(building, dir);
    } catch {
      // Another spec file got there first; its copy is the same.
      fs.rmSync(building, {recursive: true, force: true});
    }
  }
  const made = {dataDir: path.join(dir, 'data'), setupToken: fs.readFileSync(path.join(dir, 'setup-token'), 'utf8')};
  templates.set(key, made);
  return made;
}

export interface StartOptions {
  // `false` leaves it for the sign-in card to claim.
  claim?: boolean;
  // Board fixtures layered on the seed (server/src/dev/fixtures/, decision D3).
  fixtures?: string[];
  // `seed` runs on from the seed's moment; `frozen` holds there, for screenshots.
  clock?: 'seed' | 'frozen';
  // More of the server's environment (SETPOINT_DEV_AI_URL for a fake model).
  env?: Record<string, string>;
}

/** A fresh Setpoint on the seed, with board fixtures if asked. */
export async function startSetpoint({claim = true, fixtures = [], clock = 'seed', env: extra = {}}: StartOptions = {}): Promise<Setpoint & {setupToken: string}> {
  if (!fs.existsSync(path.join(WEB_DIST, 'index.html'))) throw new Error('web/dist has no build: run `npm run build` first.');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-browser-'));
  const env: NodeJS.ProcessEnv = {...process.env, SETPOINT_DATA_DIR: dataDir, SETPOINT_CLOCK: clock, SETPOINT_WEB_DIR: WEB_DIST, ...extra};
  delete env.NODE_ENV;
  delete env.SETPOINT_PUBLIC_URL;
  const seeded = template(fixtures, env);
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
    server = spawn(process.execPath, ['server/src/server.ts'], {cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe']});
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

  let cookie: Setpoint['cookie'] = null;
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
  if (claim) await api('POST', '/auth/claim', {setup_token: setupToken, password: `${PASSWORD} ${port}`});

  const contexts: BrowserContext[] = [];
  // Each page's /api requests in flight (the live stream aside).
  const loadingByPage = new Map<Page, Set<Request>>();
  const pageErrors: string[] = [];
  const stop = async () => {
    running.delete(server);
    await Promise.all(contexts.map(context => context.close().catch(() => {})));
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
      if (cookie) await context.addCookies([{name: cookie.name, value: cookie.value, url: base}]);
      if (STRESS) {
        // A check's own page.route takes precedence, so what it holds or fails isn't delayed too.
        let burst: (() => Promise<void>)[] = [];
        let quiet: NodeJS.Timeout | undefined;
        const release = async () => {
          const sending = burst.reverse();
          burst = [];
          for (const send of sending) {
            await pause(STRESS_API_GAP_MS);
            await send();
          }
        };
        await context.route(url => url.pathname.startsWith('/api/'), route => new Promise<void>(done => {
          burst.push(async () => {
            await route.continue().catch(() => {});
            done();
            // The next answer waits until this one is in and drawn, however slow the CPU; the live
            // stream never finishes, so only its headers are waited for. A request its page left
            // (a reload) never answers, so the wait gives up after a while.
            const drawn = async () => {
              const response = await route.request().response();
              if (!route.request().url().includes('/api/events')) await response?.finished();
              await route.request().frame().page().evaluate(() => new Promise(next => requestAnimationFrame(() => requestAnimationFrame(next))));
            };
            await Promise.race([drawn().catch(() => {}), pause(STRESS_STEP_LIMIT_MS)]);
          });
          clearTimeout(quiet);
          quiet = setTimeout(() => void release(), STRESS_QUIET_MS);
        }));
        await context.route('**/*.woff2', async route => {
          await pause(STRESS_FONT_DELAY_MS);
          await route.continue();
        });
      }
      const page = await context.newPage();
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
      if (STRESS) await (await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate', {rate: STRESS_CPU_RATE});
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
    if (!loading.size) await page.evaluate(() => new Promise(drawn => requestAnimationFrame(() => requestAnimationFrame(drawn))));
    return [...loading].map(request => new URL(request.url()).pathname);
  }, pending => pending.length === 0, 15_000);
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
 * Records each value `attribute` takes on `target` from now on, for a state too short-lived to read
 * after the action that starts it (a card's 120 ms close, the 180 ms theme fade): a busy machine can
 * take longer than that between the action and the read. Resolves to a reader of what it has seen.
 */
export async function watch(target: Locator, attribute: string): Promise<() => Promise<(string | null)[]>> {
  const index = await target.evaluate((element, name) => {
    const seen: (string | null)[] = [];
    // Each record holds the value before its change; the next one's, or the current, is after it.
    new MutationObserver(records => records.forEach((_, at) => seen.push(at + 1 < records.length ? records[at + 1]!.oldValue : element.getAttribute(name))))
      .observe(element, {attributes: true, attributeFilter: [name], attributeOldValue: true});
    const scope = window as unknown as {watched?: (string | null)[][]};
    scope.watched ??= [];
    return scope.watched.push(seen) - 1;
  }, attribute);
  return () => target.page().evaluate(at => (window as unknown as {watched: (string | null)[][]}).watched[at]!, index);
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

/**
 * Collapses the Inbox's groups by their headers, as the user would: every group starts expanded (DESIGN.md
 * #84), and the boards draw Deliveries, Money and Noise collapsed.
 */
export async function collapseGroups(page: Page, labels: string[] = ['Deliveries', 'Money', 'Noise']): Promise<void> {
  for (const label of labels) {
    const header = page.locator('.list .gh', {hasText: label});
    await header.click();
    await page.locator('.list .gh.collapsed', {hasText: label}).waitFor();
  }
  // Reaching a header lower down scrolled the list.
  await page.locator('.list').evaluate(list => list.scrollTo(0, 0));
}

/** Pixels that differ between two same-sized PNGs, and a diff image (red where they differ). */
export interface Comparison {
  width: number;
  height: number;
  differing: number;
  ratio: number;
  diff: Buffer;
}

/**
 * Compares two PNGs in the browser's canvas, pixelmatch's way: a pixel differs when its YIQ colour
 * distance is over `threshold` (0–1 of the largest possible; 0.1 is pixelmatch's default, which
 * lets antialiasing through). Different sizes count as entirely different.
 */
export async function compareImages(expected: Buffer, actual: Buffer, threshold = 0.1): Promise<Comparison> {
  const chromium = await launchBrowser();
  const page = await chromium.newPage();
  try {
    const result = await page.evaluate(async ({a, b, threshold}) => {
      const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = src;
      });
      const [one, two] = await Promise.all([load(a), load(b)]);
      const width = Math.max(one.width, two.width);
      const height = Math.max(one.height, two.height);
      const pixels = (image: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, width, height).data;
      };
      const p = pixels(one);
      const q = pixels(two);
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      const context = out.getContext('2d')!;
      const diff = context.createImageData(width, height);
      const max = 35215 * threshold * threshold;
      const sameSize = one.width === two.width && one.height === two.height;
      let differing = 0;
      for (let i = 0; i < p.length; i += 4) {
        const dr = p[i]! - q[i]!;
        const dg = p[i + 1]! - q[i + 1]!;
        const db = p[i + 2]! - q[i + 2]!;
        const y = dr * 0.29889531 + dg * 0.58662247 + db * 0.11448223;
        const iq = dr * 0.59597799 - dg * 0.2741761 - db * 0.32180189;
        const qq = dr * 0.21147017 - dg * 0.52261711 + db * 0.31114694;
        const delta = 0.5053 * y * y + 0.299 * iq * iq + 0.1957 * qq * qq;
        if (!sameSize || delta > max) {
          differing += 1;
          diff.data.set([255, 0, 0, 255], i);
        } else {
          const grey = 255 + ((p[i]! * 0.3 + p[i + 1]! * 0.59 + p[i + 2]! * 0.11) - 255) * 0.15;
          diff.data.set([grey, grey, grey, 255], i);
        }
      }
      context.putImageData(diff, 0, 0);
      return {width, height, differing, png: out.toDataURL('image/png')};
    }, {a: `data:image/png;base64,${expected.toString('base64')}`, b: `data:image/png;base64,${actual.toString('base64')}`, threshold});
    return {
      width: result.width, height: result.height, differing: result.differing, ratio: result.differing / (result.width * result.height),
      diff: Buffer.from(result.png.slice(result.png.indexOf(',') + 1), 'base64'),
    };
  } finally {
    await page.close();
  }
}

/** Writes a run's image under test-results/browser/ and returns its path. */
export function writeOutput(name: string, png: Buffer): string {
  fs.mkdirSync(OUTPUT, {recursive: true});
  const file = path.join(OUTPUT, name);
  fs.writeFileSync(file, png);
  return file;
}

// `npm run goldens` sets it: a screenshot that no longer matches replaces its approved one, for a
// deliberate change, and its diff is looked at before committing.
const UPDATE_GOLDENS = process.env.SETPOINT_UPDATE_GOLDENS === '1';

/**
 * Pixels allowed to differ from an approved screenshot. Captures from the same pinned Chromium come
 * out identical but for a stray edge pixel or six (the attention pill, a button's corner); a
 * recoloured chip is about 2,600 and a changed 16 px icon about 100.
 */
export const MAX_DIFFERING = 20;

/**
 * How far a pixel's colour may move before it counts (compareImages' threshold). Antialiasing
 * jitter moves a channel by 4 at most (about 0.015); `caution` drawn as `alert`, two close tokens,
 * is about 0.05, which pixelmatch's 0.1 would let through.
 */
const GOLDEN_THRESHOLD = 0.03;

/**
 * The parts of the screen a screenshot can cover (SV-33, D76): each check's covers only what it's
 * about, and the shared parts (the sidebar, with the mark, counts and Today block) are checked once
 * each in screenshots of their own, so a change re-approves only the screenshots that show it. One
 * without a region is the whole page (Light, the phone).
 */
export const REGIONS = {
  sidebar: 'aside.sb',
  main: 'main.main',
  list: 'section.list',
  // News's list column: the Missed strip, the pill and the stories (DESIGN.md › News).
  news: 'section.nw-list',
  reader: 'section.pane',
  grid: 'section.cal-month',
  rightPane: '.rpane',
  settings: '.settings',
  palette: '.palette',
} as const;
export type Region = keyof typeof REGIONS;

// The screenshots that check Setpoint's mark (the sidebar in each theme, the phone's header, the
// screen that says Setpoint can't be reached); the rest that show it leave it out. It's hidden
// rather than masked: a mask paints over the mark's box even where something covers it (the phone's
// reader over the Inbox's header).
const MARK_CHECKED = new Set(['01-inbox-a-typical-morning.sidebar', '22a-light-inbox', '21a-phone-inbox', 'unreachable-at-launch']);
const WITHOUT_MARK = 'svg.mark { visibility: hidden; }';

/**
 * Compares the page, or one region of it, with its approved screenshot,
 * web/tests/browser/goldens/<name>.png, once its fonts are in and it has settled. A region's box on
 * the page is kept beside it (<name>.json), for the board audit to crop its board the same way. The
 * actual image and a diff land in test-results/browser/.
 */
export async function matchGolden(page: Page, name: string, region?: Region): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  // Lets the last hover or scroll settle before the screenshot.
  await page.waitForTimeout(250);
  const options = {animations: 'disabled', caret: 'hide', style: MARK_CHECKED.has(name) ? undefined : WITHOUT_MARK} as const;
  // The region's box out to whole pixels, so the board audit crops its board exactly the same.
  const clip = region ? await page.locator(REGIONS[region]).evaluate(element => {
    const {left, top, right, bottom} = element.getBoundingClientRect();
    return {x: Math.floor(left), y: Math.floor(top), width: Math.ceil(right) - Math.floor(left), height: Math.ceil(bottom) - Math.floor(top)};
  }) : undefined;
  const actual = await page.screenshot({...options, clip});
  const actualPath = writeOutput(`${name}.actual.png`, actual);
  const golden = path.join(GOLDENS, `${name}.png`);
  const shown = path.relative(ROOT, golden);
  const placeBox = () => {
    const box = path.join(GOLDENS, `${name}.json`);
    if (clip) fs.writeFileSync(box, `${JSON.stringify(clip)}\n`);
    else fs.rmSync(box, {force: true});
  };
  const approve = () => {
    fs.mkdirSync(GOLDENS, {recursive: true});
    fs.writeFileSync(golden, actual);
    placeBox();
  };
  if (!fs.existsSync(golden)) {
    if (!UPDATE_GOLDENS) throw new Error(`${name}: no approved screenshot at ${shown}. Capture it with \`npm run goldens\` and look at it beside its board (\`npm run audit:boards\`) before committing.`);
    approve();
    console.log(`${name}: captured ${shown}`);
    return;
  }
  const result = await compareImages(fs.readFileSync(golden), actual, GOLDEN_THRESHOLD);
  const diffPath = writeOutput(`${name}.diff.png`, result.diff);
  console.log(`${name}: ${result.differing} pixels differ from ${shown}; actual ${actualPath}, diff ${diffPath}`);
  if (result.differing <= MAX_DIFFERING) {
    if (UPDATE_GOLDENS) placeBox();
    return;
  }
  if (UPDATE_GOLDENS) {
    approve();
    console.log(`${name}: re-captured ${shown}; look at ${diffPath} before committing`);
    return;
  }
  throw new Error(`${name} differs from ${shown} in ${result.differing} pixels (at most ${MAX_DIFFERING}); see ${diffPath}. A deliberate change re-captures it with \`npm run goldens\`.`);
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
