// News's store against an ephemeral database (N1): stories leave the page 48 hours after their last
// new fact into the archive, which keeps the summary, sources and thumbnail and drops the rest, and
// goes after 90 days; seen is per story; Missed holds what left unseen; the routes serve it all; News
// sources keep their health to Settings › News; and the worker reads sources through their adapters.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  articleSchema, missedSchema, newsPageSchema, newsSectionOutSchema, newsSeenSchema, newsSourcesSchema, SEED_NOW, storySchema,
} from '@setpoint/shared';
import type {NewsSection} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, onTestFinished, test, vi} from 'vitest';
import {issueHaToken} from '../src/auth/haToken.ts';
import * as t from '../src/db/schema.ts';
import {outletOf} from '../src/domain/newsIngest.ts';
import {sourceRule} from '../src/domain/newsSorting.ts';
import type {ArticleNotes} from '../src/domain/newsSorting.ts';
import type {NewsAdapter} from '../src/news/adapter.ts';
import {saveNewsImage} from '../src/news/images.ts';
import {DEFAULT_NEWS_SOURCES, ensureNewsSources, LOCAL_SOURCES_FILE, localSourcesSchema, registerNewsSources} from '../src/news/sources.ts';
import {expireNews, markSeen} from '../src/news/store.ts';
import {NewsWorker} from '../src/news/worker.ts';
import {articleDetail, missed, newsPage, newsSection, newsSources, storyDetail} from '../src/queries/news.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {ProviderError} from '../src/sync/errors.ts';
import {Adapters} from '../src/sync/registry.ts';
import {client, liveEvents, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

const HOUR = 3_600_000;
const NOW = SEED_NOW;
const ago = (hours: number) => new Date(Date.parse(NOW) - hours * HOUR).toISOString();
const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-news-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  return dir;
}

/** An empty Setpoint with one News feed, and a directory for image copies. */
function newsWorld() {
  const w = world();
  const images = tempDir();
  const source = w.store.db.insert(t.newsSources).values({
    key: 'local:test', name: 'KTLA · Local news', section: 'local', kind: 'feed', adapter: 'feed', url: 'https://ktla.example/feed', reads: 'Feed',
    origin: 'local', intervalSeconds: 900, position: 0, createdAt: ago(24 * 30),
  }).returning().get();
  return {w, images, source};
}

let urls = 0;
function addArticle(w: World, sourceId: number, {outlet = 'KTLA', at = ago(1), text = null as string | null, metered = false, headline = 'A headline'} = {}) {
  urls += 1;
  const url = `https://outlet.example/${urls}`;
  return w.store.db.insert(t.newsArticles).values({
    sourceId, url, canonicalUrl: url, outlet, headline, feedSummary: 'The feed\'s summary', extractedText: text, metered, publishedAt: at, fetchedAt: at,
  }).returning().get().id;
}

function addStory(w: World, articleIds: number[], {sections = ['local'] as NewsSection[], lastFact = ago(1), seenAt = null as string | null, score = 50, facts = [] as [string, string][], image = null as number | null} = {}) {
  const story = w.store.db.insert(t.newsStories).values({
    headline: 'Brush fire near the 210 grows to 400 acres', oneLine: 'Evacuation warnings for foothill homes', summary: 'The summary from every source.', score,
    leadArticleId: articleIds[0]!, imageArticleId: image, firstReportedAt: facts[0]?.[0] ?? lastFact, lastNewFactAt: lastFact, seenAt, createdAt: lastFact,
  }).returning().get().id;
  sections.forEach((section, position) => w.store.db.insert(t.newsStorySections).values({storyId: story, section, position}).run());
  for (const articleId of articleIds) w.store.db.insert(t.newsStoryArticles).values({storyId: story, articleId, linkedAt: lastFact}).run();
  for (const [at, text] of facts) w.store.db.insert(t.newsFacts).values({storyId: story, at, text}).run();
  return story;
}

const copy = {bytes: PNG, mimeType: 'image/png' as const, width: 4, height: 3};
const files = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const pageIds = (w: World) => newsPage(w.store).blocks.flatMap(block => block.stories.map(story => story.id));

