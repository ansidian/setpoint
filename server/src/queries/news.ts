// News's reads (N1; shapes in `@setpoint/shared` src/api/news.ts): All's blocks, a section's list,
// a story and its sources, an article, Missed and Settings › News. Order is the stored score, biggest
// first (N3 ranks); dots, the leading outlet, the block's size, a story's main section (All's one
// block for it and Missed's name for it, D102) and a section's line follow src/domain/news.ts. N3
// adds the bar (a story under it never shows: not on the page, in Missed or in search), Missed's
// limit of five per section per day, and search over the 90-day archive.
import type {
  ArticleOut, MissedOut, MissedStoryOut, NewsBlockOut, NewsImageOut, NewsPageOut, NewsSearchInput, NewsSearchOut, NewsSection, NewsSectionOut, NewsSourcesOut,
  SectionHealthOut, StoryFactOut, StoryOut, StoryRowOut, UpcomingOut,
} from '@setpoint/shared';
import {NEWS_SECTIONS, NEWS_SOURCE_ICONS} from '@setpoint/shared';
import type {NewsSourceIcon} from '@setpoint/shared';
import {and, asc, count, desc, eq, gt, gte, inArray, isNotNull, lte, max} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import type {Health} from '../domain/health.ts';
import {ARCHIVE_MS, blockSize, leadOf, listedArticles, mainSection, newSince, sectionHealth, sectionOrder, storyState} from '../domain/news.ts';
import {limitMissed, matchesAll, searchWords, sourceRule} from '../domain/newsSorting.ts';
import {localDay, zonedInstant} from '../domain/time.ts';
import {notFound} from '../errors.ts';
import {activeNewsSources} from '../news/sources.ts';
import {liveCondition, missedCondition, newsSourceHealth, overBar} from '../news/store.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';

type ArticleRow = typeof t.newsArticles.$inferSelect;
type ImageRow = typeof t.newsImages.$inferSelect;

const imageOut = (image: ImageRow): NewsImageOut => ({id: image.id, url: `/api/news/images/${image.id}`, width: image.width, height: image.height});
const shortName = (article: ArticleRow) => article.outletShort ?? article.outlet;

interface Loaded {
  rows: Map<number, StoryRowOut>;
  articles: Map<number, ArticleRow[]>;
  // Each row's main section (D102).
  main: Map<number, NewsSection>;
}

/** Stories as rows, with their sections, sources and image. A story with nothing to show (metered only) has no row. */
function loadRows(store: Store, storyIds: readonly number[]): Loaded {
  const rows = new Map<number, StoryRowOut>();
  const articles = new Map<number, ArticleRow[]>();
  const main = new Map<number, NewsSection>();
  if (!storyIds.length) return {rows, articles, main};
  const ids = [...new Set(storyIds)];
  const stories = store.db.select().from(t.newsStories).where(inArray(t.newsStories.id, ids)).all();
  const sections = new Map<number, NewsSection[]>();
  for (const row of store.db.select().from(t.newsStorySections).where(inArray(t.newsStorySections.storyId, ids)).orderBy(asc(t.newsStorySections.position)).all()) {
    sections.set(row.storyId, [...(sections.get(row.storyId) ?? []), row.section]);
  }
  for (const row of store.db.select({storyId: t.newsStoryArticles.storyId, article: t.newsArticles}).from(t.newsStoryArticles)
    .innerJoin(t.newsArticles, eq(t.newsArticles.id, t.newsStoryArticles.articleId)).where(inArray(t.newsStoryArticles.storyId, ids)).all()) {
    articles.set(row.storyId, [...(articles.get(row.storyId) ?? []), row.article]);
  }
  const imageArticles = stories.map(story => story.imageArticleId).filter((id): id is number => id !== null);
  const images = new Map<number, Partial<Record<ImageRow['variant'], ImageRow>>>();
  if (imageArticles.length) {
    for (const image of store.db.select().from(t.newsImages).where(inArray(t.newsImages.articleId, imageArticles)).all()) {
      images.set(image.articleId, {...images.get(image.articleId), [image.variant]: image});
    }
  }
  const sourceIds = [...new Set([...articles.values()].flat().map(article => article.sourceId))];
  const hazards = new Set(sourceIds.length
    ? store.db.select().from(t.newsSources).where(inArray(t.newsSources.id, sourceIds)).all().filter(source => sourceRule(source).hazard).map(source => source.id)
    : []);
  for (const story of stories) {
    const own = articles.get(story.id) ?? [];
    const lead = leadOf(own, story.leadArticleId);
    if (!lead) continue;
    const readings = own.map(article => ({id: article.id, publishedAt: article.publishedAt, hazard: hazards.has(article.sourceId), subject: article.notes?.subject ?? null}));
    const named = mainSection(sections.get(story.id) ?? [], readings, story.leadArticleId);
    if (named) main.set(story.id, named);
    const copies = story.imageArticleId === null ? undefined : images.get(story.imageArticleId);
    const imageArticle = own.find(article => article.id === story.imageArticleId);
    rows.set(story.id, {
      id: story.id, headline: story.headline, one_line: story.oneLine,
      sections: sectionOrder(sections.get(story.id) ?? []),
      state: storyState(story.seenAt, story.lastNewFactAt),
      lead: {
        article_id: lead.article.id, outlet: lead.article.outlet, outlet_short: shortName(lead.article), more: lead.more,
        published_at: lead.article.publishedAt, url: lead.article.url,
      },
      image: copies?.thumb && imageArticle ? {thumb: imageOut(copies.thumb), large: copies.large ? imageOut(copies.large) : null, outlet: imageArticle.outlet} : null,
      first_reported_at: story.firstReportedAt, last_new_fact_at: story.lastNewFactAt, seen_at: story.seenAt, expired_at: story.expiredAt,
    });
  }
  return {rows, articles, main};
}

