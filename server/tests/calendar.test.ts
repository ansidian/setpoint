// The calendar's read queries and item changes over the seed: ranges with recurring events
// expanded, recurring scope, failures in place and Move back.
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {confirmCommand, failCommand, moveBackCommand} from '../src/commands/index.ts';
import {completeItem, createItem, deleteItem, updateItem} from '../src/commands/items.ts';
import * as t from '../src/db/schema.ts';
import {zoned} from '../src/dev/sample.ts';
import {calendarList, itemsInRange, weatherDays} from '../src/queries/items.ts';
import {itemCreateInput, itemScopeInput, itemUpdateInput} from '@setpoint/shared';
import {liveEvents, world} from './helpers.ts';
import type {World} from './helpers.ts';

const pacific = (iso: string | null) => (iso ? new Intl.DateTimeFormat('en-US', {timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}).format(new Date(iso)) : null);
const itemId = (w: World, title: string) => w.store.db.select().from(t.items).where(eq(t.items.title, title)).get()!.id;
const day = (w: World, date: string) => itemsInRange(w.store, date, new Date(Date.parse(`${date}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)).items;
const titles = (w: World, date: string) => day(w, date).map(item => `${item.kind === 'task' ? (item.done ? '● ' : '○ ') : ''}${item.title}${item.starts_at ? ` ${pacific(item.starts_at)!.split(', ').at(-1)}` : ''}`);

describe('items in a range', () => {
  test('Wed, Oct 7: the tasks, Gym, Dentist', () => {
    const w = world({seed: true});
    expect(titles(w, '2026-10-07')).toEqual(['○ CS 101 lab report', '○ Pay rent', 'Gym 7:00 AM', 'Dentist 2:30 PM']);
  });

  test('Fri, Oct 9: Gym, Study group overlapping Dinner with Sam', () => {
    const w = world({seed: true});
    expect(titles(w, '2026-10-09')).toEqual(['Gym 7:00 AM', 'Study group 6:30 PM', 'Dinner with Sam 7:00 PM']);
  });

  test('October: each recurring occurrence keyed by its start, Gym at 7 AM across the DST change', () => {
    const w = world({seed: true});
    const october = itemsInRange(w.store, '2026-10-01', '2026-11-08').items;
    const gym = october.filter(item => item.title === 'Gym');
    // Fri Oct 2, then Mon, Wed and Fri for four weeks, then Nov 2, 4 and 6 (after the change on Nov 1).
    expect(gym).toHaveLength(16);
    expect(new Set(gym.map(item => pacific(item.starts_at)!.split(', ').at(-1)))).toEqual(new Set(['7:00 AM']));
    expect(gym[0]).toMatchObject({key: `${gym[0]!.id}@${gym[0]!.starts_at}`, occurrence_start: gym[0]!.starts_at, recurring: true});
    expect(october.filter(item => item.title === 'CS 101 lecture')).toHaveLength(11);
    expect(october.find(item => item.title === 'Return library books')).toMatchObject({done: true, due_date: '2026-10-05'});
    expect(october.find(item => item.title === 'Career fair')).toMatchObject({place: 'University Student Union', reminders: [10]});
  });

  test('the lecture stops after Thursday, Dec 3', () => {
    const w = world({seed: true});
    expect(itemsInRange(w.store, '2026-11-30', '2026-12-14').items.filter(item => item.title === 'CS 101 lecture').map(item => pacific(item.starts_at))).toEqual([
      'Tue, Dec 1, 6:00 PM', 'Thu, Dec 3, 6:00 PM',
    ]);
  });

  test('calendars and weather', () => {
    const w = world({seed: true});
    expect(calendarList(w.store).map(calendar => [calendar.name, calendar.colour, calendar.visible])).toEqual([
      ['Personal', 'cool', true], ['Classes', 'cyan', true], ['Jobs', 'violet', true], ['Todoist', null, true],
    ]);
    expect(weatherDays(w.store, '2026-10-01', '2026-11-01', true).map(day => [day.date, day.condition])).toEqual([
      ['2026-10-07', 'sun'], ['2026-10-08', 'cloud'], ['2026-10-13', 'rain'],
    ]);
    expect(weatherDays(w.store, '2026-10-01', '2026-11-01', false)).toEqual([]);
  });
});

describe('item changes', () => {
  test('creating an event shows it at once, pending, with Settings\' reminder default', () => {
    const w = world({seed: true});
    const personal = calendarList(w.store)[0]!.id;
    const command = createItem(w.store, itemCreateInput.parse({
      kind: 'event', calendar_id: personal, title: 'Coffee with Priya', starts_at: zoned('2026-10-08', '10:00'), ends_at: zoned('2026-10-08', '10:30'),
    }));
    expect(day(w, '2026-10-08').find(item => item.title === 'Coffee with Priya')).toMatchObject({reminders: [10], command: {kind: 'item_create', state: 'pending', provider: 'google_calendar'}});
    expect(liveEvents(w).at(-1)).toMatchObject({type: 'items', items: [command.targetId], calendars: [personal], commands: [command.id]});
    // Move back on a failed create removes it.
    failCommand(w.store, command.id, 'Calendar usage limits exceeded. (403)');
    moveBackCommand(w.store, command.id);
    expect(day(w, '2026-10-08').find(item => item.title === 'Coffee with Priya')).toBeUndefined();
  });

  test('board 19b: a move that fails stays at its new time with Google\'s words, then moves back', () => {
    const w = world({seed: true});
    const dinner = itemId(w, 'Dinner with Sam');
    const command = updateItem(w.store, dinner, itemUpdateInput.parse({changes: {starts_at: zoned('2026-10-10', '19:00'), ends_at: zoned('2026-10-10', '21:00')}}));
    failCommand(w.store, command.id, 'The requested event was modified by another client. (409 Conflict)');
    const moved = day(w, '2026-10-10').find(item => item.title === 'Dinner with Sam')!;
    expect(moved.command).toMatchObject({state: 'failed', provider_message: 'The requested event was modified by another client. (409 Conflict)', can_move_back: true});
    expect(pacific(moved.command!.previous!.starts_at)).toBe('Fri, Oct 9, 7:00 PM');
    expect(() => updateItem(w.store, dinner, itemUpdateInput.parse({changes: {title: 'Dinner'}}))).toThrow(/failed/);
    moveBackCommand(w.store, command.id);
    expect(titles(w, '2026-10-09')).toContain('Dinner with Sam 7:00 PM');
    expect(day(w, '2026-10-10').find(item => item.title === 'Dinner with Sam')).toBeUndefined();
  });

  test('a recurring move, This event: only Wednesday\'s Gym moves to Thursday', () => {
    const w = world({seed: true});
    const gym = itemId(w, 'Gym');
    const command = updateItem(w.store, gym, itemUpdateInput.parse({
      changes: {starts_at: zoned('2026-10-08', '07:00'), ends_at: zoned('2026-10-08', '08:00')}, scope: 'this', occurrence_start: zoned('2026-10-07', '07:00'),
    }));
    expect(titles(w, '2026-10-07')).not.toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-08')).toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-14')).toContain('Gym 7:00 AM');
    // The command is on the occurrence that moved.
    expect(day(w, '2026-10-08').find(item => item.title === 'Gym')!.command).toMatchObject({id: command.id, state: 'pending'});
    expect(day(w, '2026-10-12').find(item => item.title === 'Gym')!.command).toBeNull();
    // Move back puts it back on Wednesday.
    failCommand(w.store, command.id, 'Backend Error');
    moveBackCommand(w.store, command.id);
    expect(titles(w, '2026-10-07')).toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-08')).not.toContain('Gym 7:00 AM');
  });

  test('a recurring move, This and following: from Oct 7 on, Wednesday → Thursday', () => {
    const w = world({seed: true});
    updateItem(w.store, itemId(w, 'Gym'), itemUpdateInput.parse({
      changes: {starts_at: zoned('2026-10-08', '07:00'), ends_at: zoned('2026-10-08', '08:00')}, scope: 'following', occurrence_start: zoned('2026-10-07', '07:00'),
    }));
    expect(titles(w, '2026-09-30')).toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-05')).toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-07')).not.toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-08')).toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-14')).not.toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-15')).toContain('Gym 7:00 AM');
    expect(w.store.db.select().from(t.items).where(eq(t.items.title, 'Gym')).all().map(item => item.recurrence)).toEqual([
      'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261007T135959Z', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH,FR',
    ]);
  });

  test('a recurring move, All events: Wednesday → Thursday, past ones too', () => {
    const w = world({seed: true});
    updateItem(w.store, itemId(w, 'Gym'), itemUpdateInput.parse({
      changes: {starts_at: zoned('2026-10-08', '07:00'), ends_at: zoned('2026-10-08', '08:00')}, scope: 'all', occurrence_start: zoned('2026-10-07', '07:00'),
    }));
    expect(titles(w, '2026-09-30')).not.toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-01')).toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-05')).toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-14')).not.toContain('Gym 7:00 AM');
  });

  test('deleting waits for the provider: one occurrence, then the series', () => {
    const w = world({seed: true});
    const gym = itemId(w, 'Gym');
    const one = deleteItem(w.store, gym, itemScopeInput.parse({scope: 'this', occurrence_start: zoned('2026-10-09', '07:00')}));
    expect(day(w, '2026-10-09').find(item => item.title === 'Gym')!.command).toMatchObject({kind: 'item_delete', state: 'pending'});
    confirmCommand(w.store, one.id);
    expect(titles(w, '2026-10-09')).not.toContain('Gym 7:00 AM');
    expect(titles(w, '2026-10-12')).toContain('Gym 7:00 AM');
    const all = deleteItem(w.store, gym, itemScopeInput.parse({scope: 'all'}));
    confirmCommand(w.store, all.id);
    expect(itemsInRange(w.store, '2026-08-01', '2026-12-31').items.filter(item => item.title === 'Gym')).toEqual([]);
  });

  test('completing a task', () => {
    const w = world({seed: true});
    const rent = itemId(w, 'Pay rent');
    const command = completeItem(w.store, rent, true);
    expect(day(w, '2026-10-07').find(item => item.title === 'Pay rent')).toMatchObject({done: true, command: {kind: 'item_complete', state: 'pending', provider: 'todoist'}});
    confirmCommand(w.store, command.id);
    expect(() => completeItem(w.store, rent, true)).toThrow(/already done/);
  });

  test('events go in Google calendars, tasks in Todoist', () => {
    const w = world({seed: true});
    const todoist = calendarList(w.store).find(calendar => calendar.provider === 'todoist')!.id;
    expect(() => createItem(w.store, itemCreateInput.parse({kind: 'event', calendar_id: todoist, title: 'x', starts_at: zoned('2026-10-08', '10:00'), ends_at: zoned('2026-10-08', '11:00')}))).toThrow(/Google calendar/);
    expect(() => itemCreateInput.parse({kind: 'task', calendar_id: todoist, title: 'x', due_at: zoned('2026-10-08', '10:00')})).toThrow(/due date/);
  });

  test('SV-74: a new task may have no date, but not a time or a repeat without one; an existing task keeps its date', () => {
    const w = world({seed: true});
    const todoist = calendarList(w.store).find(calendar => calendar.provider === 'todoist')!.id;
    expect(itemCreateInput.parse({kind: 'task', calendar_id: todoist, title: 'Learn piano'})).toMatchObject({due_date: null, due_at: null});
    expect(() => createItem(w.store, itemCreateInput.parse({kind: 'task', calendar_id: todoist, title: 'Stretch', repeat: 'every day'}))).toThrow(/repeat needs a due date/);
    expect(() => updateItem(w.store, itemId(w, 'Pay rent'), itemUpdateInput.parse({changes: {due_date: null, due_at: null}}))).toThrow(/date is taken off in Todoist/);
  });
});