describe('the page and its 48 hours', () => {
  test('a story leaves the page 48 hours after its last new fact; Missed holds it only if the user hadn\'t seen it', () => {
    const {w, images, source} = newsWorld();
    const unseen = addStory(w, [addArticle(w, source.id)], {lastFact: ago(47)});
    const seen = addStory(w, [addArticle(w, source.id)], {lastFact: ago(47), seenAt: ago(30)});
    const developing = addStory(w, [addArticle(w, source.id)], {lastFact: ago(10)});
    expect(pageIds(w)).toEqual(expect.arrayContaining([unseen, seen, developing]));

    w.advance(1 * HOUR);
    // Past the 48 hours, a story is off the page even before the expiry has run.
    expect(pageIds(w)).toEqual([developing]);
    const outcome = expireNews(w.store, images);
    expect(outcome).toMatchObject({expired: [unseen, seen], missed: [unseen], purged: []});
    expect(pageIds(w)).toEqual([developing]);
    const out = missedSchema.parse(missed(w.store));
    expect(out.days.flatMap(day => day.stories.map(story => story.id))).toEqual([unseen]);
    // It left at the 48 hours, not when the expiry happened to run.
    expect(out.days[0]!.stories[0]!.expired_at).toBe(new Date(Date.parse(ago(47)) + 48 * HOUR).toISOString());
    expect(newsPage(w.store).missed).toEqual({count: 1, since: ago(30)});
    expect(liveEvents(w).filter(event => event.type === 'news').at(-1)).toEqual({type: 'news', stories: [unseen, seen], sections: ['local'], sources: []});
  });

  test('a new fact keeps a story up: the 48 hours start again', () => {
    const {w, images, source} = newsWorld();
    const story = addStory(w, [addArticle(w, source.id)], {lastFact: ago(40)});
    w.store.db.update(t.newsStories).set({lastNewFactAt: ago(1)}).where(eq(t.newsStories.id, story)).run();
    w.advance(20 * HOUR);
    expect(expireNews(w.store, images).expired).toEqual([]);
    expect(pageIds(w)).toEqual([story]);
  });
});

describe('the archive', () => {
  test('keeps the summary, the sources and the story\'s thumbnail, and drops the text, the facts and every other copy', () => {
    const {w, images, source} = newsWorld();
    const ktla = addArticle(w, source.id, {outlet: 'KTLA', at: ago(30)});
    const nbc = addArticle(w, source.id, {outlet: 'NBC Los Angeles', at: ago(31), text: 'A brush fire in the hills…'});
    for (const article of [ktla, nbc]) for (const variant of ['large', 'thumb'] as const) saveNewsImage(w.store, images, article, variant, copy);
    const story = addStory(w, [ktla, nbc], {lastFact: ago(30), image: ktla, facts: [[ago(40), 'About 60 acres'], [ago(30), 'Grew to 400 acres']]});
    expect(files(images)).toEqual([`${ktla}-large.png`, `${ktla}-thumb.png`, `${nbc}-large.png`, `${nbc}-thumb.png`]);
    expect(storyDetail(w.store, story).facts).toHaveLength(2);
    expect(articleDetail(w.store, nbc).text).toBe('A brush fire in the hills…');

    w.advance(18 * HOUR);
    const outcome = expireNews(w.store, images);
    expect(outcome.files.sort()).toEqual([`${ktla}-large.png`, `${nbc}-large.png`, `${nbc}-thumb.png`]);
    expect(files(images)).toEqual([`${ktla}-thumb.png`]);
    const archived = storySchema.parse(storyDetail(w.store, story));
    expect(archived).toMatchObject({summary: 'The summary from every source.', outlets: 2, facts: [], new_since: null, expired_at: ago(-18)});
    expect(archived.sources.map(source => source.outlet)).toEqual(['KTLA', 'NBC Los Angeles']);
    expect(archived.image).toMatchObject({large: null, outlet: 'KTLA', thumb: {width: 4, height: 3}});
    // The full text goes; the feed's summary and the link stay.
    expect(articleDetail(w.store, nbc)).toMatchObject({text: null, feed_summary: 'The feed\'s summary', image: null});
  });

  test('goes 90 days after the last fact, with its articles and files; articles never sorted go then too', () => {
    const {w, images, source} = newsWorld();
    const article = addArticle(w, source.id, {at: ago(2)});
    saveNewsImage(w.store, images, article, 'thumb', copy);
    const story = addStory(w, [article], {lastFact: ago(2), image: article});
    const unsorted = addArticle(w, source.id, {at: ago(2)});
    w.advance(50 * HOUR);
    expireNews(w.store, images);
    expect(files(images)).toEqual([`${article}-thumb.png`]);

    w.advance(90 * 24 * HOUR - 50 * HOUR);
    const later = addArticle(w, source.id, {at: new Date(w.store.now().getTime() - HOUR).toISOString()});
    w.store.db.update(t.newsArticles).set({fetchedAt: new Date(w.store.now().getTime() - HOUR).toISOString()}).where(eq(t.newsArticles.id, later)).run();
    expect(expireNews(w.store, images).purged).toEqual([story]);
    expect(files(images)).toEqual([]);
    expect(() => storyDetail(w.store, story)).toThrow(/No such story/);
    expect(w.store.db.select({id: t.newsArticles.id}).from(t.newsArticles).all().map(row => row.id)).toEqual([later]);
    expect(later).toBeGreaterThan(unsorted);
  });
});

