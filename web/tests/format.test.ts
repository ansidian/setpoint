// DESIGN.md › Copy's ages, times and codes, against the seed's moment (Wed, Oct 7, 2026, 9:12 AM
// Pacific) so the brief's ages come out: 20m, 2h, 7h, Yesterday, Mon, Sep 30.
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {addDays, age, clockTime, codeGroups, countdownChange, daysBetween, expiresIn, fullTimestamp, localDate, monthName, readerTime, startsIn} from '../src/logic/format.ts';

const now = Date.parse(SEED_NOW);
const zone = SEED_TIME_ZONE;
const minutesAgo = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

describe('age', () => {
  test.each([
    ['just arrived', minutesAgo(0.5), 'now'],
    ['a minute', minutesAgo(1), '1m'],
    ['Contoso\'s code, 9:08 AM', '2026-10-07T16:08:00.000Z', '4m'],
    ['Google\'s recovery email, 8:52 AM', '2026-10-07T15:52:00.000Z', '20m'],
    ['59 minutes', minutesAgo(59.9), '59m'],
    ['an hour', minutesAgo(60), '1h'],
    ['Northwind, 7:12 AM', '2026-10-07T14:12:00.000Z', '2h'],
    ['Wingtip Toys, 3:20 AM, to the nearest hour', '2026-10-07T10:20:00.000Z', '6h'],
    ['Fabrikam, 2:14 AM, to the nearest hour', '2026-10-07T09:14:00.000Z', '7h'],
    ['just after midnight', '2026-10-07T07:01:00.000Z', '9h'],
    ['yesterday evening', '2026-10-07T01:41:00.000Z', 'Yesterday'],
    ['yesterday morning', '2026-10-06T16:45:00.000Z', 'Yesterday'],
    ['Monday', '2026-10-05T17:05:00.000Z', 'Mon'],
    ['six days back', '2026-10-01T18:00:00.000Z', 'Thu'],
    ['a week back', '2026-09-30T21:15:00.000Z', 'Sep 30'],
    ['last year', '2025-12-30T21:15:00.000Z', 'Dec 30, 2025'],
    ['a clock running behind the server', minutesAgo(-3), 'now'],
  ])('%s → %s', (_name, at, expected) => {
    expect(age(at, now, zone)).toBe(expected);
  });

  test('local days are the owner\'s zone, not UTC', () => {
    // 11:30 PM Pacific on Oct 6 is Oct 7 in UTC.
    expect(age('2026-10-07T06:30:00.000Z', now, zone)).toBe('Yesterday');
    expect(age('2026-10-07T06:30:00.000Z', now, 'UTC')).toBe('10h');
  });
});

test.each([
  ['2026-10-07T14:12:00.000Z', '7:12 AM'],
  ['2026-10-07T21:30:00.000Z', '2:30 PM'],
  ['2026-10-07T07:00:00.000Z', '12:00 AM'],
])('clockTime %s → %s', (at, expected) => {
  expect(clockTime(at, zone)).toBe(expected);
});

test.each([
  ['today: the clock time', '2026-10-07T14:12:00.000Z', '7:12 AM'],
  ['earlier: the date too', '2026-09-30T21:15:00.000Z', 'Sep 30, 2:15 PM'],
  ['another year', '2025-03-14T22:22:00.000Z', 'Mar 14, 2025, 3:22 PM'],
])('readerTime: %s', (_name, at, expected) => {
  expect(readerTime(at, now, zone)).toBe(expected);
});

test('fullTimestamp for tooltips', () => {
  expect(fullTimestamp('2026-10-07T14:12:00.000Z', zone)).toBe('Wed, Oct 7, 2026, 7:12 AM');
});

test.each([
  ['2026-10-07T21:30:00.000Z', 'in 5h'],
  ['2026-10-07T17:57:00.000Z', 'in 2h'],
  ['2026-10-07T16:57:00.000Z', 'in 45m'],
  ['2026-10-07T16:12:20.000Z', 'now'],
  ['2026-10-07T16:00:00.000Z', 'now'],
])('startsIn %s → %s', (at, expected) => {
  expect(startsIn(at, now)).toBe(expected);
});

test.each([
  ['the code, 11 minutes left', '2026-10-07T16:23:00.000Z', now, 'Expires in 11 min'],
  ['a few seconds later, still 11', '2026-10-07T16:23:00.000Z', now + 5_000, 'Expires in 11 min'],
  ['rounded up', '2026-10-07T16:12:30.000Z', now, 'Expires in 1 min'],
  ['past', '2026-10-07T16:11:00.000Z', now, 'Expired'],
])('expiresIn: %s', (_name, at, at_now, expected) => {
  expect(expiresIn(at, at_now)).toBe(expected);
});

// When "Expires in 11 min" next changes its words, so the row moves on then, not on the app's next
// 15 s tick: a minute's end, and the last minute at its expiry, when the row leaves.
test.each([
  ['11 minutes left: when it reads 10', '2026-10-07T16:23:00.000Z', now, '2026-10-07T16:13:00.000Z'],
  ['part of a minute in: still that minute\'s end', '2026-10-07T16:23:00.000Z', now + 5_000, '2026-10-07T16:13:00.000Z'],
  ['on a minute\'s end: the next one', '2026-10-07T16:23:00.000Z', Date.parse('2026-10-07T16:13:00.000Z'), '2026-10-07T16:14:00.000Z'],
  ['the last minute: its expiry', '2026-10-07T16:12:30.000Z', now, '2026-10-07T16:12:30.000Z'],
  ['expired: never', '2026-10-07T16:11:00.000Z', now, null],
  ['expiring now: never', '2026-10-07T16:12:00.000Z', now, null],
])('countdownChange: %s', (_name, at, at_now, expected) => {
  expect(countdownChange(at, at_now)).toBe(expected === null ? null : Date.parse(expected));
});

test.each([
  ['482913', '482 913'],
  ['12345678', '1234 5678'],
  ['G-12345', 'G-12345'],
  ['1234', '1234'],
  ['12345', '12345'],
])('codeGroups %s → %s', (code, expected) => {
  expect(codeGroups(code)).toBe(expected);
});

test('local days', () => {
  expect(localDate(SEED_NOW, zone)).toBe('2026-10-07');
  expect(localDate('2026-10-08T06:59:00.000Z', zone)).toBe('2026-10-07');
  expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
  expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  expect(daysBetween('2026-10-05', '2026-10-07')).toBe(2);
  expect(monthName('2026-10-07')).toBe('October 2026');
});
