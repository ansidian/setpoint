// SV-181: whether an .ics file's event is over, so the review starts it unticked (D437).
import {describe, expect, test} from 'vitest';
import {importPast} from '../src/domain/icsReview.ts';

const NOW = '2026-10-07T16:12:00.000Z';
const ZONE = 'America/Los_Angeles';
const timed = (starts_at: string, ends_at: string | null, recurrence: string[] = [], time_zone: string | null = null) =>
  ({all_day: false, starts_at, ends_at, start_date: null, end_date: null, time_zone, recurrence});
const allDay = (start_date: string, end_date: string, recurrence: string[] = []) =>
  ({all_day: true, starts_at: null, ends_at: null, start_date, end_date, time_zone: null, recurrence});

describe('importPast', () => {
  test.each([
    ['a timed event that ended yesterday', timed('2026-10-06T16:00:00.000Z', '2026-10-06T17:00:00.000Z'), true],
    ['one that ended a minute ago', timed('2026-10-07T15:00:00.000Z', '2026-10-07T16:11:00.000Z'), true],
    ['one under way now', timed('2026-10-07T16:00:00.000Z', '2026-10-07T17:00:00.000Z'), false],
    ['one later today', timed('2026-10-07T20:00:00.000Z', '2026-10-07T21:00:00.000Z'), false],
    ['one with no length, at its start', timed('2026-10-07T16:00:00.000Z', null), true],
    ['an all-day event yesterday (its end date is exclusive)', allDay('2026-10-06', '2026-10-07'), true],
    ['an all-day event today', allDay('2026-10-07', '2026-10-08'), false],
    ['a weekly series with no end, begun last year', timed('2025-09-01T16:00:00.000Z', '2025-09-01T17:00:00.000Z', ['RRULE:FREQ=WEEKLY;BYDAY=MO']), false],
    ['a series whose UNTIL has passed', timed('2026-09-01T16:00:00.000Z', '2026-09-01T17:00:00.000Z', ['RRULE:FREQ=WEEKLY;UNTIL=20260930T235959Z']), true],
    ['a series whose UNTIL is ahead', timed('2026-09-01T16:00:00.000Z', '2026-09-01T17:00:00.000Z', ['RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z']), false],
    ['a series whose COUNT ran out', timed('2026-09-01T16:00:00.000Z', '2026-09-01T17:00:00.000Z', ['RRULE:FREQ=DAILY;COUNT=5']), true],
    ['a series whose COUNT reaches today', timed('2026-10-01T16:00:00.000Z', '2026-10-01T17:00:00.000Z', ['RRULE:FREQ=DAILY;COUNT=7']), false],
    ['an all-day yearly series with no end', allDay('2020-03-14', '2020-03-15', ['RRULE:FREQ=YEARLY']), false],
    ['a rule the expander doesn\'t cover', timed('2026-01-01T16:00:00.000Z', '2026-01-01T17:00:00.000Z', ['RRULE:FREQ=MONTHLY;BYSETPOS=2;BYDAY=TU;COUNT=2']), false],
    ['a past series with extra dates (RDATE) beside it', timed('2026-09-01T16:00:00.000Z', '2026-09-01T17:00:00.000Z', ['RRULE:FREQ=DAILY;COUNT=2', 'RDATE:20261201T160000Z']), false],
    ['a series in its own zone, ended there', timed('2026-09-01T09:00:00.000Z', '2026-09-01T10:00:00.000Z', ['RRULE:FREQ=DAILY;UNTIL=20261006T235959Z'], 'Asia/Tokyo'), true],
  ])('%s', (_, event, past) => {
    expect(importPast(event, NOW, ZONE)).toBe(past);
  });
});
