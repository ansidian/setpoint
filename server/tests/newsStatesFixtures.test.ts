// N5's fixtures (src/dev/fixtures/newsStates.ts): each gives its board the state it draws, through the
// same queries the API answers with, and holds it while the engine runs, reaching no model or feed.
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {FIXTURES} from '../src/dev/fixtures/index.ts';
import {sampleUsage} from '../src/dev/sample.ts';
import {NewsSortWorker} from '../src/news/sortWorker.ts';
import {newsStatus, unsortedArticles} from '../src/news/sortState.ts';
import {NewsWorker} from '../src/news/worker.ts';
import {newsAiOverview, usageThisMonth} from '../src/news/models.ts';
import {missed, newsPage, newsSection} from '../src/queries/news.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {world} from './helpers.ts';

const seededWith = (...names: string[]) => {
  const w = world({seed: true});
  // As `npm run seed` has it, with this month's AI usage (the tests' worlds leave it out).
  w.store.db.insert(t.aiUsage).values(sampleUsage()).run();
  for (const name of names) FIXTURES[name]!.apply({sqlite: w.store.sqlite, db: w.store.db});
  return w;
};

/** A tick of the engine with News's workers as a dev run has them: no adapters, and no model to reach. */
async function tick(w: ReturnType<typeof world>) {
  const engine = new SyncEngine({
    store: w.store, adapters: new Adapters({}),
    workers: [new NewsWorker({store: w.store}), new NewsSortWorker({store: w.store, endpoints: {anthropic: 'http://127.0.0.1:9', openai: 'http://127.0.0.1:9'}})],
  });
  await engine.tick();
  await engine.settled();
}

const block = (w: ReturnType<typeof world>, section: string) => newsPage(w.store).blocks.find(one => one.section === section)!;

describe('N5\'s fixtures', () => {
  test('the seed: this month\'s usage is board 30b\'s, Triage $2.10, Alfred $0.85 and News $18.40 in its parts', () => {
    const w = seededWith();
    const usage = usageThisMonth(w.store);
    expect([usage.triage.calls, usage.triage.cost_usd, usage.alfred.calls, usage.alfred.cost_usd]).toEqual([1214, 2.1, 18, 0.85]);
    expect([usage.news.articles, usage.news.grouping, usage.news.stories, usage.news.ranking].map(part => part.cost_usd)).toEqual([1.9, 1.2, 13.1, 2.2]);
    expect(newsAiOverview(w.store)).toMatchObject({this_month_usd: 18.4, monthly_cap_usd: 40, capped: false});
  });

  test('news-ai-down: 12 articles wait, Anthropic unreachable since 8:52 AM, retrying, and stay so while the engine runs', async () => {
    const w = seededWith('news-ai-down');
    const expected = {unsorted: 12, down: {provider: 'anthropic', cause: 'unreachable', since: '2026-10-07T15:52:00.000Z', retrying: true}, first_run: null};
    expect(newsStatus(w.store)).toMatchObject(expected);
    expect(unsortedArticles(w.store).articles.map(article => article.outlet).slice(0, 3)).toEqual(['KTLA', 'NPR', 'The Verge']);
    await tick(w);
    expect(newsStatus(w.store)).toMatchObject(expected);
    // The page is the seed's: its Missed strip too.
    expect(newsPage(w.store).missed?.count).toBe(14);
  });

  test('news-stale-ai: AI\'s line says "as of 7:02 AM", and its stories stay', () => {
    const w = seededWith('news-stale-ai');
    expect(block(w, 'ai')).toMatchObject({health: {state: 'stale', as_of: '2026-10-07T14:02:00.000Z'}});
    expect(block(w, 'ai').stories.length).toBeGreaterThan(0);
    expect(newsPage(w.store).blocks.filter(one => one.health !== null).map(one => one.section)).toEqual(['ai']);
  });

  test('news-quiet-tech: Tech holds no story and no keynote; Missed still holds its 14', () => {
    const w = seededWith('news-quiet-tech');
    expect(block(w, 'tech')).toMatchObject({stories: [], more: 0, upcoming: []});
    expect(newsSection(w.store, 'tech').stories).toEqual([]);
    expect(missed(w.store).count).toBe(14);
  });

  test('news-first-run: 186 of 312 sorted, everything new, no Missed, nothing in AI; it holds while the engine runs', async () => {
    const w = seededWith('news-first-run');
    expect(newsStatus(w.store)).toEqual({unsorted: 126, down: null, first_run: {sorted: 186, total: 312}});
    const page = newsPage(w.store);
    expect(page.missed).toBeNull();
    expect(block(w, 'ai')).toMatchObject({stories: [], more: 0});
    expect(page.blocks.flatMap(one => one.stories).every(story => story.state === 'new')).toBe(true);
    // The story AI shared with General stays in General.
    expect(newsSection(w.store, 'general').stories.find(story => story.headline === 'A federal rule on AI chip exports takes effect')?.sections).toEqual(['general']);
    await tick(w);
    expect(newsStatus(w.store)).toEqual({unsorted: 126, down: null, first_run: {sorted: 186, total: 312}});
  });

  test('news-capped: $40.40 of $40, so summaries use Haiku', () => {
    expect(newsAiOverview(seededWith('news-capped').store)).toMatchObject({this_month_usd: 40.4, capped: true, summaries_model: 'claude-haiku-5-5'});
  });
});
