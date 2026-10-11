// News's job worker on the sync engine (N1): each News source is read on its own interval (feeds
// every 15 minutes, hazards every 5) as a durable `news:<id>` job through its adapter (N2 builds
// them), and each read is the source's heartbeat. Its health rides on `news` events and shows only in
// Settings › News: the engine's `health` events, the health pill, Settings › Accounts and mantel's
// status never see News sources. A source with no adapter yet, or whose adapter isn't ready (no home
// location, no key), isn't read, and has no health until it is. After a read, its new articles are
// read too (N2): their pages' text and their images' copies; then they're sorted (N3, a `news_sort`
// job, src/news/sortWorker.ts). Every minute it also runs the expiry:
// stories leave the page 48 h after their last new fact, and the archive goes after 90 days, with
// their image copies.
import {and, eq, inArray, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {readingPlan} from '../domain/newsIngest.ts';
import type {Store} from '../store.ts';
import {noteLive, transaction} from '../store.ts';
import type {JobWorker} from '../sync/engine.ts';
import {asProviderError, ProviderError} from '../sync/errors.ts';
import {enqueueJob, failJob, finishJob, hasActiveJob} from '../sync/jobs.ts';
import type {Job} from '../sync/jobs.ts';
import {getSettings} from '../settings.ts';
import type {ArticleReading, NewsAdapter, NewsAdapters, NewsArticleReader, NewsSourceRow} from './adapter.ts';
import {sortAfterFetch} from './sortWorker.ts';
import {activeNewsSources} from './sources.ts';
import {expireNews, newsSourceHealth, recordNewsCheck, storeArticleReading, storeArticles} from './store.ts';

/** Every request names Setpoint honestly (BRIEF.md › Sources). */
export const NEWS_USER_AGENT = 'Setpoint/2 (a personal news reader; self-hosted)';

/** New articles read at once, per source: polite to the outlets, quick enough for a first run. */
const READ_AT_ONCE = 3;

export interface NewsWorkerOptions {
  store: Store;
  adapters?: NewsAdapters;
  // Reads each new article's page and copies its image (N2); none leaves articles on their feed summaries.
  reader?: NewsArticleReader | null;
  // The data directory's news-images/ (src/news/images.ts); null leaves files alone.
  imagesDir?: string | null;
  // One read's limit.
  timeoutMs?: number;
  // One article's reading's limit (its page and its image).
  readTimeoutMs?: number;
  // How often the expiry runs.
  expireEveryMs?: number;
}

export class NewsWorker implements JobWorker {
  readonly kind = 'news' as const;
  private readonly store: Store;
  private readonly adapters: NewsAdapters;
  private readonly reader: NewsArticleReader | null;
  private readonly imagesDir: string | null;
  private readonly timeoutMs: number;
  private readonly readTimeoutMs: number;
  private readonly expireEveryMs: number;
  private lastExpiryAt = Number.NEGATIVE_INFINITY;
  private readonly lastStates = new Map<number, string>();

  constructor({store, adapters = {}, reader = null, imagesDir = null, timeoutMs = 2 * 60_000, readTimeoutMs = 60_000, expireEveryMs = 60_000}: NewsWorkerOptions) {
    this.store = store;
    this.adapters = adapters;
    this.reader = reader;
    this.imagesDir = imagesDir;
    this.timeoutMs = timeoutMs;
    this.readTimeoutMs = readTimeoutMs;
    this.expireEveryMs = expireEveryMs;
  }

  /** The adapter that reads a source, when it's ready to (N2); never one for the seed's stand-ins. */
  adapterFor(source: NewsSourceRow): NewsAdapter | null {
    const adapter = source.dev ? null : this.adapters[source.adapter] ?? null;
    return adapter && (adapter.ready?.(this.store, source) ?? true) ? adapter : null;
  }

  /** The engine's tick: the expiry when it's due, a read for each source that's due, and health changes. */
  schedule() {
    const now = this.store.now().getTime();
    if (now - this.lastExpiryAt >= this.expireEveryMs) {
      this.lastExpiryAt = now;
      expireNews(this.store, this.imagesDir);
    }
    for (const source of activeNewsSources(this.store)) {
      if (!this.adapterFor(source)) continue;
      const due = !source.lastCheckAt || Date.parse(source.lastCheckAt) + source.intervalSeconds * 1000 <= now;
      const key = `news:${source.id}`;
      if (due && !hasActiveJob(this.store, key)) enqueueJob(this.store, {kind: 'news', key, newsSourceId: source.id});
    }
    this.announceHealth();
  }

  /** A `news` event naming the sources whose health changed (Settings › News refetches them). */
  announceHealth() {
    const now = this.store.now().toISOString();
    const changed: number[] = [];
    for (const source of activeNewsSources(this.store)) {
      const state = newsSourceHealth(source, now)?.state ?? 'unchecked';
      if (this.lastStates.get(source.id) !== state) changed.push(source.id);
      this.lastStates.set(source.id, state);
    }
    if (changed.length) noteLive(this.store, {type: 'news', stories: [], sections: [], sources: changed});
  }

  async run(job: Job, signal: AbortSignal) {
    const source = job.newsSourceId === null ? undefined
      : this.store.db.select().from(t.newsSources).where(and(eq(t.newsSources.id, job.newsSourceId), isNull(t.newsSources.retiredAt))).get();
    const adapter = source ? this.adapterFor(source) : null;
    if (!source || !adapter) return finishJob(this.store, job.id);
    let added: number[] = [];
    try {
      const result = await this.timed(adapter.fetch({
        store: this.store, source, home: getSettings(this.store).calendar.home, userAgent: NEWS_USER_AGENT,
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.timeoutMs)]),
      }, source.cursor));
      added = transaction(this.store, () => {
        const ids = storeArticles(this.store, source, result.articles);
        if (result.cursor !== null) this.store.db.update(t.newsSources).set({cursor: result.cursor}).where(eq(t.newsSources.id, source.id)).run();
        recordNewsCheck(this.store, source.id, null);
        finishJob(this.store, job.id);
        // Settings › News's article count; the stories change once N3 sorts them.
        if (ids.length) noteLive(this.store, {type: 'news', stories: [], sections: [], sources: [source.id]});
        return ids;
      });
    } catch (caught) {
      const error = asProviderError(caught);
      transaction(this.store, () => {
        recordNewsCheck(this.store, source.id, error);
        failJob(this.store, job, error);
      });
    }
    this.announceHealth();
    // The source's check is done and recorded; reading its articles never changes its health.
    if (added.length) {
      await this.readArticles(added, signal);
      // Sorted once their pages are read, so the model reads their text (N3).
      if (!signal.aborted) sortAfterFetch(this.store);
    }
  }

  /**
   * Reads each new article as its plan says (src/domain/newsIngest.ts's readingPlan), a few at a
   * time, each within its own limit: the page's text and the best image's copies. Whatever can't be
   * read falls back to the feed summary (src/news/store.ts's storeArticleReading). A restart in the
   * middle leaves the rest on their feed summaries.
   */
  private async readArticles(ids: number[], signal: AbortSignal) {
    const reader = this.reader;
    if (!reader) return;
    const queue = this.store.db.select().from(t.newsArticles).where(inArray(t.newsArticles.id, ids)).all()
      .map(article => ({article, plan: readingPlan({discovery: article.discovery, metered: article.metered, summaryOnly: article.summaryOnly, hasText: article.extractedText !== null})}))
      .filter(({plan}) => plan.page || plan.image);
    const next = async (): Promise<void> => {
      const item = queue.shift();
      if (!item || signal.aborted) return;
      let reading: ArticleReading = {text: null, imageUrl: null, images: []};
      try {
        reading = await reader.read({userAgent: NEWS_USER_AGENT, signal: AbortSignal.any([signal, AbortSignal.timeout(this.readTimeoutMs)])}, item.article, item.plan);
      } catch {
        // A reader gives up quietly; one that throws anyway has read nothing.
      }
      if (!signal.aborted) storeArticleReading(this.store, this.imagesDir, item.article.id, item.plan, reading);
      return next();
    };
    await Promise.all(Array.from({length: READ_AT_ONCE}, next));
  }

  /** The adapter's promise, or a transient failure once the timeout passes. */
  private timed<T>(work: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProviderError('transient', 'The source didn\'t answer in time.')), this.timeoutMs);
      timer.unref();
    });
    return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
  }
}
