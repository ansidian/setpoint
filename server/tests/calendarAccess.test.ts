// SV-191: a Google calendar the user can only read (a subscribed holiday calendar is `reader`).
// Its role is kept from the calendar list, and calendarWritable says whether its events can change.
import {describe, expect, test} from 'vitest';
import {calendarWritable} from '../src/domain/calendarAccess.ts';
import {calendarWorld, HOLIDAYS, PERSONAL} from './calendarWorld.ts';

describe('whether a calendar can be written to, from Google\'s accessRole', () => {
  test.each([
    ['owner', true],
    ['writer', true],
    // Writes everything but private events (Andy, 2026-11-04).
    ['writerWithoutPrivateAccess', true],
    ['reader', false],
    ['freeBusyReader', false],
    // Todoist's, or a Google calendar not listed since the column came.
    [null, true],
    // A role Google adds later isn't known to write.
    ['commenter', false],
  ])('%s', (role, writable) => expect(calendarWritable(role)).toBe(writable));
});

describe('the calendar list', () => {
  test('keeps each calendar\'s role', async () => {
    const {run, calendar} = await calendarWorld();
    await run();
    expect([calendar(PERSONAL).accessRole, calendar(HOLIDAYS).accessRole]).toEqual(['owner', 'reader']);
  });
});
