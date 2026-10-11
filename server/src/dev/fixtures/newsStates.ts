// N5's fixtures (SV decision D3): News's states the seed doesn't have, for boards 29a, 29b and 30b
// and the News and Settings browser checks. Registered in index.ts. Everything here is invented and
// reaches no model or feed: the articles waiting to be sorted come from sources no adapter reads
// outside production (`.example` addresses), sorting's next try is held far ahead, and the hourly
// ranking has just run, so nothing asks a model while a check runs.
//
//   news-ai-down     29a: sorting down since 8:52 AM (Anthropic didn't answer), 12 articles waiting
//   news-stale-ai    29a: every AI source last checked at 7:02 AM ("AI, as of 7:02 AM")
//   news-quiet-tech  29a: no Tech story on the page, nor its keynote ("Nothing new in Tech since Mon")
//   news-first-run   29b: the first run sorting the last 48 hours, 186 of 312 articles; nothing
//                    seen yet, no Missed, and nothing sorted into AI yet
//   news-capped      the cap reached: $22 more of story summaries this month, $40.40 of $40
import {SEED_NOW} from '@setpoint/shared';
import type {NewsSection} from '@setpoint/shared';
import {and, eq, inArray, isNotNull, isNull, notInArray} from 'drizzle-orm';
import type {Db, OpenDatabase} from '../../db/open.ts';
import * as t from '../../db/schema.ts';
import {zoned} from '../sample.ts';

const MINUTE = 60_000;
const minutesAgo = (minutes: number) => new Date(Date.parse(SEED_NOW) - minutes * MINUTE).toISOString();
const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/** Sorting's state as the fixture has it: the ranking just ran, so its hour isn't up while a check runs. */
function sorting(db: Db, values: Partial<typeof t.newsSorting.$inferInsert>) {
  const row = {lastRankedAt: SEED_NOW, ...values};
  db.insert(t.newsSorting).values({id: 1, ...row}).onConflictDoUpdate({target: t.newsSorting.id, set: row}).run();
}

/** Sorting's next try, held far ahead, as a hung retry would be: no sort starts while a check runs. */
function holdSorting(db: Db) {
  db.insert(t.jobs).values({kind: 'news_sort', key: 'news_sort', state: 'queued', attempts: 1, runAt: '2099-01-01T00:00:00.000Z', createdAt: SEED_NOW}).run();
}

/** A source the fixture's articles come through: not the seed's (so they count as waiting), and read by nothing outside production. */
function fixtureSource(db: Db, section: NewsSection, name: string): number {
  return db.insert(t.newsSources).values({
    key: `fixture:${slug(name)}`, name, section, kind: 'feed', adapter: 'feed', url: `https://${slug(name)}.example/feed`, reads: 'Feed',
    origin: 'default', dev: false, intervalSeconds: 15 * 60, position: 900, createdAt: zoned('2026-08-01', '09:00'),
  }).returning({id: t.newsSources.id}).get().id;
}

// Board 29a's twelve, as their sources gave them: invented events (incidents happen to Fabrikam).
const WAITING: {section: NewsSection; outlet: string; headline: string; minutes: number}[] = [
  {section: 'local', outlet: 'KTLA', headline: 'Crews contain a brush fire near the 210 at 40%', minutes: 3},
  {section: 'general', outlet: 'NPR', headline: 'Hurricane Teresa weakens to a tropical storm over Georgia', minutes: 5},
  {section: 'tech', outlet: 'The Verge', headline: 'Pixel Watch 5 reviews praise its two-day battery', minutes: 7},
  {section: 'local', outlet: 'NBC Los Angeles', headline: 'Metro adds weekend service on the A Line', minutes: 9},
  {section: 'ai', outlet: 'Ars Technica', headline: 'Fabrikam Hub publishes its token leak report', minutes: 11},
  {section: 'general', outlet: 'ABC News', headline: 'Ohio warehouse suspect appears in court', minutes: 12},
  {section: 'tech', outlet: '9to5Mac', headline: 'iOS 26.1 beta 3 is out for developers', minutes: 13},
  {section: 'local', outlet: 'LAist', headline: 'County extends cooling center hours through Friday', minutes: 14},
  {section: 'ai', outlet: 'TechCrunch', headline: 'Hugging Face opens video inference to free accounts', minutes: 15},
  {section: 'general', outlet: 'CBS News', headline: 'Shutdown talks resume as parks stay closed', minutes: 16},
  {section: 'tech', outlet: 'Engadget', headline: 'Samsung\'s Galaxy Ring 2 goes on sale in the US', minutes: 18},
  {section: 'local', outlet: 'ABC7', headline: 'Water main repairs close two lanes downtown', minutes: 19},
];

