// The overdue banner's rules, as tables: the order an arrival lists its tasks in, four and "and N
// more", the words for when each was due, which titles return to Today on the way out and how
// long it lasts, and the snooze: when each preset ends, which tasks it holds off, and which
// snoozes a browser keeps.
import type {ItemOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import type {Overdue} from '../src/logic/overdue.ts';
import {arrivalTasks, bannerRange, dueLine, exitLength, exitSplit, inCooldown, isSnoozed, keptSnoozes, listed, shortDue, snoozeFor, snoozeUntil} from '../src/logic/overdueBanner.ts';
import type {Snooze, SnoozeChoice} from '../src/logic/overdueBanner.ts';

let nextId = 1;
function item(fields: Partial<ItemOut>): ItemOut {
  const id = nextId++;
  return {
    key: String(id), id, calendar_id: 1, kind: 'task', title: `Task ${id}`, time_zone: SEED_TIME_ZONE, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, can_reopen: false, command: null, read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: 'opaque', description: null, subtasks: [], parent_id: null,
    all_day: true, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: null, due_at: null, ...fields,
  };
}
const untimed = (due: string, title?: string) => item({due_date: due, ...(title ? {title} : {})});
const timed = (due: string, at: string, title?: string) => item({due_date: due, due_at: at, ...(title ? {title} : {})});
const overdue = (...items: ItemOut[]): Overdue[] => items.map(one => ({item: one, today: one.due_date === '2026-10-07'}));
const titles = (tasks: Overdue[]) => tasks.map(task => task.item.title);

// The seed's clock: 9:12 AM Pacific on Wed, Oct 7 (16:12Z).
const now = Date.parse(SEED_NOW);

describe('an arrival lists every overdue task, the most recently due first', () => {
  const eight = timed('2026-10-07', '2026-10-07T15:00:00.000Z', 'Today 8:00 AM');
  const sevenThirty = timed('2026-10-07', '2026-10-07T14:30:00.000Z', 'Today 7:30 AM');
  const yesterday = untimed('2026-10-06', 'Yesterday');
  const yesterdayFive = timed('2026-10-06', '2026-10-07T00:00:00.000Z', 'Yesterday 5:00 PM');
  const monday = untimed('2026-10-05', 'Monday');
  const sep = untimed('2026-09-24', 'Sep 24');
  test.each([
    ['all of them, the most recently due first', [sep, monday, eight, yesterday, sevenThirty], ['Today 8:00 AM', 'Today 7:30 AM', 'Yesterday', 'Monday', 'Sep 24']],
    ['an untimed task falls due as its day ends, after that day\'s timed ones', [yesterdayFive, yesterday], ['Yesterday', 'Yesterday 5:00 PM']],
    ['none overdue: none', [], []],
  ])('%s', (_name, tasks, expected) => {
    expect(titles(arrivalTasks(overdue(...tasks), SEED_TIME_ZONE))).toEqual(expected);
  });
});

describe('several tasks list four, then "and N more"', () => {
  test.each([
    [2, 2, 0],
    [4, 4, 0],
    [5, 4, 1],
    [7, 4, 3],
  ])('%i tasks: %i listed and %i more', (count, shown, more) => {
    const result = listed(Array.from({length: count}, (_, index) => index));
    expect(result.listed).toEqual(Array.from({length: shown}, (_, index) => index));
    expect(result.more).toBe(more);
  });
});

describe('on the way out, the titles due today return and the rest fade', () => {
  const today = (title: string) => timed('2026-10-07', '2026-10-07T15:00:00.000Z', title);
  const earlier = (title: string) => untimed('2026-10-05', title);
  test.each([
    ['one task due today: it returns', [today('A')], ['A'], []],
    ['one task from an earlier day: it fades', [earlier('A')], [], ['A']],
    ['four, one due today', [today('A'), earlier('B'), earlier('C'), earlier('D')], ['A'], ['B', 'C', 'D']],
    ['four, two due today', [today('A'), today('B'), earlier('C'), earlier('D')], ['A', 'B'], ['C', 'D']],
    ['four, none due today', [earlier('A'), earlier('B'), earlier('C'), earlier('D')], [], ['A', 'B', 'C', 'D']],
    ['six: those under "and 2 more" do neither', [earlier('A'), earlier('B'), earlier('C'), earlier('D'), today('E'), today('F')], [], ['A', 'B', 'C', 'D']],
  ])('%s', (_, tasks, returning, fading) => {
    const split = exitSplit(overdue(...tasks));
    expect(titles(split.returning)).toEqual(returning);
    expect(titles(split.fading)).toEqual(fading);
  });

  test.each([
    ['nothing returns: until the veil has gone', 0, false, 420],
    ['one to its line: it lands at 420, its tint 420 more', 1, false, 840],
    ['two to their lines, 50 ms apart', 2, false, 890],
    ['one to the icon: its tint 1200 more', 1, true, 1620],
    ['two to the icon', 2, true, 1670],
  ])('%s', (_, flying, toIcon, length) => {
    expect(exitLength(flying, toIcon)).toBe(length);
  });
});

describe('when each was due', () => {
  test.each([
    ['timed, earlier today', timed('2026-10-07', '2026-10-07T15:00:00.000Z'), 'Due today, 8:00 AM', '8:00 AM'],
    ['timed, yesterday evening', timed('2026-10-06', '2026-10-07T00:00:00.000Z'), 'Due yesterday, 5:00 PM', 'Yesterday'],
    ['untimed, yesterday', untimed('2026-10-06'), 'Due yesterday', 'Yesterday'],
    ['untimed, Monday this week', untimed('2026-10-05'), 'Due Monday', 'Mon'],
    ['timed, Thursday last week', timed('2026-10-01', '2026-10-01T16:00:00.000Z'), 'Due Thursday, 9:00 AM', 'Thu'],
    ['untimed, a week ago', untimed('2026-09-30'), 'Due Sep 30', 'Sep 30'],
    ['untimed, last month', untimed('2026-09-13'), 'Due Sep 13', 'Sep 13'],
  ])('%s', (_name, task, line, short) => {
    expect(dueLine(task, now, SEED_TIME_ZONE)).toBe(line);
    expect(shortDue(task, now, SEED_TIME_ZONE)).toBe(short);
  });

  test('a date from another year has its year', () => {
    const newYear = Date.parse('2027-01-03T18:00:00.000Z');
    expect(dueLine(untimed('2026-12-20'), newYear, SEED_TIME_ZONE)).toBe('Due Dec 20, 2026');
    expect(shortDue(untimed('2026-12-20'), newYear, SEED_TIME_ZONE)).toBe('Dec 20, 2026');
  });

  test('a timed task late in the evening is due on its day in the user\'s zone, not UTC\'s', () => {
    // 10:00 PM Pacific on Oct 5 is 05:00Z on Oct 6.
    expect(dueLine(timed('2026-10-05', '2026-10-06T05:00:00.000Z'), now, SEED_TIME_ZONE)).toBe('Due Monday, 10:00 PM');
  });
});

describe('the load looks back Settings › Tasks\' days through today, `to` exclusive', () => {
  test.each([
    [1, '2026-10-06'],
    [3, '2026-10-04'],
    [30, '2026-09-07'],
  ])('%i days: from %s to Oct 8', (days, from) => {
    expect(bannerRange(now, SEED_TIME_ZONE, days)).toEqual({from, to: '2026-10-08'});
  });
});

describe('a snooze ends at its preset', () => {
  const at = (iso: string) => Date.parse(iso);
  test.each<[string, SnoozeChoice, string, string | null, string]>([
    ['1 hour', 'hour', '2026-10-07T16:12:00.000Z', null, '2026-10-07T17:12:00.000Z'],
    ['3 hours', 'threeHours', '2026-10-07T16:12:00.000Z', null, '2026-10-07T19:12:00.000Z'],
    ['3 hours, late in the evening: past midnight', 'threeHours', '2026-10-08T05:30:00.000Z', null, '2026-10-08T08:30:00.000Z'],
    ['Tomorrow, at the Settings task time', 'tomorrow', '2026-10-07T16:12:00.000Z', '08:30', '2026-10-08T15:30:00.000Z'],
    ['Tomorrow, with no task time: at the untimed default, 9:00 AM', 'tomorrow', '2026-10-07T16:12:00.000Z', null, '2026-10-08T16:00:00.000Z'],
    ['Tomorrow, picked at 11:50 PM: the next morning', 'tomorrow', '2026-10-08T06:50:00.000Z', null, '2026-10-08T16:00:00.000Z'],
    ['Tomorrow, picked just after midnight: the day after the one begun', 'tomorrow', '2026-10-08T07:10:00.000Z', null, '2026-10-09T16:00:00.000Z'],
    ['Tomorrow, across the clock change: 9:00 AM in standard time', 'tomorrow', '2026-10-31T16:12:00.000Z', null, '2026-11-01T17:00:00.000Z'],
  ])('%s', (_name, choice, now, taskTime, until) => {
    expect(snoozeUntil(choice, at(now), taskTime, SEED_TIME_ZONE)).toBe(at(until));
  });
});

describe('a snooze holds a task and its due until it ends', () => {
  const task = timed('2026-10-07', '2026-10-07T15:00:00.000Z', 'Call the landlord');
  const errand = untimed('2026-10-05', 'Return the drill');
  const snoozes: Snooze[] = [snoozeFor(task, now + 3_600_000), snoozeFor(errand, now + 60_000)];
  test.each([
    ['a timed task, before its snooze ends: held', task, now, true],
    ['an untimed task, by its date: held', errand, now, true],
    ['as its snooze ends: back', errand, now + 60_000, false],
    ['rescheduled to a new time: back, as a new task', {...task, due_at: '2026-10-07T15:30:00.000Z'}, now, false],
    ['rescheduled to another day: back', {...errand, due_date: '2026-10-06'}, now, false],
    ['another task: not held', untimed('2026-10-05', 'Pay the water bill'), now, false],
  ])('%s', (_name, item, at, held) => {
    expect(isSnoozed(item, snoozes, at)).toBe(held);
  });
});

describe('a browser keeps a snooze while its task is still overdue with that due, until it ends', () => {
  const task = timed('2026-10-07', '2026-10-07T15:00:00.000Z', 'Call the landlord');
  const snooze = snoozeFor(task, now + 3_600_000);
  test.each([
    ['still overdue, before its end: kept', [task], now, true],
    ['ended: dropped', [task], now + 3_600_000, false],
    ['rescheduled: dropped', [{...task, due_at: '2026-10-07T15:30:00.000Z'}], now, false],
    ['completed: dropped', [{...task, done: true}], now, false],
    ['gone from the items (moved past today, or deleted): dropped', [], now, false],
    ['its completion still on its way: kept, as the change may yet fail', [{...task, command: {state: 'pending'} as ItemOut['command']}], now, true],
  ])('%s', (_name, items, at, kept) => {
    expect(keptSnoozes([snooze], items, at)).toEqual(kept ? [snooze] : []);
  });
});

describe('arrivals stay quiet for the banner\'s pause after it was last on screen', () => {
  test.each([
    ['never on screen: shows', null, now, 5, false],
    ['just left: quiet', now, now, 5, true],
    ['4 minutes 59 after: quiet', now, now + 299_000, 5, true],
    ['5 minutes after: shows', now, now + 300_000, 5, false],
    ['15 minutes\' pause, 10 after: quiet', now, now + 600_000, 15, true],
    ['no pause, just left: shows', now, now, 0, false],
    ['the clock gone back before it: shows', now, now - 60_000, 5, false],
  ])('%s', (_name, seen, at, minutes, quiet) => {
    expect(inCooldown(seen, at, minutes)).toBe(quiet);
  });
});

