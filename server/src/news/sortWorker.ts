// News sorting's job worker on the sync engine (N3), following triage's: durable `news_sort` jobs.
// - `news_sort` sorts what waits Unsorted (src/news/sorter.ts). The News worker queues it after each
//   source's job, once that job has read its new articles' pages; every few minutes, and as soon as
//   the keys change, it's queued again while anything waits, so articles a down AI left Unsorted are
//   sorted once it's back.
// - `news_rank` is the hourly ranking, on a prompt cached for an hour (so it runs a little inside the
//   hour, while the cache is warm). Without a key it still scores the stories by the formula.
// Each model call is written to the AI usage ledger and to sorting's health; a refusal fails the job
// by the one retry policy, and the articles wait Unsorted meanwhile ("Anthropic unreachable since
// 8:52 AM, retrying"). Production asks with the keys in Settings › AI (D90).
import {and, eq, gt, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {STORY_TTL_MS} from '../domain/news.ts';
import {RANK_EVERY_MS} from '../domain/newsSorting.ts';
import {AI_ENDPOINTS} from '../providers/ai/index.ts';
import type {AiEndpoints} from '../providers/ai/index.ts';
import {isoNow, noteLive} from '../store.ts';
import type {Store} from '../store.ts';
import type {JobWorker} from '../sync/engine.ts';
import {asProviderError, ProviderError} from '../sync/errors.ts';
import {enqueueJob, failJob, finishJob, hasActiveJob} from '../sync/jobs.ts';
import type {Job} from '../sync/jobs.ts';
import {newsClients, NO_NEWS_KEY, recordNewsUsage} from './models.ts';
import {rankStories, sortPending} from './sorter.ts';
import type {Ask, SortContext} from './sorter.ts';
import {finishFirstRun, markRanked, pendingArticleIds, recordSortFailure, recordSortSuccess, sortDown, sortingRow, startFirstRun} from './sortState.ts';

export const NEWS_SORT_KEY = 'news_sort';
export const NEWS_RANK_KEY = 'news_rank';

export const enqueueNewsSort = (store: Store) => enqueueJob(store, {kind: 'news_sort', key: NEWS_SORT_KEY});

/**
 * A source's job brought articles: sort them now (a sort already queued or running takes them), unless
 * sorting waits on Settings › AI (no key, or the key refused), when the five-minute resort and a key's
 * change are enough.
 */
export function sortAfterFetch(store: Store) {
  const down = sortDown(store);
  if (down?.cause === 'no_key' || down?.cause === 'refused') return;
  enqueueNewsSort(store);
}

/** Sorting's state changed (down, back, the first run done): a `news` event naming nothing, so the page asks again. */
const announceState = (store: Store) => noteLive(store, {type: 'news', stories: [], sections: [], sources: []});

export interface NewsSortWorkerOptions {
  store: Store;
  // The providers' base URLs; tests point them at a fake on 127.0.0.1.
  endpoints?: AiEndpoints;
  // How often what waits Unsorted is queued again (5 minutes, as triage's).
  resortEveryMs?: number;
  // Articles read at once.
  concurrency?: number;
  // One model call's limit.
  timeoutMs?: number;
}

export class NewsSortWorker implements JobWorker {
  readonly kind = 'news_sort' as const;
  private readonly store: Store;
  private readonly endpoints: AiEndpoints;
  private readonly resortEveryMs: number;
  private readonly concurrency: number;
  private readonly timeoutMs: number | undefined;
  private lastResortAt = Number.NEGATIVE_INFINITY;

  constructor({store, endpoints = AI_ENDPOINTS, resortEveryMs = 5 * 60_000, concurrency = 4, timeoutMs}: NewsSortWorkerOptions) {
    this.store = store;
    this.endpoints = endpoints;
    this.resortEveryMs = resortEveryMs;
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
  }

  /** The engine's tick: queue what waits Unsorted when it's time, and the ranking when the hour's up. */
  schedule() {
    const now = this.store.now().getTime();
    if (now - this.lastResortAt >= this.resortEveryMs) {
      this.lastResortAt = now;
      if (pendingArticleIds(this.store, 1).length) enqueueNewsSort(this.store);
    }
    const ranked = sortingRow(this.store).lastRankedAt;
    if ((ranked === null || Date.parse(ranked) + RANK_EVERY_MS <= now) && !hasActiveJob(this.store, NEWS_RANK_KEY) && this.hasStories()) {
      enqueueJob(this.store, {kind: 'news_sort', key: NEWS_RANK_KEY});
    }
  }

  /** Keys changed (Settings › AI): sort what waits now. */
  configurationChanged() {
    enqueueNewsSort(this.store);
    this.store.db.update(t.jobs).set({runAt: isoNow(this.store)}).where(and(eq(t.jobs.kind, 'news_sort'), eq(t.jobs.state, 'queued'))).run();
  }

  async run(job: Job, signal: AbortSignal) {
    if (job.key === NEWS_RANK_KEY) return this.rank(job);
    return this.sort(job, signal);
  }

  /** Stories on the page to rank. */
  private hasStories() {
    const cutoff = new Date(this.store.now().getTime() - STORY_TTL_MS).toISOString();
    return this.store.db.select({id: t.newsStories.id}).from(t.newsStories).where(and(isNull(t.newsStories.expiredAt), gt(t.newsStories.lastNewFactAt, cutoff))).limit(1).get() !== undefined;
  }

  /** Each call: written to the ledger, and a success to sorting's health. A failure is the caller's to record. */
  private ask: Ask = async (purpose, {client, model}, request) => {
    const answer = await client.call({...request, model, cacheKey: `setpoint-news:${purpose}:${model}`});
    recordNewsUsage(this.store, answer, purpose, request.cacheTtl);
    if (recordSortSuccess(this.store)) announceState(this.store);
    return answer;
  };

  private failed(job: Job, caught: unknown) {
    const error = asProviderError(caught);
    if (recordSortFailure(this.store, error.kind, error.message)) announceState(this.store);
    failJob(this.store, job, error);
  }

  private async sort(job: Job, signal: AbortSignal) {
    const store = this.store;
    if (!pendingArticleIds(store, 1).length) {
      if (finishFirstRun(store)) announceState(store);
      return finishJob(store, job.id);
    }
    const clients = newsClients(store, this.endpoints, this.timeoutMs);
    if (!clients) {
      // Nothing to retry until a key arrives (configurationChanged queues it again).
      if (recordSortFailure(store, 'no_key', NO_NEWS_KEY)) announceState(store);
      failJob(store, job, new ProviderError('auth', NO_NEWS_KEY));
      return;
    }
    startFirstRun(store);
    const context: SortContext = {store, clients, ask: this.ask, concurrency: this.concurrency, signal};
    try {
      await sortPending(context);
    } catch (caught) {
      return this.failed(job, caught);
    }
    if (!pendingArticleIds(store, 1).length && finishFirstRun(store)) announceState(store);
    finishJob(store, job.id);
  }

  private async rank(job: Job) {
    const store = this.store;
    const clients = newsClients(store, this.endpoints, this.timeoutMs);
    // The next hour's ranking counts from this one, whatever the model says; a failure is retried by
    // the policy meanwhile.
    markRanked(store);
    try {
      await rankStories(store, clients ? {clients, ask: this.ask} : null);
    } catch (caught) {
      // The formula still runs: recency moves with the clock.
      await rankStories(store, null);
      return this.failed(job, caught);
    }
    finishJob(store, job.id);
  }
}
