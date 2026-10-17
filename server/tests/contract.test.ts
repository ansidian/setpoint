// SV-85: the iPhone app's contract. The app (setpoint-ios) decodes these responses with hand-written
// Codable types, and an installed build stays older than the server, so what it reads is recorded
// from the seed into shared/contract/ and every run checks the API still answers in a way that build
// can decode: no key gone or renamed, no new kind at a path, no status changed, and no enum value it
// doesn't know. A new key passes. `npm run contract:record` re-records, deliberately (like `npm run
// goldens`), and its index lists what each fixture can't speak for. setpoint-ios copies the folder in at a
// pinned setpoint-v2 commit, and its decoding tests read the same files.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  COMMAND_KINDS, COMMAND_STATES, COMMAND_TARGETS, CALENDAR_PROVIDERS, COLOURS, HEALTH_STATES, INBOX_GROUPS, ITEM_KINDS, KINDS,
  LANES, LIVE_EVENT_TYPES, MATCH_FIELDS, MESSAGE_TYPES, NEWS_SECTIONS, REMOTE_CONTENT_REASONS, SEARCH_CHIP_KINDS, SESSION_METHODS,
  SOURCE_PROVIDERS, STREAM_EVENTS, SYNC_MODES, ACCOUNT_PROVIDERS,
} from '@setpoint/shared';
import type {HighlightOut, MeOut, SearchOut} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {confirmCommand, failCommand} from '../src/commands/index.ts';
import {noteLive} from '../src/store.ts';
import {addedValues, breaks, shapeOf, unseen} from './contractShape.ts';
import {readEvents, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

const DIR = fileURLToPath(new URL('../../shared/contract/', import.meta.url));
const RECORDING = process.env.SETPOINT_UPDATE_CONTRACT === '1';

// The literal unions the app reads that shared/ doesn't export as a list; `satisfies` and the
// checks below keep each one equal to its type.
const SEARCH_ORDERS = ['newest', 'match'] as const satisfies readonly SearchOut['order'][];
const HIGHLIGHT_FIELDS = ['from_name', 'organisation', 'subject', 'excerpt'] as const satisfies readonly HighlightOut['field'][];
const ME_METHODS = [...SESSION_METHODS, 'device'] as const satisfies readonly MeOut['method'][];
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export type ContractUnionsCheck = [
  Exactly<(typeof SEARCH_ORDERS)[number], SearchOut['order']>,
  Exactly<(typeof HIGHLIGHT_FIELDS)[number], HighlightOut['field']>,
  Exactly<(typeof ME_METHODS)[number], MeOut['method']>,
];

/** Every fixed set a pinned response or event carries. */
const ENUMS: Record<string, readonly string[]> = {
  ACCOUNT_PROVIDERS, CALENDAR_PROVIDERS, COLOURS, COMMAND_KINDS, COMMAND_STATES, COMMAND_TARGETS, HEALTH_STATES, HIGHLIGHT_FIELDS,
  INBOX_GROUPS, ITEM_KINDS, KINDS, LANES, LIVE_EVENT_TYPES, MATCH_FIELDS, ME_METHODS, MESSAGE_TYPES, NEWS_SECTIONS,
  REMOTE_CONTENT_REASONS, SEARCH_CHIP_KINDS, SEARCH_ORDERS, SOURCE_PROVIDERS, STREAM_EVENTS, SYNC_MODES,
};

interface Recorded {
  name: string;
  // The TypeScript type in shared/ the body is, for the Swift type that decodes it.
  type: string;
  method: string;
  route: string;
  path: string;
  request?: unknown;
  status: number;
  content_type: string | null;
  body: unknown;
}
interface Event {
  name: string;
  type: string;
  data: unknown;
}

// Random values, made fixed and of the same form, so recording an unchanged server changes nothing.
const FIXED_TOKEN = `sp_device_${'0'.repeat(43)}`;
const FIXED_CODE = '0'.repeat(43);
const fixedStreamId = (id: string) => id.replace(/^[0-9a-f]{8}-/, '00000000-');

/** The app's requests: a bearer token and no cookie or Origin, as setpoint-ios sends them. */
function phone(app: {request: (url: string, init: RequestInit) => Response | Promise<Response>}) {
  let token: string | null = null;
  const recorded: Recorded[] = [];
  const send = async (method: string, url: string, body?: unknown) => {
    const response = await app.request(url, {
      method,
      headers: {...(body === undefined ? {} : {'content-type': 'application/json'}), ...(token ? {authorization: `Bearer ${token}`} : {})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? null;
    const text = await response.text();
    return {status: response.status, contentType, body: contentType === 'application/json' ? JSON.parse(text) : null};
  };
  return {
    recorded,
    send,
    set token(value: string) {
      token = value;
    },
    /** Sends a request and keeps its answer as a fixture. */
    async record(name: string, type: string, method: string, route: string, url: string, request?: unknown) {
      const answer = await send(method, url, request);
      recorded.push({name, type, method, route, path: url, ...(request === undefined ? {} : {request}), status: answer.status, content_type: answer.contentType, body: answer.body});
      return answer.body;
    },
  };
}

/** Everything the app reads, from the seed at SEED_NOW, in one fixed order. */
async function recordAll(w: World) {
  const browser = await signedIn(w, {keepAliveMs: 20});
  const app = phone(browser.app);
  const {code} = (await browser.send('POST', '/api/security/pairing')).body;

  // Pairing, then who the app is signed in as.
  const paired = await app.record('auth-pair', 'PairOut', 'POST', '/api/auth/pair', '/api/auth/pair', {code, name: 'iPhone 17 Pro'}) as {token: string};
  const token = paired.token;
  app.token = token;
  paired.token = FIXED_TOKEN;
  (app.recorded[0]!.request as {code: string}).code = FIXED_CODE;
  await app.record('me', 'MeOut', 'GET', '/api/me', '/api/me');
  await app.record('accounts', 'AccountOut[]', 'GET', '/api/accounts', '/api/accounts');
  await app.record('calendars', 'CalendarOut[]', 'GET', '/api/calendars', '/api/calendars');
  await app.record('sources', 'SourceOut[]', 'GET', '/api/sources', '/api/sources');

  // The live stream, open while the changes below are made: they send its mail and items events.
  const stream = await browser.app.request('/api/events', {headers: {authorization: `Bearer ${token}`}});
  const names = ['ready', ...LIVE_EVENT_TYPES, 'ping'];
  const reading = readEvents(stream, seen => names.every(name => seen.some(event => event.event === name)));

  // An email each way the reading pane shows one: pinned with an attachment, a protected security
  // email with its facts, and HTML with remote content held back (its body page too).
  await app.record('mail-message', 'MessageOut', 'GET', '/api/mail/messages/:id', '/api/mail/messages/27');
  await app.record('mail-message-security', 'MessageOut', 'GET', '/api/mail/messages/:id', '/api/mail/messages/2');
  await app.record('mail-message-html', 'MessageOut', 'GET', '/api/mail/messages/:id', '/api/mail/messages/8');
  await app.record('mail-body', 'HTML page', 'GET', '/api/mail/messages/:id/body', '/api/mail/messages/8/body');
  await app.record('mail-body-app', 'HTML page', 'GET', '/api/mail/messages/:id/body?frame=app', '/api/mail/messages/8/body?frame=app');

  // The mail actions.
  const opened = await app.record('mail-open', 'MessageOut', 'POST', '/api/mail/messages/:id/open', '/api/mail/messages/5/open') as {command: {id: number}};
  const marked = await app.record('mail-read', 'CommandOut', 'POST', '/api/mail/messages/:id/read', '/api/mail/messages/27/read', {unread: true}) as {id: number};
  await app.record('mail-done', 'MessageOut', 'POST', '/api/mail/messages/:id/done', '/api/mail/messages/5/done', {done: true});
  await app.record('mail-pin', 'MessageOut', 'POST', '/api/mail/messages/:id/pin', '/api/mail/messages/3/pin', {pinned: true});
  const trashed = await app.record('mail-trash', 'CommandOut', 'POST', '/api/mail/messages/:id/trash', '/api/mail/messages/4/trash') as {id: number};
  // Undo waits for the trash to settle, as the web's does.
  confirmCommand(w.store, trashed.id);
  await app.record('mail-untrash', 'CommandOut', 'POST', '/api/mail/messages/:id/untrash', '/api/mail/messages/4/untrash');
  await app.record('mail-mark-all-read', 'MarkAllReadOut', 'POST', '/api/mail/mark-all-read', '/api/mail/mark-all-read', {account_id: 1});

  // A command that failed, left failed in the Inbox; another failed and tried again.
  failCommand(w.store, marked.id, 'Gmail answered 503.');
  await app.record('command', 'CommandOut', 'GET', '/api/commands/:id', `/api/commands/${marked.id}`);
  failCommand(w.store, opened.command.id, 'Gmail answered 503.');
  await app.record('command-retry', 'CommandOut', 'POST', '/api/commands/:id/retry', `/api/commands/${opened.command.id}/retry`);

  // A task done, so the agenda has a change waiting too.
  await app.send('POST', '/api/items/8/complete', {done: true});

  // What only the server's own work sends: a source's health, and News.
  noteLive(w.store, {type: 'health', sources: [1]});
  noteLive(w.store, {type: 'news', stories: [1], sections: ['local'], sources: [1]});
  const live = await reading;
  // A reconnect from an id this process can't account for.
  const again = await browser.app.request('/api/events', {headers: {authorization: `Bearer ${token}`, 'last-event-id': 'deadbeef-12'}});
  const resync = await readEvents(again, seen => seen.some(event => event.event === 'resync'));
  const events: Event[] = names.map(name => {
    const event = live.find(seen => seen.event === name)!;
    return {name, type: name === 'ready' ? 'ReadyOut' : name === 'ping' ? '{}' : 'LiveEvent', data: event.data};
  });
  events.push({name: 'resync', type: '{}', data: resync.find(event => event.event === 'resync')!.data});
  const ready = events[0]!.data as {last_id: string};
  ready.last_id = fixedStreamId(ready.last_id);

  // The lists, with those changes in them.
  await app.record('mail-inbox', 'InboxOut', 'GET', '/api/mail/inbox', '/api/mail/inbox');
  await app.record('mail-counts', 'MailCountsOut', 'GET', '/api/mail/counts', '/api/mail/counts');
  await app.record('items', 'ItemsOut', 'GET', '/api/items', '/api/items?from=2026-10-01&to=2026-11-01');
  await app.record('search', 'SearchOut', 'POST', '/api/search', '/api/search', {text: 'northwind interview'});

  // Unpairing, and what every request gets after it.
  await app.record('device-unpair', '(no body)', 'DELETE', '/api/device', '/api/device');
  await app.record('error-unauthorized', 'ApiError', 'GET', '/api/mail/inbox', '/api/mail/inbox');
  app.token = '';
  await app.record('error-bad-pairing-code', 'ApiError', 'POST', '/api/auth/pair', '/api/auth/pair', {code: 'not-a-code'});
  return {responses: app.recorded, events};
}

const fixture = (file: string) => path.join(DIR, file);
const readJson = (file: string) => JSON.parse(fs.readFileSync(fixture(file), 'utf8'));
const writeJson = (file: string, value: unknown) => {
  fs.mkdirSync(path.dirname(fixture(file)), {recursive: true});
  fs.writeFileSync(fixture(file), `${JSON.stringify(value, null, 2)}\n`);
};
const responseFile = (name: string) => `responses/${name}.json`;
const eventFile = (name: string) => `events/${name}.json`;

interface Index {
  about: string;
  // `unseen` lists the paths a fixture can't speak for (always null, or always empty), which the
  // check leaves open.
  responses: (Omit<Recorded, 'body'> & {file: string | null; unseen?: string[]})[];
  events: (Omit<Event, 'data'> & {file: string; unseen?: string[]})[];
  enums: string;
}

const blind = (body: unknown) => {
  const paths = body === null ? [] : unseen(shapeOf([body]));
  return paths.length ? {unseen: paths} : {};
};

function write({responses, events}: Awaited<ReturnType<typeof recordAll>>) {
  fs.rmSync(DIR, {recursive: true, force: true});
  const index: Index = {
    about: 'The API responses and live events the iPhone app reads, recorded from the seed at SEED_NOW by server/tests/contract.test.ts (npm run contract:record). Each file is the body as sent. npm test fails when the server stops answering in a way an app built against these can decode.',
    responses: responses.map(({body, ...entry}) => {
      if (body !== null) writeJson(responseFile(entry.name), body);
      return {...entry, file: body === null ? null : responseFile(entry.name), ...blind(body)};
    }),
    events: events.map(({data, ...entry}) => {
      writeJson(eventFile(entry.name), data);
      return {...entry, file: eventFile(entry.name), ...blind(data)};
    }),
    enums: 'enums.json',
  };
  writeJson('enums.json', ENUMS);
  writeJson('index.json', index);
}

/** What changed in a way an app built against the fixtures can't decode. */
function compare({responses, events}: Awaited<ReturnType<typeof recordAll>>) {
  const index = readJson('index.json') as Index;
  const found: string[] = [];
  const check = (file: string, body: unknown) => found.push(...breaks(shapeOf([readJson(file)]), shapeOf([body])).map(line => `${file} ${line}`));
  for (const entry of responses) {
    const pinned = index.responses.find(known => known.name === entry.name);
    if (!pinned) {
      found.push(`${entry.name}: not recorded yet`);
      continue;
    }
    if (entry.status !== pinned.status) found.push(`${entry.name}: answered ${entry.status}, was ${pinned.status}`);
    if (entry.content_type !== pinned.content_type) found.push(`${entry.name}: sent ${entry.content_type}, was ${pinned.content_type}`);
    if (pinned.file && entry.body !== null) check(pinned.file, entry.body);
  }
  for (const entry of events) {
    const pinned = index.events.find(known => known.name === entry.name);
    if (pinned) check(pinned.file, entry.data);
    else found.push(`events ${entry.name}: not recorded yet`);
  }
  for (const known of [...index.responses, ...index.events]) {
    if (![...responses, ...events].some(entry => entry.name === known.name)) found.push(`${known.name}: in the fixtures, but no longer recorded`);
  }
  found.push(...addedValues(readJson('enums.json'), ENUMS).map(line => `enums.json ${line}`));
  return found;
}

describe('the iPhone app\'s contract', () => {
  test.skipIf(RECORDING)('the API still answers the way the recorded fixtures say', async () => {
    const found = compare(await recordAll(world({seed: true})));
    expect(found, 'An installed iPhone app would fail on these. Keep the old field, status or value alongside the new one; or, once setpoint-ios handles it, npm run contract:record and pin the new commit there.').toEqual([]);
  });

  test.runIf(RECORDING)('records the fixtures', async () => {
    write(await recordAll(world({seed: true})));
  });
});

const shape = (fixture: unknown, live: unknown) => breaks(shapeOf([fixture]), shapeOf([live]));

describe('what breaks an older app', () => {
  test.each([
    ['the same', {a: 1, b: 'x'}, {a: 2, b: 'y'}, []],
    ['a key added', {a: 1}, {a: 1, b: 2}, []],
    ['a key removed', {a: 1, b: 2}, {a: 1}, ['b: removed']],
    ['a key renamed', {a: 1, b: 2}, {a: 1, c: 2}, ['b: removed']],
    ['a string now a number', {a: 'x'}, {a: 1}, ['a: was string, now also integer']],
    ['null where it was always a string', {a: 'x'}, {a: null}, ['a: was string, now also null']],
    ['a value where it was always null', {a: null}, {a: 'x'}, []],
    ['a value where it was sometimes null', {rows: [{a: null}, {a: 'x'}]}, {rows: [{a: 'y'}]}, []],
    ['an integer now a fraction', {a: 3}, {a: 0.5}, ['a: was integer, now also number']],
    ['a fraction now whole', {a: 0.62}, {a: 1}, []],
    ['an instant now free text', {a: '2026-10-07T16:12:00.000Z'}, {a: 'Oct 7'}, ['a: was instant, now also string']],
    ['an instant now a date', {a: '2026-10-07T16:12:00.000Z'}, {a: '2026-10-07'}, ['a: was instant, now also date']],
    ['free text that reads as a date', {a: 'Oct 7'}, {a: '2026-10-07'}, []],
    ['a key gone from one element', {rows: [{a: 1}, {a: 2}]}, {rows: [{a: 1}, {}]}, ['rows[].a: missing from some']],
    ['a key gone from every element', {rows: [{a: 1, b: 1}]}, {rows: [{b: 1}, {b: 2}]}, ['rows[].a: removed']],
    ['a key only some elements had', {rows: [{a: 1}, {}]}, {rows: [{}]}, []],
    ['a nested key removed', {a: {b: {c: 1}}}, {a: {b: {}}}, ['a.b.c: removed']],
    ['an object now null', {a: {b: 1}}, {a: null}, ['a: was object, now also null']],
    ['an array always empty', {rows: []}, {rows: [{a: 1}]}, []],
    ['a list now empty', {rows: [{a: 1}]}, {rows: []}, []],
  ])('%s', (_name, fixture, live, expected) => {
    expect(shape(fixture, live)).toEqual(expected);
  });

  test.each([
    ['the same', {A: ['x', 'y']}, {A: ['x', 'y']}, []],
    ['a value removed', {A: ['x', 'y']}, {A: ['x']}, []],
    ['a value added', {A: ['x']}, {A: ['x', 'y']}, ['A: y added']],
    ['a set not pinned yet', {}, {A: ['x']}, ['A: not pinned yet']],
  ])('enums: %s', (_name, pinned, now, expected) => {
    expect(addedValues(pinned, now)).toEqual(expected);
  });

  test('a fixture lists what it can\'t speak for: always null, or always empty', () => {
    expect(unseen(shapeOf([{a: null, rows: [], b: {c: null}, d: [{e: []}]}]))).toEqual(['a: always null', 'rows: always empty', 'b.c: always null', 'd[].e: always empty']);
  });
});
