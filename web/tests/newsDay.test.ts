// News's empty pane's words as tables (SV-219, D466): the freshness line, feeds failing, today's strip and the quiet facts.
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {failingLine, freshnessLine, newsKeptLine, newsTiles, wholeDollars} from '../src/logic/newsDay.ts';

describe('News\'s day\'s words', () => {
  test.each([
    [{updated_at: '2026-10-07T15:40:00.000Z', next_at: '2026-10-07T16:40:00.000Z'}, 'Updated 8:40 AM, next around 9:40'],
    // Across noon, the next keeps its PM.
    [{updated_at: '2026-10-07T18:30:00.000Z', next_at: '2026-10-07T19:30:00.000Z'}, 'Updated 11:30 AM, next around 12:30 PM'],
    [{updated_at: null, next_at: null}, 'Not ranked yet'],
  ])('freshness for %j', (day, line) => expect(freshnessLine(day, SEED_TIME_ZONE)).toBe(line));

  test.each([[0, null], [1, '1 feed failing'], [2, '2 feeds failing']])('%i failing', (feeds, line) => expect(failingLine({feeds_failing: feeds})).toBe(line));

  test('today\'s strip says what it counts', () => {
    expect(newsTiles({articles_today: 1312, stories_today: 42, outlets_today: 0}).map(tile => [tile.value, tile.label])).toEqual([
      ['1,312', 'Articles fetched'], ['42', 'Stories started'], ['0', 'Outlets'],
    ]);
  });

  test.each([
    [{stories_total: 8214, ai_this_month_usd: 38.4}, '8,214 stories, $38 of AI this month.'],
    [{stories_total: 1, ai_this_month_usd: 0.4}, '1 story, $0.40 of AI this month.'],
    [{stories_total: 0, ai_this_month_usd: 0}, 'No stories yet, $0.00 of AI this month.'],
  ])('the quiet facts for %j', (day, line) => expect(newsKeptLine(day)).toBe(line));

  test('whole dollars from $10', () => expect([wholeDollars(9.99), wholeDollars(10), wholeDollars(1234.5)]).toEqual(['$9.99', '$10', '$1,235']));
});
