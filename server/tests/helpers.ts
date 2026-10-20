// Test worlds: an ephemeral SQLite database (optionally with the seed), a clock the test moves, a
// live feed and a key; and the app signed in as the owner, the way a browser is.
import {SEED_NOW} from '@setpoint/shared';
import {onTestFinished} from 'vitest';
import {createApp} from '../src/api/app.ts';
import type {AppOptions} from '../src/api/app.ts';
import {claimOwner, issueSetupToken} from '../src/auth/owner.ts';
import {openDatabase} from '../src/db/open.ts';
import {seedSampleData} from '../src/dev/sample.ts';
import {LiveFeed} from '../src/live/feed.ts';
import type {FeedEvent} from '../src/live/feed.ts';
import {keyringFrom} from '../src/secrets/crypto.ts';
import type {Store} from '../src/store.ts';

export const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
export const ORIGIN = 'http://localhost';
export const PASSWORD = 'correct horse battery';

export interface World {
  store: Store;
  // Sets the clock, as an ISO instant, or moves it on by `ms`.
  at(iso: string): void;
  advance(ms: number): void;
  // Every live event the feed sent.
  events: FeedEvent[];
}

export function world({seed = false, now = SEED_NOW, newsImagesDir = null}: {seed?: boolean; now?: string; newsImagesDir?: string | null} = {}): World {
  const {sqlite, db} = openDatabase(':memory:');
  onTestFinished(() => {
    sqlite.close();
  });
  let clock = Date.parse(now);
  const live = new LiveFeed();
  const events: FeedEvent[] = [];
  live.subscribe(event => events.push(event));
  const store: Store = {sqlite, db, timeZone: 'America/Los_Angeles', now: () => new Date(clock), live, keyring: keyringFrom(TEST_KEY)};
  // News's images go to `newsImagesDir`; without one only their rows are kept.
  if (seed) seedSampleData({sqlite, db}, {newsImagesDir});
  return {
    store, events,
    at: iso => (clock = Date.parse(iso)),
    advance: ms => (clock += ms),
  };
}

/** The live events sent so far, as LiveEvents. */
export const liveEvents = (w: World) => w.events.flatMap(event => (event.type === 'live' ? [event.event] : []));

export interface Response {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  headers: Headers;
}

/** The app, and requests sent from Setpoint's own page with whatever cookie it holds. */
export function client(w: World, options: Partial<AppOptions> = {}) {
  const app = createApp({store: w.store, bcryptCost: 4, ...options});
  let cookie: string | null = null;
  const send = async (method: string, url: string, {body, headers = {}, keepCookie = true}: {body?: unknown; headers?: Record<string, string>; keepCookie?: boolean} = {}): Promise<Response> => {
    const response = await app.request(url, {
      method,
      headers: {
        origin: ORIGIN,
        ...(body === undefined ? {} : {'content-type': 'application/json'}),
        ...(cookie ? {cookie} : {}),
        ...headers,
      },
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    const set = response.headers.getSetCookie().find(line => line.startsWith('setpoint_session=') || line.startsWith('__Host-setpoint_session='));
    if (set && keepCookie) {
      const [pair] = set.split(';');
      cookie = pair!.endsWith('=') ? null : pair!;
    }
    const text = await response.text();
    return {status: response.status, body: text && response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text, headers: response.headers};
  };
  return {
    app, send,
    get cookie() {
      return cookie;
    },
    set cookie(value: string | null) {
      cookie = value;
    },
  };
}

/** Reads SSE events from a stream until `until` says stop. */
export async function readEvents(response: globalThis.Response, until: (events: {event: string; data: unknown; id?: string}[]) => boolean) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const events: {event: string; data: unknown; id?: string}[] = [];
  let buffer = '';
  while (!until(events)) {
    const {value, done} = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, {stream: true});
    let end;
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const fields = Object.fromEntries(block.split('\n').filter(line => line && !line.startsWith(':')).map(line => [line.slice(0, line.indexOf(':')), line.slice(line.indexOf(':') + 1).trim()]));
      if (fields.event) events.push({event: fields.event, data: JSON.parse(fields.data ?? 'null'), id: fields.id});
    }
  }
  await reader.cancel();
  return events;
}

/** Claims Setpoint (bcrypt at cost 4) and signs this client in. */
export async function signedIn(w: World, options: Partial<AppOptions> = {}) {
  const c = client(w, options);
  const {token} = issueSetupToken(w.store);
  const claimed = await c.send('POST', '/api/auth/claim', {body: {setup_token: token, password: PASSWORD}});
  if (claimed.status !== 201) throw new Error(`Claim failed: ${JSON.stringify(claimed.body)}`);
  return c;
}

/** Claims Setpoint without the API. */
export const claim = (w: World) => claimOwner(w.store, issueSetupToken(w.store).token, PASSWORD, 4);
