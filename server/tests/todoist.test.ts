// The Todoist adapter against a fake Todoist on 127.0.0.1: the mirror (with v1's Z-suffix bug
// fixed), changes through the command layer, a completed repeating task kept on its day (the
// tombstone) whether completed here or in Todoist's app, revoked tokens, and OAuth at v1's path.
import {calendarSearchInput, itemCreateInput, itemScopeInput, itemUpdateInput} from '@setpoint/shared';
import {and, eq, isNull} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {moveBackCommand, retryCommand} from '../src/commands/index.ts';
import {completeItem, createItem, deleteItem, reorderSubtasks, setProjectColour, updateItem} from '../src/commands/items.ts';
import * as t from '../src/db/schema.ts';
import {readDue, repeatAfter, repeatOf, writeDue} from '../src/providers/todoist/due.ts';
import {todoistAdapter} from '../src/providers/todoist/index.ts';
import {itemsInRange, todoistLabels, todoistProjects} from '../src/queries/items.ts';
import {sourceList} from '../src/queries/sources.ts';
import {searchCalendar} from '../src/search/calendar.ts';
import {updateSettings} from '../src/settings.ts';
import {readSourceCredentials, writeSourceCredentials} from '../src/secrets/store.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeTodoist} from './fakes/todoist.ts';
import {client, signedIn, world} from './helpers.ts';

const ZONE = 'America/Los_Angeles';
// SV-264: a description as Todoist's own editor writes one (read from a real task, 2026-11-10): Markdown, single
// newlines between lines, a blank line around lists.
const TODOIST_DESCRIPTION = '**Bring** the signed form\n*Room 204*\n\n1. *Check in*\n2. Badge\n\n- Laptop\n\n[https://example.com/visit](https://example.com/visit)';

describe('a Todoist due as a day and a time', () => {
  test.each([
    ['a day', {date: '2026-10-07'}, {dueDate: '2026-10-07', dueAt: null}],
    ['a floating time is wall-clock time in the user\'s zone', {date: '2026-01-15T19:00:00'}, {dueDate: '2026-01-15', dueAt: '2026-01-16T03:00:00.000Z'}],
    // v1 read this as 3:00 AM on Jan 16 (56a59a4e), and still stored the UTC day.
    ['a fixed-zone time (Z) is an instant, on its local day', {date: '2026-01-16T03:00:00Z', timezone: 'America/New_York'}, {dueDate: '2026-01-15', dueAt: '2026-01-16T03:00:00.000Z'}],
    ['an offset is an instant too', {date: '2026-10-08T02:00:00+00:00'}, {dueDate: '2026-10-07', dueAt: '2026-10-08T02:00:00.000Z'}],
    ['across the DST change', {date: '2026-11-01T09:00:00'}, {dueDate: '2026-11-01', dueAt: '2026-11-01T17:00:00.000Z'}],
  ])('%s', (_, due, expected) => {
    expect(readDue(due, ZONE)).toEqual(expected);
  });

  test('something unreadable is no due', () => {
    expect(readDue({date: 'next tuesday'}, ZONE)).toBeNull();
  });
});

describe('F6b: a repeat travels with its date (D16 revisited)', () => {
  // Todoist reads a bare date as the end of a task's repeat, so a repeating task's new date goes in
  // one due string with its repeat and time; a task with no repeat sends its day or instant.
  test.each([
    ['a day', {dueDate: '2026-10-09', dueAt: null}, {due_date: '2026-10-09'}],
    ['a time is an instant', {dueDate: '2026-10-09', dueAt: '2026-10-09T16:30:00.000Z'}, {due_datetime: '2026-10-09T16:30:00Z'}],
    ['a repeat starts on its day', {dueDate: '2026-10-09', dueAt: null, repeat: 'every wed'}, {due_string: 'every wed starting 2026-10-09'}],
    ['a repeat keeps its time, in the user\'s zone', {dueDate: '2026-10-09', dueAt: '2026-10-09T16:30:00.000Z', repeat: 'every wed'}, {due_string: 'every wed at 09:30 starting 2026-10-09'}],
    ['no repeat any more is a plain day', {dueDate: '2026-10-09', dueAt: null, repeat: null}, {due_date: '2026-10-09'}],
    // SV-113: a repeat's last day goes after its first, as Todoist documents "everyday from 10 May until 20 May".
    ['a repeat\'s last day after its first', {dueDate: '2026-10-12', dueAt: null, repeat: 'every mon until 2026-12-15'}, {due_string: 'every mon from 2026-10-12 until 2026-12-15'}],
    ['a repeat\'s last day, with its time', {dueDate: '2026-10-12', dueAt: '2026-10-12T16:30:00.000Z', repeat: 'every mon until 2026-12-15'}, {due_string: 'every mon at 09:30 from 2026-10-12 until 2026-12-15'}],
    ['Todoist\'s own "ending"', {dueDate: '2026-10-12', dueAt: null, repeat: 'every day ending aug 3'}, {due_string: 'every day from 2026-10-12 ending aug 3'}],
  ])('writes %s', (_, task, expected) => {
    expect(writeDue(task, ZONE)).toEqual(expected);
  });

  test.each([
    ['every wed', 'every wed'],
    ['every mon at 9am', 'every mon'],
    ['every mon at 21:00 starting 2026-10-12', 'every mon'],
    ['every day from oct 12', 'every day'],
    ['every! 3 days', 'every! 3 days'],
    ['every other fri @ 5pm', 'every other fri'],
    // SV-113: the last day stays with the repeat, wherever Todoist keeps it.
    ['every mon at 09:30 from 2026-10-12 until 2026-12-15', 'every mon until 2026-12-15'],
    ['every mon from 2026-10-12 until 2026-12-15', 'every mon until 2026-12-15'],
    ['everyday from 10 May until 20 May', 'everyday until 20 May'],
    ['every day ending aug 3 starting 2026-10-12', 'every day ending aug 3'],
    ['every day until aug 3', 'every day until aug 3'],
    ['', null],
    [null, null],
  ])('reads the repeat in "%s"', (words, expected) => {
    expect(repeatOf(words)).toBe(expected);
  });

  test.each([
    ['a one-off task stays one-off', {dueRecurring: false, dueString: 'Oct 7'}, undefined, null],
    ['a repeating task keeps its repeat', {dueRecurring: true, dueString: 'every wed starting 2026-10-07'}, undefined, 'every wed'],
    ['a new repeat is the one asked for', {dueRecurring: false, dueString: 'Oct 7'}, 'every mon', 'every mon'],
    ['taking the repeat off', {dueRecurring: true, dueString: 'every wed'}, null, null],
  ])('%s', (_, task, asked, expected) => {
    expect(repeatAfter(task, asked)).toBe(expected);
  });
});

async function todoistWorld() {
  const w = world();
  const todoist = await fakeTodoist();
  todoist.useClock(() => w.store.now());
  todoist.addProject({id: 'inbox', name: 'Inbox', inbox_project: true, child_order: 0});
  todoist.addProject({id: 'p-home', name: 'Home', child_order: 1});
  todoist.addProject({id: 'p-school', name: 'School', child_order: 2});
  todoist.addLabel({id: 'l-errand', name: 'errand', item_order: 0});
  todoist.addLabel({id: 'l-waiting', name: 'waiting', item_order: 1});
  todoist.put({id: 't-rent', content: 'Pay rent', project_id: 'p-home', due: {date: '2026-10-07', string: 'Oct 7', is_recurring: false}, labels: ['errand']});
  todoist.put({id: 't-plants', content: 'Water plants', project_id: 'p-home', due: {date: '2026-10-07', string: 'every wed', is_recurring: true}, everyDays: 7});
  todoist.put({id: 't-call', content: 'Call Mom', project_id: 'inbox', due: {date: '2026-10-08T02:00:00Z', timezone: 'America/New_York', string: 'oct 7 10pm', is_recurring: false}});
  todoist.put({id: 't-someday', content: 'Learn piano', project_id: 'inbox', due: null});
  const source = w.store.db.insert(t.sources).values({provider: 'todoist', syncMode: 'poll', intervalSeconds: 300, createdAt: w.store.now().toISOString()}).returning().get();
  writeSourceCredentials(w.store, source.id, {kind: 'api_key', key: 'todoist-token'});
  const engine = new SyncEngine({store: w.store, adapters: new Adapters({todoist: todoistAdapter({baseUrl: todoist.url, timeoutMs: 2000})})});
  const run = async () => {
    for (let round = 0; round < 4; round += 1) {
      await engine.tick();
      await engine.settled();
    }
  };
  const day = (date: string) => itemsInRange(w.store, date, new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)).items;
  const tasks = (date: string) => day(date).map(item => `${item.done ? '●' : '○'} ${item.title}`);
  const task = (providerId: string) => w.store.db.select().from(t.items).where(and(eq(t.items.providerId, providerId), isNull(t.items.recurringItemId))).get()!;
  const command = (id: number) => w.store.db.select().from(t.commands).where(eq(t.commands.id, id)).get()!;
  const calendarId = () => w.store.db.select().from(t.calendars).where(eq(t.calendars.provider, 'todoist')).get()!.id;
  return {w, todoist, engine, source, run, day, tasks, task, command, calendarId};
}

