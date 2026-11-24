// The API over the seed, as the web app uses it: the live stream, commands with Try again and Move
// back, items, settings and accounts, search and Places.
import {DEFAULT_SETTINGS} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {and, eq} from 'drizzle-orm';
import {failCommand} from '../src/commands/index.ts';
import * as t from '../src/db/schema.ts';
import {zoned} from '../src/dev/sample.ts';
import {calendarList} from '../src/queries/items.ts';
import {claimDueJobs} from '../src/sync/jobs.ts';
import {readEvents, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

describe('the live stream', () => {
  test('ready, then a typed event naming what changed', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const stream = await c.app.request('/api/events', {headers: {cookie: c.cookie!}});
    expect(stream.headers.get('content-type')).toMatch(/text\/event-stream/);
    const reading = readEvents(stream, events => events.some(event => event.event === 'mail'));
    // The stream subscribed before its answer came back (streamSSE runs the handler up to its first wait).
    const opened = await c.send('POST', '/api/mail/messages/5/open');
    expect(opened.body).toMatchObject({id: 5, unread: false, command: {kind: 'open', state: 'pending'}});
    const events = await reading;
    expect(events[0]).toMatchObject({event: 'ready', data: {last_id: expect.stringMatching(/^[0-9a-f]{8}-\d+$/)}});
    expect(events.at(-1)).toMatchObject({event: 'mail', data: {type: 'mail', messages: [5], accounts: [4], commands: [opened.body.command.id]}});
  });

  test('a reconnect with an id this process can\'t account for gets resync', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const stream = await c.app.request('/api/events', {headers: {cookie: c.cookie!, 'last-event-id': 'deadbeef-12'}});
    const events = await readEvents(stream, seen => seen.length >= 2);
    expect(events.map(event => event.event)).toEqual(['resync', 'ready']);
  });
});

