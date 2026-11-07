// News's empty pane's numbers (SV-219, D466): feeds failing every attempt for 6 hours as a table over
// the rule, and the rest over the seed through the API.
import {SEED_NOW} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {feedsFailing} from '../src/domain/news.ts';
import {newsDay} from '../src/queries/news.ts';
import {signedIn, world} from './helpers.ts';

const NOW = '2026-10-07T16:12:00.000Z';
const eqId = (id: number) => eq(t.newsSources.id, id);

describe('News\'s day (SV-219)', () => {
  test.each([
    ['none failing', [null, null], 0],
    ['failing six hours to the minute counts', ['2026-10-07T10:12:00.000Z'], 1],
    ['failing under six hours doesn\'t (an intermittent failure clears on its next success)', ['2026-10-07T10:13:00.000Z'], 0],
    ['each long failure counts', ['2026-10-06T10:00:00.000Z', '2026-10-07T09:00:00.000Z', null, '2026-10-07T15:00:00.000Z'], 2],
  ] as const)('%s', (_, since, count) => expect(feedsFailing(since.map(failingSince => ({failingSince})), NOW)).toBe(count));

  test('over the seed: not ranked yet, today\'s articles, stories and outlets, every story kept, and no AI this month', async () => {
    const w = world({seed: true, now: SEED_NOW});
    const c = await signedIn(w);
    expect((await c.send('GET', '/api/news/day')).body).toEqual({
      updated_at: null, next_at: null, feeds_failing: 0, articles_today: 89, stories_today: 15, outlets_today: 40, stories_total: 60, ai_this_month_usd: 0,
    });
  });

  test('ranked, the next is due an hour on', () => {
    const w = world({seed: true, now: SEED_NOW});
    w.store.db.insert(t.newsSorting).values({id: 1, lastRankedAt: '2026-10-07T15:40:00.000Z'}).onConflictDoUpdate({target: t.newsSorting.id, set: {lastRankedAt: '2026-10-07T15:40:00.000Z'}}).run();
    expect(newsDay(w.store)).toMatchObject({updated_at: '2026-10-07T15:40:00.000Z', next_at: '2026-10-07T16:40:00.000Z'});
  });

  test('a feed failing since seven hours ago shows; one failing for an hour doesn\'t', () => {
    const w = world({seed: true, now: SEED_NOW});
    const [first, second] = w.store.db.select().from(t.newsSources).all();
    const ago = (hours: number) => new Date(Date.parse(SEED_NOW) - hours * 60 * 60_000).toISOString();
    w.store.db.update(t.newsSources).set({failingSince: ago(7)}).where(eqId(first!.id)).run();
    w.store.db.update(t.newsSources).set({failingSince: ago(1)}).where(eqId(second!.id)).run();
    expect(newsDay(w.store).feeds_failing).toBe(1);
  });
});