describe('the mirror', () => {
  test('dated tasks with their projects; a Z time on its local day; undated ones aren\'t on the calendar', async () => {
    const {w, run, day, tasks} = await todoistWorld();
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '○ Water plants']);
    expect(day('2026-10-07').find(item => item.title === 'Call Mom')).toMatchObject({due_date: '2026-10-07', due_at: '2026-10-08T02:00:00.000Z', project: 'Inbox'});
    expect(day('2026-10-07').find(item => item.title === 'Water plants')).toMatchObject({recurring: true, due_string: 'every wed', project: 'Home'});
    expect(w.store.db.select().from(t.items).where(eq(t.items.title, 'Learn piano')).get()).toBeUndefined();
    expect(w.store.db.select().from(t.todoistProjects).all().map(row => row.name)).toEqual(['Inbox', 'Home', 'School']);
  });

  test('changes in Todoist arrive on the next poll; a deleted task leaves', async () => {
    const {w, todoist, run, tasks} = await todoistWorld();
    await run();
    todoist.put({...todoist.task('t-rent')!, due: {date: '2026-10-08', string: 'Oct 8', is_recurring: false}});
    todoist.put({...todoist.task('t-call')!, is_deleted: true});
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Water plants']);
    expect(tasks('2026-10-08')).toEqual(['○ Pay rent']);
  });

  test('a sync token Todoist refuses is followed by a full sync', async () => {
    const {w, todoist, run, tasks, source} = await todoistWorld();
    await run();
    w.store.db.update(t.syncCursors).set({cursor: 'not-a-token'}).where(and(eq(t.syncCursors.sourceId, source.id), eq(t.syncCursors.scope, ''))).run();
    todoist.put({id: 't-new', content: 'Buy stamps', project_id: 'inbox', due: {date: '2026-10-07', is_recurring: false}});
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toContain('○ Buy stamps');
    expect(todoist.requests.filter(request => request.path === '/api/v1/sync').slice(-2).map(request => request.body.sync_token)).toEqual(['not-a-token', '*']);
  });

  test('a revoked token is needs reconnect, and new credentials bring it back', async () => {
    const {w, todoist, run, source} = await todoistWorld();
    await run();
    todoist.revoke();
    w.advance(5 * 60_000);
    await run();
    const health = () => sourceList(w.store).find(row => row.id === source.id)!.health;
    expect(health()).toMatchObject({state: 'needs_reconnect', reason: 'Invalid token (401 Unauthorized)'});
    todoist.grant('unused', 'todoist-token-2');
    writeSourceCredentials(w.store, source.id, {kind: 'api_key', key: 'todoist-token'});
    expect(health().state).not.toBe('needs_reconnect');
  });
});