describe('commands over the API', () => {
  test('a failed move: Try again, then Move back', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const moved = await c.send('PATCH', '/api/items/3', {body: {changes: {starts_at: zoned('2026-10-10', '19:00'), ends_at: zoned('2026-10-10', '21:00')}}});
    expect(moved.body).toMatchObject({kind: 'item_update', state: 'pending', provider: 'google_calendar'});
    expect((await c.send('POST', `/api/commands/${moved.body.id}/move-back`)).body.error.code).toBe('command_state');
    failCommand(w.store, moved.body.id, 'The requested event was modified by another client. (409 Conflict)');
    expect((await c.send('GET', '/api/commands')).body).toMatchObject([{id: moved.body.id, state: 'failed', can_retry: true, can_move_back: true}]);
    expect((await c.send('POST', `/api/commands/${moved.body.id}/retry`)).body).toMatchObject({state: 'pending', provider_message: null});
    failCommand(w.store, moved.body.id, 'Still conflicting');
    expect((await c.send('POST', `/api/commands/${moved.body.id}/move-back`)).body).toMatchObject({state: 'reverted'});
    expect((await c.send('GET', '/api/items/3')).body).toMatchObject({starts_at: zoned('2026-10-09', '19:00'), command: null});
    expect((await c.send('GET', '/api/commands')).body).toEqual([]);
  });

  test('one change per item at a time', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    await c.send('POST', '/api/items/8/complete', {body: {done: true}});
    expect((await c.send('PATCH', '/api/items/8', {body: {changes: {title: 'Pay October rent'}}})).body.error.code).toBe('command_pending');
  });

  describe('a delete takes the place of a change still waiting', () => {
    const queuedJob = (w: World, commandId: number) => w.store.db.select().from(t.jobs).where(and(eq(t.jobs.commandId, commandId), eq(t.jobs.state, 'queued'))).get();

    test('a waiting move is cancelled, the event back in place, and the delete waits instead', async () => {
      const w = world({seed: true});
      const c = await signedIn(w);
      const moved = await c.send('PATCH', '/api/items/3', {body: {changes: {starts_at: zoned('2026-10-10', '19:00'), ends_at: zoned('2026-10-10', '21:00')}}});
      const deleted = await c.send('POST', '/api/items/3/delete', {body: {}});
      expect(deleted.body).toMatchObject({kind: 'item_delete', state: 'pending', target_id: 3});
      expect(queuedJob(w, moved.body.id)).toBeUndefined();
      expect((await c.send('GET', '/api/items/3')).body).toMatchObject({starts_at: zoned('2026-10-09', '19:00'), command: {id: deleted.body.id, kind: 'item_delete'}});
      expect((await c.send('GET', '/api/commands')).body.map((command: {id: number}) => command.id)).toEqual([deleted.body.id]);
    });

    test('a failed change is replaced the same way', async () => {
      const w = world({seed: true});
      const c = await signedIn(w);
      const done = await c.send('POST', '/api/items/8/complete', {body: {done: true}});
      failCommand(w.store, done.body.id, 'Service Unavailable (503)');
      const deleted = await c.send('POST', '/api/items/8/delete', {body: {}});
      expect(deleted.body).toMatchObject({kind: 'item_delete', state: 'pending', target_id: 8});
      expect((await c.send('GET', '/api/items/8')).body).toMatchObject({done: false, command: {id: deleted.body.id}});
      expect((await c.send('GET', '/api/commands')).body.map((command: {id: number}) => command.id)).toEqual([deleted.body.id]);
    });

    test('a create that never reached its provider just goes, and nothing is sent', async () => {
      const w = world({seed: true});
      const c = await signedIn(w);
      const todoist = calendarList(w.store).find(calendar => calendar.provider === 'todoist')!.id;
      const created = await c.send('POST', '/api/items', {body: {kind: 'task', calendar_id: todoist, title: 'Call the bank', due_date: '2026-10-08'}});
      expect(created.body).toMatchObject({kind: 'item_create', state: 'pending'});
      const deleted = await c.send('POST', `/api/items/${created.body.target_id}/delete`, {body: {}});
      expect(deleted.status).toBe(200);
      expect((await c.send('GET', `/api/items/${created.body.target_id}`)).status).toBe(404);
      expect(queuedJob(w, created.body.id)).toBeUndefined();
      expect((await c.send('GET', '/api/commands')).body).toEqual([]);
    });

    test('a moved occurrence of a series is put back and that occurrence deleted', async () => {
      const w = world({seed: true});
      const c = await signedIn(w);
      const gym = w.store.db.select().from(t.items).where(eq(t.items.title, 'Gym')).get()!.id;
      const moved = await c.send('PATCH', `/api/items/${gym}`, {body: {changes: {starts_at: zoned('2026-10-08', '07:00'), ends_at: zoned('2026-10-08', '08:00')}, scope: 'this', occurrence_start: zoned('2026-10-07', '07:00')}});
      const deleted = await c.send('POST', `/api/items/${moved.body.target_id}/delete`, {body: {scope: 'this'}});
      expect(deleted.body).toMatchObject({kind: 'item_delete', state: 'pending', target_id: gym});
      expect((await c.send('GET', `/api/items/${moved.body.target_id}`)).status).toBe(404);
      expect((await c.send('GET', '/api/commands')).body.map((command: {id: number}) => command.id)).toEqual([deleted.body.id]);
    });

    test('deleting a moved occurrence with All events deletes the series', async () => {
      const w = world({seed: true});
      const c = await signedIn(w);
      const gym = w.store.db.select().from(t.items).where(eq(t.items.title, 'Gym')).get()!.id;
      const moved = await c.send('PATCH', `/api/items/${gym}`, {body: {changes: {starts_at: zoned('2026-10-08', '07:00'), ends_at: zoned('2026-10-08', '08:00')}, scope: 'this', occurrence_start: zoned('2026-10-07', '07:00')}});
      const deleted = await c.send('POST', `/api/items/${moved.body.target_id}/delete`, {body: {scope: 'all'}});
      expect(deleted.body).toMatchObject({kind: 'item_delete', state: 'pending', target_id: gym});
      expect(w.store.db.select().from(t.commands).where(eq(t.commands.id, deleted.body.id)).get()!.payload).toMatchObject({item_id: gym, scope: 'all'});
    });

    test('a change already on its way to the provider is not cancelled: the delete waits', async () => {
      const w = world({seed: true});
      const c = await signedIn(w);
      const done = await c.send('POST', '/api/items/8/complete', {body: {done: true}});
      claimDueJobs(w.store, new Set());
      expect((await c.send('POST', '/api/items/8/delete', {body: {}})).body.error.code).toBe('command_pending');
      expect((await c.send('GET', '/api/commands')).body).toMatchObject([{id: done.body.id, state: 'pending'}]);
    });

    test('only a delete cancels: an edit still waits its turn', async () => {
      const w = world({seed: true});
      const c = await signedIn(w);
      const done = await c.send('POST', '/api/items/8/complete', {body: {done: true}});
      failCommand(w.store, done.body.id, 'Service Unavailable (503)');
      expect((await c.send('PATCH', '/api/items/8', {body: {changes: {title: 'Pay October rent'}}})).body.error.code).toBe('command_failed');
    });
  });

  test('Done and Pin change at once, without a command', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    expect((await c.send('POST', '/api/mail/messages/2/done', {body: {done: true}})).body).toMatchObject({done: true, command: null});
    expect((await c.send('GET', '/api/mail/counts')).body.attention).toBe(2);
    expect((await c.send('POST', '/api/mail/messages/9/pin', {body: {pinned: true}})).body).toMatchObject({pinned: true});
    expect((await c.send('GET', '/api/mail/inbox')).body.groups[0].rows.map((row: {subject: string}) => row.subject)).toEqual(['Statement ready', 'Lease renewal terms']);
  });

  test('bad input is refused with each problem named', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const response = await c.send('POST', '/api/items', {body: {kind: 'event', calendar_id: 1, title: 'No times'}});
    expect(response).toMatchObject({status: 400, body: {error: {code: 'invalid_input', message: 'An event needs a start and an end.'}}});
    expect((await c.send('GET', '/api/items?from=2026-10-31&to=2026-10-01')).status).toBe(400);
    expect((await c.send('GET', '/api/mail/messages/999')).status).toBe(404);
  });
});

