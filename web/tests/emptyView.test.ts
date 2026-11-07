// An empty Inbox view's quiet line as a table (SV-226): when the last email it tells of came.
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {quietLine} from '../src/logic/emptyView.ts';

// 3:00 PM on Wednesday, Oct 7, 2026 in Los Angeles.
const NOW = Date.parse('2026-10-07T22:00:00.000Z');

describe('an empty view\'s quiet line', () => {
  test.each([
    ['unread', '2026-10-07T21:14:00.000Z', 'Last new email at 2:14 PM'],
    ['fyi', '2026-10-07T21:14:00.000Z', 'Last new email at 2:14 PM'],
    ['noise', '2026-10-05T16:30:00.000Z', 'Last new email Oct 5, 9:30 AM'],
    ['attention', '2026-10-07T16:05:00.000Z', 'The last one came at 9:05 AM'],
    ['attention', '2025-12-31T20:00:00.000Z', 'The last one came Dec 31, 2025, 12:00 PM'],
    ['unread', null, null],
  ] as const)('%s, newest %s', (view, newest, line) => expect(quietLine(view, newest, NOW, SEED_TIME_ZONE)).toBe(line));
});
