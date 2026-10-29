// SV-85: the iPhone app's contract. The app (setpoint-ios) decodes these responses with hand-written
// Codable types, and an installed build stays older than the server, so what it reads is recorded
// from the seed into shared/contract/ and every run checks the API still answers in a way that build
// can decode: no key gone or renamed, no new kind at a path, no status changed, and no enum value it
// doesn't know. A new key passes. `npm run contract:record` re-records, deliberately (like `npm run
// goldens`), and its index lists what each fixture can't speak for. setpoint-ios copies the folder in at a
// pinned setpoint-v2 commit, and its decoding tests read the same files.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  AI_PROVIDERS, CALENDAR_MATCH_FIELDS, COMMAND_KINDS, COMMAND_STATES, COMMAND_TARGETS, CALENDAR_PROVIDERS, COLOURS, EVENT_COLOURS, HEALTH_STATES, INBOX_GROUPS, ITEM_KINDS, KINDS,
  LANES, LIVE_EVENT_TYPES, MATCH_FIELDS, MESSAGE_TYPES, NEWS_HAZARDS, NEWS_SECTIONS, NEWS_SORT_CAUSES, PROPOSAL_FIELDS, RECURRING_SCOPES, REMOTE_CONTENT_REASONS,
  SEARCH_CHIP_KINDS, SESSION_METHODS, SOURCE_PROVIDERS, STORY_STATES, STREAM_EVENTS, SYNC_MODES, TODOIST_COLOUR_NAMES, WEATHER_CONDITIONS, ACCOUNT_PROVIDERS,
} from '@setpoint/shared';
import type {ApiError, HighlightOut, MeOut, SearchOut, SectionHealthOut} from '@setpoint/shared';
import {describe, expect, onTestFinished, test} from 'vitest';
import type {AppOptions} from '../src/api/app.ts';
import {confirmCommand, failCommand} from '../src/commands/index.ts';
import {FIXTURES} from '../src/dev/fixtures/index.ts';
import {devProvider} from '../src/providers/dev/index.ts';
import {noteLive} from '../src/store.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
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
const NEWS_SECTION_HEALTH = ['stale', 'failing'] as const satisfies readonly SectionHealthOut['state'][];
type Exactly<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export type ContractUnionsCheck = [
  Exactly<(typeof SEARCH_ORDERS)[number], SearchOut['order']>,
  Exactly<(typeof HIGHLIGHT_FIELDS)[number], HighlightOut['field']>,
  Exactly<(typeof ME_METHODS)[number], MeOut['method']>,
  Exactly<(typeof NEWS_SECTION_HEALTH)[number], SectionHealthOut['state']>,
];

