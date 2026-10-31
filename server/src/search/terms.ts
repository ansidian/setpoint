// Every email's search terms (SV-136): Claude Haiku 5.5 reads the email once and writes, in the user's
// everyday words, what it's about, because search only knows an email's own words and the user often
// searches by meaning. It's apart from triage since rules-sorted mail may never reach a model, and
// terms are for finding mail, not sorting it. Modelled on the history pass (src/triage/history.ts):
//
// - Each email is a durable `search_terms` job on the engine (key `search_terms:<id>`), retried by the
//   one policy. Every few minutes, and as soon as triage sorts an email, the worker queues what's left
//   from the newest down, so it resumes after a restart and new mail never waits behind old.
// - It waits until the email is settled, since it reads what triage left: sorted, and for backfilled
//   mail through the history pass too. Trashed mail is never read, and comes back into the queue if
//   it leaves the trash.
// - `search_terms_version` is written with the terms and the ledger's row, after the call, in one
//   transaction, and a job for an email already read finishes without a call: each email is charged
//   for at most once per prompt version. An answer with no usable terms still counts as read (it was
//   paid for).
// - New mail is read on its own. Mail from before this job, or read by an older prompt, costs money in
//   bulk, so it waits until `search-terms --apply` records the go-ahead for this prompt version, and
//   keeps the terms it has until it's read again.
// - No Anthropic key: nothing is queued, terms stay empty and search works from the email's own words.
//   It's always Haiku 5.5, whatever Settings › AI chooses for triage, so a dearer model can't turn
//   this into a dearer pass. Every call is in the AI usage ledger, purpose `search_terms`.
import {and, count, desc, eq, isNotNull, isNull, ne, or} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {AI_ENDPOINTS, modelClient} from '../providers/ai/index.ts';
import type {AiEndpoints} from '../providers/ai/index.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import type {JobWorker} from '../sync/engine.ts';
import {asProviderError, ProviderError} from '../sync/errors.ts';
import {enqueueJob, failJob, finishJob} from '../sync/jobs.ts';
import type {Job} from '../sync/jobs.ts';
import {aiKeys, keyOf} from '../triage/models.ts';
import {recordUsage} from '../triage/worker.ts';
import {
  SEARCH_TERMS_MAX_OUTPUT_TOKENS, SEARCH_TERMS_MODEL, SEARCH_TERMS_PROMPT_VERSION, SEARCH_TERMS_SYSTEM, SEARCH_TERMS_TOOL, searchTermsInput, termsOf, termsText,
} from './termsPrompt.ts';

export const NO_SEARCH_TERMS_KEY = 'Search terms need an Anthropic key in Settings › AI.';
export const searchTermsKey = (messageId: number) => `search_terms:${messageId}`;

// The go-ahead is for one prompt version: a later prompt asks again.
const PASS_MARK = `search_terms_pass:v${SEARCH_TERMS_PROMPT_VERSION}`;
// Jobs queued at a time. A round of the whole mailbox would stand in front of new mail's triage.
const BATCH = 500;

const passStarted = (store: Store) => store.db.select().from(t.scheduleMarks).where(eq(t.scheduleMarks.name, PASS_MARK)).get() !== undefined;

// Settled and not in the trash: mail that terms are for.
const readable = and(isNotNull(t.messages.lane), isNull(t.messages.trashedAt), or(eq(t.messages.backfill, false), isNotNull(t.messages.extractedAt)));
const isNew = isNull(t.messages.searchTermsVersion);
const isBehind = and(isNotNull(t.messages.searchTermsVersion), ne(t.messages.searchTermsVersion, SEARCH_TERMS_PROMPT_VERSION));

/** Queues the newest emails due terms (a queued or running job stays as it is). Returns how many. */
export function queueSearchTerms(store: Store): number {
  if (!aiKeys(store).anthropic) return 0;
  const ids = store.db.select({id: t.messages.id}).from(t.messages).where(and(readable, passStarted(store) ? or(isNew, isBehind) : isNew))
    .orderBy(desc(t.messages.receivedAt)).limit(BATCH).all().map(row => row.id);
  return transaction(store, () => ids.filter(id => enqueueJob(store, {kind: 'search_terms', key: searchTermsKey(id), messageId: id})).length);
}