describe('reminders', () => {
  test('signed minutes from the item\'s moment, 4 weeks either side, 10 at most', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const change = (reminders: number[]) => c.send('PATCH', '/api/items/3', {body: {changes: {reminders}}});
    expect((await change([40_321])).status).toBe(400);
    expect((await change([-40_321])).status).toBe(400);
    expect((await change(Array.from({length: 11}, (_, index) => index))).status).toBe(400);
    expect((await change([40_320, -40_320, -120, 10])).body).toMatchObject({kind: 'item_update', state: 'pending'});
    expect((await c.send('GET', '/api/items/3')).body.reminders).toEqual([40_320, -40_320, -120, 10]);
  });
});

describe('reads', () => {
  test('the month\'s items, calendars and weather', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const month = (await c.send('GET', '/api/items?from=2026-10-01&to=2026-11-01')).body;
    expect(month.items.filter((item: {title: string}) => item.title === 'Dentist')).toMatchObject([{place: 'Smile Dental', address: '1420 Elm St', reminders: [30]}]);
    expect((await c.send('PATCH', '/api/calendars/2', {body: {visible: false}})).body).toMatchObject({name: 'Classes', visible: false, listed: true, command: null});
    expect((await c.send('PATCH', '/api/calendars/2', {body: {listed: false}})).body).toMatchObject({name: 'Classes', visible: false, listed: false});
    // A colour answers with its command pending. Todoist's has none, and an empty change is refused.
    expect((await c.send('PATCH', '/api/calendars/2', {body: {colour: 'sun'}})).body).toMatchObject({name: 'Classes', colour: 'sun', command: {kind: 'calendar_colour', state: 'pending'}});
    expect((await c.send('PATCH', '/api/calendars/4', {body: {colour: 'sun'}})).status).toBe(400);
    expect((await c.send('PATCH', '/api/calendars/2', {body: {}})).status).toBe(400);
    // A project's colour answers with its command pending. A colour Todoist doesn't have is refused.
    expect((await c.send('PATCH', '/api/todoist/projects/seed-project-3', {body: {colour: 'teal'}})).body).toMatchObject({name: 'Home', colour: 'teal', command: {kind: 'project_colour', state: 'pending'}});
    expect((await c.send('PATCH', '/api/todoist/projects/seed-project-2', {body: {colour: 'sun'}})).status).toBe(400);
    expect((await c.send('GET', '/api/weather?from=2026-10-07&to=2026-10-09')).status).toBe(200);
  });

  test('accounts and sources with their health; Settings › Accounts\' edits', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const accounts = (await c.send('GET', '/api/accounts')).body;
    expect(accounts.every((account: {health: {state: string}}) => account.health.state === 'healthy')).toBe(true);
    expect((await c.send('GET', '/api/sources')).status).toBe(200);
    expect((await c.send('PATCH', '/api/accounts/1', {body: {label: 'Studio', colour: 'sun'}})).body).toMatchObject({label: 'Studio', colour: 'sun'});
    expect((await c.send('PATCH', '/api/accounts/1', {body: {label: 'Personal'}})).body.error.code).toBe('label_taken');
    expect((await c.send('PUT', '/api/accounts/order', {body: {account_ids: [5, 4, 3, 2, 1]}})).body.map((account: {label: string}) => account.label)).toEqual(['iCloud', 'Jobs', 'Work', 'Personal', 'Studio']);
    // An hour without checks, and they're stale.
    w.advance(60 * 60_000);
    expect((await c.send('GET', '/api/accounts')).body[0].health).toMatchObject({state: 'stale', as_of: '2026-10-07T16:11:00.000Z'});
  });

  test('settings: the defaults, then a patch', async () => {
    const w = world();
    const c = await signedIn(w);
    expect((await c.send('GET', '/api/settings')).body).toEqual(DEFAULT_SETTINGS);
    const patched = await c.send('PATCH', '/api/settings', {body: {mail: {code_expiry_minutes: 30}, notifications: {ntfy_server: 'https://ntfy.example.com'}}});
    expect(patched.body).toMatchObject({mail: {code_expiry_minutes: 30}, notifications: {ntfy_server: 'https://ntfy.example.com', topics: {reminders: 'setpoint-reminders'}}});
    expect((await c.send('PATCH', '/api/settings', {body: {mail: {code_expiry_minutes: 7}}})).status).toBe(400);
    expect((await c.send('GET', '/api/settings')).body.mail.code_expiry_minutes).toBe(30);
    // A reminder default set, then back to None.
    expect((await c.send('PATCH', '/api/settings', {body: {reminders: {event_minutes_before: 10, task_time: '08:00'}}})).body.reminders).toEqual({event_minutes_before: 10, task_time: '08:00'});
    expect((await c.send('PATCH', '/api/settings', {body: {reminders: {event_minutes_before: null, task_time: null}}})).body.reminders).toEqual({event_minutes_before: null, task_time: null});
  });

  test('search answers over an empty mailbox; Places needs its key', async () => {
    const w = world();
    const c = await signedIn(w);
    expect((await c.send('POST', '/api/search', {body: {text: 'northwind'}})).body).toMatchObject({total: 0, results: [], text: 'northwind', order: 'match'});
    expect((await c.send('GET', '/api/places?query=blue&session_token=editor-session-1')).body.error.code).toBe('places_not_configured');
    expect((await c.send('GET', '/api/nothing')).status).toBe(404);
  });
});