describe('seen, per story', () => {
  test('a story is new until seen; a new fact after that makes it updated, with what\'s new since', () => {
    const {w, source} = newsWorld();
    const story = addStory(w, [addArticle(w, source.id), addArticle(w, source.id, {outlet: 'ABC7'})], {lastFact: ago(3), facts: [[ago(3), 'About 60 acres']]});
    expect(storyDetail(w.store, story).state).toBe('new');
    expect(markSeen(w.store, [story, 999])).toEqual([story]);
    expect(storyDetail(w.store, story)).toMatchObject({state: 'seen', seen_at: NOW, new_since: null});

    // Another outlet repeating the story isn't a new fact: it stays seen.
    w.advance(HOUR);
    const repeat = addArticle(w, source.id, {outlet: 'CBS Los Angeles', at: w.store.now().toISOString()});
    w.store.db.insert(t.newsStoryArticles).values({storyId: story, articleId: repeat, linkedAt: w.store.now().toISOString()}).run();
    expect(storyDetail(w.store, story)).toMatchObject({state: 'seen', outlets: 3});

    // A new fact brings the dot back as updated.
    const fact = w.store.now().toISOString();
    w.store.db.insert(t.newsFacts).values({storyId: story, at: fact, text: 'Suspect arrested'}).run();
    w.store.db.update(t.newsStories).set({lastNewFactAt: fact}).where(eq(t.newsStories.id, story)).run();
    expect(storyDetail(w.store, story)).toMatchObject({state: 'updated', new_since: {since: NOW, facts: [{at: fact, text: 'Suspect arrested'}]}});
    w.advance(HOUR);
    markSeen(w.store, [story]);
    expect(storyDetail(w.store, story)).toMatchObject({state: 'seen', new_since: null});
  });

  test('a story in two sections shares its seen state', () => {
    const {w, source} = newsWorld();
    const story = addStory(w, [addArticle(w, source.id)], {sections: ['ai', 'general']});
    markSeen(w.store, [story]);
    for (const section of ['ai', 'general'] as const) expect(newsSection(w.store, section).stories.map(row => [row.id, row.state, row.sections])).toEqual([[story, 'seen', ['ai', 'general']]]);
  });

  test('a Missed story leaves Missed once it\'s seen, and the strip goes with the last', () => {
    const {w, images, source} = newsWorld();
    const story = addStory(w, [addArticle(w, source.id)], {lastFact: ago(49)});
    expireNews(w.store, images);
    expect(newsPage(w.store).missed).toEqual({count: 1, since: null});
    markSeen(w.store, [story]);
    expect(newsPage(w.store).missed).toBeNull();
    expect(missed(w.store)).toEqual({since: null, count: 0, days: []});
  });
});

describe('All shows a story once, in its main section\'s block (D102)', () => {
  const read = (w: World, articleId: number, subject: ArticleNotes['subject'], sections: NewsSection[]) => w.store.db.update(t.newsArticles)
    .set({notes: {sections, kind: 'event', subject, facts: ['A fact'], importance: 60, place: null, keynote: null}}).where(eq(t.newsArticles.id, articleId)).run();

  test('a story in Tech and AI about AI leads only AI\'s block; both lists hold it, and "N more" counts it', () => {
    const {w, images, source} = newsWorld();
    const lab = addArticle(w, source.id, {outlet: 'The Verge'});
    read(w, lab, 'ai', ['tech', 'ai']);
    // Stored as the released code sorted it: position 0 is NEWS_SECTIONS order, Tech before AI.
    const both = addStory(w, [lab], {sections: ['tech', 'ai'], score: 95});
    const tech = [90, 80, 75, 72].map(score => {
      const article = addArticle(w, source.id, {outlet: 'Engadget'});
      read(w, article, 'tech', ['tech']);
      return addStory(w, [article], {sections: ['tech'], score});
    });
    // The seed's stand-ins have no reading: their first section is the main one.
    const unread = addStory(w, [addArticle(w, source.id, {outlet: 'Reuters'})], {sections: ['ai', 'general'], score: 58});

    const page = newsPageSchema.parse(newsPage(w.store));
    const block = (section: NewsSection) => page.blocks.find(one => one.section === section)!;
    // Tech's block is sized from its own stories (four, the fourth over the bar), and "N more" is the one it left to Tech's list.
    expect(block('tech')).toMatchObject({stories: tech.map(id => expect.objectContaining({id})), more: 1});
    expect(block('ai')).toMatchObject({stories: [expect.objectContaining({id: both}), expect.objectContaining({id: unread})], more: 0});
    expect(block('general')).toMatchObject({stories: [], more: 1});
    expect(page.blocks.flatMap(one => one.stories.map(story => story.id)).sort((a, b) => a - b)).toEqual([both, ...tech, unread].sort((a, b) => a - b));
    // Each section's list still holds every story in it; "N more" is its list less what the block showed.
    expect(newsSection(w.store, 'tech').stories.map(story => story.id)).toEqual([both, ...tech]);
    expect(newsSection(w.store, 'ai').stories.map(story => story.id)).toEqual([both, unread]);
    expect(newsSection(w.store, 'general').stories.map(story => story.id)).toEqual([unread]);
    for (const one of page.blocks) expect(one.more).toBe(newsSection(w.store, one.section).stories.length - one.stories.length);

    // Missed names the main section too.
    w.advance(49 * HOUR);
    expireNews(w.store, images);
    const out = missedSchema.parse(missed(w.store));
    expect(out.days.flatMap(day => day.stories.map(story => [story.id, story.section]))).toEqual([[both, 'ai'], ...tech.map(id => [id, 'tech']), [unread, 'ai']]);
  });
});

