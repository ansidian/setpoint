// Durable jobs: a source's sync, sweep or push renewal, a command for its provider, an email's
// triage (B3) or a News source's fetch (N1), the last two run by JobWorkers the engine is given.
// Each is claimed with a lease, so one a crash left running is taken up again after it; `key` keeps
// one queued or running job per purpose. Failures follow the one retry policy (src/domain/retry.ts).
import {and, asc, eq, inArray, lt, lte, or} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {retryAfterFailure} from '../domain/retry.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import type {ProviderError} from './errors.ts';

export type Job = typeof t.jobs.$inferSelect;
export type JobKind = Job['kind'];
export const LEASE_MS = 10 * 60_000;

/** Queues a job unless one with its key is already queued or running. Returns whether it queued. */
export function enqueueJob(store: Store, job: {kind: JobKind; key: string; sourceId?: number | null; commandId?: number | null; messageId?: number | null; newsSourceId?: number | null; runAt?: string}): boolean {
  const now = isoNow(store);
  const result = store.db.insert(t.jobs).values({
    kind: job.kind, key: job.key, sourceId: job.sourceId ?? null, commandId: job.commandId ?? null, messageId: job.messageId ?? null, newsSourceId: job.newsSourceId ?? null,
    runAt: job.runAt ?? now, createdAt: now,
  }).onConflictDoNothing().run();
  return result.changes === 1;
}

export const hasActiveJob = (store: Store, key: string) =>
  store.db.select({id: t.jobs.id}).from(t.jobs).where(and(eq(t.jobs.key, key), inArray(t.jobs.state, ['queued', 'running']))).get() !== undefined;

/**
 * Claims the jobs that are due: queued ones whose time has come, and running ones whose lease ran
 * out (a crash, or a check that hung past its lease). `skip` leaves out jobs this process is still
 * running.
 */
export function claimDueJobs(store: Store, skip: ReadonlySet<number>, limit = 20): Job[] {
  return transaction(store, () => {
    const now = isoNow(store);
    const due = store.db.select().from(t.jobs).where(or(
      and(eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, now)),
      and(eq(t.jobs.state, 'running'), lte(t.jobs.leaseUntil, now)),
    )).orderBy(asc(t.jobs.runAt), asc(t.jobs.id)).limit(limit + skip.size).all().filter(job => !skip.has(job.id)).slice(0, limit);
    const leaseUntil = new Date(store.now().getTime() + LEASE_MS).toISOString();
    return due.map(job => store.db.update(t.jobs).set({state: 'running', attempts: job.attempts + 1, leaseUntil})
      .where(eq(t.jobs.id, job.id)).returning().get()!);
  });
}

export function finishJob(store: Store, jobId: number) {
  store.db.update(t.jobs).set({state: 'done', finishedAt: isoNow(store), leaseUntil: null}).where(eq(t.jobs.id, jobId)).run();
}

/** A failed attempt: queued again after the policy's delay, or failed for good. Returns whether it will retry. */
export function failJob(store: Store, job: Job, error: ProviderError): boolean {
  const decision = retryAfterFailure(error.kind, job.attempts, error.retryAfterMs);
  const now = store.now();
  if (decision.retry) {
    store.db.update(t.jobs).set({state: 'queued', runAt: new Date(now.getTime() + decision.delayMs).toISOString(), leaseUntil: null, lastError: error.message})
      .where(eq(t.jobs.id, job.id)).run();
    return true;
  }
  store.db.update(t.jobs).set({state: 'failed', finishedAt: now.toISOString(), leaseUntil: null, lastError: error.message}).where(eq(t.jobs.id, job.id)).run();
  return false;
}

/** Finished jobs are kept a week, for looking into a failure, then dropped. */
export function pruneJobs(store: Store, keepMs = 7 * 24 * 60 * 60_000) {
  const before = new Date(store.now().getTime() - keepMs).toISOString();
  store.db.delete(t.jobs).where(and(inArray(t.jobs.state, ['done', 'failed']), lt(t.jobs.finishedAt, before))).run();
}