describe('changes through the command layer', () => {
  test('create: Todoist gets the day, the project and English due words; the task takes Todoist\'s id', async () => {
    const {w, todoist, run, command, calendarId, tasks} = await todoistWorld();
    await run();
    const created = createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: calendarId(), title: 'CS 101 lab report', due_date: '2026-10-09', project: 'School'}));
    await run();
    expect(command(created.id).state).toBe('confirmed');
    const sent = todoist.requests.find(request => request.method === 'POST' && request.path === '/api/v1/tasks')!;
    expect(sent.body).toEqual({content: 'CS 101 lab report', project_id: 'p-school', due_date: '2026-10-09', due_lang: 'en'});
    expect(sent.headers['x-request-id']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    const row = w.store.db.select().from(t.items).where(eq(t.items.id, created.targetId)).get()!;
    expect(todoist.task(row.providerId)).toMatchObject({content: 'CS 101 lab report'});
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-09')).toEqual(['○ CS 101 lab report']);
  });

  test('SV-113: a repeat with a last day reaches Todoist after its first, and reads back with it, so a new date keeps it', async () => {
    const {w, todoist, run, command, calendarId, task, day} = await todoistWorld();
    await run();
    const created = createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: calendarId(), title: 'Water ferns', due_date: '2026-10-12', project: 'Home', repeat: 'every mon until 2026-12-15'}));
    await run();
    expect(command(created.id).state).toBe('confirmed');
    const sent = todoist.requests.find(request => request.method === 'POST' && request.path === '/api/v1/tasks')!;
    expect(sent.body).toMatchObject({content: 'Water ferns', due_string: 'every mon from 2026-10-12 until 2026-12-15'});
    w.advance(5 * 60_000);
    await run();
    expect(day('2026-10-12').find(item => item.title === 'Water ferns')).toMatchObject({recurring: true, repeat: 'every mon until 2026-12-15'});
    const ferns = task(w.store.db.select().from(t.items).where(eq(t.items.title, 'Water ferns')).get()!.providerId!);
    const moved = updateItem(w.store, ferns.id, itemUpdateInput.parse({changes: {due_date: '2026-10-19', due_at: null}}));
    await run();
    expect(command(moved.id).state).toBe('confirmed');
    expect(todoist.requests.at(-1)!.body).toEqual({due_string: 'every mon from 2026-10-19 until 2026-12-15', due_lang: 'en'});
    expect(day('2026-10-19').find(item => item.title === 'Water ferns')).toMatchObject({repeat: 'every mon until 2026-12-15'});
  });

  test('SV-74: create with no date: Todoist gets its "no date", and once it confirms the task leaves the mirror, as an undated task isn\'t on the calendar', async () => {
    const {w, todoist, run, command, calendarId} = await todoistWorld();
    await run();
    const created = createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: calendarId(), title: 'Learn guitar', project: 'Home'}));
    expect(command(created.id).state).toBe('pending');
    await run();
    expect(command(created.id).state).toBe('confirmed');
    const sent = todoist.requests.find(request => request.method === 'POST' && request.path === '/api/v1/tasks')!;
    expect(sent.body).toEqual({content: 'Learn guitar', project_id: 'p-home', due_string: 'no date', due_lang: 'en'});
    expect(w.store.db.select().from(t.items).where(eq(t.items.id, created.targetId)).get()).toBeUndefined();
    w.advance(5 * 60_000);
    await run();
    expect(w.store.db.select().from(t.items).where(eq(t.items.title, 'Learn guitar')).get()).toBeUndefined();
  });

  test('SV-109: a task\'s reminders are Setpoint\'s own: Todoist isn\'t asked, and its syncs keep them', async () => {
    const {w, todoist, run, command, task} = await todoistWorld();
    await run();
    const before = todoist.requests.length;
    const changed = updateItem(w.store, task('t-rent').id, itemUpdateInput.parse({changes: {reminders: [60, -30]}}));
    await run();
    expect(command(changed.id).state).toBe('confirmed');
    expect(todoist.requests.slice(before).filter(request => request.path.startsWith('/api/v1/tasks'))).toEqual([]);
    todoist.put({...todoist.task('t-rent')!, content: 'Pay October rent'});
    w.advance(5 * 60_000);
    await run();
    expect(task('t-rent')).toMatchObject({title: 'Pay October rent', reminders: [60, -30]});
  });

  test('create with a new project (SV-24, D50): Todoist makes the project first, the task goes in it, and the project list has it at once', async () => {
    const {w, todoist, run, command, calendarId, tasks} = await todoistWorld();
    await run();
    const created = createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: calendarId(), title: 'Expense report', due_date: '2026-10-09', project: 'Work', create_project: true}));
    await run();
    expect(command(created.id).state).toBe('confirmed');
    const made = todoist.requests.find(request => request.method === 'POST' && request.path === '/api/v1/projects')!;
    expect(made.body).toEqual({name: 'Work'});
    const project = w.store.db.select().from(t.todoistProjects).where(eq(t.todoistProjects.name, 'Work')).get()!;
    expect(todoist.requests.find(request => request.method === 'POST' && request.path === '/api/v1/tasks')!.body).toMatchObject({project_id: project.providerId});
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-09')).toEqual(['○ Expense report']);
    expect(w.store.db.select().from(t.todoistProjects).all().map(row => row.name)).toEqual(['Inbox', 'Home', 'School', 'Work']);
  });

  test('an unknown project without create_project makes none: the task goes to the default project', async () => {
    const {w, todoist, run, command, calendarId} = await todoistWorld();
    await run();
    const created = createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: calendarId(), title: 'Typo', due_date: '2026-10-09', project: 'Wrok'}));
    await run();
    expect(command(created.id).state).toBe('confirmed');
    expect(todoist.requests.some(request => request.path === '/api/v1/projects')).toBe(false);
    expect(todoist.requests.find(request => request.method === 'POST' && request.path === '/api/v1/tasks')!.body).not.toHaveProperty('project_id');
  });

  test('F6b: labels: mirrored with their tasks and as Todoist\'s list; written on create and change; events have none', async () => {
    const {w, todoist, run, command, calendarId, task, day} = await todoistWorld();
    await run();
    expect(todoistLabels(w.store)).toEqual([{id: 'l-errand', name: 'errand'}, {id: 'l-waiting', name: 'waiting'}]);
    expect(day('2026-10-07').find(item => item.title === 'Pay rent')).toMatchObject({labels: ['errand'], repeat: null});
    const created = createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: calendarId(), title: 'Mail the form', due_date: '2026-10-09', labels: ['errand', 'waiting']}));
    await run();
    expect(command(created.id).state).toBe('confirmed');
    expect(todoist.requests.find(request => request.method === 'POST' && request.path === '/api/v1/tasks')!.body).toMatchObject({labels: ['errand', 'waiting']});
    const relabelled = updateItem(w.store, task('t-rent').id, itemUpdateInput.parse({changes: {labels: ['waiting']}}));
    expect(day('2026-10-07').find(item => item.title === 'Pay rent')!.labels).toEqual(['waiting']);
    await run();
    expect(command(relabelled.id).state).toBe('confirmed');
    expect(todoist.requests.at(-1)!.body).toEqual({labels: ['waiting']});
    expect(todoist.task('t-rent')!.labels).toEqual(['waiting']);
    // A label deleted in Todoist leaves the picker.
    todoist.addLabel({id: 'l-waiting', name: 'waiting', is_deleted: true});
    w.advance(5 * 60_000);
    await run();
    expect(todoistLabels(w.store).map(label => label.name)).toEqual(['errand']);
    const personal = w.store.db.insert(t.calendars).values({provider: 'google', providerId: 'personal', name: 'Personal', colour: 'cool', position: 5}).returning().get();
    expect(() => createItem(w.store, itemCreateInput.parse({kind: 'event', calendar_id: personal.id, title: 'Lunch', starts_at: '2026-10-09T19:00:00.000Z', ends_at: '2026-10-09T20:00:00.000Z', labels: ['errand']}))).toThrow(/task's/);
  });

  test('SV-264: a task\'s description is kept as Todoist\'s Markdown, an empty one is none; written on create and only when it changes; an empty string clears it', async () => {
    const {w, todoist, run, command, calendarId, task, day} = await todoistWorld();
    todoist.put({...todoist.task('t-rent')!, description: TODOIST_DESCRIPTION});
    todoist.put({...todoist.task('t-call')!, description: ''});
    await run();
    expect(day('2026-10-07').map(item => [item.title, item.description])).toEqual([['Call Mom', null], ['Pay rent', TODOIST_DESCRIPTION], ['Water plants', null]]);
    const created = createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: calendarId(), title: 'Mail the form', due_date: '2026-10-09', description: '**Certified** mail'}));
    await run();
    expect(command(created.id).state).toBe('confirmed');
    expect(todoist.requests.find(request => request.method === 'POST' && request.path === '/api/v1/tasks')!.body).toMatchObject({description: '**Certified** mail'});
    // Another change leaves Todoist's description out of what's sent.
    const renamed = updateItem(w.store, task('t-rent').id, itemUpdateInput.parse({changes: {title: 'Pay the rent'}}));
    await run();
    expect(command(renamed.id).state).toBe('confirmed');
    expect(todoist.requests.at(-1)!.body).toEqual({content: 'Pay the rent'});
    expect(todoist.task('t-rent')!.description).toBe(TODOIST_DESCRIPTION);
    const changed = updateItem(w.store, task('t-rent').id, itemUpdateInput.parse({changes: {description: 'By *check* this month'}}));
    expect(task('t-rent').description).toBe('By *check* this month');
    await run();
    expect(command(changed.id).state).toBe('confirmed');
    expect(todoist.requests.at(-1)!.body).toEqual({description: 'By *check* this month'});
    expect(todoist.task('t-rent')!.description).toBe('By *check* this month');
    const cleared = updateItem(w.store, task('t-rent').id, itemUpdateInput.parse({changes: {description: null}}));
    await run();
    expect(command(cleared.id).state).toBe('confirmed');
    expect(todoist.requests.at(-1)!.body).toEqual({description: ''});
    expect(todoist.task('t-rent')!.description).toBe('');
    w.advance(5 * 60_000);
    await run();
    expect(task('t-rent').description).toBeNull();
  });

  test('SV-264: a description change Todoist refuses is kept in place through a poll, and Todoist\'s own applies after Move back', async () => {
    const {w, todoist, run, command, task} = await todoistWorld();
    todoist.put({...todoist.task('t-rent')!, description: TODOIST_DESCRIPTION});
    await run();
    todoist.fault({method: 'POST', path: /\/tasks\/t-rent$/, response: {status: 400, body: {error: 'Description is too long', error_code: 400, http_code: 400}}});
    const changed = updateItem(w.store, task('t-rent').id, itemUpdateInput.parse({changes: {description: 'By check'}}));
    await run();
    expect(command(changed.id).state).toBe('failed');
    todoist.put({...todoist.task('t-rent')!, description: 'Changed in Todoist'});
    w.advance(5 * 60_000);
    await run();
    expect(task('t-rent').description).toBe('By check');
    moveBackCommand(w.store, changed.id);
    expect(task('t-rent').description).toBe(TODOIST_DESCRIPTION);
    w.advance(5 * 60_000);
    await run();
    expect(task('t-rent').description).toBe('Changed in Todoist');
  });

  test('F6b: a repeating task\'s date moves with its repeat in one due string, and lands where Todoist puts it', async () => {
    const {w, todoist, run, command, task, tasks, day} = await todoistWorld();
    await run();
    // Water plants (every wed, Oct 7) to Friday, Oct 9: Todoist starts the repeat there, so its next is Wed, Oct 14.
    const moved = updateItem(w.store, task('t-plants').id, itemUpdateInput.parse({changes: {due_date: '2026-10-09', due_at: null}}));
    expect(tasks('2026-10-09')).toEqual(['○ Water plants']);
    await run();
    expect(command(moved.id).state).toBe('confirmed');
    expect(todoist.requests.at(-1)!.body).toEqual({due_string: 'every wed starting 2026-10-09', due_lang: 'en'});
    expect(tasks('2026-10-09')).toEqual([]);
    expect(day('2026-10-14').find(item => item.title === 'Water plants')).toMatchObject({recurring: true, repeat: 'every wed', due_string: 'every wed starting 2026-10-09'});
    // A one-off task takes a repeat (at its time), and gives it up again for a plain day.
    const repeating = updateItem(w.store, task('t-call').id, itemUpdateInput.parse({changes: {repeat: 'every fri'}}));
    await run();
    expect(command(repeating.id).state).toBe('confirmed');
    expect(todoist.requests.at(-1)!.body).toEqual({due_string: 'every fri at 19:00 starting 2026-10-07', due_lang: 'en'});
    expect(day('2026-10-09').find(item => item.title === 'Call Mom')).toMatchObject({recurring: true, repeat: 'every fri', due_at: '2026-10-10T02:00:00.000Z'});
    const oneOff = updateItem(w.store, task('t-call').id, itemUpdateInput.parse({changes: {repeat: null, due_date: '2026-10-12', due_at: null}}));
    await run();
    expect(command(oneOff.id).state).toBe('confirmed');
    expect(todoist.requests.at(-1)!.body).toEqual({due_date: '2026-10-12', due_lang: 'en'});
    expect(day('2026-10-12').find(item => item.title === 'Call Mom')).toMatchObject({recurring: false, repeat: null});
    // A repeat Todoist sent no words for can't travel with a new date: refused before Todoist.
    w.store.db.update(t.items).set({dueString: null}).where(eq(t.items.id, task('t-plants').id)).run();
    expect(() => updateItem(w.store, task('t-plants').id, itemUpdateInput.parse({changes: {due_date: '2026-10-21'}}))).toThrow(/didn't say how this task repeats/);
  });

  test('F7: with no project, a task goes to Settings\' default project, which is a project\'s name as the editor shows it', async () => {
    const {w, todoist, run, calendarId} = await todoistWorld();
    await run();
    updateSettings(w.store, {todoist: {default_project: 'Home'}});
    createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: calendarId(), title: 'Buy stamps', due_date: '2026-10-09'}));
    await run();
    const sent = todoist.requests.find(request => request.method === 'POST' && request.path === '/api/v1/tasks')!;
    expect(sent.body).toMatchObject({content: 'Buy stamps', project_id: 'p-home'});
  });

  test('SV-88: a task made with no project is in the one it goes to, Settings\' default else the Inbox, from the start rather than from a later sync', async () => {
    const {w, todoist, run, command, calendarId, day} = await todoistWorld();
    await run();
    const project = (title: string) => day('2026-10-09').find(item => item.title === title)?.project;
    const inbox = createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: calendarId(), title: 'Mail the form', due_date: '2026-10-09'}));
    expect(project('Mail the form')).toBe('Inbox');
    updateSettings(w.store, {todoist: {default_project: 'Home'}});
    const home = createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: calendarId(), title: 'Buy stamps', due_date: '2026-10-09'}));
    expect(project('Buy stamps')).toBe('Home');
    // A default project that's gone from Todoist leaves the task in the Inbox, as the server sends it.
    updateSettings(w.store, {todoist: {default_project: 'Garden'}});
    const gone = createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: calendarId(), title: 'Rake leaves', due_date: '2026-10-09'}));
    expect(project('Rake leaves')).toBe('Inbox');
    await run();
    expect([inbox, home, gone].map(one => command(one.id).state)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    expect(['Mail the form', 'Buy stamps', 'Rake leaves'].map(project)).toEqual(['Inbox', 'Home', 'Inbox']);
    // By task, as the three commands go out side by side, in no fixed order.
    const sent = todoist.requests.filter(request => request.method === 'POST' && request.path === '/api/v1/tasks').map(request => request.body as {content: string; project_id?: string});
    expect(Object.fromEntries(sent.map(body => [body.content, body.project_id]))).toEqual({'Mail the form': 'inbox', 'Buy stamps': 'p-home', 'Rake leaves': 'inbox'});
    expect(sent).toHaveLength(3);
  });

  test('a one-off task completes and reopens', async () => {
    const {w, todoist, run, command, task, tasks} = await todoistWorld();
    await run();
    const done = completeItem(w.store, task('t-rent').id, true);
    expect(tasks('2026-10-07')[1]).toBe('● Pay rent');
    await run();
    expect(command(done.id).state).toBe('confirmed');
    expect(todoist.task('t-rent')!.checked).toBe(true);
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')[1]).toBe('● Pay rent');
    const reopened = completeItem(w.store, task('t-rent').id, false);
    await run();
    expect(command(reopened.id).state).toBe('confirmed');
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')[1]).toBe('○ Pay rent');
  });

  test('a completed repeating task stays done on its day after Todoist moves it on, and can\'t be completed twice', async () => {
    const {w, todoist, run, command, task, tasks} = await todoistWorld();
    await run();
    const plants = task('t-plants');
    // Only the occurrence Todoist has open can be completed (v1's 409).
    expect(() => completeItem(w.store, plants.id, true, '2026-10-14')).toThrow(/isn't open on 2026-10-14/);
    const done = completeItem(w.store, plants.id, true, '2026-10-07');
    // At once: done on Oct 7, pending.
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
    await run();
    expect(command(done.id).state).toBe('confirmed');
    expect(todoist.requests.filter(request => request.path === '/api/v1/tasks/t-plants/close')).toHaveLength(1);
    expect(todoist.task('t-plants')!.due!.date).toBe('2026-10-14');
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
    expect(tasks('2026-10-14')).toEqual(['○ Water plants']);
    // Its activity log names the same occurrence: still one row for Oct 7.
    expect(w.store.db.select().from(t.items).where(eq(t.items.recurringItemId, plants.id)).all().map(row => [row.originalStart, row.doneAt !== null])).toEqual([['2026-10-07', true]]);
    // The resurrection guard: a stale sync showing Oct 7 open again, with nothing in the log to say
    // the task was put back there, doesn't undo it.
    todoist.put({...todoist.task('t-plants')!, due: {date: '2026-10-07', string: 'every wed', is_recurring: true}});
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
    expect(() => completeItem(w.store, task('t-plants').id, true, '2026-10-07')).toThrow(/already done/);
    // The task itself isn't reopened: its done occurrence is (SV-249).
    expect(() => completeItem(w.store, task('t-plants').id, false)).toThrow(/from its done occurrence/);
  });

  // SV-249 (D510): the toast's Undo and a done occurrence's Reopen. Todoist's reopen does nothing on
  // a repeating task, so the undo is the Sync command Todoist's own Undo sends.
  async function doneOccurrenceWorld() {
    const world = await todoistWorld();
    await world.run();
    const plants = world.task('t-plants');
    completeItem(world.w.store, plants.id, true, '2026-10-07');
    // The close confirmed and no poll since, as when the toast's Undo is pressed: the poll after the
    // undo reads the close and the undo together from the activity log (SV-251).
    await world.run();
    const occurrences = () => world.w.store.db.select().from(t.items).where(eq(t.items.recurringItemId, plants.id)).all();
    return {...world, plants, occurrences};
  }

  test('SV-249: a repeating task\'s latest done occurrence reopens: Todoist puts the task back on its day with its repeat, and a poll leaves it so', async () => {
    const {w, todoist, run, command, task, tasks, day, plants, occurrences} = await doneOccurrenceWorld();
    expect(todoist.task('t-plants')!.due!.date).toBe('2026-10-14');
    expect(day('2026-10-07').find(item => item.title === 'Water plants')).toMatchObject({done: true, can_reopen: true});
    expect(day('2026-10-07').find(item => item.title === 'Pay rent')).toMatchObject({done: false, can_reopen: false});
    const reopened = completeItem(w.store, occurrences()[0]!.id, false);
    // At once: open on Oct 7 again, the done row gone, the change on the task.
    expect(reopened.targetId).toBe(plants.id);
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '○ Water plants']);
    expect(occurrences()).toEqual([]);
    await run();
    expect(command(reopened.id).state).toBe('confirmed');
    const sent = todoist.requests.filter(request => request.path === '/api/v1/sync' && (request.body as Record<string, string>).commands);
    expect(sent).toHaveLength(1);
    const [sync] = JSON.parse((sent[0]!.body as Record<string, string>).commands!) as {uuid: string}[];
    expect(sync).toEqual({
      type: 'item_update_date_complete', uuid: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/),
      args: {id: 't-plants', due: {date: '2026-10-07', string: 'every wed', lang: 'en', is_recurring: true}, is_forward: 0},
    });
    expect(todoist.requests.filter(request => request.path === '/api/v1/tasks/t-plants/reopen')).toEqual([]);
    expect(todoist.task('t-plants')!.due).toMatchObject({date: '2026-10-07', string: 'every wed', is_recurring: true});
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '○ Water plants']);
    expect(tasks('2026-10-14')).toEqual([]);
    expect(occurrences()).toEqual([]);
    expect(task('t-plants')).toMatchObject({dueDate: '2026-10-07', dueRecurring: true, dueString: 'every wed', doneAt: null});
    // And it completes again as before.
    completeItem(w.store, plants.id, true, '2026-10-07');
    await run();
    expect(todoist.task('t-plants')!.due!.date).toBe('2026-10-14');
  });

  test('SV-249: a reopen Todoist refuses fails in place with Todoist\'s words; Move back brings the done occurrence back', async () => {
    const {w, todoist, run, command, task, tasks, occurrences} = await doneOccurrenceWorld();
    todoist.refuseCommand({error: 'Item not found', error_code: 22, error_tag: 'ITEM_NOT_FOUND', http_code: 404, error_extra: {}});
    const reopened = completeItem(w.store, occurrences()[0]!.id, false);
    await run();
    expect(command(reopened.id)).toMatchObject({state: 'failed', providerMessage: 'Item not found (404 Not Found)'});
    w.advance(5 * 60_000);
    await run();
    expect(command(reopened.id).state).toBe('failed');
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '○ Water plants']);
    moveBackCommand(w.store, reopened.id);
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
    expect(occurrences().map(row => [row.originalStart, row.doneAt !== null])).toEqual([['2026-10-07', true]]);
    expect(todoist.task('t-plants')!.due!.date).toBe('2026-10-14');
    // The close's move to Oct 14 was skipped while the reopen held the task; the next poll applies it (SV-260).
    w.advance(5 * 60_000);
    await run();
    expect(task('t-plants').dueDate).toBe('2026-10-14');
    expect(occurrences().map(row => [row.originalStart, row.doneAt !== null])).toEqual([['2026-10-07', true]]);
  });

  test('SV-249: an older done occurrence is history and isn\'t reopened; the latest one is', async () => {
    const {w, run, task, day, plants, occurrences} = await doneOccurrenceWorld();
    w.advance(7 * 24 * 60 * 60_000);
    await run();
    completeItem(w.store, task('t-plants').id, true, '2026-10-14');
    await run();
    const [older, latest] = occurrences().sort((a, b) => a.originalStart!.localeCompare(b.originalStart!));
    expect([older!.originalStart, latest!.originalStart]).toEqual(['2026-10-07', '2026-10-14']);
    expect(day('2026-10-07').find(item => item.title === 'Water plants')).toMatchObject({done: true, can_reopen: false});
    expect(day('2026-10-14').find(item => item.title === 'Water plants')).toMatchObject({done: true, can_reopen: true});
    expect(() => completeItem(w.store, older!.id, false)).toThrow(/only its latest done occurrence reopens/);
    expect(() => completeItem(w.store, latest!.id, true)).toThrow(/already done/);
    completeItem(w.store, latest!.id, false);
    expect(task('t-plants').id).toBe(plants.id);
    expect(task('t-plants').dueDate).toBe('2026-10-14');
  });

  test('SV-249 with SV-251: a reopen after a poll has read the close is not brought back by the next poll either', async () => {
    const {w, run, tasks, occurrences} = await doneOccurrenceWorld();
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
    completeItem(w.store, occurrences()[0]!.id, false);
    await run();
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '○ Water plants']);
    expect(occurrences()).toEqual([]);
  });

  test('SV-251: a repeating task completed in Todoist\'s own app is kept done on its day, from its activity log; its completed list never names it', async () => {
    const {w, todoist, run, tasks, task} = await todoistWorld();
    await run();
    w.advance(10 * 60_000);
    const completedAt = w.store.now().toISOString();
    todoist.completeInTodoist('t-plants');
    expect(todoist.task('t-plants')!.due!.date).toBe('2026-10-14');
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
    expect(tasks('2026-10-14')).toEqual(['○ Water plants']);
    const occurrence = w.store.db.select().from(t.items).where(eq(t.items.recurringItemId, task('t-plants').id)).get()!;
    expect(occurrence).toMatchObject({originalStart: '2026-10-07', dueDate: '2026-10-07', dueAt: null, doneAt: completedAt});
    const read = todoist.requests.filter(request => request.path === '/api/v1/activities');
    expect(read.map(request => [request.query.get('object_type'), request.query.get('event_type')])).toContainEqual(['item', 'completed']);
    // Once: later polls make no second row.
    w.advance(5 * 60_000);
    await run();
    expect(w.store.db.select().from(t.items).where(eq(t.items.recurringItemId, task('t-plants').id)).all()).toHaveLength(1);
  });

  test('SV-251: a timed occurrence is kept on its local day with its time; a one-off completed in the app is done from the completed list, once', async () => {
    const {w, todoist, run, tasks, task} = await todoistWorld();
    // 09:00 in Los Angeles, a floating time as Todoist sends it.
    todoist.put({id: 't-standup', content: 'Standup', project_id: 'inbox', due: {date: '2026-10-07T09:00:00', string: 'every day at 9am', is_recurring: true}, everyDays: 1});
    await run();
    todoist.completeInTodoist('t-standup');
    todoist.completeInTodoist('t-rent');
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '● Pay rent', '● Standup', '○ Water plants']);
    expect(tasks('2026-10-08')).toEqual(['○ Standup']);
    const standup = w.store.db.select().from(t.items).where(eq(t.items.recurringItemId, task('t-standup').id)).all();
    expect(standup.map(row => [row.originalStart, row.dueAt])).toEqual([['2026-10-07', '2026-10-07T16:00:00.000Z']]);
    // The one-off made no occurrence row of its own.
    expect(w.store.db.select().from(t.items).where(eq(t.items.recurringItemId, task('t-rent').id)).all()).toEqual([]);
  });

  test('SV-251: a look at the activity log stays inside the week Todoist\'s Free plan keeps, every page read', async () => {
    const {w, todoist, run, tasks, source} = await todoistWorld();
    const DAY = 86_400_000;
    // Completed in the app before Setpoint first looks: Oct 7's eight days before, past what
    // Todoist keeps, and Oct 14's five days before.
    todoist.completeInTodoist('t-plants');
    w.advance(3 * DAY);
    todoist.completeInTodoist('t-plants');
    w.advance(5 * DAY);
    // A busy week: more completions than one page holds, newer than Oct 14's.
    for (let close = 0; close < 230; close += 1) todoist.completeInTodoist('t-call');
    w.advance(60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Pay rent']);
    expect(tasks('2026-10-14')).toEqual(['● Water plants']);
    expect(tasks('2026-10-21')).toEqual(['○ Water plants']);
    const reads = () => todoist.requests.filter(request => request.path === '/api/v1/activities' && request.query.get('event_type') === 'completed');
    expect(reads()[0]!.query.get('date_from')).toBe(new Date(w.store.now().getTime() - 6 * DAY).toISOString());
    expect(reads().map(request => request.query.get('cursor'))).toEqual([null, 'o.200']);
    // Setpoint away for ten days: its next look starts six days back, not at its last, which
    // Todoist would refuse; the connection stays healthy.
    w.advance(10 * DAY);
    await run();
    expect(reads().at(-1)!.query.get('date_from')).toBe(new Date(w.store.now().getTime() - 6 * DAY).toISOString());
    expect(sourceList(w.store).find(row => row.id === source.id)).toMatchObject({health: {state: 'healthy'}});
  });

  test('SV-251: the log\'s fields are read in the camel case Todoist\'s own connector shows too', async () => {
    const {w, todoist, run, tasks} = await todoistWorld();
    await run();
    todoist.completeInTodoist('t-plants');
    todoist.camelCaseLog();
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
  });

  test('SV-251: Undo on Todoist\'s pop-up puts the occurrence back open, whether the poll read the completion before it or with it', async () => {
    const {w, todoist, engine, source, run, tasks, task} = await todoistWorld();
    await run();
    const oct7 = {date: '2026-10-07', string: 'every wed', is_recurring: true};
    // Completed and undone between two polls: no done row is made.
    todoist.completeInTodoist('t-plants');
    w.advance(3_000);
    todoist.undoInTodoist('t-plants', oct7);
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '○ Water plants']);
    expect(w.store.db.select().from(t.items).where(eq(t.items.recurringItemId, task('t-plants').id)).all()).toEqual([]);
    // Completed, a poll (a webhook's) makes the done row, then Undo: the next poll takes it away.
    todoist.completeInTodoist('t-plants');
    w.advance(2_000);
    engine.pushed(source.id);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
    w.advance(3_000);
    todoist.undoInTodoist('t-plants', oct7);
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '○ Water plants']);
    expect(tasks('2026-10-14')).toEqual([]);
    expect(w.store.db.select().from(t.items).where(eq(t.items.recurringItemId, task('t-plants').id)).all()).toEqual([]);
    // And completed again for real, it's done again.
    w.advance(60_000);
    todoist.completeInTodoist('t-plants');
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
  });

  test('SV-251: with a later occurrence completed in Todoist\'s app, Reopen is offered on that one, not the one completed here', async () => {
    const {w, todoist, run, task, day, occurrences} = await doneOccurrenceWorld();
    w.advance(7 * 24 * 60 * 60_000);
    await run();
    todoist.completeInTodoist('t-plants');
    w.advance(5 * 60_000);
    await run();
    expect(occurrences().map(row => row.originalStart).sort()).toEqual(['2026-10-07', '2026-10-14']);
    expect(day('2026-10-07').find(item => item.title === 'Water plants')).toMatchObject({done: true, can_reopen: false});
    expect(day('2026-10-14').find(item => item.title === 'Water plants')).toMatchObject({done: true, can_reopen: true});
    const latest = occurrences().find(row => row.originalStart === '2026-10-14')!;
    completeItem(w.store, latest.id, false);
    await run();
    expect(todoist.task('t-plants')!.due!.date).toBe('2026-10-14');
    expect(task('t-plants').dueDate).toBe('2026-10-14');
  });

  test('delete; a task already gone in Todoist counts as deleted; a failure keeps Todoist\'s words', async () => {
    const {w, todoist, run, command, task, tasks} = await todoistWorld();
    await run();
    const removed = deleteItem(w.store, task('t-rent').id, itemScopeInput.parse({}));
    await run();
    expect(command(removed.id).state).toBe('confirmed');
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Water plants']);
    todoist.put({...todoist.task('t-call')!, is_deleted: true});
    const gone = deleteItem(w.store, task('t-call').id, itemScopeInput.parse({}));
    await run();
    expect(command(gone.id).state).toBe('confirmed');
    todoist.fault({method: 'POST', path: /\/tasks\/t-plants$/, response: {status: 400, body: {error: 'Content is too long', error_code: 400, http_code: 400}}});
    const renamed = updateItem(w.store, task('t-plants').id, itemUpdateInput.parse({changes: {title: 'Water the plants'}}));
    await run();
    expect(command(renamed.id)).toMatchObject({state: 'failed', providerMessage: 'Content is too long (400 Bad Request)'});
  });

  describe('SV-260: a change made in Todoist while a change of Setpoint\'s holds its task is applied once the hold ends', () => {
    /** A rename Todoist refuses, failed in place: it holds the task until Try again or Move back. */
    async function heldWorld(providerId: string, put?: Parameters<Awaited<ReturnType<typeof fakeTodoist>>['put']>[0]) {
      const world = await todoistWorld();
      if (put) world.todoist.put(put);
      await world.run();
      world.todoist.fault({method: 'POST', path: new RegExp(`/tasks/${providerId}$`), response: {status: 400, body: {error: 'Content is too long', error_code: 400, http_code: 400}}});
      const renamed = updateItem(world.w.store, world.task(providerId).id, itemUpdateInput.parse({changes: {title: 'Renamed'}}));
      await world.run();
      expect(world.command(renamed.id).state).toBe('failed');
      return {...world, renamed};
    }

    test('a due moved in Todoist is left alone while the failed change holds the task, and applied by the first poll after Move back', async () => {
      const {w, todoist, run, task, renamed} = await heldWorld('t-rent');
      todoist.put({...todoist.task('t-rent')!, due: {date: '2026-10-09', string: 'Oct 9', is_recurring: false}});
      w.advance(5 * 60_000);
      await run();
      expect(task('t-rent')).toMatchObject({title: 'Renamed', dueDate: '2026-10-07'});
      moveBackCommand(w.store, renamed.id);
      expect(task('t-rent')).toMatchObject({title: 'Pay rent', dueDate: '2026-10-07'});
      w.advance(5 * 60_000);
      await run();
      expect(task('t-rent')).toMatchObject({title: 'Pay rent', dueDate: '2026-10-09'});
    });

    test('a sweep while the hold lasts keeps the token, so a pushed sync after Move back still applies the change', async () => {
      const {w, todoist, engine, source, run, task, renamed} = await heldWorld('t-rent');
      w.store.db.update(t.sources).set({syncMode: 'push'}).where(eq(t.sources.id, source.id)).run();
      const fullSyncs = () => todoist.requests.filter(request => request.path === '/api/v1/sync' && (request.body as Record<string, string>).sync_token === '*').length;
      const before = fullSyncs();
      todoist.put({...todoist.task('t-rent')!, due: {date: '2026-10-09', string: 'Oct 9', is_recurring: false}});
      w.advance(5 * 60_000);
      await run();
      expect(fullSyncs()).toBe(before + 1);
      expect(task('t-rent').dueDate).toBe('2026-10-07');
      moveBackCommand(w.store, renamed.id);
      engine.pushed(source.id);
      await run();
      expect(task('t-rent')).toMatchObject({title: 'Pay rent', dueDate: '2026-10-09'});
    });

    test('a repeating occurrence completed in Todoist\'s app while the hold lasts is kept done on its day after Move back, from the activity log', async () => {
      const {w, todoist, run, task, tasks, renamed} = await heldWorld('t-plants');
      todoist.completeInTodoist('t-plants');
      w.advance(5 * 60_000);
      await run();
      expect(w.store.db.select().from(t.items).where(eq(t.items.recurringItemId, task('t-plants').id)).all()).toEqual([]);
      moveBackCommand(w.store, renamed.id);
      w.advance(5 * 60_000);
      await run();
      expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
      expect(task('t-plants').dueDate).toBe('2026-10-14');
    });

    test('a repeating task completed for good in Todoist\'s app while the hold lasts keeps its last occurrence done after Move back, from the completed list', async () => {
      const {w, todoist, run, task, renamed} = await heldWorld('t-last', {id: 't-last', content: 'Last lesson', project_id: 'inbox', due: {date: '2026-10-07', string: 'every wed until oct 7', is_recurring: true}});
      todoist.completeInTodoist('t-last');
      w.advance(5 * 60_000);
      await run();
      moveBackCommand(w.store, renamed.id);
      w.advance(5 * 60_000);
      await run();
      const last = task('t-last');
      expect(last.doneAt).not.toBeNull();
      expect(w.store.db.select().from(t.items).where(eq(t.items.recurringItemId, last.id)).all().map(row => [row.originalStart, row.doneAt !== null])).toEqual([['2026-10-07', true]]);
    });
  });
});

