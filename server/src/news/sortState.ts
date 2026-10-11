// News sorting's state (N3; BRIEF.md › When things break; DESIGN.md › States): what waits Unsorted
// and why, and the first run's progress. Like triage's health, it's about the last attempt: sorting is
// down while its last model call failed (or there was no key to call with), since the spell began,
// with the provider's words; a success brings it back. Articles keep arriving meanwhile and wait,
// and nothing vanishes. The first run fills the last 48 hours; it's done once a pass finds nothing
// left to sort.
import type {NewsStatusOut, NewsUnsortedOut, NewsSortDownOut} from '@setpoint/shared';
import {and, count, desc, eq, isNotNull, isNull, notExists} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import type {ProviderErrorKind} from '../domain/retry.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';

type Row = typeof t.newsSorting.$inferSelect;

const EMPTY: Row = {
  id: 1, lastSuccessAt: null, lastFailureAt: null, failingSince: null, lastError: null, lastErrorKind: null,
  firstRunStartedAt: null, firstRunDoneAt: null, lastRankedAt: null,
};

export function sortingRow(store: Store): Row {
  return store.db.select().from(t.newsSorting).where(eq(t.newsSorting.id, 1)).get() ?? EMPTY;
}

function save(store: Store, values: Partial<Row>) {
  store.db.insert(t.newsSorting).values({...EMPTY, ...values, id: 1}).onConflictDoUpdate({target: t.newsSorting.id, set: values}).run();
}

/** Down from a failure until the next success: `failing_since` is the spell's start. */
const isDown = (row: Pick<Row, 'failingSince'>) => row.failingSince !== null;

/** A model answered. Returns true when that ended a spell of sorting being down. */
export function recordSortSuccess(store: Store): boolean {
  return transaction(store, () => {
    const wasDown = isDown(sortingRow(store));
    save(store, {lastSuccessAt: isoNow(store), failingSince: null});
    return wasDown;
  });
}

/** A model call failed, or there was no key to make one. Returns true when sorting just went down. */
export function recordSortFailure(store: Store, kind: ProviderErrorKind | 'no_key', message: string): boolean {
  return transaction(store, () => {
    const row = sortingRow(store);
    const wasDown = isDown(row);
    const now = isoNow(store);
    save(store, {lastFailureAt: now, failingSince: row.failingSince ?? now, lastError: message, lastErrorKind: kind});
    return !wasDown;
  });
}

/** Why sorting is down, worded by the page: "Anthropic unreachable since 8:52 AM, retrying". */
export function sortDown(store: Store): NewsSortDownOut | null {
  const row = sortingRow(store);
  if (!isDown(row)) return null;
  const kind = row.lastErrorKind;
  const cause = kind === 'no_key' ? 'no_key' : kind === 'auth' ? 'refused' : kind === 'rate_limited' ? 'rate_limited' : 'unreachable';
  return {provider: 'anthropic', cause, since: row.failingSince!, reason: row.lastError ?? '', retrying: cause === 'unreachable' || cause === 'rate_limited'};
}

/** The first pass that sorts anything starts the first run. */
export function startFirstRun(store: Store) {
  if (sortingRow(store).firstRunStartedAt === null) save(store, {firstRunStartedAt: isoNow(store)});
}

/** A pass found nothing left: the first run is done. Returns true when that just happened. */
export function finishFirstRun(store: Store): boolean {
  const row = sortingRow(store);
  if (row.firstRunStartedAt === null || row.firstRunDoneAt !== null) return false;
  save(store, {firstRunDoneAt: isoNow(store)});
  return true;
}

/** Stories made now are the first run's fill (they never go to Missed). */
export const inFirstRun = (store: Store) => {
  const row = sortingRow(store);
  return row.firstRunStartedAt !== null && row.firstRunDoneAt === null;
};

export const markRanked = (store: Store) => save(store, {lastRankedAt: isoNow(store)});

/** Real sources' articles: the seed's stand-ins are never sorted, ranked or sent to a model. */
const realSource = () => eq(t.newsSources.dev, false);

/** The articles waiting to be sorted (not grouped into a story, not found to be noise), oldest first (metered ones too: they count toward stories). */
export function pendingArticleIds(store: Store, limit: number): number[] {
  return store.db.select({id: t.newsArticles.id}).from(t.newsArticles)
    .innerJoin(t.newsSources, eq(t.newsSources.id, t.newsArticles.sourceId))
    .where(and(isNull(t.newsArticles.sortedAt), realSource(), notLinked(store)))
    .orderBy(t.newsArticles.publishedAt, t.newsArticles.id).limit(limit).all().map(row => row.id);
}

function notLinked(store: Store) {
  return notExists(store.db.select({id: t.newsStoryArticles.articleId}).from(t.newsStoryArticles).where(eq(t.newsStoryArticles.articleId, t.newsArticles.id)));
}

/** Show headlines: what waits Unsorted, newest first, never a metered paper's (D89). */
export function unsortedArticles(store: Store, limit = 500): NewsUnsortedOut {
  const where = and(isNull(t.newsArticles.sortedAt), realSource(), eq(t.newsArticles.metered, false), notLinked(store));
  const total = store.db.select({n: count()}).from(t.newsArticles).innerJoin(t.newsSources, eq(t.newsSources.id, t.newsArticles.sourceId)).where(where).get()?.n ?? 0;
  const rows = store.db.select({article: t.newsArticles, section: t.newsSources.section}).from(t.newsArticles)
    .innerJoin(t.newsSources, eq(t.newsSources.id, t.newsArticles.sourceId)).where(where)
    .orderBy(desc(t.newsArticles.publishedAt), desc(t.newsArticles.id)).limit(limit).all();
  return {
    count: total,
    articles: rows.map(({article, section}) => ({
      id: article.id, section, outlet: article.outlet, outlet_short: article.outletShort ?? article.outlet, headline: article.headline,
      url: article.url, published_at: article.publishedAt,
    })),
  };
}

/** The lines above the list: Unsorted and why, and the first run's progress. */
export function newsStatus(store: Store): NewsStatusOut {
  const row = sortingRow(store);
  const firstRun = row.firstRunStartedAt !== null && row.firstRunDoneAt === null;
  let progress: NewsStatusOut['first_run'] = null;
  if (firstRun) {
    const of = (sorted: boolean) => store.db.select({n: count()}).from(t.newsArticles).innerJoin(t.newsSources, eq(t.newsSources.id, t.newsArticles.sourceId))
      .where(and(realSource(), sorted ? isNotNull(t.newsArticles.sortedAt) : undefined)).get()?.n ?? 0;
    progress = {sorted: of(true), total: of(false)};
  }
  return {unsorted: unsortedArticles(store, 0).count, down: sortDown(store), first_run: progress};
}
