// News's writes (N1): a source's heartbeat, the articles a fetch brought, stories seen, and the
// expiry that moves a story from the page to the archive (48 h after its last new fact) and drops the
// archive after 90 days (src/domain/news.ts has the rules). Each is one transaction; image files go
// once it commits.
import type {NewsSection, NewsSourceHealthOut} from '@setpoint/shared';
import {NEWS_SECTIONS} from '@setpoint/shared';
import {and, eq, gt, gte, inArray, isNotNull, isNull, lte, notExists, sql} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {deriveHealth} from '../domain/health.ts';
import {ARCHIVE_MS, expiresAt, keepsImage, STORY_TTL_MS} from '../domain/news.ts';
import {STORY_BAR} from '../domain/newsSorting.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import type {ProviderError} from '../sync/errors.ts';
import type {ReadingPlan} from '../domain/newsIngest.ts';
import type {ArticleReading, FetchedArticle, NewsSourceRow} from './adapter.ts';
import {deleteImageFiles, saveNewsImage} from './images.ts';

/**
 * A News source's health, as for `sources` (src/domain/health.ts), from its own schedule. Null until
 * its first check: a source no adapter reads yet (N2 adds them) is neither healthy nor failing.
 */
export function newsSourceHealth(source: NewsSourceRow, now: string): NewsSourceHealthOut | null {
  if (source.lastCheckAt === null) return null;
  const health = deriveHealth({
    now, intervalSeconds: source.intervalSeconds, createdAt: source.createdAt, lastCheckAt: source.lastCheckAt,
    lastSuccessAt: source.lastSuccessAt, lastErrorAt: source.lastErrorAt, lastError: source.lastError, needsReconnectAt: null,
  });
  return {
    state: health.state, as_of: health.asOf, reason: health.reason, last_check_at: source.lastCheckAt,
    failing_since: health.state === 'failing' ? source.failingSince : null,
  };
}

/** A fetch finished: the heartbeat, and when a failure began. */
export function recordNewsCheck(store: Store, sourceId: number, error: ProviderError | null) {
  const now = isoNow(store);
  if (!error) {
    store.db.update(t.newsSources).set({lastCheckAt: now, lastSuccessAt: now, failingSince: null}).where(eq(t.newsSources.id, sourceId)).run();
    return;
  }
  store.db.update(t.newsSources).set({lastCheckAt: now, lastErrorAt: now, lastError: error.message, failingSince: sql`coalesce(${t.newsSources.failingSince}, ${now})`})
    .where(eq(t.newsSources.id, sourceId)).run();
}

/**
 * Keeps what a fetch brought, once per source and canonical URL (a feed repeats its items); the
 * source's own flags carry to its articles. Text a source gave with an article (official data) is
 * kept as its text, never a metered or discovery article's. Returns the new articles' ids, which
 * wait Unsorted until N3 sorts them into stories.
 */
export function storeArticles(store: Store, source: NewsSourceRow, articles: readonly FetchedArticle[]): number[] {
  const now = isoNow(store);
  return transaction(store, () => articles.flatMap(article => {
    const discovery = article.discovery ?? source.kind === 'discovery';
    const row = store.db.insert(t.newsArticles).values({
      sourceId: source.id, url: article.url, canonicalUrl: article.canonicalUrl, outlet: article.outlet, outletShort: article.outletShort ?? null,
      byline: article.byline ?? null, headline: article.headline, feedSummary: article.feedSummary ?? null, publishedAt: article.publishedAt,
      extractedText: discovery || source.metered ? null : article.text ?? null,
      imageUrl: article.imageUrl ?? null, summaryOnly: source.summaryOnly, metered: source.metered, discovery, fetchedAt: now,
      lat: article.lat ?? null, lng: article.lng ?? null,
    }).onConflictDoNothing().returning({id: t.newsArticles.id}).get();
    return row ? [row.id] : [];
  }));
}

/**
 * What reading a new article gave (N2): its page's text, and its image's copies, saved through
 * saveNewsImage. A page that was read and yielded no text marks the article summary only, so the
 * pane shows its feed summary and the link (BRIEF.md › When things break); that isn't an error.
 */
export function storeArticleReading(store: Store, imagesDir: string | null, articleId: number, plan: ReadingPlan, reading: ArticleReading) {
  const article = store.db.select().from(t.newsArticles).where(eq(t.newsArticles.id, articleId)).get();
  if (!article) return;
  for (const {variant, copy} of reading.images) saveNewsImage(store, imagesDir, articleId, variant, copy);
  const values: Partial<typeof t.newsArticles.$inferInsert> = {};
  if (reading.imageUrl && reading.images.length) values.imageUrl = reading.imageUrl;
  if (plan.page && !article.discovery && !article.metered) {
    if (reading.text) values.extractedText = reading.text;
    else values.summaryOnly = true;
  }
  if (Object.keys(values).length) store.db.update(t.newsArticles).set(values).where(eq(t.newsArticles.id, articleId)).run();
}

/** The sections stories sit in, for the `news` event. */
function sectionsOf(store: Store, storyIds: number[]): NewsSection[] {
  if (!storyIds.length) return [];
  const rows = store.db.selectDistinct({section: t.newsStorySections.section}).from(t.newsStorySections).where(inArray(t.newsStorySections.storyId, storyIds)).all();
  return NEWS_SECTIONS.filter(section => rows.some(row => row.section === section));
}

/**
 * Stories seen (D87): a row fully on screen for about a second, or opened. Per story, never per
 * article; seeing an updated story clears its dot until the next new fact, and seeing a Missed one
 * takes it out of Missed. Returns the stories that exist.
 */
