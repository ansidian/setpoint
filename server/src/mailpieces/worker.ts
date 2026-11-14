// SV-274 (D564): USPS's mail, kept 30 days for the agenda rail. Each digest the mirror marks
// (src/sync/mailMirror.ts) is a durable `mailpieces` job: its source is fetched again through its
// account's adapter, its mailpieces' pictures read (src/providers/mime.ts › readDigest, ads left out)
// and kept under the day it's for. Every ten minutes the worker queues digests from the last 30 days
// that have no day yet (the ones already mirrored when this shipped, a job that gave up) and drops
// days older than 30. A digest the provider no longer has is left without a day.
import {and, eq, gte, isNull, lt} from 'drizzle-orm';
import {mailSourceId} from '../commands/mail.ts';
import * as t from '../db/schema.ts';
import {digestDay} from '../domain/mailpieces.ts';
import {addDays, localDay} from '../domain/time.ts';
import {readDigest} from '../providers/mime.ts';
import type {JobWorker} from '../sync/engine.ts';
import {asProviderError} from '../sync/errors.ts';
import {enqueueJob, failJob, finishJob} from '../sync/jobs.ts';
import type {Job} from '../sync/jobs.ts';
import {mailpiecesKey} from '../sync/mailMirror.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';

/** How many days are kept, today included. */
export const MAILPIECES_DAYS = 30;

/** The first day kept: today and the 29 before it. */
export const firstKeptDay = (store: Store) => addDays(localDay(isoNow(store), store.timeZone), 1 - MAILPIECES_DAYS);

/** Drops the days before the first one kept, with their scans. Returns how many went. */
export function pruneMailpieces(store: Store): number {
  return store.db.delete(t.mailDigests).where(lt(t.mailDigests.day, firstKeptDay(store))).run().changes;
}

/** Queues a job for each digest from the last 30 days that has no day yet. Returns how many. */
export function queueMailpieces(store: Store): number {
  const since = new Date(store.now().getTime() - (MAILPIECES_DAYS + 1) * 86_400_000).toISOString();
  const rows = store.db.select({id: t.messages.id}).from(t.messages)
    .leftJoin(t.mailDigests, eq(t.mailDigests.messageId, t.messages.id))
    .where(and(eq(t.messages.uspsDigest, true), gte(t.messages.receivedAt, since), isNull(t.mailDigests.id))).all();
  return transaction(store, () => rows.filter(row => enqueueJob(store, {kind: 'mailpieces', key: mailpiecesKey(row.id), messageId: row.id})).length);
}

export interface MailpiecesWorkerOptions {
  store: Store;
  // The email's source, through its account's adapter (the engine's `source`).
  fetchSource: (sourceId: number, message: {providerId: string}) => Promise<Buffer | null>;
  everyMs?: number;
}

export class MailpiecesWorker implements JobWorker {
  readonly kind = 'mailpieces' as const;
  private readonly store: Store;
  private readonly fetchSource: MailpiecesWorkerOptions['fetchSource'];
  private readonly everyMs: number;
  private lastCheckAt = Number.NEGATIVE_INFINITY;

  constructor({store, fetchSource, everyMs = 10 * 60_000}: MailpiecesWorkerOptions) {
    this.store = store;
    this.fetchSource = fetchSource;
    this.everyMs = everyMs;
  }

  schedule() {
    const now = this.store.now().getTime();
    if (now - this.lastCheckAt < this.everyMs) return;
    this.lastCheckAt = now;
    if (pruneMailpieces(this.store)) noteLive(this.store, {type: 'mail', messages: [], accounts: [], commands: []});
    queueMailpieces(this.store);
  }

  async run(job: Job) {
    const store = this.store;
    const message = job.messageId === null ? undefined : store.db.select().from(t.messages).where(eq(t.messages.id, job.messageId)).get();
    if (!message || store.db.select({id: t.mailDigests.id}).from(t.mailDigests).where(eq(t.mailDigests.messageId, message.id)).get()) return finishJob(store, job.id);
    const received = localDay(message.receivedAt, store.timeZone);
    const day = digestDay(message.subject, received) ?? received;
    const sourceId = mailSourceId(store, message.accountId);
    if (day < firstKeptDay(store) || sourceId === null) return finishJob(store, job.id);
    try {
      const source = await this.fetchSource(sourceId, {providerId: message.providerId});
      if (!source) return finishJob(store, job.id);
      const digest = await readDigest(source);
      transaction(store, () => {
        const row = store.db.insert(t.mailDigests).values({messageId: message.id, day, pieces: digest.pieces ?? digest.scans.length, storedAt: isoNow(store)})
          .onConflictDoNothing().returning({id: t.mailDigests.id}).get();
        if (row) {
          digest.scans.forEach((scan, position) => store.db.insert(t.mailScans).values({digestId: row.id, position, mimeType: scan.mimeType, bytes: scan.content}).run());
          noteLive(store, {type: 'mail', messages: [message.id], accounts: [message.accountId], commands: []});
        }
        finishJob(store, job.id);
      });
    } catch (caught) {
      failJob(store, job, asProviderError(caught));
    }
  }
}