function waitingArticles(db: Db, articles: {section: NewsSection; outlet: string; headline: string; at: string; sortedAt: string | null}[]) {
  const sources = new Map<string, number>();
  for (const article of articles) {
    const name = `Fixture · ${article.outlet}`;
    const sourceId = sources.get(name) ?? fixtureSource(db, article.section, name);
    sources.set(name, sourceId);
    const url = `https://${slug(article.outlet)}.example/news/${slug(article.headline)}`;
    db.insert(t.newsArticles).values({
      sourceId, url, canonicalUrl: url, outlet: article.outlet, headline: article.headline, feedSummary: null,
      publishedAt: article.at, fetchedAt: article.at, sortedAt: article.sortedAt,
    }).run();
  }
}

export function newsAiDown({db}: OpenDatabase) {
  sorting(db, {
    lastSuccessAt: zoned('2026-10-07', '08:51'), lastFailureAt: minutesAgo(1), failingSince: zoned('2026-10-07', '08:52'),
    lastError: 'Anthropic didn\'t answer in time.', lastErrorKind: 'transient',
  });
  holdSorting(db);
  waitingArticles(db, WAITING.map(article => ({...article, at: minutesAgo(article.minutes), sortedAt: null})));
}

export function newsStaleAi({db}: OpenDatabase) {
  const at = zoned('2026-10-07', '07:02');
  db.update(t.newsSources).set({lastCheckAt: at, lastSuccessAt: at, lastErrorAt: null, lastError: null, failingSince: null})
    .where(and(eq(t.newsSources.section, 'ai'), isNull(t.newsSources.retiredAt))).run();
}

/** Takes stories off the page as if they'd never been: their articles and image copies go with them. */
function removeStories(db: Db, storyIds: number[]) {
  if (!storyIds.length) return;
  const articles = db.select({id: t.newsStoryArticles.articleId}).from(t.newsStoryArticles).where(inArray(t.newsStoryArticles.storyId, storyIds)).all().map(row => row.id);
  db.delete(t.newsStories).where(inArray(t.newsStories.id, storyIds)).run();
  if (articles.length) db.delete(t.newsArticles).where(inArray(t.newsArticles.id, articles)).run();
}

/** The stories on the page sitting only in `section`. */
function onlyIn(db: Db, section: NewsSection, {onPage}: {onPage: boolean}): number[] {
  const inOthers = db.select({id: t.newsStorySections.storyId}).from(t.newsStorySections).where(notInArray(t.newsStorySections.section, [section])).all().map(row => row.id);
  return db.select({id: t.newsStories.id}).from(t.newsStories)
    .innerJoin(t.newsStorySections, eq(t.newsStorySections.storyId, t.newsStories.id))
    .where(and(eq(t.newsStorySections.section, section), onPage ? isNull(t.newsStories.expiredAt) : undefined, inOthers.length ? notInArray(t.newsStories.id, inOthers) : undefined))
    .all().map(row => row.id);
}

export function newsQuietTech({db}: OpenDatabase) {
  removeStories(db, onlyIn(db, 'tech', {onPage: true}));
}

// 312 articles in the last 48 hours, the first 186 sorted (into stories, or left out as noise).
const FIRST_RUN_TOTAL = 312;
const FIRST_RUN_SORTED = 186;
const FIRST_RUN_SECTIONS: NewsSection[] = ['local', 'tech', 'ai', 'general'];

export function newsFirstRun({db}: OpenDatabase) {
  sorting(db, {firstRunStartedAt: zoned('2026-10-07', '08:40'), firstRunDoneAt: null});
  holdSorting(db);
  // A first run has no history: nothing seen yet and nothing missed.
  removeStories(db, db.select({id: t.newsStories.id}).from(t.newsStories).where(isNotNull(t.newsStories.expiredAt)).all().map(row => row.id));
  db.update(t.newsStories).set({seenAt: null}).run();
  // Nothing sorted into AI yet: its own stories aren't made, and a story it shares keeps its other section.
  removeStories(db, onlyIn(db, 'ai', {onPage: true}));
  db.delete(t.newsStorySections).where(eq(t.newsStorySections.section, 'ai')).run();
  const span = 48 * 60;
  waitingArticles(db, Array.from({length: FIRST_RUN_TOTAL}, (_, index) => {
    const at = minutesAgo(span - Math.floor((index * span) / FIRST_RUN_TOTAL));
    return {
      section: FIRST_RUN_SECTIONS[index % FIRST_RUN_SECTIONS.length]!, outlet: `Outlet ${String(index % 24 + 1).padStart(2, '0')}`,
      headline: `First run article ${index + 1}`, at, sortedAt: index < FIRST_RUN_SORTED ? SEED_NOW : null,
    };
  }));
}

export function newsCapped({db}: OpenDatabase) {
  db.insert(t.aiUsage).values({
    at: zoned('2026-10-07', '06:00'), provider: 'anthropic', model: 'claude-sonnet-5-5', purpose: 'news_stories', messageId: null,
    inputTokens: 700_000, outputTokens: 70_000, costMicros: 22_000_000,
  }).run();
}