describe('the routes', () => {
  test('All, a section, a story, an article, Missed, Settings › News and seen, on the seed', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const page = newsPageSchema.parse((await c.send('GET', '/api/news')).body);
    const fire = page.blocks[0]!.stories[0]!;
    expect(newsSectionOutSchema.parse((await c.send('GET', '/api/news/sections/local')).body).stories).toHaveLength(17);
    expect((await c.send('GET', '/api/news/sections/sports')).status).toBe(400);
    const story = storySchema.parse((await c.send('GET', `/api/news/stories/${fire.id}`)).body);
    const nbc = story.sources.find(source => source.outlet === 'NBC Los Angeles')!;
    expect(articleSchema.parse((await c.send('GET', `/api/news/articles/${nbc.article_id}`)).body)).toMatchObject({byline: 'Staff report', summary_only: false});
    const metered = w.store.db.select().from(t.newsArticles).where(eq(t.newsArticles.metered, true)).get()!;
    expect((await c.send('GET', `/api/news/articles/${metered.id}`)).status).toBe(404);
    expect(missedSchema.parse((await c.send('GET', '/api/news/missed')).body).count).toBe(14);
    newsSourcesSchema.parse((await c.send('GET', '/api/news/sources')).body);
    expect((await c.send('GET', '/api/news/stories/99999')).status).toBe(404);

    const before = liveEvents(w).length;
    const seen = await c.send('POST', '/api/news/seen', {body: {story_ids: [fire.id]}});
    expect(newsSeenSchema.parse(seen.body).stories).toMatchObject([{id: fire.id, state: 'seen', seen_at: SEED_NOW}]);
    expect(liveEvents(w).slice(before)).toEqual([{type: 'news', stories: [fire.id], sections: [], sources: []}]);
    expect((await c.send('POST', '/api/news/seen', {body: {story_ids: []}})).status).toBe(400);
    // Seen is a change: it comes from Setpoint's own page.
    expect((await c.send('POST', '/api/news/seen', {body: {story_ids: [fire.id]}, headers: {origin: 'https://elsewhere.example'}})).status).toBe(403);
    expect((await client(w).send('GET', '/api/news')).status).toBe(401);
  });

  test('an image is Setpoint\'s own copy, served from the data directory', async () => {
    const {w, images, source} = newsWorld();
    const article = addArticle(w, source.id);
    const image = saveNewsImage(w.store, images, article, 'thumb', copy);
    const c = await signedIn(w, {news: {imagesDir: images}});
    const served = await c.send('GET', `/api/news/images/${image.id}`);
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/png');
    expect(served.headers.get('cache-control')).toBe('private, max-age=86400');
    expect((await c.send('GET', '/api/news/images/999')).status).toBe(404);
    fs.rmSync(path.join(images, image.file));
    expect((await c.send('GET', `/api/news/images/${image.id}`)).status).toBe(404);
  });
});

