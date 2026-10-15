// The Todoist adapter against a fake Todoist on 127.0.0.1: the mirror (with v1's Z-suffix bug
// fixed), changes through the command layer, a completed repeating task kept on its day (the
// tombstone) whether completed here or in Todoist's app, revoked tokens, and OAuth at v1's path.
import {itemCreateInput, itemScopeInput, itemUpdateInput} from '@setpoint/shared';
import {and, eq, isNull} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {moveBackCommand, retryCommand} from '../src/commands/index.ts';
import {completeItem, createItem, deleteItem, setProjectColour, updateItem} from '../src/commands/items.ts';
import * as t from '../src/db/schema.ts';
import {readDue, repeatAfter, repeatOf, writeDue} from '../src/providers/todoist/due.ts';
import {todoistAdapter} from '../src/providers/todoist/index.ts';
import {itemsInRange, todoistLabels, todoistProjects} from '../src/queries/items.ts';
import {sourceList} from '../src/queries/sources.ts';
import {updateSettings} from '../src/settings.ts';
import {readSourceCredentials, writeSourceCredentials} from '../src/secrets/store.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeTodoist} from './fakes/todoist.ts';
import {client, signedIn, world} from './helpers.ts';

const ZONE = 'America/Los_Angeles';

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
    ['a repeat Todoist sent no words for can\'t travel', {dueRecurring: true, dueString: null}, undefined, undefined],
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

  test('F6: a task takes no colour of its own', async () => {
    const {w, run, task} = await todoistWorld();
    await run();
    expect(() => updateItem(w.store, task('t-rent').id, itemUpdateInput.parse({changes: {colour: 'cool'}}))).toThrow(/no colour/);
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
    // Its completed list names the same occurrence: still one row for Oct 7.
    expect(w.store.db.select().from(t.items).where(eq(t.items.recurringItemId, plants.id)).all().map(row => [row.originalStart, row.doneAt !== null])).toEqual([['2026-10-07', true]]);
    // The resurrection guard: a stale sync showing Oct 7 open again doesn't undo it.
    todoist.put({...todoist.task('t-plants')!, due: {date: '2026-10-07', string: 'every wed', is_recurring: true}});
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
    expect(() => completeItem(w.store, task('t-plants').id, true, '2026-10-07')).toThrow(/already done/);
    // And it can't be reopened here (Todoist would drop the recurrence).
    expect(() => completeItem(w.store, task('t-plants').id, false)).toThrow(/reopens in Todoist/);
  });

  test('a repeating task completed in Todoist\'s own app is kept done on its day', async () => {
    const {w, todoist, run, tasks} = await todoistWorld();
    await run();
    w.advance(10 * 60_000);
    todoist.completeInTodoist('t-plants', w.store.now());
    w.advance(5 * 60_000);
    await run();
    expect(tasks('2026-10-07')).toEqual(['○ Call Mom', '○ Pay rent', '● Water plants']);
    expect(tasks('2026-10-14')).toEqual(['○ Water plants']);
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
    world.todoist.fault({method: 'POST', path: /\/projects\/p-home$/, response: {status: 403, body: {error: 'Insufficient permissions', error_code: 403, http_code: 403}}});
    const picked = setProjectColour(world.w.store, 'p-home', 'grape');
    await world.run();
    expect(world.command(picked.id)).toMatchObject({state: 'failed', providerMessage: 'Insufficient permissions (403 Forbidden)'});
    world.todoist.addProject({id: 'p-home', name: 'Home', child_order: 1, color: 'orange'});
    world.w.advance(5 * 60_000);
    await world.run();
    expect(world.colours()).toContainEqual(['Home', 'grape', 'failed']);
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
    expect(back.body).toContain('url=/settings/todoist?connected=1');
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