describe('SV-25: a project\'s colour, written to Todoist', () => {
  async function colourWorld() {
    const world = await todoistWorld();
    return {...world, colours: () => todoistProjects(world.w.store).map(project => [project.name, project.colour, project.command?.state ?? null])};
  }

  test('each project\'s colour is read from Todoist; one Setpoint doesn\'t know is none; one changed in Todoist\'s app arrives with the next poll', async () => {
    const world = await colourWorld();
    world.todoist.addProject({id: 'p-home', name: 'Home', child_order: 1, color: 'orange'});
    world.todoist.addProject({id: 'p-school', name: 'School', child_order: 2, color: 'neon_pink'});
    await world.run();
    expect(world.colours()).toEqual([['Inbox', null, null], ['Home', 'orange', null], ['School', null, null]]);
    world.todoist.addProject({id: 'p-school', name: 'School', child_order: 2, color: 'sky_blue'});
    world.w.advance(5 * 60_000);
    await world.run();
    expect(world.colours()).toEqual([['Inbox', null, null], ['Home', 'orange', null], ['School', 'sky_blue', null]]);
  });

  test('picked in Settings: shown at once, pending until Todoist confirms, and written as Todoist\'s colour name', async () => {
    const world = await colourWorld();
    await world.run();
    const picked = setProjectColour(world.w.store, 'p-home', 'teal');
    expect(world.colours()).toContainEqual(['Home', 'teal', 'pending']);
    expect(todoistProjects(world.w.store).find(project => project.name === 'Home')!.command).toMatchObject({kind: 'project_colour', target: 'project', provider: 'todoist'});
    expect(() => setProjectColour(world.w.store, 'p-home', 'red')).toThrow(/still waiting/);
    await world.run();
    expect(world.command(picked.id).state).toBe('confirmed');
    expect(world.todoist.project('p-home')!.color).toBe('teal');
    // The next poll reads it back.
    world.w.advance(5 * 60_000);
    await world.run();
    expect(world.colours()).toContainEqual(['Home', 'teal', null]);
    expect(() => setProjectColour(world.w.store, 'p-home', 'teal')).toThrow(/already has that colour/);
    expect(() => setProjectColour(world.w.store, 'p-gone', 'teal')).toThrow(/No such Todoist project/);
  });

  test('refused by Todoist: failed in place with Todoist\'s words, kept through a sync; Change back restores it, Try again sends it again', async () => {
    const world = await colourWorld();
    world.todoist.addProject({id: 'p-home', name: 'Home', child_order: 1, color: 'orange'});
    await world.run();
    // A 400, not a 401 or 403: those mark the connection as needing reconnect, which stops its syncs (SV-266).
    world.todoist.fault({method: 'POST', path: /\/projects\/p-home$/, response: {status: 400, body: {error: 'Invalid argument value', error_code: 400, http_code: 400}}});
    const picked = setProjectColour(world.w.store, 'p-home', 'grape');
    await world.run();
    expect(world.command(picked.id)).toMatchObject({state: 'failed', providerMessage: 'Invalid argument value (400 Bad Request)'});
    // The sync runs and names both projects: School's new colour arrives, while Home keeps the failed grape over Todoist's orange.
    world.todoist.addProject({id: 'p-home', name: 'Home', child_order: 1, color: 'orange'});
    world.todoist.addProject({id: 'p-school', name: 'School', child_order: 2, color: 'sky_blue'});
    world.w.advance(5 * 60_000);
    await world.run();
    expect(world.colours()).toEqual([['Inbox', null, null], ['Home', 'grape', 'failed'], ['School', 'sky_blue', null]]);
    moveBackCommand(world.w.store, picked.id);
    expect(world.colours()).toContainEqual(['Home', 'orange', null]);
    world.todoist.fault({method: 'POST', path: /\/projects\/p-home$/, response: {status: 404, body: {error: 'Project not found', error_code: 404, http_code: 404}}});
    const again = setProjectColour(world.w.store, 'p-home', 'grape');
    await world.run();
    expect(world.command(again.id).state).toBe('failed');
    retryCommand(world.w.store, again.id);
    await world.run();
    expect(world.command(again.id).state).toBe('confirmed');
    expect(world.todoist.project('p-home')!.color).toBe('grape');
  });

  describe('SV-262: a colour changed in Todoist while a colour change of Setpoint\'s holds its project is applied once the hold ends', () => {
    /** A colour Todoist refuses, failed in place: it holds the project until Try again or Change back. */
    async function heldColourWorld() {
      const world = await colourWorld();
      world.todoist.addProject({id: 'p-home', name: 'Home', child_order: 1, color: 'orange'});
      await world.run();
      world.todoist.fault({method: 'POST', path: /\/projects\/p-home$/, response: {status: 400, body: {error: 'Invalid argument value', error_code: 400, http_code: 400}}});
      const picked = setProjectColour(world.w.store, 'p-home', 'grape');
      await world.run();
      expect(world.command(picked.id).state).toBe('failed');
      return {...world, picked};
    }

    test('a colour changed in Todoist is left alone while the failed change holds the project, and applied by the first poll after Change back', async () => {
      const {w, todoist, run, colours, picked} = await heldColourWorld();
      todoist.addProject({id: 'p-home', name: 'Home', child_order: 1, color: 'sky_blue'});
      w.advance(5 * 60_000);
      await run();
      expect(colours()).toContainEqual(['Home', 'grape', 'failed']);
      moveBackCommand(w.store, picked.id);
      expect(colours()).toContainEqual(['Home', 'orange', null]);
      w.advance(5 * 60_000);
      await run();
      expect(colours()).toContainEqual(['Home', 'sky_blue', null]);
    });

    test('a sweep while the hold lasts keeps the token, so a pushed sync after Change back still applies the colour', async () => {
      const {w, todoist, engine, source, run, colours, picked} = await heldColourWorld();
      w.store.db.update(t.sources).set({syncMode: 'push'}).where(eq(t.sources.id, source.id)).run();
      const fullSyncs = () => todoist.requests.filter(request => request.path === '/api/v1/sync' && (request.body as Record<string, string>).sync_token === '*').length;
      const before = fullSyncs();
      todoist.addProject({id: 'p-home', name: 'Home', child_order: 1, color: 'sky_blue'});
      w.advance(5 * 60_000);
      await run();
      expect(fullSyncs()).toBe(before + 1);
      expect(colours()).toContainEqual(['Home', 'grape', 'failed']);
      moveBackCommand(w.store, picked.id);
      engine.pushed(source.id);
      await run();
      expect(colours()).toContainEqual(['Home', 'sky_blue', null]);
    });
  });
});

