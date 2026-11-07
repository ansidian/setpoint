// The Inbox's empty pane's words as tables (SV-218, D465): the headline, today's strip and the quiet facts.
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {keptLine, needLine, todayTiles} from '../src/logic/mailDay.ts';

describe('the mail day\'s words', () => {
  test.each([
    [{need_you: 0, overdue: 0}, null],
    [{need_you: 1, overdue: 0}, {need: '1 needs you', overdue: null}],
    [{need_you: 3, overdue: 1}, {need: '3 need you', overdue: '1 overdue'}],
    [{need_you: 1204, overdue: 12}, {need: '1,204 need you', overdue: '12 overdue'}],
  ])('the headline for %j', (day, line) => expect(needLine(day)).toEqual(line));

  test.each([
    [{done: 0, sorted_fyi: 8, sorted_noise: 3}, [['0', 'Done today', false], ['8', 'Sorted to FYI', true], ['3', 'Sorted to Noise', true]]],
    [{done: 7, sorted_fyi: 0, sorted_noise: 1310}, [['7', 'Done today', true], ['0', 'Sorted to FYI', false], ['1,310', 'Sorted to Noise', true]]],
  ])('today\'s strip for %j, lit only above 0', (day, tiles) => expect(todayTiles(day).map(tile => [tile.value, tile.label, tile.lit])).toEqual(tiles));

  test.each([
    [{total: 12408, bytes: 1.3 * 1024 ** 3, oldest_at: '2019-03-14T18:00:00.000Z'}, '12,408 emails · 1.3 GB, since Mar 2019.'],
    [{total: 1, bytes: 2048, oldest_at: '2026-10-07T16:00:00.000Z'}, '1 email · 2 KB, since Oct 2026.'],
    // The oldest arrived on New Year's Eve in Los Angeles, though it's already January in UTC.
    [{total: 2, bytes: 4096, oldest_at: '2026-01-01T05:00:00.000Z'}, '2 emails · 4 KB, since Dec 2025.'],
    [{total: 0, bytes: 0, oldest_at: null}, 'No emails yet.'],
  ])('the quiet facts for %j', (day, line) => expect(keptLine(day, SEED_TIME_ZONE)).toBe(line));
});