/** Story rows in the order given, leaving out any with nothing to show. */
export function storyRows(store: Store, storyIds: readonly number[]): StoryRowOut[] {
  const {rows} = loadRows(store, storyIds);
  return storyIds.flatMap(id => rows.get(id) ?? []);
}

/** A section's stories on the page, biggest first: by score, then the newest fact. */
function sectionStoryIds(store: Store, section: NewsSection, now: string): {id: number; score: number}[] {
  return store.db.select({id: t.newsStories.id, score: t.newsStories.score}).from(t.newsStories)
    .innerJoin(t.newsStorySections, eq(t.newsStorySections.storyId, t.newsStories.id))
    .where(and(eq(t.newsStorySections.section, section), liveCondition(now), overBar()))
    .orderBy(desc(t.newsStories.score), desc(t.newsStories.lastNewFactAt), desc(t.newsStories.id)).all();
}

/** Keynotes still to come in a section, soonest first. An all-day one stays through its day. */
function upcoming(store: Store, section: NewsSection, now: string): UpcomingOut[] {
  const today = zonedInstant(localDay(now, store.timeZone), '00:00', store.timeZone);
  const events = store.db.select().from(t.newsEvents).where(and(eq(t.newsEvents.section, section), gte(t.newsEvents.startsAt, today)))
    .orderBy(asc(t.newsEvents.startsAt), asc(t.newsEvents.id)).all()
    .filter(event => event.allDay || event.startsAt >= now);
  const {rows} = loadRows(store, events.map(event => event.storyId));
  return events.flatMap(event => {
    const story = rows.get(event.storyId);
    return story ? [{id: event.id, name: event.name, starts_at: event.startsAt, all_day: event.allDay, section: event.section, story_id: story.id, lead: story.lead}] : [];
  });
}

/** Each section's line, from its sources' health. */
function sectionLines(store: Store, now: string): Map<NewsSection, SectionHealthOut | null> {
  const healths = new Map<NewsSection, (Health | null)[]>();
  for (const source of activeNewsSources(store)) {
    const health = newsSourceHealth(source, now);
    healths.set(source.section, [...(healths.get(source.section) ?? []), health && {state: health.state, asOf: health.as_of, reason: health.reason}]);
  }
  return new Map(NEWS_SECTIONS.map(section => {
    const line = sectionHealth(healths.get(section) ?? []);
    return [section, line && {state: line.state, as_of: line.asOf}];
  }));
}

/** The stories in Missed, biggest first. */
function missedIds(store: Store): number[] {
  return store.db.select({id: t.newsStories.id}).from(t.newsStories).where(and(missedCondition(), overBar()))
    .orderBy(desc(t.newsStories.score), desc(t.newsStories.lastNewFactAt), desc(t.newsStories.id)).all().map(row => row.id);
}

/**
 * Missed's "since Mon 10:40 PM": the user's last look before the first of these stories left the page,
 * the newest time they saw any story up to then. Null when they'd seen none.
 */