/** A News adapter whose next read does what the test says. */
function fakeNews() {
  let next: {articles: {headline: string; url: string}[]} | {error: ProviderError} = {articles: []};
  const cursors: (string | null)[] = [];
  const adapter: NewsAdapter = {
    async fetch(_, cursor) {
      cursors.push(cursor);
      if ('error' in next) throw next.error;
      return {
        articles: next.articles.map(article => ({url: article.url, canonicalUrl: article.url, outlet: 'NPR', headline: article.headline, publishedAt: SEED_NOW})),
        cursor: `etag-${cursors.length}`,
      };
    },
  };
  return {adapter, cursors, serve: (articles: {headline: string; url: string}[]) => (next = {articles}), fail: (error: ProviderError) => (next = {error})};
}

describe('News sources on the sync engine', () => {
  // The engine claims 20 jobs a tick (claimDueJobs), fewer than the built-in list's feeds: a round
  // of reads takes as many ticks as that needs.
  const readRound = async (engine: SyncEngine, store: World['store']) => {
    const feeds = store.db.select().from(t.newsSources).where(eq(t.newsSources.adapter, 'feed')).all().length;
    for (let tick = 0; tick < Math.ceil(feeds / 20); tick += 1) {
      await engine.tick();
      await engine.settled();
    }
  };

  test('each source is read as a durable job through its adapter: articles once each, the cursor kept, the heartbeat recorded', async () => {
    const w = world();
    ensureNewsSources(w.store, []);
    const fake = fakeNews();
    const news = new NewsWorker({store: w.store, adapters: {feed: fake.adapter}});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters(), workers: [news]});
    const npr = w.store.db.select().from(t.newsSources).where(eq(t.newsSources.key, 'npr-national')).get()!;
    const feeds = w.store.db.select().from(t.newsSources).where(eq(t.newsSources.adapter, 'feed')).all();

    fake.serve([{headline: 'Hurricane Teresa makes landfall', url: 'https://npr.example/1'}, {headline: 'Judge blocks a rule', url: 'https://npr.example/2'}]);
    await readRound(engine, w.store);
    expect(fake.cursors).toHaveLength(feeds.length);
    expect(fake.cursors.every(cursor => cursor === null)).toBe(true);
    const sources = newsSourcesSchema.parse(newsSources(w.store));
    const row = (id: number) => sources.sections.flatMap(section => section.sources).find(source => source.id === id)!;
    expect(row(npr.id).health).toMatchObject({state: 'healthy', last_check_at: SEED_NOW, failing_since: null});
    // Sources N2 hasn't built an adapter for aren't read and have no health yet, rather than failing.
    const nws = w.store.db.select().from(t.newsSources).where(eq(t.newsSources.key, 'nws-alerts')).get()!;
    expect(row(nws.id).health).toBeNull();
    const jobs = w.store.db.select().from(t.jobs).all();
    expect(jobs.filter(job => job.kind === 'news').every(job => feeds.some(feed => feed.id === job.newsSourceId))).toBe(true);
    // N3: what they brought is sorted next, as a durable job, one at a time.
    const sorts = jobs.filter(job => job.kind !== 'news');
    expect(new Set(sorts.map(job => job.key))).toEqual(new Set(['news_sort']));
    expect(sorts.filter(job => job.state === 'queued' || job.state === 'running').length).toBeLessThanOrEqual(1);
    expect(w.store.db.select().from(t.newsSources).where(eq(t.newsSources.id, npr.id)).get()!.cursor).toMatch(/^etag-/);
    expect(w.store.db.select().from(t.newsArticles).where(eq(t.newsArticles.sourceId, npr.id)).all()).toHaveLength(2);

    // Due again after its 15 minutes: the same items aren't kept twice.
    w.advance(15 * 60_000);
    await readRound(engine, w.store);
    expect(w.store.db.select().from(t.newsArticles).where(eq(t.newsArticles.sourceId, npr.id)).all()).toHaveLength(2);
    engine.stop();
  });

  test('a failing source says since when in Settings › News, and recovers', async () => {
    const w = world();
    ensureNewsSources(w.store, []);
    const fake = fakeNews();
    const news = new NewsWorker({store: w.store, adapters: {feed: fake.adapter}});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters(), workers: [news]});
    const npr = w.store.db.select().from(t.newsSources).where(eq(t.newsSources.key, 'npr-national')).get()!;
    const health = () => newsSources(w.store).sections.flatMap(section => section.sources).find(source => source.id === npr.id)!.health;

    fake.fail(new ProviderError('permanent', '404 Not Found', {status: 404}));
    await readRound(engine, w.store);
    expect(health()).toMatchObject({state: 'failing', reason: '404 Not Found', failing_since: SEED_NOW});
    const failedAt = SEED_NOW;
    w.advance(15 * 60_000);
    await readRound(engine, w.store);
    expect(health()).toMatchObject({state: 'failing', failing_since: failedAt});
    expect(liveEvents(w).some(event => event.type === 'news' && event.sources.includes(npr.id))).toBe(true);

    fake.serve([]);
    w.advance(15 * 60_000);
    await readRound(engine, w.store);
    expect(health()).toMatchObject({state: 'healthy', failing_since: null});
    engine.stop();
  });

  test('the seed\'s stand-ins are never read, whatever adapters there are', async () => {
    const w = world({seed: true});
    const fake = fakeNews();
    const engine = new SyncEngine({store: w.store, adapters: new Adapters(), workers: [new NewsWorker({store: w.store, adapters: {feed: fake.adapter, page_read: fake.adapter}})]});
    await engine.tick();
    await engine.settled();
    expect(fake.cursors).toEqual([]);
    expect(w.store.db.select().from(t.jobs).all().filter(job => job.kind === 'news')).toEqual([]);
    engine.stop();
  });
});

