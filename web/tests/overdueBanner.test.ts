// The overdue banner's rules, as tables: which tasks an arrival lists for what this browser has
// shown, their order, four and "and N more", the words for when each was due, which titles return
// to Today on the way out and how long it lasts, and the record of what's shown, which keeps a task
// by its due and drops what's past the 30 days.
import type {ItemOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import type {Overdue} from '../src/logic/overdue.ts';
import {addShown, arrivalTasks, bannerRange, dueLine, exitLength, exitSplit, listed, readShown, shortDue, shownKey} from '../src/logic/overdueBanner.ts';

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

describe('which tasks an arrival lists, and in what order', () => {
  const eight = timed('2026-10-07', '2026-10-07T15:00:00.000Z', 'Today 8:00 AM');
  const sevenThirty = timed('2026-10-07', '2026-10-07T14:30:00.000Z', 'Today 7:30 AM');
  const yesterday = untimed('2026-10-06', 'Yesterday');
  const yesterdayFive = timed('2026-10-06', '2026-10-07T00:00:00.000Z', 'Yesterday 5:00 PM');
  const monday = untimed('2026-10-05', 'Monday');
  const sep = untimed('2026-09-24', 'Sep 24');
  test.each([
    ['nothing shown: all, the most recently due first', [sep, monday, eight, yesterday, sevenThirty], [], ['Today 8:00 AM', 'Today 7:30 AM', 'Yesterday', 'Monday', 'Sep 24']],
    ['an untimed task falls due as its day ends, after that day\'s timed ones', [yesterdayFive, yesterday], [], ['Yesterday', 'Yesterday 5:00 PM']],
    ['the shown ones are left out', [eight, monday, sep], [shownKey(monday)], ['Today 8:00 AM', 'Sep 24']],
    ['all of them shown: none', [eight, monday], [shownKey(eight), shownKey(monday)], []],
    ['a task rescheduled and missed again is new', [{...monday, due_date: '2026-10-06'}], [shownKey(monday)], ['Monday']],
    ['a timed task moved to another time is new', [{...eight, due_at: '2026-10-07T15:30:00.000Z'}], [shownKey(eight)], ['Today 8:00 AM']],
  ])('%s', (_name, tasks, shown, expected) => {
    expect(titles(arrivalTasks(overdue(...tasks), new Set(shown), SEED_TIME_ZONE))).toEqual(expected);
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

describe('the load looks 30 days back through today', () => {
  test('from Sep 7 to Oct 8, `to` exclusive', () => {
    expect(bannerRange(now, SEED_TIME_ZONE)).toEqual({from: '2026-09-07', to: '2026-10-08'});
  });
});

describe('the record of what\'s shown', () => {
  test.each([
    ['nothing stored', null, []],
    ['a list of keys', '["4@2026-10-05","9@2026-10-07T15:00:00.000Z"]', ['4@2026-10-05', '9@2026-10-07T15:00:00.000Z']],
    ['not JSON', 'nope', []],
    ['not a list', '{"4": true}', []],
    ['what isn\'t a key is left out', '["4@2026-10-05", 7, null]', ['4@2026-10-05']],
  ])('reads back: %s', (_name, stored, expected) => {
    expect(readShown(stored)).toEqual(expected);
  });

  test.each([
    ['adds the shown keys once each', ['4@2026-10-05'], ['4@2026-10-05', '9@2026-10-07T15:00:00.000Z'], ['4@2026-10-05', '9@2026-10-07T15:00:00.000Z']],
    ['keeps a task due on the window\'s first day', ['1@2026-09-07'], ['2@2026-10-06'], ['1@2026-09-07', '2@2026-10-06']],
    ['drops a task due before the 30 days', ['1@2026-09-06', '3@2026-09-01T16:00:00.000Z'], ['2@2026-10-06'], ['2@2026-10-06']],
    ['drops what it can\'t read a due from', ['1@nothing', 'junk'], ['2@2026-10-06'], ['2@2026-10-06']],
  ])('%s', (_name, stored, keys, expected) => {
    expect(addShown(stored, keys, now, SEED_TIME_ZONE)).toEqual(expected);
  });
});