function missedSince(store: Store, firstExpiry: string): string | null {
  return store.db.select({at: max(t.newsStories.seenAt)}).from(t.newsStories)
    .where(and(isNotNull(t.newsStories.seenAt), lte(t.newsStories.seenAt, firstExpiry))).get()?.at ?? null;
}

/**
 * All: one block per section in its fixed order, and the Missed strip. A block holds only the stories
 * whose main section it is, so a story shows once (D102), and is sized from them. "N more" is the rest
 * of the section's list, which holds every story in the section, those shown in another block too.
 */
export function newsPage(store: Store): NewsPageOut {
  const now = isoNow(store);
  const lines = sectionLines(store, now);
  const blocks: NewsBlockOut[] = NEWS_SECTIONS.map(section => {
    const ranked = sectionStoryIds(store, section, now);
    const {rows: loaded, main} = loadRows(store, ranked.map(story => story.id));
    const rows = ranked.flatMap(story => loaded.get(story.id) ?? []);
    const own = ranked.filter(story => loaded.has(story.id) && main.get(story.id) === section);
    const shown = blockSize(own.map(story => story.score));
    return {section, stories: own.slice(0, shown).map(story => loaded.get(story.id)!), more: rows.length - shown, upcoming: upcoming(store, section, now), health: lines.get(section) ?? null};
  });
  const missed = missedStories(store);
  return {blocks, missed: missed.length ? {count: missed.length, since: missedSince(store, firstExpiry(missed))} : null};
}

/** A section's full list, biggest first. */
export function newsSection(store: Store, section: NewsSection): NewsSectionOut {
  const now = isoNow(store);
  return {
    section, stories: storyRows(store, sectionStoryIds(store, section, now).map(story => story.id)), upcoming: upcoming(store, section, now),
    health: sectionLines(store, now).get(section) ?? null,
  };
}

/** The story pane: the row, its summary, the facts timeline, what's new since the user looked, and its sources. */
export function storyDetail(store: Store, storyId: number): StoryOut {
  const {rows, articles} = loadRows(store, [storyId]);
  const row = rows.get(storyId);
  if (!row) throw notFound('No such story.');
  const story = store.db.select().from(t.newsStories).where(eq(t.newsStories.id, storyId)).get()!;
  const facts: StoryFactOut[] = store.db.select({at: t.newsFacts.at, text: t.newsFacts.text}).from(t.newsFacts)
    .where(eq(t.newsFacts.storyId, storyId)).orderBy(asc(t.newsFacts.at), asc(t.newsFacts.id)).all();
  const sources = listedArticles(articles.get(storyId) ?? []);
  return {
    ...row, summary: story.summary, outlets: sources.length, facts,
    new_since: row.state === 'updated' ? newSince(facts, story.seenAt) : null,
    sources: sources.map(article => ({
      article_id: article.id, outlet: article.outlet, outlet_short: shortName(article), headline: article.headline, published_at: article.publishedAt,
      summary_only: article.summaryOnly, discovery: article.discovery, url: article.url,
    })),
  };
}

/** An article in the pane. A metered paper's never is (D89). */
export function articleDetail(store: Store, articleId: number): ArticleOut {
  const article = store.db.select().from(t.newsArticles).where(eq(t.newsArticles.id, articleId)).get();
  if (!article || article.metered) throw notFound('No such article.');
  const link = store.db.select({storyId: t.newsStoryArticles.storyId}).from(t.newsStoryArticles).where(eq(t.newsStoryArticles.articleId, articleId)).get();
  const image = store.db.select().from(t.newsImages).where(and(eq(t.newsImages.articleId, articleId), eq(t.newsImages.variant, 'large'))).get();
  return {
    id: article.id, story_id: link?.storyId ?? null, outlet: article.outlet, outlet_short: shortName(article), byline: article.byline,
    published_at: article.publishedAt, headline: article.headline, url: article.url,
    text: article.summaryOnly || article.discovery ? null : article.extractedText,
    feed_summary: article.feedSummary, summary_only: article.summaryOnly, discovery: article.discovery, image: image ? imageOut(image) : null,
  };
}

/**
 * Missed's stories, biggest first, each named by its main section (D102), at most five per section per
 * day (N3); the rest never show there.
 */