describe('News health stays in Settings › News', () => {
  test('failing and stale News sources never reach the health pill, Settings › Accounts or mantel\'s status', async () => {
    const w = world({seed: true});
    const {token} = issueHaToken(w.store);
    const c = await signedIn(w);
    const surfaces = async () => ({
      sources: (await c.send('GET', '/api/sources')).body,
      accounts: (await c.send('GET', '/api/accounts')).body,
      triage: (await c.send('GET', '/api/mail/triage')).body,
      ha: (await c.send('GET', '/api/status/ha', {headers: {authorization: `Bearer ${token}`}})).body,
    });
    const before = await surfaces();

    // Every News source fails, and one also stops being checked: the whole of Local is down.
    w.store.db.update(t.newsSources).set({lastCheckAt: SEED_NOW, lastErrorAt: SEED_NOW, lastError: '503 Service Unavailable', failingSince: SEED_NOW}).run();
    w.store.db.update(t.newsSources).set({lastCheckAt: ago(2)}).where(eq(t.newsSources.key, 'nws-alerts')).run();
    const fake = fakeNews();
    fake.fail(new ProviderError('transient', '503 Service Unavailable', {status: 503}));
    const news = new NewsWorker({store: w.store, adapters: {feed: fake.adapter}});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters(), workers: [news]});
    const events = liveEvents(w).length;
    await engine.tick();
    await engine.settled();
    engine.stop();

    expect(await surfaces()).toEqual({...before, ha: {...before.ha, as_of: expect.any(String)}});
    const health = liveEvents(w).slice(events).filter(event => event.type === 'health');
    const newsIds = new Set(w.store.db.select({id: t.newsSources.id}).from(t.newsSources).all().map(row => row.id));
    const mailSources = new Set((before.sources as {id: number}[]).map(source => source.id));
    // The engine's health events name only its own sources (ids are separate sequences, so check by table).
    expect(health.flatMap(event => event.sources).every(id => mailSources.has(id))).toBe(true);
    expect(liveEvents(w).slice(events).some(event => event.type === 'news' && event.sources.length > 0)).toBe(true);
    expect(newsIds.size).toBeGreaterThan(0);

    // Settings › News shows them, and the page says so only for a whole section.
    const settings = newsSources(w.store);
    expect(settings.sections.flatMap(section => section.sources).every(source => source.health?.state === 'failing' || source.health?.state === 'stale')).toBe(true);
    expect(newsPage(w.store).blocks[0]!.health).toEqual({state: 'stale', as_of: expect.any(String)});
  });

  test('on the seed, one failing feed shows in Settings › News and nowhere on the page', () => {
    const w = world({seed: true});
    const failing = newsSources(w.store).sections.flatMap(section => section.sources).filter(source => source.health?.state !== 'healthy');
    expect(failing).toMatchObject([{name: 'FOX 11 · Local news', health: {state: 'failing', reason: '404 Not Found'}}]);
    expect(newsPage(w.store).blocks.map(block => block.health)).toEqual([null, null, null, null]);
  });
});

