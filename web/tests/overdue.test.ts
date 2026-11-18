// Which Todoist tasks are overdue, as a table: open and confirmed, a timed one once its time has
// passed, an untimed one once its day is over in the user's time zone, each saying whether it's
// due today (so it has a line in Today).
import type {ItemOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {overdueTasks} from '../src/logic/overdue.ts';

let nextId = 1;
function item(fields: Partial<ItemOut>): ItemOut {
  const id = nextId++;
  return {
    key: String(id), id, calendar_id: 1, kind: 'task', title: 'Task', time_zone: SEED_TIME_ZONE, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, can_reopen: false, command: null, read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: 'opaque', description: null, subtasks: [], parent_id: null,
    all_day: true, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: null, due_at: null, ...fields,
  };
}
const untimed = (due: string, fields: Partial<ItemOut> = {}) => item({due_date: due, ...fields});
const timed = (due: string, at: string, fields: Partial<ItemOut> = {}) => item({all_day: false, due_date: due, due_at: at, ...fields});
const pending = {command: {state: 'pending'} as ItemOut['command']};

// The seed's clock: 9:12 AM Pacific on Wed, Oct 7 (16:12Z).
const now = Date.parse(SEED_NOW);

describe('which tasks are overdue', () => {
  test.each([
    ['timed, its time passed this morning: overdue, due today', [timed('2026-10-07', '2026-10-07T15:00:00.000Z')], [true]],
    ['timed, a minute from now: not yet', [timed('2026-10-07', '2026-10-07T16:13:00.000Z')], []],
    ['timed, due this very minute: not yet', [timed('2026-10-07', SEED_NOW)], []],
    ['timed, yesterday: overdue, not today\'s', [timed('2026-10-06', '2026-10-06T22:00:00.000Z')], [false]],
    ['untimed, due today: not until tomorrow', [untimed('2026-10-07')], []],
    ['untimed, due yesterday: overdue, not today\'s', [untimed('2026-10-06')], [false]],
    ['untimed, due tomorrow: no', [untimed('2026-10-08')], []],
    ['undated: never', [item({})], []],
    ['done: never', [timed('2026-10-07', '2026-10-07T15:00:00.000Z', {done: true}), untimed('2026-10-06', {done: true})], []],
    ['pending (still waiting for Todoist): never', [timed('2026-10-07', '2026-10-07T15:00:00.000Z', pending), untimed('2026-10-06', pending)], []],
    ['an event that has ended: never, only tasks', [item({kind: 'event', all_day: false, starts_at: '2026-10-07T14:00:00.000Z', ends_at: '2026-10-07T15:00:00.000Z'})], []],
    // A repeating task is one open row at its current due; its completed occurrences are rows of their own.
    ['repeating, its done occurrence yesterday and the open one this morning: the open one alone', [
      untimed('2026-10-06', {recurring: true, repeat: 'every day', done: true, done_at: '2026-10-06T18:00:00.000Z'}),
      timed('2026-10-07', '2026-10-07T15:00:00.000Z', {recurring: true, repeat: 'every day'}),
    ], [true]],
    // A subtask with its own date is listed as an item, so it counts in its own right.
    ['a dated subtask, due yesterday: overdue in its own right', [untimed('2026-10-06', {parent_id: 7})], [false]],
  ])('%s', (_name, items, expected) => {
    expect(overdueTasks(items, now, SEED_TIME_ZONE).map(one => one.today)).toEqual(expected);
  });

  // The day's boundary is the user's zone's midnight, not UTC's.
  test.each([
    // 05:30Z on the 8th is 10:30 PM on the 7th in Los Angeles: the 7th's untimed task isn't over yet.
    ['Los Angeles at 10:30 PM: the day\'s untimed task isn\'t overdue yet', 'America/Los_Angeles', '2026-10-08T05:30:00.000Z', []],
    // … and 7:30 AM on the 8th in Berlin, where the 7th is over.
    ['Berlin at 7:30 AM the next day: it is', 'Europe/Berlin', '2026-10-08T05:30:00.000Z', [false]],
    // 07:00Z on the 8th is midnight in Los Angeles: the 7th has just ended.
    ['Los Angeles at midnight: it is', 'America/Los_Angeles', '2026-10-08T07:00:00.000Z', [false]],
  ])('at the day\'s boundary, %s', (_name, zone, at, expected) => {
    expect(overdueTasks([untimed('2026-10-07')], Date.parse(at), zone).map(one => one.today)).toEqual(expected);
  });

  test('a timed task late in the evening is today\'s by its due day in the user\'s zone', () => {
    // 10:00 PM Pacific on the 7th, 05:00Z on the 8th; now is 05:30Z.
    const late = timed('2026-10-07', '2026-10-08T05:00:00.000Z');
    expect(overdueTasks([late], Date.parse('2026-10-08T05:30:00.000Z'), 'America/Los_Angeles').map(one => [one.item.id, one.today])).toEqual([[late.id, true]]);
  });
});