export interface SearchTermsProgress {
  // Read by this prompt, of all the mail terms are for.
  done: number;
  total: number;
  // Waiting for the go-ahead: from before terms, or read by an older prompt.
  behind: number;
  started: boolean;
  key: boolean;
}

export function searchTermsProgress(store: Store): SearchTermsProgress {
  const where = (filter?: ReturnType<typeof and>) => store.db.select({n: count()}).from(t.messages).where(and(readable, filter)).get()?.n ?? 0;
  return {
    done: where(eq(t.messages.searchTermsVersion, SEARCH_TERMS_PROMPT_VERSION)), total: where(), behind: where(isBehind),
    started: passStarted(store), key: aiKeys(store).anthropic,
  };
}

/** The user's go-ahead for this prompt version's run over the mail that's behind. The server reads it. */
export function startSearchTermsPass(store: Store): SearchTermsProgress {
  store.db.insert(t.scheduleMarks).values({name: PASS_MARK, at: isoNow(store)}).onConflictDoNothing().run();
  return searchTermsProgress(store);
}

export interface SearchTermsWorkerOptions {
  store: Store;
  endpoints?: AiEndpoints;
  // How often it queues what's left (5 minutes).
  everyMs?: number;
  // Emails read at once, leaving room for new mail's triage.
  concurrency?: number;
  timeoutMs?: number;
}

/** The job worker on the engine. */
export class SearchTermsWorker implements JobWorker {
  readonly kind = 'search_terms' as const;
  private readonly store: Store;
  private readonly endpoints: AiEndpoints;
  private readonly everyMs: number;
  private readonly concurrency: number;
  private readonly timeoutMs: number | undefined;
  private lastCheckAt = Number.NEGATIVE_INFINITY;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor({store, endpoints = AI_ENDPOINTS, everyMs = 5 * 60_000, concurrency = 2, timeoutMs}: SearchTermsWorkerOptions) {
    this.store = store;
    this.endpoints = endpoints;
    this.everyMs = everyMs;
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
  }

  /** Triage sorted an email: queue on the next tick. A missed nudge costs a few minutes, nothing else. */
  nudge() {
    this.lastCheckAt = Number.NEGATIVE_INFINITY;
  }

  schedule() {
    const now = this.store.now().getTime();
    if (now - this.lastCheckAt < this.everyMs) return;
    this.lastCheckAt = now;
    queueSearchTerms(this.store);
  }

  async run(job: Job, signal: AbortSignal) {
    while (this.active >= this.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
    this.active += 1;
    try {
      await this.read(job, signal);
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  private async read(job: Job, signal: AbortSignal) {
    const store = this.store;
    const message = job.messageId === null ? undefined : store.db.select().from(t.messages).where(eq(t.messages.id, job.messageId)).get();
    // Gone, trashed since it was queued, or read already: never charged for.
    if (!message || message.trashedAt || message.searchTermsVersion === SEARCH_TERMS_PROMPT_VERSION) return finishJob(store, job.id);
    const apiKey = keyOf(store, 'anthropic');
    if (!apiKey) return failJob(store, job, new ProviderError('auth', NO_SEARCH_TERMS_KEY));
    try {
      const client = modelClient('anthropic', {apiKey, baseUrl: this.endpoints.anthropic, timeoutMs: this.timeoutMs});
      const answer = await client.call({
        model: SEARCH_TERMS_MODEL, system: SEARCH_TERMS_SYSTEM, tool: SEARCH_TERMS_TOOL, input: searchTermsInput(message), maxOutputTokens: SEARCH_TERMS_MAX_OUTPUT_TOKENS,
        cacheKey: `setpoint-search-terms:v${SEARCH_TERMS_PROMPT_VERSION}`, signal,
      });
      transaction(store, () => {
        // The email may have gone during the call; its cost stays in the ledger.
        const written = store.db.update(t.messages).set({searchTerms: termsText(termsOf(answer.toolInput)) ?? message.searchTerms, searchTermsVersion: SEARCH_TERMS_PROMPT_VERSION})
          .where(eq(t.messages.id, message.id)).run();
        recordUsage(store, answer, written.changes ? message.id : null, 'search_terms');
        finishJob(store, job.id);
      });
    } catch (caught) {
      failJob(store, job, asProviderError(caught));
    }
  }
}
