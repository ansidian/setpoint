// The phone editor's native day and time fields (logic/nativeWhen.ts), as tables.
import {expect, test} from 'vitest';
import {endDatePicked, endOf, endTimePicked, inputTime, lastDayPicked, readInputTime} from '../src/logic/nativeWhen.ts';

test.each<[number, string]>([
  [0, '00:00'], [9 * 60 + 5, '09:05'], [13 * 60, '13:00'], [23 * 60 + 45, '23:45'], [1440, '00:00'], [1440 + 90, '01:30'],
])('%i minutes is the time input\'s %s', (minutes, value) => {
  expect(inputTime(minutes)).toBe(value);
});

test.each<[string, number | null]>([
  ['00:00', 0], ['09:05', 545], ['13:00', 780], ['23:59', 1439], ['13:00:00', 780], ['13:00:30.5', 780], ['', null], ['24:00', null], ['9:05', null], ['12:60', null],
])('the time input\'s "%s" reads %s', (value, minutes) => {
  expect(readInputTime(value)).toBe(minutes);
});

test.each<[string, number, string, number]>([
  ['2026-10-07', 14 * 60, '2026-10-07', 840],
  ['2026-10-07', 1440, '2026-10-08', 0],
  ['2026-10-07', 1440 + 60, '2026-10-08', 60],
  ['2026-10-31', 2 * 1440 + 600, '2026-11-02', 600],
])('on %s an end at %i shows on %s at %i', (date, end, day, minutes) => {
  expect(endOf(date, end)).toEqual({date: day, minutes});
});

test.each<[string, number, number, number, number]>([
  ['a later time the same day', 13 * 60, 14 * 60, 15 * 60 + 30, 15 * 60 + 30],
  ['the start\'s own time: no end', 13 * 60, 14 * 60, 13 * 60, 13 * 60],
  ['an earlier time runs past midnight', 23 * 60, 1440, 60, 1440 + 60],
  ['on a later last day, that day\'s time', 22 * 60, 1440 + 120, 9 * 60, 1440 + 9 * 60],
  ['on a later last day, an early time stays on it', 9 * 60, 2 * 1440 + 600, 6 * 60, 2 * 1440 + 360],
])('%s', (_, start, end, picked, next) => {
  expect(endTimePicked(start, end, picked)).toBe(next);
});

test.each<[string, string, number, number, string, number]>([
  ['a later day keeps the end\'s time', '2026-10-07', 13 * 60, 14 * 60, '2026-10-09', 2 * 1440 + 14 * 60],
  ['back to the first day', '2026-10-07', 22 * 60, 1440 + 120, '2026-10-07', 23 * 60],
  ['the first day with a later end time', '2026-10-07', 9 * 60, 1440 + 600, '2026-10-07', 600],
  ['a day before the first is the first', '2026-10-07', 9 * 60, 600, '2026-10-05', 600],
])('%s', (_, date, start, end, to, next) => {
  expect(endDatePicked(date, start, end, to)).toBe(next);
});

test.each<[string, string, number]>([
  ['2026-10-07', '2026-10-07', 1], ['2026-10-07', '2026-10-09', 3], ['2026-10-30', '2026-11-02', 4], ['2026-10-07', '2026-10-01', 1],
])('an all-day event from %s to %s runs %i days', (date, to, days) => {
  expect(lastDayPicked(date, to)).toBe(days);
});
