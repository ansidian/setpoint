// The one-time extraction pass over backfilled history (SV-4 D20). History is sorted as it
// lands by the rules-only pass, which guesses organisation and type from the sender and the words.
// Once a key exists, the cheap model reads each backfilled email once to fill in its organisation,
// platform, type, key date, summary and security facts, which search's chips rely on (B4). It never
// touches the lane, kind or protection: history stays out of Attention (D19).
//
// - It starts by itself when every mail account's backfill has finished and an AI key is set, or
//   from the CLI (`npm run cli -- triage-history`). Starting it is recorded (schedule_marks), so
//   accounts backfilled later are read too.
// - Each email is a durable `extract` job on the engine (key `extract:<id>`), retried by the one
//   policy; every few minutes the pass queues whatever is left, so it resumes after a restart.
// - `extracted_at` is written with the result, after the call, in one transaction, and a job for an
//   email already read finishes without a call: each email is charged for at most once. An answer
//   without a usable reading still counts as read (it was paid for).
// - Every call is in the AI usage ledger, purpose `triage`.
import type {HistoryExtractionOut} from '@setpoint/shared';
import {and, count, eq, isNotNull, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {indexing} from '../queries/mail.ts';
import type {Reading} from '../domain/triagePolicy.ts';
import {AI_ENDPOINTS} from '../providers/ai/index.ts';
import type {AiEndpoints} from '../providers/ai/index.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import type {JobWorker} from '../sync/engine.ts';
import {asProviderError, ProviderError} from '../sync/errors.ts';
import {enqueueJob, failJob, finishJob} from '../sync/jobs.ts';
import type {Job} from '../sync/jobs.ts';
import {triageEmailOf} from './intake.ts';
import {aiKeys} from './models.ts';
import {promptInput, readingOf} from './prompt.ts';
import {askModel, triageClients} from './worker.ts';

export const HISTORY_MARK = 'history_extraction';
export const extractKey = (messageId: number) => `extract:${messageId}`;

const started = (store: Store) => store.db.select().from(t.scheduleMarks).where(eq(t.scheduleMarks.name, HISTORY_MARK)).get() !== undefined;
const hasKey = (store: Store) => Object.values(aiKeys(store)).some(Boolean);

/** How far the pass has got: backfilled emails read, of all backfilled emails. */
export function historyProgress(store: Store): HistoryExtractionOut {
  const total = store.db.select({n: count()}).from(t.messages).where(eq(t.messages.backfill, true)).get()?.n ?? 0;
  const done = store.db.select({n: count()}).from(t.messages).where(and(eq(t.messages.backfill, true), isNotNull(t.messages.extractedAt))).get()?.n ?? 0;
  const state = !started(store) ? 'not_started' : done >= total ? 'done' : hasKey(store) ? 'running' : 'waiting_for_key';
  return {state, done, total};
}

/** Every mail account that backfilled has finished, and at least one did. */
export function backfillsComplete(store: Store): boolean {
  const {accounts} = indexing(store);
  return accounts.length > 0 && accounts.every(account => account.done);
}

/** Queues each backfilled email not read yet (a queued or running job stays as it is). Returns how many. */
export function queueHistoryExtraction(store: Store): number {
  if (!hasKey(store)) return 0;
  const ids = store.db.select({id: t.messages.id}).from(t.messages)
    .where(and(eq(t.messages.backfill, true), isNull(t.messages.extractedAt), isNotNull(t.messages.lane))).all().map(row => row.id);
  return transaction(store, () => ids.filter(id => enqueueJob(store, {kind: 'extract', key: extractKey(id), messageId: id})).length);
}

/** Starts (or resumes) the pass: recorded once, then everything not read yet is queued. */
export function startHistoryExtraction(store: Store): HistoryExtractionOut & {queued: number} {
  store.db.insert(t.scheduleMarks).values({name: HISTORY_MARK, at: isoNow(store)}).onConflictDoNothing().run();
  const queued = queueHistoryExtraction(store);
  return {...historyProgress(store), queued};
}

/**
 * Writes what the model read, once: only fields it filled, never the lane, kind or protection; a
 * code or protected email keeps its type; security facts only on security mail.
 */
export function applyExtraction(store: Store, messageId: number, reading: Reading | null): boolean {
  return transaction(store, () => {
    const row = store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get();
    if (!row || row.extractedAt) return false;
    const keepType = row.code !== null || row.protected;
    store.db.update(t.messages).set({
      organisation: reading?.organisation ?? row.organisation,
      via: reading?.via ?? row.via,
      type: keepType ? row.type : reading?.type ?? row.type,
      keyDate: reading?.keyDate ?? row.keyDate,
      summary: reading?.summary ?? row.summary,
      securityFacts: row.kind === 'security' && reading?.security ? reading.security : row.securityFacts,
      extractedAt: isoNow(store),
    }).where(eq(t.messages.id, messageId)).run();
    noteLive(store, {type: 'mail', messages: [messageId], accounts: [row.accountId], commands: []});
    return true;
  });
}

export interface HistoryExtractorOptions {
  store: Store;
  endpoints?: AiEndpoints;
  // How often it checks whether to start, and queues what's left (5 minutes).
  everyMs?: number;
  // Emails read at once, leaving room for new mail's triage.
  concurrency?: number;
  timeoutMs?: number;
}

/** The pass's job worker on the engine. */
export class HistoryExtractor implements JobWorker {
  readonly kind = 'extract' as const;
  private readonly store: Store;
  private readonly endpoints: AiEndpoints;
  private readonly everyMs: number;
  private readonly concurrency: number;
  private readonly timeoutMs: number | undefined;
  private lastCheckAt = Number.NEGATIVE_INFINITY;
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor({store, endpoints = AI_ENDPOINTS, everyMs = 5 * 60_000, concurrency = 2, timeoutMs}: HistoryExtractorOptions) {
    this.store = store;
    this.endpoints = endpoints;
    this.everyMs = everyMs;
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
  }

  /** Starts the pass once the backfills are done and a key is set; afterwards, queues what's left. */
  schedule() {
    const now = this.store.now().getTime();
    if (now - this.lastCheckAt < this.everyMs) return;
    this.lastCheckAt = now;
    if (started(this.store)) queueHistoryExtraction(this.store);
    else if (hasKey(this.store) && backfillsComplete(this.store)) startHistoryExtraction(this.store);
  }

  async run(job: Job, signal: AbortSignal) {
    while (this.active >= this.concurrency) await new Promise<void>(resolve => this.waiting.push(resolve));
    this.active += 1;
    try {
      await this.extract(job, signal);
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }

  private async extract(job: Job, signal: AbortSignal) {
    const store = this.store;
    const message = job.messageId === null ? undefined : store.db.select().from(t.messages).where(eq(t.messages.id, job.messageId)).get();
    // Gone, or read already: never charged for twice.
    if (!message || message.extractedAt) return finishJob(store, job.id);
    const {clients, missing} = triageClients(store, this.endpoints, this.timeoutMs);
    if (!clients.history) return failJob(store, job, new ProviderError('auth', missing ?? 'No AI key for the history pass.'));
    try {
      const answer = await askModel(store, clients.history, 'cheap', promptInput(triageEmailOf(store, message)).input, message.id, signal);
      transaction(store, () => {
        applyExtraction(store, message.id, readingOf(answer.toolInput));
        finishJob(store, job.id);
      });
    } catch (caught) {
      failJob(store, job, asProviderError(caught));
    }
  }
}