function missedStories(store: Store): MissedStoryOut[] {
  const ids = missedIds(store);
  const {rows, main} = loadRows(store, ids);
  const stories = ids.flatMap(id => {
    const row = rows.get(id);
    return row?.expired_at ? [{...row, section: main.get(id) ?? row.sections[0]!, expired_at: row.expired_at}] : [];
  });
  return limitMissed(stories, store.timeZone);
}

const firstExpiry = (stories: readonly MissedStoryOut[]) => stories.map(story => story.expired_at).sort()[0]!;

/**
 * Catch up: by the local day each story left the page, newest day first, biggest first within it, at
 * most five per section per day. A story that left unseen is here until it's seen.
 */
export function missed(store: Store): MissedOut {
  const stories = missedStories(store);
  const days = new Map<string, MissedStoryOut[]>();
  for (const story of stories) {
    const date = localDay(story.expired_at, store.timeZone);
    days.set(date, [...(days.get(date) ?? []), story]);
  }
  return {
    since: stories.length ? missedSince(store, firstExpiry(stories)) : null,
    count: stories.length,
    days: [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, list]) => ({date, stories: list})),
  };
}

/** The icon a source's list named for its tile, kept in its config (N5); null takes its adapter's. */
const sourceIcon = (config: Record<string, unknown>): NewsSourceIcon | null =>
  (NEWS_SOURCE_ICONS as readonly unknown[]).includes(config.icon) ? config.icon as NewsSourceIcon : null;

/** Settings › News: today's articles, the stories on the page, and every source by section with its health. */
export function newsSources(store: Store): NewsSourcesOut {
  const now = isoNow(store);
  const midnight = zonedInstant(localDay(now, store.timeZone), '00:00', store.timeZone);
  const sources = activeNewsSources(store);
  const onPage = store.db.select({n: count()}).from(t.newsStories).where(and(liveCondition(now), overBar())).get()!.n;
  return {
    articles_today: store.db.select({n: count()}).from(t.newsArticles).where(gte(t.newsArticles.fetchedAt, midnight)).get()!.n,
    stories_on_page: onPage,
    sections: NEWS_SECTIONS.map(section => ({
      section,
      sources: sources.filter(source => source.section === section).map(source => ({
        id: source.id, name: source.name, section: source.section, kind: source.kind, adapter: source.adapter, icon: sourceIcon(source.config), reads: source.reads, interval_seconds: source.intervalSeconds,
        local: source.origin === 'local', health: newsSourceHealth(source, now),
      })),
    })),
  };
}

/**
 * Search news (D91): stories from the last 90 days, expired ones included, whose headline, one line,
 * summary or sources (an outlet's name or its own headline; never a metered paper's) hold every word
 * of the search as a prefix. Newest first. A story under the bar, or one nothing can show, isn't found.
 */
export function newsSearch(store: Store, input: NewsSearchInput): NewsSearchOut {
  const words = searchWords(input.q);
  const since = new Date(store.now().getTime() - ARCHIVE_MS).toISOString();
  const stories = store.db.select({id: t.newsStories.id, headline: t.newsStories.headline, oneLine: t.newsStories.oneLine, summary: t.newsStories.summary})
    .from(t.newsStories).where(and(gt(t.newsStories.lastNewFactAt, since), overBar()))
    .orderBy(desc(t.newsStories.lastNewFactAt), desc(t.newsStories.id)).all();
  const sources = new Map<number, string[]>();
  if (words.length && stories.length) {
    for (const row of store.db.select({storyId: t.newsStoryArticles.storyId, outlet: t.newsArticles.outlet, short: t.newsArticles.outletShort, headline: t.newsArticles.headline})
      .from(t.newsStoryArticles).innerJoin(t.newsArticles, eq(t.newsArticles.id, t.newsStoryArticles.articleId))
      .where(and(inArray(t.newsStoryArticles.storyId, stories.map(story => story.id)), eq(t.newsArticles.metered, false))).all()) {
      sources.set(row.storyId, [...(sources.get(row.storyId) ?? []), row.outlet, row.short ?? '', row.headline]);
    }
  }
  const found = stories.filter(story => matchesAll(words, [story.headline, story.oneLine ?? '', story.summary ?? '', ...(sources.get(story.id) ?? [])].join('\n')));
  const rows = storyRows(store, found.map(story => story.id));
  return {query: input.q, total: rows.length, stories: rows.slice(0, input.limit)};
}