describe('the lists of sources (D91)', () => {
  test('the built-in list is registered by key; the local list comes from the data directory, first copied from the checkout\'s', () => {
    const w = world();
    const dataDir = tempDir();
    const repoFile = path.join(tempDir(), 'local-sources.json');
    fs.writeFileSync(repoFile, JSON.stringify({sources: [
      {key: 'channel-4', name: 'Channel 4', url: 'https://www.example.com/feed', summary_only: true},
      {key: 'area-search', name: 'Google News · area search', kind: 'discovery', adapter: 'google_news', config: {query: 'Example City'}, reads: 'Finds stories, never read'},
    ]}));
    const added = registerNewsSources(w.store, dataDir, repoFile);
    expect(added).toHaveLength(DEFAULT_NEWS_SOURCES.length + 2);
    expect(fs.readFileSync(path.join(dataDir, LOCAL_SOURCES_FILE), 'utf8')).toBe(fs.readFileSync(repoFile, 'utf8'));
    const local = w.store.db.select().from(t.newsSources).where(eq(t.newsSources.origin, 'local')).all();
    expect(local.map(row => [row.key, row.section, row.kind, row.summaryOnly, row.intervalSeconds])).toEqual([
      ['local:channel-4', 'local', 'feed', true, 900], ['local:area-search', 'local', 'discovery', false, 1800],
    ]);

    // Again: nothing new. The data directory's list wins over the checkout's from now on; a source
    // dropped from it is retired, not deleted.
    expect(registerNewsSources(w.store, dataDir, repoFile)).toEqual([]);
    fs.writeFileSync(path.join(dataDir, LOCAL_SOURCES_FILE), JSON.stringify({sources: [{key: 'channel-4', name: 'Channel 4', url: 'https://www.example.com/feed'}]}));
    registerNewsSources(w.store, dataDir, repoFile);
    expect(w.store.db.select().from(t.newsSources).where(eq(t.newsSources.key, 'local:area-search')).get()!.retiredAt).toBe(SEED_NOW);
    expect(newsSources(w.store).sections[0]!.sources.map(source => source.name)).not.toContain('Google News · area search');

    // A list that can't be read leaves the local sources as they were.
    fs.writeFileSync(path.join(dataDir, LOCAL_SOURCES_FILE), '{"sources": [{"name": "no key"}]}');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerNewsSources(w.store, dataDir, repoFile);
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
    expect(w.store.db.select().from(t.newsSources).where(eq(t.newsSources.key, 'local:channel-4')).get()!.retiredAt).toBeNull();
  });

  test('N5: a source names its tile\'s icon, kept in its config and given to Settings › News; one not allowed makes the list unreadable, so nothing changes', () => {
    const w = world();
    const dataDir = tempDir();
    fs.writeFileSync(path.join(dataDir, LOCAL_SOURCES_FILE), JSON.stringify({sources: [
      {key: 'channel-4', name: 'Channel 4', url: 'https://www.example.com/feed', icon: 'live_tv'},
      {key: 'crime-wire', name: 'County crime wire', url: 'https://sheriff.example.org/feed', icon: 'local_police'},
      {key: 'area', name: 'Area news site', url: 'https://www.example.org/feed'},
    ]}));
    registerNewsSources(w.store, dataDir, null);
    const tiles = () => newsSourcesSchema.parse(newsSources(w.store)).sections[0]!.sources.map(source => [source.name, source.icon]);
    expect(tiles().filter(([name]) => ['Channel 4', 'County crime wire', 'Area news site'].includes(name as string))).toEqual([
      ['Channel 4', 'live_tv'], ['County crime wire', 'local_police'], ['Area news site', null],
    ]);
    // The hazard APIs name none: their tile is their adapter's.
    expect(tiles().find(([name]) => name === 'National Weather Service')?.[1]).toBeNull();
    expect(w.store.db.select().from(t.newsSources).where(eq(t.newsSources.key, 'local:channel-4')).get()!.config).toEqual({icon: 'live_tv'});

    // An icon not allowed: the list isn't read, and the sources stay as they were.
    fs.writeFileSync(path.join(dataDir, LOCAL_SOURCES_FILE), JSON.stringify({sources: [{key: 'channel-4', name: 'Channel 4', url: 'https://www.example.com/feed', icon: 'rocket'}]}));
    expect(localSourcesSchema.safeParse(JSON.parse(fs.readFileSync(path.join(dataDir, LOCAL_SOURCES_FILE), 'utf8'))).success).toBe(false);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    registerNewsSources(w.store, dataDir, null);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0]![0])).toContain('icon');
    logged.mockRestore();
    expect(tiles().filter(([name]) => name === 'Channel 4' || name === 'County crime wire')).toEqual([['Channel 4', 'live_tv'], ['County crime wire', 'local_police']]);
  });

  test('the built-in list (the 2026-10-10 research): each key once; an outlet\'s feeds and pages share its name, so a story counts it once; only newsrooms speak for a company', () => {
    const keys = DEFAULT_NEWS_SOURCES.map(source => source.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const source of DEFAULT_NEWS_SOURCES) {
      expect(source.key).toMatch(/^[a-z0-9-]{1,64}$/);
      expect(new URL(source.url!).protocol).toBe('https:');
    }
    // The outlets' feeds and pages name their outlet; the hazard APIs and Hacker News name their own.
    const outlets = new Map<string, string[]>();
    for (const source of DEFAULT_NEWS_SOURCES.filter(spec => spec.adapter === 'feed' || spec.adapter === 'page_read')) {
      expect(typeof source.config?.outlet, source.key).toBe('string');
      const {outlet} = outletOf(source.name, source.config ?? {});
      outlets.set(outlet, [...(outlets.get(outlet) ?? []), source.key]);
    }
    expect(Object.fromEntries([...outlets].filter(([, list]) => list.length > 1))).toEqual({
      'Google': ['google-products', 'google-pixel', 'google-ai', 'google-gemini'],
      'The Verge': ['the-verge-apple', 'the-verge-google', 'the-verge-samsung', 'the-verge-tech', 'the-verge-ai'],
      'Ars Technica': ['ars-technica-gadgets', 'ars-technica-ai'],
      'Anthropic': ['anthropic-news', 'claude-release-notes', 'claude-apps-release-notes', 'anthropic-status'],
      'NPR': ['npr-national', 'npr-law'],
    });
    // The newsrooms speak for their company (a keynote they announce is confirmed); the press doesn't.
    const firstParty = DEFAULT_NEWS_SOURCES.flatMap(source => {
      const company = sourceRule(source).firstParty;
      return company ? [`${source.key}: ${company}`] : [];
    });
    expect(firstParty).toEqual([
      'apple-newsroom: apple', 'google-products: google', 'google-pixel: google', 'samsung-newsroom: samsung', 'microsoft-news: microsoft',
      'anthropic-news: anthropic', 'claude-release-notes: anthropic', 'claude-apps-release-notes: anthropic', 'anthropic-status: anthropic',
      'google-ai: google', 'google-gemini: google', 'openai-news: openai', 'google-deepmind: google', 'meta-newsroom: meta', 'hugging-face: hugging face', 'mistral-news: mistral',
    ]);
    // Hacker News at 300 points; Cal Fire's GeoJSON list on its incidents host, as www.fire.ca.gov refuses it.
    expect(DEFAULT_NEWS_SOURCES.find(source => source.key === 'hacker-news')!.config).toEqual({minPoints: 300});
    expect(DEFAULT_NEWS_SOURCES.find(source => source.key === 'cal-fire')!.url).toBe('https://incidents.fire.ca.gov/umbraco/api/IncidentApi/GeoJsonList?inactive=false');
  });

  test('a built-in source already registered takes its new address, config and interval at start, keeping its row (AirNow\'s file, SV-45)', () => {
    const w = world();
    ensureNewsSources(w.store, []);
    const row = () => w.store.db.select().from(t.newsSources).where(eq(t.newsSources.key, 'airnow')).get()!;
    // As production registered it: the retired web service, every 5 minutes.
    const {id} = row();
    w.store.db.update(t.newsSources).set({url: 'https://www.airnowapi.org/aq/observation/latLong/current/', config: {radiusKm: 25}, intervalSeconds: 300})
      .where(eq(t.newsSources.id, id)).run();
    expect(registerNewsSources(w.store, tempDir(), null)).toEqual([]);
    expect(row()).toMatchObject({id, url: 'https://files.airnowtech.org/airnow/today/reportingarea.dat', config: {radiusKm: 40, minAqi: 151}, intervalSeconds: 3600,
      reads: 'Unhealthy air within 40 km', retiredAt: null});
  });

  test('a seeded database keeps its stand-ins: no source a fetch could reach is added', () => {
    const w = world({seed: true});
    const before = w.store.db.select().from(t.newsSources).all();
    expect(registerNewsSources(w.store, tempDir(), null)).toEqual([]);
    expect(w.store.db.select().from(t.newsSources).all()).toEqual(before);
    expect(before.every(source => source.dev)).toBe(true);
  });

  test('the repository names no local source: the example uses example domains, the built-in list none', () => {
    const example = fileURLToPath(new URL('../news/local-sources.example.json', import.meta.url));
    const parsed = localSourcesSchema.parse(JSON.parse(fs.readFileSync(example, 'utf8')));
    expect(parsed.sources.length).toBeGreaterThan(0);
    for (const source of parsed.sources) if (source.url) expect(new URL(source.url).hostname).toMatch(/(^|\.)example\.(com|org)$/);
    // The built-in list's Local sources are the hazard APIs, which ask about the home location.
    expect(DEFAULT_NEWS_SOURCES.filter(source => source.section === 'local').every(source => source.kind === 'official_api')).toBe(true);
    expect(fs.readFileSync(fileURLToPath(new URL('../../.gitignore', import.meta.url)), 'utf8')).toContain('server/news/local-sources.json');
  });
});