describe('connecting Todoist', () => {
  const CALLBACK = '/api/ea/accounts/todoist/callback';

  async function connectWorld() {
    const w = world();
    const todoist = await fakeTodoist();
    const providers = {todoistOAuth: {client: {clientId: 'todoist-client', clientSecret: 'todoist-secret'}, authorizeUrl: `${todoist.url}/oauth/authorize`, apiUrl: todoist.url}};
    const c = await signedIn(w, {providers});
    return {w, todoist, c, providers};
  }

  const bindCookie = (headers: Headers) => headers.getSetCookie().find(line => line.startsWith('setpoint_todoist_bind='))!;

  test('Connect, consent, and the callback at v1\'s path stores the token on a new Todoist source', async () => {
    const {w, todoist, c} = await connectWorld();
    const begun = await c.send('POST', '/api/todoist/connect');
    expect(begun.status).toBe(200);
    const url = new URL(begun.body.url);
    expect([url.origin + url.pathname, url.searchParams.get('client_id'), url.searchParams.get('scope'), url.searchParams.get('response_type')]).toEqual([
      `${todoist.url}/oauth/authorize`, 'todoist-client', 'data:read_write,data:delete', 'code',
    ]);
    const cookie = bindCookie(begun.headers);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(new RegExp(`Path=${CALLBACK.replaceAll('/', '\\/')}`));
    todoist.grant('code-1', 'todoist-token-new');
    // Todoist's redirect back: cross-site, so no session cookie, only the binding.
    const back = await c.send('GET', `${CALLBACK}?code=code-1&state=${url.searchParams.get('state')}`, {headers: {cookie: cookie.split(';')[0]!}});
    expect(back.status).toBe(200);
    expect(back.body).toContain('url=/settings/accounts?todoist=1');
    const source = w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'todoist')).get()!;
    expect(readSourceCredentials(w.store, source.id)).toEqual({kind: 'api_key', key: 'todoist-token-new'});
    expect(todoist.requests.find(request => request.path === '/oauth/access_token')!.body).toMatchObject({
      client_id: 'todoist-client', code: 'code-1', grant_type: 'authorization_code', redirect_uri: `http://localhost${CALLBACK}`,
    });
    expect(w.store.db.select().from(t.calendars).where(eq(t.calendars.provider, 'todoist')).get()).toMatchObject({name: 'Todoist', colour: null});
    // The state was single use.
    const replay = await c.send('GET', `${CALLBACK}?code=code-1&state=${url.searchParams.get('state')}`, {headers: {cookie: cookie.split(';')[0]!}});
    expect(replay.status).toBe(400);
  });

  test('a callback in another browser is refused before any exchange', async () => {
    const {w, todoist, c, providers} = await connectWorld();
    const begun = await c.send('POST', '/api/todoist/connect');
    todoist.grant('code-2', 'stolen');
    const other = client(w, {providers});
    const back = await other.send('GET', `${CALLBACK}?code=code-2&state=${new URL(begun.body.url).searchParams.get('state')}`, {headers: {cookie: 'setpoint_todoist_bind=someone-else'}});
    expect(back.status).toBe(400);
    expect(todoist.requests.some(request => request.path === '/oauth/access_token')).toBe(false);
    expect(w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'todoist')).get()).toBeUndefined();
  });

  test('an expired state, a refused code, or a cancelled consent store nothing', async () => {
    const {w, c} = await connectWorld();
    const first = await c.send('POST', '/api/todoist/connect');
    w.advance(11 * 60_000);
    const late = await c.send('GET', `${CALLBACK}?code=x&state=${new URL(first.body.url).searchParams.get('state')}`, {headers: {cookie: bindCookie(first.headers).split(';')[0]!}});
    expect(late.status).toBe(400);
    const second = await c.send('POST', '/api/todoist/connect');
    const refused = await c.send('GET', `${CALLBACK}?code=never-granted&state=${new URL(second.body.url).searchParams.get('state')}`, {headers: {cookie: bindCookie(second.headers).split(';')[0]!}});
    expect(refused.status).toBe(400);
    expect((await c.send('GET', `${CALLBACK}?error=access_denied`)).status).toBe(400);
    expect(w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'todoist')).get()).toBeUndefined();
  });

  test('without a configured app, Connect says so', async () => {
    const w = world();
    const c = await signedIn(w);
    expect((await c.send('POST', '/api/todoist/connect')).body.error.code).toBe('todoist_not_configured');
  });
});