export function markSeen(store: Store, storyIds: readonly number[]): number[] {
  const now = isoNow(store);
  return transaction(store, () => {
    const seen = store.db.update(t.newsStories).set({seenAt: now}).where(inArray(t.newsStories.id, [...new Set(storyIds)])).returning({id: t.newsStories.id}).all().map(row => row.id);
    if (seen.length) noteLive(store, {type: 'news', stories: seen, sections: [], sources: []});
    return seen;
  });
}

export interface ExpiryOutcome {
  // Moved from the page to the archive, and the ones of them the user hadn't seen (Missed).
  expired: number[];
  missed: number[];
  // Gone with their archive.
  purged: number[];
  // Image files deleted.
  files: string[];
}

/**
 * Moves stories 48 h past their last new fact into the archive, recording which left unseen, and
 * drops what the archive doesn't keep: the articles' extracted text, the facts timeline, and every
 * image copy but the story's own thumbnail. Stories 90 days past their last fact go entirely, with
 * their articles, as do articles that never joined a story in that time. Image files are deleted
 * once the transaction commits. `imagesDir` null leaves files alone (tests without a data directory).
 */
export function expireNews(store: Store, imagesDir: string | null): ExpiryOutcome {
  const now = store.now().getTime();
  const pageCutoff = new Date(now - STORY_TTL_MS).toISOString();
  const archiveCutoff = new Date(now - ARCHIVE_MS).toISOString();
  const outcome = transaction(store, () => {
    const files: string[] = [];
    const leaving = store.db.select().from(t.newsStories).where(and(isNull(t.newsStories.expiredAt), lte(t.newsStories.lastNewFactAt, pageCutoff))).all();
    for (const story of leaving) {
      // The first run's fill never goes to Missed: Missed stays empty until there's history (N3).
      const unseen = story.seenAt === null && !story.backfill;
      store.db.update(t.newsStories).set({expiredAt: expiresAt(story.lastNewFactAt), expiredUnseen: unseen}).where(eq(t.newsStories.id, story.id)).run();
      const articleIds = store.db.select({id: t.newsStoryArticles.articleId}).from(t.newsStoryArticles).where(eq(t.newsStoryArticles.storyId, story.id)).all().map(row => row.id);
      if (articleIds.length) {
        store.db.update(t.newsArticles).set({extractedText: null}).where(inArray(t.newsArticles.id, articleIds)).run();
        const images = store.db.select().from(t.newsImages).where(inArray(t.newsImages.articleId, articleIds)).all();
        const dropped = images.filter(image => !keepsImage('archive', image, story.imageArticleId));
        if (dropped.length) store.db.delete(t.newsImages).where(inArray(t.newsImages.id, dropped.map(image => image.id))).run();
        files.push(...dropped.map(image => image.file));
      }
      store.db.delete(t.newsFacts).where(eq(t.newsFacts.storyId, story.id)).run();
    }

    // The archive's end: the stories, their articles (and so their images), and articles that never
    // joined a story within the archive's span.
    const purging = store.db.select({id: t.newsStories.id}).from(t.newsStories).where(lte(t.newsStories.lastNewFactAt, archiveCutoff)).all().map(row => row.id);
    const purgedArticles = purging.length
      ? store.db.select({id: t.newsStoryArticles.articleId}).from(t.newsStoryArticles).where(inArray(t.newsStoryArticles.storyId, purging)).all().map(row => row.id)
      : [];
    const unlinked = store.db.select({id: t.newsArticles.id}).from(t.newsArticles).where(and(
      lte(t.newsArticles.fetchedAt, archiveCutoff),
      notExists(store.db.select({id: t.newsStoryArticles.articleId}).from(t.newsStoryArticles).where(eq(t.newsStoryArticles.articleId, t.newsArticles.id))),
    )).all().map(row => row.id);
    const goneArticles = [...purgedArticles, ...unlinked];
    const sections = sectionsOf(store, [...leaving.map(story => story.id), ...purging]);
    if (goneArticles.length || purging.length) {
      files.push(...store.db.select({file: t.newsImages.file}).from(t.newsImages).where(inArray(t.newsImages.articleId, goneArticles)).all().map(row => row.file));
      if (purging.length) store.db.delete(t.newsStories).where(inArray(t.newsStories.id, purging)).run();
      if (goneArticles.length) store.db.delete(t.newsArticles).where(inArray(t.newsArticles.id, goneArticles)).run();
    }
    const expired = leaving.map(story => story.id);
    if (expired.length || purging.length) noteLive(store, {type: 'news', stories: [...expired, ...purging], sections, sources: []});
    return {expired, missed: leaving.filter(story => story.seenAt === null && !story.backfill).map(story => story.id), purged: purging, files};
  });
  deleteImageFiles(imagesDir, outcome.files);
  return outcome;
}

/** Missed: stories that left the page before the user saw them and haven't been seen since. */
export const missedCondition = () => and(eq(t.newsStories.expiredUnseen, true), isNull(t.newsStories.seenAt), isNotNull(t.newsStories.expiredAt));

/** On the page: not yet expired, and not past the 48 hours even if the expiry hasn't run yet. */
export const liveCondition = (now: string) => and(isNull(t.newsStories.expiredAt), gt(t.newsStories.lastNewFactAt, new Date(Date.parse(now) - STORY_TTL_MS).toISOString()));

/** Shown: a story under the bar never shows (N3, D86), on the page, in Missed or in search. */
export const overBar = () => gte(t.newsStories.score, STORY_BAR);
