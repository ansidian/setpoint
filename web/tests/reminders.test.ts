// Reminders' anchors and words as tables (darma SV-109, D287–D289): what an item's reminders count
// from, a preset's words, any other offset as its moment with the offset quiet beside it, the order
// they're shown in, and the 4 weeks either side.
import type {ItemOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {customProblem, inOrder, lineOffsets, offsetAt, reminderAnchor, reminderLines, reminderMoment, reminderWords, relativeLine, rowReminders, withLine} from '../src/logic/reminders.ts';

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

describe('SV-112: the line\'s reminders (D293)', () => {
  const anchor = ms('2026-10-27', '14:00');
  test('an offset is itself; a moment is its offset from the item\'s moment', () => {
    expect(lineOffsets([{minutes: 60}, {date: '2026-10-25', time: 20 * 60}, {date: '2026-10-27', time: 16 * 60}], anchor, zone)).toEqual([60, 2520, -120]);
  });
  test('a moment counts real minutes across a change of clocks, and past 4 weeks that way it goes', () => {
    // Clocks go back on Sun, Nov 1, 2026: Sat, Oct 31, 9:00 AM is 49 hours before Mon, Nov 2, 9:00 AM.
    expect(lineOffsets([{date: '2026-10-31', time: 9 * 60}], Date.parse('2026-11-02T09:00:00-08:00'), zone)).toEqual([2940]);
    // 28 days on the clock, but 40,380 minutes.
    expect(lineOffsets([{date: '2026-10-31', time: 9 * 60}], Date.parse('2026-11-28T09:00:00-08:00'), zone)).toEqual([]);
  });
  test('the same reminder twice is one; with no anchor there are none', () => {
    expect(lineOffsets([{minutes: 2520}, {date: '2026-10-25', time: 20 * 60}], anchor, zone)).toEqual([2520]);
    expect(lineOffsets([{minutes: 60}], null, zone)).toEqual([]);
  });

  test.each<[string, number[] | null, number[], number[] | null]>([
    ['no line: what was picked', [10], [], [10]],
    ['no line and nothing picked: Settings\' default', null, [], null],
    ['a new item\'s line replaces the default', null, [60], [60]],
    ['what\'s ticked sits beside the line\'s', [10], [60], [10, 60]],
    ['an edited item\'s line adds to its own', [10, 1440], [60, 10], [10, 60, 1440]],
    ['10 at most, what\'s picked first', [1, 2, 3, 4, 5, 6, 7, 8, 9], [60, 120], [1, 2, 3, 4, 5, 6, 7, 8, 9, 60]],
  ])('%s', (_, picked, line, reminders) => expect(withLine(picked, line)).toEqual(reminders));

  test.each<[string, number[], number[] | null, number[], {reminders: number[] | null; byHand: boolean}]>([
    ['a reminder ticked beside the line\'s is picked', [10, 60], null, [60], {reminders: [10], byHand: false}],
    ['one picked taken out', [60], [10], [60], {reminders: [], byHand: false}],
    ['one the item had and the line says too stays the item\'s', [60, 1440], [60], [60], {reminders: [60, 1440], byHand: false}],
    ['one the line set taken out: the reminders are set by hand', [10], [10], [60], {reminders: [10], byHand: true}],
  ])('the row: %s', (_, list, picked, line, result) => expect(rowReminders(list, picked, line)).toEqual(result));
});
