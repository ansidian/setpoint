// Recurring items' occurrences, in the item's zone.
import {describe, expect, test} from 'vitest';
import {occurrenceDates, parseRule} from '../src/domain/recurrence.ts';
import {localDay} from '../src/domain/time.ts';

const pacific = (until: string) => localDay(until, 'America/Los_Angeles');

describe('parseRule', () => {
  test.each([
    ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', {freq: 'WEEKLY', interval: 1, byDay: [1, 3, 5], count: null, untilDate: null, untilAt: null}],
    // CS 101's UNTIL is Dec 4, 07:59:59 UTC: Thursday, Dec 3 in Los Angeles.
    ['RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261204T075959Z', {freq: 'WEEKLY', interval: 1, byDay: [2, 4], count: null, untilDate: '2026-12-03', untilAt: '2026-12-04T07:59:59.000Z'}],
    ['RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3', {freq: 'DAILY', interval: 2, byDay: null, count: 3, untilDate: null, untilAt: null}],
    ['RRULE:FREQ=MONTHLY;UNTIL=20270101', {freq: 'MONTHLY', interval: 1, byDay: null, count: null, untilDate: '2027-01-01', untilAt: null}],
  ])('%s', (text, rule) => {
    expect(parseRule(text, pacific)).toEqual(rule);
  });

  test.each(['RRULE:FREQ=MONTHLY;BYDAY=2TU', 'RRULE:FREQ=WEEKLY;BYSETPOS=1', 'RRULE:FREQ=HOURLY', 'RRULE:FREQ=WEEKLY;INTERVAL=0'])('%s isn\'t covered', text => {
    expect(parseRule(text, pacific)).toBeNull();
  });
});

describe('occurrenceDates', () => {
  const rule = (text: string) => parseRule(text, pacific)!;

  test.each([
    ['Gym in the week of Oct 5', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', '2026-08-31', '2026-10-05', '2026-10-12', ['2026-10-05', '2026-10-07', '2026-10-09']],
    ['CS 101 ends with its UNTIL', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261204T075959Z', '2026-08-25', '2026-11-30', '2026-12-14', ['2026-12-01', '2026-12-03']],
    ['every other day, three times', 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=3', '2026-10-01', '2026-10-01', '2026-10-31', ['2026-10-01', '2026-10-03', '2026-10-05']],
    ['COUNT counts from the start, not the range', 'RRULE:FREQ=DAILY;COUNT=3', '2026-10-01', '2026-10-02', '2026-10-31', ['2026-10-02', '2026-10-03']],
    ['every two weeks on Tuesday', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', '2026-10-06', '2026-10-01', '2026-11-01', ['2026-10-06', '2026-10-20']],
    ['monthly on the 31st skips short months', 'RRULE:FREQ=MONTHLY', '2026-08-31', '2026-08-01', '2026-12-01', ['2026-08-31', '2026-10-31']],
    ['yearly', 'RRULE:FREQ=YEARLY', '2024-10-07', '2026-01-01', '2027-01-01', ['2026-10-07']],
    ['nothing before the start', 'RRULE:FREQ=WEEKLY;BYDAY=MO', '2026-10-12', '2026-10-01', '2026-10-13', ['2026-10-12']],
  ])('%s', (_, text, start, from, to, dates) => {
    expect(occurrenceDates(rule(text), start, from, to)).toEqual(dates);
  });
});