describe('SV-272: a task\'s subtasks', () => {
  /** Pay rent with three subtasks, the middle one dated; `keys` gives them Todoist's order keys. */
  async function checklistWorld({keys = true} = {}) {
    const world = await todoistWorld();
    const {todoist} = world;
    const sub = (id: string, content: string, place: number, key: string, due: {date: string; string: string; is_recurring: boolean} | null = null) =>
      todoist.put({id, content, project_id: 'p-home', parent_id: 't-rent', child_order: place, order_key: keys ? key : null, due});
    // Out of their order in Todoist's answer, as a sync may send them.
    sub('t-stamp', 'Buy a stamp', 2, 'a2');
    sub('t-cheque', 'Write the cheque', 0, 'a0');
    sub('t-envelope', 'Find an envelope', 1, 'a1', {date: '2026-10-08', string: 'Oct 8', is_recurring: false});
    await world.run();
    const rent = () => world.day('2026-10-07').find(item => item.title === 'Pay rent')!;
    const checklist = () => rent().subtasks.map(subtask => `${subtask.done ? '●' : '○'} ${subtask.title}`);
    return {...world, rent, checklist};
  }

  test('are mirrored with their task, in Todoist\'s order; one with no date is only in the checklist, one with a date is on its day too', async () => {
    const {tasks, checklist, day, w} = await checklistWorld();
    expect(checklist()).toEqual(['○ Write the cheque', '○ Find an envelope', '○ Buy a stamp']);
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '○ Water plants']);
    expect(tasks('2026-10-08')).toEqual(['○ Find an envelope']);
    expect(day('2026-10-08')[0]!.subtasks).toEqual([]);
    // An undated task that is nobody's subtask still isn't mirrored.
    expect(w.store.db.select().from(t.items).where(eq(t.items.title, 'Learn piano')).get()).toBeUndefined();
  });

  test('without order keys they sort by child_order', async () => {
    const {checklist} = await checklistWorld({keys: false});
    expect(checklist()).toEqual(['○ Write the cheque', '○ Find an envelope', '○ Buy a stamp']);
  });

  test('an undated one isn\'t found by Calendar search', async () => {
    const {w} = await checklistWorld();
    const hits = searchCalendar(w.store, calendarSearchInput.parse({text: 'stamp'}));
    expect(hits.results.map(result => result.item.title)).toEqual([]);
  });

  test('checking one closes it in Todoist and leaves its task open, even when it\'s the last; its check reopens it', async () => {
    const {w, todoist, run, task, command, rent, checklist} = await checklistWorld();
    for (const id of ['t-cheque', 't-envelope', 't-stamp']) {
      const done = completeItem(w.store, task(id).id, true);
      expect((command(done.id).payload.touched as {items: number[]}).items).toEqual([task(id).id, task('t-rent').id]);
      await run();
      expect(command(done.id).state).toBe('confirmed');
    }
    expect(todoist.task('t-stamp')).toMatchObject({checked: true});
    expect(checklist()).toEqual(['● Write the cheque', '● Find an envelope', '● Buy a stamp']);
    expect(rent().done).toBe(false);
    expect(todoist.task('t-rent')).toMatchObject({checked: false});
    completeItem(w.store, task('t-stamp').id, false);
    await run();
    expect(checklist()).toEqual(['● Write the cheque', '● Find an envelope', '○ Buy a stamp']);
    expect(todoist.task('t-stamp')).toMatchObject({checked: false});
  });

  test('one checked in Todoist\'s app is done here, with no date to go by', async () => {
    const {w, todoist, run, checklist} = await checklistWorld();
    todoist.completeInTodoist('t-stamp');
    w.advance(5 * 60_000);
    await run();
    expect(checklist()).toEqual(['○ Write the cheque', '○ Find an envelope', '● Buy a stamp']);
  });

  test('one deleted in Todoist, or moved out from under its task with no date, leaves the checklist', async () => {
    const {w, todoist, run, checklist} = await checklistWorld();
    todoist.put({...todoist.task('t-stamp')!, is_deleted: true});
    todoist.put({...todoist.task('t-cheque')!, parent_id: null});
    w.advance(5 * 60_000);
    await run();
    expect(checklist()).toEqual(['○ Find an envelope']);
    expect(w.store.db.select().from(t.items).where(eq(t.items.providerId, 't-cheque')).get()).toBeUndefined();
  });

  test('reordering sends Todoist one new order key, for the subtask that moved, between its new neighbours\'', async () => {
    const {w, todoist, run, task, command, checklist} = await checklistWorld();
    const ids = (...providerIds: string[]) => providerIds.map(id => task(id).id);
    const moved = reorderSubtasks(w.store, task('t-rent').id, ids('t-cheque', 't-stamp', 't-envelope'));
    expect(checklist()).toEqual(['○ Write the cheque', '○ Buy a stamp', '○ Find an envelope']);
    await run();
    expect(command(moved.id)).toMatchObject({state: 'confirmed', kind: 'item_update', targetId: task('t-rent').id});
    const sent = todoist.requests.filter(request => request.path === '/api/v1/sync' && request.body.commands).map(request => JSON.parse(request.body.commands as string)[0]);
    expect(sent.map(one => [one.type, one.args])).toEqual([['item_update', {id: 't-stamp', order_key: 'a0V'}]]);
    expect(todoist.task('t-stamp')).toMatchObject({order_key: 'a0V'});
    // Todoist's own answer on the next poll keeps the order.
    w.advance(5 * 60_000);
    await run();
    expect(checklist()).toEqual(['○ Write the cheque', '○ Buy a stamp', '○ Find an envelope']);
  });

  test('reordering subtasks Todoist gave no keys sends each one its place', async () => {
    const {w, todoist, run, task, command, checklist} = await checklistWorld({keys: false});
    const moved = reorderSubtasks(w.store, task('t-rent').id, ['t-stamp', 't-envelope', 't-cheque'].map(id => task(id).id));
    await run();
    expect(command(moved.id).state).toBe('confirmed');
    const sent = todoist.requests.filter(request => request.path === '/api/v1/sync' && request.body.commands).map(request => JSON.parse(request.body.commands as string)[0]);
    expect(sent.map(one => [one.type, one.args])).toEqual([['item_reorder', {items: [{id: 't-stamp', child_order: 0}, {id: 't-envelope', child_order: 1}, {id: 't-cheque', child_order: 2}]}]]);
    w.advance(5 * 60_000);
    await run();
    expect(checklist()).toEqual(['○ Buy a stamp', '○ Find an envelope', '○ Write the cheque']);
  });

  test('a reorder Todoist refuses stays in place until Move back puts the subtasks back', async () => {
    const {w, todoist, run, task, command, checklist, rent} = await checklistWorld();
    todoist.refuseCommand({error: 'Invalid argument value', error_code: 20, error_tag: 'INVALID_ARGUMENT_VALUE', http_code: 400, error_extra: {}});
    const moved = reorderSubtasks(w.store, task('t-rent').id, ['t-envelope', 't-cheque', 't-stamp'].map(id => task(id).id));
    await run();
    expect(command(moved.id)).toMatchObject({state: 'failed', providerMessage: 'Invalid argument value (400 Bad Request)'});
    expect(rent().command).toMatchObject({state: 'failed', can_move_back: true});
    expect(checklist()).toEqual(['○ Find an envelope', '○ Write the cheque', '○ Buy a stamp']);
    moveBackCommand(w.store, moved.id);
    expect(checklist()).toEqual(['○ Write the cheque', '○ Find an envelope', '○ Buy a stamp']);
    expect(task('t-envelope').orderKey).toBe('a1');
  });

  test('a reorder names each subtask once, moves one at a time, and changes something', async () => {
    const {w, task} = await checklistWorld();
    const rent = task('t-rent').id;
    const [cheque, envelope, stamp] = ['t-cheque', 't-envelope', 't-stamp'].map(id => task(id).id) as [number, number, number];
    expect(() => reorderSubtasks(w.store, rent, [cheque, envelope])).toThrow('Name each of the task\'s subtasks once.');
    expect(() => reorderSubtasks(w.store, rent, [cheque, envelope, envelope])).toThrow('Name each of the task\'s subtasks once.');
    expect(() => reorderSubtasks(w.store, rent, [cheque, envelope, task('t-plants').id])).toThrow('Name each of the task\'s subtasks once.');
    expect(() => reorderSubtasks(w.store, rent, [cheque, envelope, stamp])).toThrow('The subtasks are already in that order.');
  });

  test('PUT /api/items/:id/subtasks/order answers with the task\'s command', async () => {
    const {w, task} = await checklistWorld();
    const c = await signedIn(w);
    const order = ['t-stamp', 't-cheque', 't-envelope'].map(id => task(id).id);
    const answer = await c.send('PUT', `/api/items/${task('t-rent').id}/subtasks/order`, {body: {subtask_ids: order}});
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({target: 'item', target_id: task('t-rent').id, kind: 'item_update', state: 'pending'});
    const read = await c.send('GET', `/api/items/${task('t-rent').id}`);
    expect((read.body as {subtasks: {id: number}[]}).subtasks.map(subtask => subtask.id)).toEqual(order);
  });
});
