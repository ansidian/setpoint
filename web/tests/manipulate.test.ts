// F6's pure rules as tables: recurring scope and its consequences (boards 14 and 15b), overlaps
// (the editor's conflict preview, board 13, and the agenda's line, board 12b), and direct
// manipulation (drop targets and their tooltip, board 15; clone, copy and paste; multi-select; the
// failed card's lines, board 19b), with v1's quick-action and deadline cases carried over (darma SV-15).
import type {CommandOut, ItemOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {agendaOverlap, conflictLine, overlapsWith, shortDuration, spanOf, timelineLabels, timelineWindow} from '../src/logic/conflict.ts';
import {asRetried, canMove, copyOf, dropChange, dropLabel, edgeScroll, deletes, failedFrom, failedTitle, inverseOf, pasteOn, pendingItem, selectWith, withCreating} from '../src/logic/manipulate.ts';
import type {Creating} from '../src/logic/manipulate.ts';
import {calendarMoveChoices, moveLine, scopeChoices} from '../src/logic/scope.ts';

const zone = SEED_TIME_ZONE;
// Pacific daylight time until Nov 1, 2026; standard time after.
const at = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00${date >= '2026-11-01' ? '-08:00' : '-07:00'}`)).toISOString();
let nextId = 1;
const item = (fields: Partial<ItemOut>): ItemOut => {
  const id = nextId++;
  return {
    key: String(id), id, calendar_id: 1, kind: 'event', title: 'Item', time_zone: zone, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [10], leave_reminder: false, project: null, done: false, done_at: null, command: null,
    all_day: false, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: null, due_at: null, read_only: false, due_string: null,
    time_to_leave: null, colour: null, labels: [], repeat: null, ...fields,
  };
};
const event = (title: string, date: string, start: string, end: string, fields: Partial<ItemOut> = {}) => item({title, starts_at: at(date, start), ends_at: at(date, end), ...fields});
const task = (title: string, due: string, fields: Partial<ItemOut> = {}) => item({kind: 'task', title, all_day: true, due_date: due, calendar_id: 4, reminders: [], ...fields});
const command = (fields: Partial<CommandOut>): CommandOut => ({
  id: 1, target: 'item', target_id: 1, kind: 'item_update', state: 'failed', provider: 'google_calendar', provider_message: 'No.', can_retry: true, can_move_back: true,
  previous: null, created_at: at('2026-10-07', '09:05'), settled_at: at('2026-10-07', '09:06'), ...fields,
});

const gym = event('Gym', '2026-10-07', '07:00', '08:00', {recurring: true, recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', occurrence_start: at('2026-10-07', '07:00')});
const study = event('Study group', '2026-10-09', '18:30', '20:30');
const dinner = event('Dinner with Sam', '2026-10-09', '19:00', '21:00', {place: 'Blue Door', address: '2118 Sunset Blvd'});

describe('recurring scope (DESIGN.md › Recurring events)', () => {
  test('board 15b: Gym dropped from Wed, Oct 7 on Thu, Oct 8', () => {
    expect(scopeChoices('2026-10-07', '2026-10-08')).toEqual([
      {scope: 'this', label: 'This event', line: 'Thu, Oct 8 only'},
      {scope: 'following', label: 'This and following', line: 'Wed → Thu from Oct 7 on'},
      {scope: 'all', label: 'All events', line: 'Wed → Thu, past ones too'},
    ]);
    expect(moveLine('Gym', '2026-10-07', '2026-10-08', at('2026-10-08', '07:00'), zone)).toBe('Gym · Wed, Oct 7 → Thu, Oct 8 · 7:00 AM');
  });
  test('board 14: Gym on Wed, Oct 7 at another time, the same day', () => {
    expect(scopeChoices('2026-10-07', '2026-10-07').map(choice => choice.line)).toEqual(['Wed, Oct 7 only', 'From Wed, Oct 7 on', 'Past ones too']);
  });
  test.each([
    // A week later on the same weekday keeps it.
    ['2026-10-07', '2026-10-14', ['Wed, Oct 14 only', 'From Wed, Oct 7 on', 'Past ones too']],
    ['2026-10-09', '2026-10-05', ['Mon, Oct 5 only', 'Fri → Mon from Oct 9 on', 'Fri → Mon, past ones too']],
  ])('%s → %s', (from, to, lines) => expect(scopeChoices(from, to).map(choice => choice.line)).toEqual(lines));
  test('an all-day or task move has no time', () => expect(moveLine('Trip', '2026-10-07', '2026-10-08', null, zone)).toBe('Trip · Wed, Oct 7 → Thu, Oct 8'));
  test('F6b: to another calendar, Google moves a series, never one occurrence', () => {
    expect(calendarMoveChoices('2026-10-07', 'Classes')).toEqual([
      {scope: 'following', label: 'This and following', line: 'To Classes from Oct 7 on'},
      {scope: 'all', label: 'All events', line: 'To Classes, past ones too'},
    ]);
  });
});

describe('overlaps (the conflict preview)', () => {
  const friday = [event('Gym', '2026-10-09', '07:00', '08:00'), study, task('Laundry', '2026-10-09'), item({title: 'Trip', all_day: true, start_date: '2026-10-09', end_date: '2026-10-10'})];
  const span = (start: string, end: string) => ({start: Date.parse(at('2026-10-09', start)), end: Date.parse(at('2026-10-09', end))});
  test.each([
    ['board 13: Dinner 7 – 9 PM', span('19:00', '21:00'), 'Overlaps Study group · 1h 30m'],
    ['inside it', span('19:00', '19:45'), 'Overlaps Study group · 45m'],
    ['touching its end', span('20:30', '21:30'), 'No conflicts'],
    ['touching its start', span('17:30', '18:30'), 'No conflicts'],
    ['covering both', span('06:00', '22:00'), 'Overlaps Gym and 1 more · 1h'],
    // All-day events and tasks take no time.
    ['the morning', span('09:00', '10:00'), 'No conflicts'],
  ])('%s', (_, draft, line) => expect(conflictLine(overlapsWith(draft, friday)).text).toBe(line));
  test('an event doesn\'t overlap itself', () => expect(overlapsWith(spanOf(study)!, [study], study.key)).toEqual([]));
  test.each([[90 * 60_000, '1h 30m'], [45 * 60_000, '45m'], [2 * 3600_000, '2h']])('%i ms is %s', (ms, text) => expect(shortDuration(ms)).toBe(text));
  const h = (hour: number, minute = 0) => hour * 60 + minute;
  test.each([
    ['board 13: Dinner and Study group, 6 PM – 10 PM', [{start: h(19), end: h(21)}, {start: h(18, 30), end: h(20, 30)}], {from: h(18), to: h(22)}],
    ['board 14: Gym at 6:30, 5 AM – 9 AM', [{start: h(6, 30), end: h(7, 30)}], {from: h(5), to: h(9)}],
    ['a long day widens it', [{start: h(9), end: h(15, 30)}], {from: h(9), to: h(16)}],
    ['just after midnight', [{start: h(0, 30), end: h(1)}], {from: h(-1), to: h(3)}],
  ])('%s', (_, spans, window) => expect(timelineWindow(spans)).toEqual(window));
  test('the axis: the ends with AM or PM', () => {
    expect(timelineLabels({from: h(18), to: h(22)})).toEqual([
      {at: 0, label: '6 PM'}, {at: 0.25, label: '7'}, {at: 0.5, label: '8'}, {at: 0.75, label: '9'}, {at: 1, label: '10 PM'},
    ]);
    expect(timelineLabels({from: h(5), to: h(9)}).map(label => label.label)).toEqual(['5 AM', '6', '7', '8', '9 AM']);
  });
  test('the agenda: an event that starts during another says so (board 12b); the other says nothing', () => {
    expect(agendaOverlap(dinner, [study, dinner], zone)).toBe('Overlaps Study group until 8:30 PM');
    expect(agendaOverlap(study, [study, dinner], zone)).toBeNull();
    const short = event('Call', '2026-10-09', '19:00', '19:30');
    expect(agendaOverlap(short, [study, short], zone)).toBe('Overlaps Study group until 7:30 PM');
    expect(agendaOverlap(task('Laundry', '2026-10-09'), [study], zone)).toBeNull();
  });
});

describe('dropping on another day (board 15; v1\'s reschedule and deadline models)', () => {
  test.each([
    ['Gym Wed → Thu keeps 7 AM', gym, '2026-10-08', {starts_at: at('2026-10-08', '07:00'), ends_at: at('2026-10-08', '08:00')}],
    ['back a week', dinner, '2026-10-02', {starts_at: at('2026-10-02', '19:00'), ends_at: at('2026-10-02', '21:00')}],
    // v1's DST fix: across the change on Nov 1 the wall-clock time stays.
    ['across daylight saving', event('Late', '2026-10-31', '23:00', '23:30'), '2026-11-02', {starts_at: at('2026-11-02', '23:00'), ends_at: at('2026-11-02', '23:30')}],
    ['into the next day', event('Show', '2026-10-09', '22:00', '01:00', {ends_at: at('2026-10-10', '01:00')}), '2026-10-10', {starts_at: at('2026-10-10', '22:00'), ends_at: at('2026-10-11', '01:00')}],
    ['all day, two days', item({all_day: true, start_date: '2026-10-09', end_date: '2026-10-11'}), '2026-10-12', {start_date: '2026-10-12', end_date: '2026-10-14'}],
    // Tasks move by whole days and keep a time they have.
    ['a task', task('Pay rent', '2026-10-07'), '2026-10-09', {due_date: '2026-10-09'}],
    ['a timed task', task('Call', '2026-10-07', {due_at: at('2026-10-07', '17:00')}), '2026-10-08', {due_date: '2026-10-08', due_at: at('2026-10-08', '17:00')}],
  ])('%s', (_, one, to, change) => expect(dropChange(one, to, zone)).toEqual(change));
  test('a drop on its own day does nothing (v1)', () => {
    expect(dropChange(gym, '2026-10-07', zone)).toBeNull();
    expect(dropChange(task('Pay rent', '2026-10-07'), '2026-10-07', zone)).toBeNull();
  });
  test.each([
    ['an event', gym, true],
    ['a task', task('Pay rent', '2026-10-07'), true],
    // v1's deadline rule: a repeating task would move its whole pattern (and Todoist refuses, D16); a done one stays.
    ['a repeating task', task('Water plants', '2026-10-07', {recurring: true, due_string: 'every wed'}), false],
    ['a done task', task('Return library books', '2026-10-05', {done: true}), false],
    ['Google\'s own kind', item({title: 'Birthday', all_day: true, start_date: '2026-10-20', end_date: '2026-10-21', read_only: true}), false],
    ['one whose change is waiting', event('Moving', '2026-10-07', '10:00', '11:00', {command: command({state: 'pending'})}), false],
    ['one whose change failed', event('Stuck', '2026-10-07', '10:00', '11:00', {command: command({})}), false],
  ])('%s can move: %s', (_, one, can) => expect(canMove(one)).toBe(can));
  test.each([
    ['board 15', gym, '2026-10-08', 'Thu, Oct 8 · 7:00 AM'],
    ['all day', item({all_day: true, start_date: '2026-10-09', end_date: '2026-10-10'}), '2026-10-12', 'Mon, Oct 12 · All day'],
    ['a task', task('Pay rent', '2026-10-07'), '2026-10-09', 'Fri, Oct 9'],
  ])('tooltip, %s', (_, one, to, label) => expect(dropLabel(one, to, zone)).toBe(label));
});

describe('F6b: a drag held near the grid\'s top or bottom edge scrolls it', () => {
  // The grid from 30 to 1000 in the section's CSS pixels; a 48 px band each side, up to 18 px a frame.
  test.each([
    ['in the middle', 500, 0],
    ['just inside the top band', 77, -1],
    ['halfway into the top band', 54, -9],
    ['at the top edge', 30, -18],
    ['above the grid (the weekday row)', 10, -18],
    ['just outside the bottom band', 952, 0],
    ['halfway into the bottom band', 976, 9],
    ['past the bottom edge', 1040, 18],
  ])('%s', (_, pointer, step) => expect(edgeScroll(pointer, 30, 1000)).toBe(step));
});

describe('clone, copy and paste (v1\'s clone and clipboard payloads)', () => {
  test('a clone of one Gym is an event of its own on the same day, with its reminders, Time to Leave and colour', () => {
    expect(copyOf({...gym, colour: 'good', leave_reminder: true}, 0, zone)).toEqual({
      kind: 'event', calendar_id: 1, title: 'Gym', all_day: false, starts_at: at('2026-10-07', '07:00'), ends_at: at('2026-10-07', '08:00'),
      start_date: null, end_date: null, due_date: null, due_at: null, time_zone: zone, recurrence: null, place: null, address: null, attendees: [],
      reminders: [10], leave_reminder: true, project: null, colour: 'good',
    });
  });
  test('a task\'s copy keeps its project', () => expect(copyOf(task('Pay rent', '2026-10-07', {project: 'Home'}), 2, zone)).toMatchObject({kind: 'task', due_date: '2026-10-09', project: 'Home', colour: null}));
  test('pasting: the first copied day lands on the day pasted on; the others keep their distance', () => {
    const pasted = pasteOn([dinner, gym, task('Pay rent', '2026-10-07')], '2026-10-14', zone);
    expect(pasted.map(input => [input.title, input.starts_at ?? input.due_date])).toEqual([
      ['Dinner with Sam', at('2026-10-16', '19:00')], ['Gym', at('2026-10-14', '07:00')], ['Pay rent', '2026-10-14'],
    ]);
    expect(pasteOn([], '2026-10-14', zone)).toEqual([]);
  });
});

describe('a create drawn at once, and ⌘Z', () => {
  test('a pasted copy is drawn pending on its day, unselectable, before the server answers', () => {
    const [input] = pasteOn([dinner], '2026-10-14', zone);
    const drawn = pendingItem(input!, -3, at('2026-10-07', '09:12'));
    expect(drawn).toMatchObject({key: 'new:3', id: -3, title: 'Dinner with Sam', starts_at: at('2026-10-14', '19:00'), place: 'Blue Door', recurring: false, done: false, read_only: false});
    expect(drawn.command).toMatchObject({kind: 'item_create', state: 'pending'});
    expect(canMove(drawn)).toBe(false);
  });
  test('a task with a Todoist repeat is drawn repeating', () => {
    const input = {...copyOf(task('Water plants', '2026-10-07'), 0, zone), repeat: 'every mon'};
    expect(pendingItem(input, -1, at('2026-10-07', '09:12'))).toMatchObject({recurring: true, due_string: 'every mon', reminders: []});
  });
  describe('Try again draws the change pending at once (SV-42)', () => {
    const failure = command({id: 7, kind: 'item_update', state: 'failed', settled_at: at('2026-10-07', '09:06')});
    const failedDinner = {...dinner, command: failure};
    test.each<[string, ItemOut, ReadonlyMap<number, string | null>, string | undefined]>([
      ['not retried: failed', failedDinner, new Map(), 'failed'],
      ['retried, the server still lists the failure: pending', failedDinner, new Map([[7, failure.settled_at]]), 'pending'],
      ['retried, now pending on the server: as listed', {...dinner, command: {...failure, state: 'pending', settled_at: null}}, new Map([[7, failure.settled_at]]), 'pending'],
      ['retried and refused again: failed', {...dinner, command: {...failure, settled_at: at('2026-10-07', '09:20')}}, new Map([[7, failure.settled_at]]), 'failed'],
      ['another change retried: failed', failedDinner, new Map([[8, failure.settled_at]]), 'failed'],
    ])('%s', (_name, one, retried, state) => expect(asRetried(one, retried).command?.state).toBe(state));
    test('pending, it offers nothing and says nothing until the provider answers', () => {
      expect(asRetried(failedDinner, new Map([[7, failure.settled_at]])).command).toMatchObject({provider_message: null, can_retry: false, can_move_back: false});
    });
  });
  describe('a create on its way is drawn once', () => {
    const lunch = event('Lunch with Jo', '2026-10-08', '12:00', '13:30');
    const draft = pendingItem(copyOf(lunch, 0, zone), -1, at('2026-10-07', '09:12'));
    const copy = {...lunch, command: command({kind: 'item_create', state: 'pending', target_id: lunch.id})};
    const listed = new Set([study.id, dinner.id]);
    test.each<[string, ItemOut[], Creating[], number[]]>([
      ['nothing on its way', [study, dinner], [], [study.id, dinner.id]],
      ['waiting: its draft', [study, dinner], [{drafts: [draft], listed}], [study.id, dinner.id, -1]],
      ['waiting, the server\'s copy listed already: still only its draft', [study, dinner, copy], [{drafts: [draft], listed}], [study.id, dinner.id, -1]],
      ['answered: the server\'s own', [study, dinner, copy], [{drafts: [draft], listed, made: [lunch.id]}], [study.id, dinner.id, lunch.id]],
      ['waiting, the server\'s copy already confirmed: still only its draft', [study, dinner, lunch], [{drafts: [draft], listed}], [study.id, dinner.id, -1]],
      ['a twin that was listed already stays', [study, dinner, lunch], [{drafts: [draft], listed: new Set([study.id, dinner.id, lunch.id])}], [study.id, dinner.id, lunch.id, -1]],
      ['a new item that isn\'t a draft stays', [study, dinner, {...lunch, title: 'Lunch with Ana'}], [{drafts: [draft], listed}], [study.id, dinner.id, lunch.id, -1]],
      ['nor one at another time', [study, dinner, {...lunch, starts_at: at('2026-10-08', '12:30')}], [{drafts: [draft], listed}], [study.id, dinner.id, lunch.id, -1]],
      ['another create answered while this one waits: its item stays', [study, dinner, copy], [{drafts: [], listed, made: [lunch.id]}, {drafts: [draft], listed}], [study.id, dinner.id, lunch.id, -1]],
    ])('%s', (_name, items, creating, ids) => expect(withCreating(items, creating).map(one => one.id)).toEqual(ids));
  });
  test.each([
    ['a single event', {id: dinner.id, scope: 'this', occurrence_start: null}, dinner, true],
    ['another event', {id: dinner.id, scope: 'this', occurrence_start: null}, study, false],
    ['this Gym only', {id: gym.id, scope: 'this', occurrence_start: gym.occurrence_start}, gym, true],
    ['not Friday\'s Gym', {id: gym.id, scope: 'this', occurrence_start: gym.occurrence_start}, {...gym, occurrence_start: at('2026-10-09', '07:00')}, false],
    ['and following: Friday\'s', {id: gym.id, scope: 'following', occurrence_start: gym.occurrence_start}, {...gym, occurrence_start: at('2026-10-09', '07:00')}, true],
    ['and following: not Monday\'s before it', {id: gym.id, scope: 'following', occurrence_start: gym.occurrence_start}, {...gym, occurrence_start: at('2026-10-05', '07:00')}, false],
    ['all: Monday\'s too', {id: gym.id, scope: 'all', occurrence_start: gym.occurrence_start}, {...gym, occurrence_start: at('2026-10-05', '07:00')}, true],
  ] as const)('a delete takes %s off the grid at once', (_name, entry, one, gone) => expect(deletes(entry, one)).toBe(gone));
  test.each([
    ['a move', dinner, dropChange(dinner, '2026-10-10', zone)!, {starts_at: dinner.starts_at, ends_at: dinner.ends_at}],
    ['a colour', dinner, {colour: 'good'}, {colour: null}],
    ['an edit', dinner, {title: 'Dinner', place: null}, {title: 'Dinner with Sam', place: 'Blue Door'}],
  ] as const)('%s puts back what it changed, and only that', (_name, before, changes, back) => expect(inverseOf(before, changes)).toEqual(back));
});

describe('multi-select', () => {
  test.each([
    [[], '1', false, ['1']],
    [['1'], '2', false, ['2']],
    [['1'], '2', true, ['1', '2']],
    [['1', '2'], '1', true, ['2']],
    [['1', '2'], '3', false, ['3']],
    [[], '1', true, ['1']],
  ])('%j, click %s (adding: %s) → %j', (selected, key, additive, after) => expect(selectWith(selected, key, additive)).toEqual(after));
});

describe('the failed card (board 19b)', () => {
  const moved = {...dinner, starts_at: at('2026-10-10', '19:00'), ends_at: at('2026-10-10', '21:00'), command: command({previous: {all_day: false, starts_at: dinner.starts_at, ends_at: dinner.ends_at, start_date: null, end_date: null, due_date: null, due_at: null}})};
  test.each([
    ['moved to Saturday', moved, 'Couldn\'t move Dinner with Sam', 'From Fri, Oct 9'],
    ['later the same day', {...moved, starts_at: at('2026-10-09', '20:00'), ends_at: at('2026-10-09', '22:00')}, 'Couldn\'t move Dinner with Sam', 'From 7:00 – 9:00 PM'],
    ['renamed', {...dinner, command: command({previous: {all_day: false, starts_at: dinner.starts_at, ends_at: dinner.ends_at, start_date: null, end_date: null, due_date: null, due_at: null}})}, 'Couldn\'t change Dinner with Sam', null],
    ['created', {...dinner, command: command({kind: 'item_create'})}, 'Couldn\'t create Dinner with Sam', null],
    ['deleted', {...dinner, command: command({kind: 'item_delete'})}, 'Couldn\'t delete Dinner with Sam', null],
    ['completed', task('Pay rent', '2026-10-07', {command: command({kind: 'item_complete', provider: 'todoist'})}), 'Couldn\'t complete Pay rent', null],
  ])('%s', (_, one, title, from) => {
    expect(failedTitle(one)).toBe(title);
    expect(failedFrom(one, zone)).toBe(from);
  });
});