/** Every fixed set a pinned response or event carries. */
const ENUMS: Record<string, readonly string[]> = {
  ACCOUNT_PROVIDERS, AI_PROVIDERS, CALENDAR_MATCH_FIELDS, CALENDAR_PROVIDERS, COLOURS, COMMAND_KINDS, COMMAND_STATES, COMMAND_TARGETS, EVENT_COLOURS, HEALTH_STATES,
  HIGHLIGHT_FIELDS, INBOX_GROUPS, ITEM_KINDS, KINDS, LANES, LIVE_EVENT_TYPES, MATCH_FIELDS, ME_METHODS, MESSAGE_TYPES, NEWS_HAZARDS, NEWS_SECTION_HEALTH,
  NEWS_SECTIONS, NEWS_SORT_CAUSES, PROPOSAL_FIELDS, RECURRING_SCOPES, REMOTE_CONTENT_REASONS, SEARCH_CHIP_KINDS, SEARCH_ORDERS, SOURCE_PROVIDERS, STORY_STATES,
  STREAM_EVENTS, SYNC_MODES, TODOIST_COLOUR_NAMES, WEATHER_CONDITIONS,
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
  // Headers the app relies on beyond the content type (a News image's caching), pinned like a status.
  headers?: Record<string, string>;
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
function phone(app: {request: (url: string, init: RequestInit) => Response | Promise<Response>}, recorded: Recorded[] = []) {
  let token: string | null = null;
  const send = async (method: string, url: string, body?: unknown) => {
    const response = await app.request(url, {
      method,
      headers: {...(body === undefined ? {} : {'content-type': 'application/json'}), ...(token ? {authorization: `Bearer ${token}`} : {})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    const contentType = response.headers.get('content-type')?.split(';')[0] ?? null;
    const text = await response.text();
    return {status: response.status, contentType, headers: response.headers, body: contentType === 'application/json' ? JSON.parse(text) : null};
  };
  return {
    recorded,
    send,
    get token() {
      return token ?? '';
    },
    set token(value: string) {
      token = value;
    },
    /** Sends a request and keeps its answer as a fixture, with the `headers` named. */
    async record(name: string, type: string, method: string, route: string, url: string, request?: unknown, headers?: readonly string[]) {
      const answer = await send(method, url, request);
      const kept = headers && Object.fromEntries(headers.map(header => [header, answer.headers.get(header) ?? '']));
      recorded.push({
        name, type, method, route, path: url, ...(request === undefined ? {} : {request}), status: answer.status, content_type: answer.contentType,
        ...(kept ? {headers: kept} : {}), body: answer.body,
      });
      return answer.body;
    },
  };
}

/** A data directory's news-images/ for one test, so the seed's News images are served as files. */
function newsImages() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-contract-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

/** The seed, signed in from the web, with an iPhone paired to it whose answers go into `recorded`. */
async function pairedPhone(w: World, options: Partial<AppOptions> = {}, recorded: Recorded[] = []) {
  const browser = await signedIn(w, options);
  const app = phone(browser.app, recorded);
  const {code} = (await browser.send('POST', '/api/security/pairing')).body;
  app.token = (await app.send('POST', '/api/auth/pair', {code, name: 'iPhone 17 Pro'})).body.token;
  return {browser, app};
}

/**
 * News's states the seed itself doesn't hold, from the board fixtures layered on it (src/dev/fixtures/
 * newsStates.ts, D3), each in a seeded world of its own so the rest stays as the seed has it.
 */
const NEWS_STATES = [
  {fixture: 'news-ai-down', name: 'news-status-unsorted', type: 'NewsStatusOut', route: '/api/news/status', path: '/api/news/status'},
  {fixture: 'news-first-run', name: 'news-status-first-run', type: 'NewsStatusOut', route: '/api/news/status', path: '/api/news/status'},
  // A section's own line: every AI source last checked at 7:02 AM.
  {fixture: 'news-stale-ai', name: 'news-section-stale', type: 'NewsSectionOut', route: '/api/news/sections/:section', path: '/api/news/sections/ai'},
];

/** Everything the app reads, from the seed at SEED_NOW, in one fixed order. */
async function recordAll() {
  const imagesDir = newsImages();
  const w = world({seed: true, newsImagesDir: imagesDir});
  // The dev provider serves the seed's attachment bytes; nothing ticks the engine, so commands stay
  // as the steps below leave them.
  const engine = new SyncEngine({store: w.store, adapters: new Adapters({}, devProvider())});
  const browser = await signedIn(w, {keepAliveMs: 20, engine, news: {imagesDir}});
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
  // A task ring takes its Todoist project's colour (D54).
  await app.record('todoist-projects', 'TodoistProjectOut[]', 'GET', '/api/todoist/projects', '/api/todoist/projects');

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
  await app.record('mail-body-app-show', 'HTML page', 'GET', '/api/mail/messages/:id/body?frame=app&images=show', '/api/mail/messages/8/body?frame=app&images=show');
  // Plain-text email has no body page.
  await app.record('mail-body-app-plain', 'ApiError', 'GET', '/api/mail/messages/:id/body?frame=app', '/api/mail/messages/27/body?frame=app');
  await app.record('mail-attachment', 'file bytes', 'GET', '/api/mail/messages/:id/attachments/:attachment', '/api/mail/messages/27/attachments/1');

  // The mail actions.
  const opened = await app.record('mail-open', 'MessageOut', 'POST', '/api/mail/messages/:id/open', '/api/mail/messages/5/open') as {command: {id: number}};
  const marked = await app.record('mail-read', 'CommandOut', 'POST', '/api/mail/messages/:id/read', '/api/mail/messages/27/read', {unread: true}) as {id: number};
  // Mark read, on an email the seed has unread.
  await app.record('mail-read-false', 'CommandOut', 'POST', '/api/mail/messages/:id/read', '/api/mail/messages/9/read', {unread: false});
  await app.record('mail-done', 'MessageOut', 'POST', '/api/mail/messages/:id/done', '/api/mail/messages/5/done', {done: true});
  await app.record('mail-pin', 'MessageOut', 'POST', '/api/mail/messages/:id/pin', '/api/mail/messages/3/pin', {pinned: true});
  const trashed = await app.record('mail-trash', 'CommandOut', 'POST', '/api/mail/messages/:id/trash', '/api/mail/messages/4/trash') as {id: number};
  // Undo while the provider still holds the trash is refused, and the app sends it again, as the
  // web's afterPending does; once the trash settles, Undo goes through.
  await app.record('error-command-pending', 'ApiError', 'POST', '/api/mail/messages/:id/untrash', '/api/mail/messages/4/untrash');
  confirmCommand(w.store, trashed.id);
  await app.record('mail-untrash', 'CommandOut', 'POST', '/api/mail/messages/:id/untrash', '/api/mail/messages/4/untrash');
  await app.record('mail-mark-all-read', 'MarkAllReadOut', 'POST', '/api/mail/mark-all-read', '/api/mail/mark-all-read', {account_id: 1});

  // A command that failed, left failed in the Inbox; another failed and tried again.
  failCommand(w.store, marked.id, 'Gmail answered 503.');
  await app.record('command', 'CommandOut', 'GET', '/api/commands/:id', `/api/commands/${marked.id}`);
  failCommand(w.store, opened.command.id, 'Gmail answered 503.');
  await app.record('command-retry', 'CommandOut', 'POST', '/api/commands/:id/retry', `/api/commands/${opened.command.id}/retry`);
  // A failed trash moved back instead.
  const stuck = await app.send('POST', '/api/mail/messages/3/trash');
  failCommand(w.store, stuck.body.id, 'Gmail answered 503.');
  await app.record('command-move-back', 'CommandOut', 'POST', '/api/commands/:id/move-back', `/api/commands/${stuck.body.id}/move-back`);

  // A task done, so the agenda has a change waiting too.
  await app.send('POST', '/api/items/8/complete', {done: true});

  // What only the server's own work sends: a source's health, News, and Jobs (which the app doesn't
  // show; it ignores an event type it doesn't handle).
  noteLive(w.store, {type: 'health', sources: [1]});
  noteLive(w.store, {type: 'news', stories: [1], sections: ['local'], sources: [1]});
  noteLive(w.store, {type: 'jobs', applications: [1], needs_you: [1]});
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
  // The one list's days in pages of 20 of the seed's 32 emails: the first ends partway through a
  // day with a real cursor, and the page from that cursor ends the list.
  const all = await app.record('mail-all', 'AllOut', 'GET', '/api/mail/all', '/api/mail/all?limit=20') as {next_before: string};
  await app.record('mail-all-before', 'AllOut', 'GET', '/api/mail/all', `/api/mail/all?limit=20&before=${encodeURIComponent(all.next_before)}`);
  await app.record('items', 'ItemsOut', 'GET', '/api/items', '/api/items?from=2026-10-01&to=2026-11-01');
  // The phone's agenda: today and the next 7 days.
  await app.record('items-agenda', 'ItemsOut', 'GET', '/api/items', '/api/items?from=2026-10-07&to=2026-10-15');
  // Its day heads' forecasts: the seed has them on the 7th, the 8th and the 13th.
  await app.record('weather-agenda', 'WeatherDayOut[]', 'GET', '/api/weather', '/api/weather?from=2026-10-07&to=2026-10-15');
  // An item's detail, as a link opens it: an event with a place and a guest, and a task.
  await app.record('item', 'ItemOut', 'GET', '/api/items/:id', '/api/items/3');
  await app.record('item-task', 'ItemOut', 'GET', '/api/items/:id', '/api/items/9');
  const found = await app.record('search', 'SearchOut', 'POST', '/api/search', '/api/search', {text: 'northwind interview'}) as SearchOut;
  await app.record('search-opened', '(no body)', 'POST', '/api/search/opened', '/api/search/opened', {search_id: found.search_id, message_id: found.results[0]!.id, position: 0});
  await app.record('calendar-search', 'CalendarSearchOut', 'POST', '/api/calendar/search', '/api/calendar/search', {text: 'dinner sam'});
  // A link to an email or item the server no longer has.
  await app.record('error-message-not-found', 'ApiError', 'GET', '/api/mail/messages/:id', '/api/mail/messages/9999');
  await app.record('error-item-not-found', 'ApiError', 'GET', '/api/items/:id', '/api/items/9999');

  // SV-94: the editor, after the lists so they stay as the seed has them. Every request body below is
  // one the server took, and the app tests its encoder against them. What the editor reads first: places
  // (the seed's invented ones, never Google's), the places events have used, Todoist's labels and Settings
  // (Time to Leave's switch and buffer, the default reminder).
  await app.record('places', 'PlaceSuggestionOut[]', 'GET', '/api/places', '/api/places?query=blue%20door&session_token=0000000000000000');
  await app.record('places-recent', 'RecentPlaceOut[]', 'GET', '/api/places/recent', '/api/places/recent');
  await app.record('todoist-labels', 'TodoistLabelOut[]', 'GET', '/api/todoist/labels', '/api/todoist/labels');
  await app.record('settings', 'Settings', 'GET', '/api/settings', '/api/settings');
  // Creating: a timed event with a place, Time to Leave and its own colour; an all-day event; a task due
  // at a time in a project with a label; a task with no date; a task in a new project; a repeating task.
  await app.record('item-create-event', 'CommandOut', 'POST', '/api/items', '/api/items', {
    kind: 'event', calendar_id: 1, title: 'Coffee with Priya', all_day: false, starts_at: '2026-10-09T16:00:00.000Z', ends_at: '2026-10-09T17:00:00.000Z',
    time_zone: 'America/Los_Angeles', place: 'Blue Door Coffee', address: '77 Elm Ave, Glendale', reminders: [10], leave_reminder: true, colour: 'violet',
  });
  await app.record('item-create-all-day', 'CommandOut', 'POST', '/api/items', '/api/items', {kind: 'event', calendar_id: 2, title: 'Midterm week', all_day: true, start_date: '2026-10-19', end_date: '2026-10-24'});
  await app.record('item-create-task', 'CommandOut', 'POST', '/api/items', '/api/items', {
    kind: 'task', calendar_id: 4, title: 'Submit lab report', due_date: '2026-10-09', due_at: '2026-10-09T23:00:00.000Z', project: 'School', labels: ['school'],
  });
  await app.record('item-create-task-undated', 'CommandOut', 'POST', '/api/items', '/api/items', {kind: 'task', calendar_id: 4, title: 'Call the bank'});
  await app.record('item-create-task-new-project', 'CommandOut', 'POST', '/api/items', '/api/items', {kind: 'task', calendar_id: 4, title: 'Buy seeds', due_date: '2026-10-10', project: 'Garden', create_project: true});
  // The server takes a project Todoist doesn't have without create_project, and Todoist files the task in
  // its Inbox: "No project named" is the web's own check, before it sends.
  await app.record('item-create-task-unknown-project', 'CommandOut', 'POST', '/api/items', '/api/items', {kind: 'task', calendar_id: 4, title: 'Fix the gate', project: 'Garden shed'});
  const repeating = await app.record('item-create-task-repeating', 'CommandOut', 'POST', '/api/items', '/api/items', {
    kind: 'task', calendar_id: 4, title: 'Water the plants', due_date: '2026-10-12', project: 'Home', labels: ['errand'], repeat: 'every mon',
  }) as {target_id: number};
  // Editing: a few fields of one event, then Gym's occurrences with each scope.
  await app.record('item-update', 'CommandOut', 'PATCH', '/api/items/:id', '/api/items/2', {changes: {title: 'Dentist, cleaning', reminders: [30, 60], leave_reminder: false}});
  await app.record('item-update-this', 'CommandOut', 'PATCH', '/api/items/:id', '/api/items/1', {changes: {title: 'Gym, legs'}, scope: 'this', occurrence_start: '2026-10-09T14:00:00.000Z'});
  const following = await app.record('item-update-following', 'CommandOut', 'PATCH', '/api/items/:id', '/api/items/1', {
    changes: {starts_at: '2026-10-19T15:00:00.000Z', ends_at: '2026-10-19T16:00:00.000Z'}, scope: 'following', occurrence_start: '2026-10-19T14:00:00.000Z',
  }) as {id: number};
  confirmCommand(w.store, following.id);
  await app.record('item-update-all', 'CommandOut', 'PATCH', '/api/items/:id', '/api/items/1', {changes: {place: 'Campus gym'}, scope: 'all', occurrence_start: '2026-10-12T14:00:00.000Z'});
  // Deleting: one event, and one occurrence of the CS 101 lecture.
  await app.record('item-delete', 'CommandOut', 'POST', '/api/items/:id/delete', '/api/items/6/delete', {});
  await app.record('item-delete-occurrence', 'CommandOut', 'POST', '/api/items/:id/delete', '/api/items/5/delete', {scope: 'this', occurrence_start: '2026-10-14T01:00:00.000Z'});
  // Completing a task, reopening one the seed has done, and one occurrence of the repeating task.
  await app.record('item-complete', 'CommandOut', 'POST', '/api/items/:id/complete', '/api/items/7/complete', {done: true});
  await app.record('item-reopen', 'CommandOut', 'POST', '/api/items/:id/complete', '/api/items/10/complete', {done: false});
  await app.record('item-complete-occurrence', 'CommandOut', 'POST', '/api/items/:id/complete', `/api/items/${repeating.target_id}/complete`, {done: true, occurrence_date: '2026-10-12'});
  // What the editor is refused: an event without an end, and a change with nothing in it.
  await app.record('error-item-when', 'ApiError', 'POST', '/api/items', '/api/items', {kind: 'event', calendar_id: 1, title: 'Lunch', starts_at: '2026-10-09T19:00:00.000Z'});
  await app.record('error-item-nothing-to-change', 'ApiError', 'PATCH', '/api/items/:id', '/api/items/2', {changes: {}});

  // SV-104: News. All, with the Missed strip, a hazard's lead (Local's Red Flag Warning) and Tech's block
  // holding Upcoming (the Apple event); a section with more than its block shows, and Tech's with Upcoming.
  await app.record('news', 'NewsPageOut', 'GET', '/api/news', '/api/news');
  await app.record('news-section', 'NewsSectionOut', 'GET', '/api/news/sections/:section', '/api/news/sections/local');
  await app.record('news-section-upcoming', 'NewsSectionOut', 'GET', '/api/news/sections/:section', '/api/news/sections/tech');
  // A new story, and the brush fire: seen Mon at 10:40 PM and given facts since, so it has new_since.
  await app.record('news-story', 'StoryOut', 'GET', '/api/news/stories/:id', '/api/news/stories/18');
  await app.record('news-story-updated', 'StoryOut', 'GET', '/api/news/stories/:id', '/api/news/stories/1');
  // Its sources opened: NBC LA's text, KTLA's feed summary only, and one only Google News found.
  await app.record('news-article', 'ArticleOut', 'GET', '/api/news/articles/:id', '/api/news/articles/2');
  await app.record('news-article-summary-only', 'ArticleOut', 'GET', '/api/news/articles/:id', '/api/news/articles/1');
  await app.record('news-article-discovery', 'ArticleOut', 'GET', '/api/news/articles/:id', '/api/news/articles/42');
  // Catch up: Tuesday's 14.
  await app.record('news-missed', 'MissedOut', 'GET', '/api/news/missed', '/api/news/missed');
  // Sorting as the seed has it: nothing waiting, no first run.
  await app.record('news-status', 'NewsStatusOut', 'GET', '/api/news/status', '/api/news/status');
  // Four stories, one already off the page.
  await app.record('news-search', 'NewsSearchOut', 'GET', '/api/news/search', '/api/news/search?q=fire');
  // A copy as the app's image loader gets it, with its bearer token (the web's cookie gets the same, below).
  await app.record('news-image', 'image bytes', 'GET', '/api/news/images/:id', '/api/news/images/2', undefined, ['cache-control', 'content-security-policy', 'x-content-type-options']);
  // Upcoming's Add to calendar: the event it would create, nothing created yet.
  await app.record('news-proposal', 'NewsProposalOut', 'POST', '/api/news/events/:id/proposal', '/api/news/events/1/proposal');
  // Last, as it changes their dots: the new story and the updated one seen.
  await app.record('news-seen', 'NewsSeenOut', 'POST', '/api/news/seen', '/api/news/seen', {story_ids: [18, 1]});

  // Unpairing, and what every request gets after it.
  await app.record('device-unpair', '(no body)', 'DELETE', '/api/device', '/api/device');
  await app.record('error-unauthorized', 'ApiError', 'GET', '/api/mail/inbox', '/api/mail/inbox');
  app.token = '';
  await app.record('error-bad-pairing-code', 'ApiError', 'POST', '/api/auth/pair', '/api/auth/pair', {code: 'not-a-code'});

  for (const state of NEWS_STATES) {
    const other = world({seed: true});
    FIXTURES[state.fixture]!.apply({sqlite: other.store.sqlite, db: other.store.db});
    const {app: there} = await pairedPhone(other, {}, app.recorded);
    await there.record(state.name, state.type, 'GET', state.route, state.path);
  }
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
  // Only what this records: the folder holds other files the app copies in too (compose/, SV-95).
  for (const owned of ['responses', 'events', 'index.json', 'enums.json']) fs.rmSync(fixture(owned), {recursive: true, force: true});
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
    for (const [header, was] of Object.entries(pinned.headers ?? {})) {
      const now = entry.headers?.[header];
      if (now !== was) found.push(`${entry.name}: sent ${header} ${now ?? '(none)'}, was ${was}`);
    }
    // A refusal's code is what the app branches on, so it's pinned like a status.
    if (entry.type === 'ApiError' && pinned.file) {
      const code = (entry.body as ApiError | null)?.error.code;
      const was = (readJson(pinned.file) as ApiError).error.code;
      if (code !== was) found.push(`${entry.name}: refused with ${code}, was ${was}`);
    }
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
    const found = compare(await recordAll());
    expect(found, 'An installed iPhone app would fail on these. Keep the old field, status or value alongside the new one; or, once setpoint-ios handles it, npm run contract:record and pin the new commit there.').toEqual([]);
  });

  test.runIf(RECORDING)('records the fixtures', async () => {
    write(await recordAll());
  });

  // SV-104: the app's image loader sends the device's bearer token, never the web's cookie.
  test('a News image answers a paired iPhone\'s bearer token as it answers the web\'s cookie', async () => {
    const imagesDir = newsImages();
    const w = world({seed: true, newsImagesDir: imagesDir});
    const {browser, app} = await pairedPhone(w, {news: {imagesDir}});
    const read = async (response: Response) => ({
      status: response.status,
      headers: Object.fromEntries([...response.headers].filter(([header]) => header !== 'set-cookie')),
      bytes: Buffer.from(await response.arrayBuffer()),
    });
    const byCookie = await read(await browser.app.request('/api/news/images/2', {headers: {cookie: browser.cookie!}}));
    const byToken = await read(await browser.app.request('/api/news/images/2', {headers: {authorization: `Bearer ${app.token}`}}));
    expect(byCookie.status).toBe(200);
    expect(byCookie.headers['content-type']).toBe('image/png');
    expect(byToken).toEqual(byCookie);
    // An unpaired token gets the app's 401, not the web's.
    const unpaired = await browser.app.request('/api/news/images/2', {headers: {authorization: 'Bearer sp_device_unknown'}});
    expect(unpaired.status).toBe(401);
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
