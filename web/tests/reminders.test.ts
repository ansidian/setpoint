// Reminders' anchors and words as tables (darma SV-109, D287–D289): what an item's reminders count
// from, a preset's words, any other offset as its moment with the offset quiet beside it, the order
// they're shown in, and the 4 weeks either side.
import type {ItemOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {customProblem, inOrder, offsetAt, reminderAnchor, reminderLines, reminderMoment, reminderWords, relativeLine} from '../src/logic/reminders.ts';

const zone = SEED_TIME_ZONE;
const at = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00-07:00`)).toISOString();
const ms = (date: string, time: string) => Date.parse(at(date, time));
type When = Pick<ItemOut, 'kind' | 'all_day' | 'starts_at' | 'start_date' | 'due_date' | 'due_at'>;
const when = (fields: Partial<When>): When => ({kind: 'event', all_day: false, starts_at: null, start_date: null, due_date: null, due_at: null, ...fields});

describe('what reminders count from', () => {
  test.each<[string, Partial<When>, string | null, number | null]>([
    ['a timed event: its start', {starts_at: at('2026-10-27', '14:00')}, null, ms('2026-10-27', '14:00')],
    ['an all-day event: its midnight', {all_day: true, start_date: '2026-10-27'}, '18:00', ms('2026-10-27', '00:00')],
    ['a timed task: its due time', {kind: 'task', due_date: '2026-10-27', due_at: at('2026-10-27', '17:00')}, '09:00', ms('2026-10-27', '17:00')],
    ['a dated task: Settings\' task time', {kind: 'task', due_date: '2026-10-27'}, '18:30', ms('2026-10-27', '18:30')],
    ['a dated task at None: 9:00 AM', {kind: 'task', due_date: '2026-10-27'}, null, ms('2026-10-27', '09:00')],
    ['a task with no date: nothing', {kind: 'task'}, '09:00', null],
  ])('%s', (_, fields, taskTime, anchor) => expect(reminderAnchor(when(fields), taskTime, zone)).toBe(anchor));

  test('a moment picked is its offset, and moves with the item', () => {
    const anchor = ms('2026-10-27', '14:00');
    expect(offsetAt(anchor, ms('2026-10-25', '20:00'))).toBe(2520);
    expect(offsetAt(anchor, ms('2026-10-27', '16:00'))).toBe(-120);
    expect(reminderMoment(ms('2026-10-28', '14:00'), 2520)).toBe(ms('2026-10-26', '20:00'));
  });
});

describe('words', () => {
  const anchor = ms('2026-10-27', '14:00');
  test.each<[number, {text: string; quiet: string | null; custom: boolean}]>([
    [10, {text: '10 min before', quiet: null, custom: false}],
    [0, {text: 'At the start', quiet: null, custom: false}],
    [1440, {text: '1 day before', quiet: null, custom: false}],
    [2520, {text: 'Sun, Oct 25, 8:00 PM', quiet: '1 day 18 hrs before', custom: true}],
    [-120, {text: 'Tue, Oct 27, 4:00 PM', quiet: '2 hrs after', custom: true}],
    [90, {text: 'Tue, Oct 27, 12:30 PM', quiet: '1 hr 30 min before', custom: true}],
    [-60, {text: 'Tue, Oct 27, 3:00 PM', quiet: '1 hr after', custom: true}],
  ])('%i min', (minutes, words) => expect(reminderWords(minutes, anchor, zone)).toEqual(words));

  test('with no anchor (a task with no date), an offset reads as itself', () => {
    expect(reminderWords(-2880, null, zone)).toEqual({text: '2 days after', quiet: null, custom: true});
    expect(relativeLine(45)).toBe('45 min before');
  });

  test('the detail: the presets in one line, then each other one at its moment', () => {
    expect(reminderLines([60, 10, -120, 2520], anchor, zone)).toEqual([
      {text: '10 min, 1 hour before', quiet: null},
      {text: 'Sun, Oct 25, 8:00 PM', quiet: '1 day 18 hrs before'},
      {text: 'Tue, Oct 27, 4:00 PM', quiet: '2 hrs after'},
    ]);
    expect(reminderLines([], anchor, zone)).toEqual([]);
  });

  test('shown before-ones nearest the start first, then after-ones the same', () => {
    expect(inOrder([-120, 60, 0, -10, 2520, 10, 10])).toEqual([0, 10, 60, 2520, -10, -120]);
  });
});

describe('4 weeks either side', () => {
  test.each<[number, string | null]>([
    [40_320, null],
    [-40_320, null],
    [40_321, 'That\'s more than 4 weeks before: a reminder goes within 4 weeks either side.'],
    [-40_321, 'That\'s more than 4 weeks after: a reminder goes within 4 weeks either side.'],
  ])('%i min', (minutes, problem) => expect(customProblem(minutes)).toBe(problem));
});
