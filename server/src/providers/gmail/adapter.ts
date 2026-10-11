// The Gmail adapter (BUILD-PLAN.md › B2): the history cursor, the reconciliation sweep, the
// 365-day backfill, the users.watch behind Pub/Sub push, and read state, trash and Mark all as read
// sent back to Gmail. Harvested from v1's gmail-sync and its helpers (see SV-3).
//
// - sync (on a push, or every 2 minutes without Pub/Sub): pages history from the stored history
//   id, fetches what arrived in the inbox, and re-reads the labels of what changed. A 404 (history
//   older than Gmail keeps) or a burst past the page cap is a full resync: a fresh cursor, the
//   backfill restarted and a reconciliation over all 365 days.
// - sweep (every 5 minutes behind push): the same, then compares the last 30 days of inbox and
//   unread with the record and repairs what a missed push left.
// - backfill: 365 days of inbox, a few pages per job, resumable from its page token, with progress.
import {inArray} from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import type {Store} from '../../store.ts';
import type {AdapterContext, AttachmentBytes, CommandRow, SourceAdapter, SyncResult} from '../../sync/adapter.ts';
import {BACKFILL_DAYS, readBackfill, readCursor, startBackfill, writeBackfill, writeCursor} from '../../sync/cursors.ts';
import type {BackfillState} from '../../sync/cursors.ts';
import {ProviderError} from '../../sync/errors.ts';
import {enqueueJob} from '../../sync/jobs.ts';
import {applyProviderStates, knownProviderIds, recordedSince, removeMessages, upsertMessages} from '../../sync/mailMirror.ts';
import type {FetchedMessage, ProviderState} from '../../sync/mailMirror.ts';
import {attachmentFromSource, fetchedMessage} from '../mime.ts';
import {GmailApi, HistoryGone} from './api.ts';
import type {GmailMessage} from './api.ts';
import {GoogleTokens} from '../google/auth.ts';
import type {GoogleClient} from '../google/auth.ts';
import {historyChanges, stateFromLabels} from './history.ts';

export interface GmailAdapterOptions {
  client: GoogleClient;
  // The Pub/Sub topic users.watch publishes to; null without push (the source is then polled).
  topic: string | null;
  // Backfill: ids per page and pages per job.
  pageSize?: number;
  backfillPagesPerStep?: number;
  // Messages fetched at once (v1 used 15).
  concurrency?: number;
  // The sweep's window.
  sweepDays?: number;
}

// v1: more history pages than this between syncs means recovering by resync, not paging on.
const MAX_HISTORY_PAGES = 20;
// v1: renew a watch a day before it lapses (watches last about a week).
const WATCH_RENEWAL_LEAD_MS = 24 * 60 * 60_000;
// A sweep re-reads at most this many messages' labels; the next sweep carries on.
const MAX_SWEEP_REREADS = 500;
// Gmail's batchModify takes up to 1,000 ids.
const BATCH_MODIFY_MAX = 1000;
const DAY_MS = 24 * 60 * 60_000;

class HistoryTooLong extends Error {}

/** Runs `work` over items, `limit` at a time, in order. */
async function mapLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const run = async () => {
    while (next < items.length) {
      const at = next++;
      results[at] = await work(items[at]!);
    }
  };
  await Promise.all(Array.from({length: Math.min(limit, items.length)}, run));
  return results;
}

const afterQuery = (since: number) => `after:${Math.floor(since / 1000)}`;

export class GmailAdapter implements SourceAdapter {
  private readonly options: Required<Omit<GmailAdapterOptions, 'topic'>> & {topic: string | null};
  private readonly tokens: GoogleTokens;
  // One sync, sweep or backfill step per source at a time: they share the cursor.
  private readonly locks = new Map<number, Promise<unknown>>();

  constructor(options: GmailAdapterOptions) {
    this.options = {pageSize: 100, backfillPagesPerStep: 5, concurrency: 10, sweepDays: 30, ...options};
    this.tokens = new GoogleTokens(options.client);
  }

  private api(context: AdapterContext) {
    return new GmailApi(this.options.client, this.tokens, context);
  }

  private async locked<T>(context: AdapterContext, work: () => Promise<T>): Promise<T> {
    const id = context.source.id;
    const before = this.locks.get(id) ?? Promise.resolve();
    const run = before.catch(() => {}).then(work);
    this.locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === run) this.locks.delete(id);
    }
  }

  async sync(context: AdapterContext, cursor: string | null): Promise<SyncResult> {
    return this.locked(context, () => this.check(context, cursor, false));
  }

  async sweep(context: AdapterContext): Promise<void> {
    await this.locked(context, async () => {
      const result = await this.check(context, readCursor(context.store, context.source.id), true);
      if (result.cursor) writeCursor(context.store, context.source.id, result.cursor);
    });
  }

  async watch(context: AdapterContext): Promise<{renewBy: string | null}> {
    if (!this.options.topic) throw new ProviderError('permanent', 'Gmail push isn\'t set up on this Setpoint (no Pub/Sub topic).');
    const {expiration} = await this.api(context).watch(this.options.topic);
    const expires = Number(expiration);
    if (!Number.isFinite(expires)) throw new ProviderError('transient', 'Gmail\'s watch answer had no expiry.');
    return {renewBy: new Date(expires - WATCH_RENEWAL_LEAD_MS).toISOString()};
  }

  private accountId(context: AdapterContext): number {
    if (context.source.accountId === null) throw new ProviderError('permanent', 'This Gmail source has no account.');
    return context.source.accountId;
  }

  /** One check: history (or the first cursor), the sweep's comparison if asked, then a backfill step. */
  private async check(context: AdapterContext, cursor: string | null, sweep: boolean): Promise<SyncResult> {
    const api = this.api(context);
    let next: string;
    let resynced = false;
    if (cursor === null) {
      // First run: history from now on, and the backfill for what came before.
      next = (await api.profile()).historyId;
      if (!readBackfill(context.store, context.source.id)) startBackfill(context.store, context.source.id, 0, null);
    } else {
      try {
        next = await this.history(api, context, cursor);
      } catch (error) {
        if (!(error instanceof HistoryGone || error instanceof HistoryTooLong)) throw error;
        next = await this.resync(api, context);
        resynced = true;
      }
    }
    if (sweep && !resynced) await this.reconcile(api, context, this.options.sweepDays);
    await this.backfillStep(api, context);
    return {cursor: next};
  }

  private async history(api: GmailApi, context: AdapterContext, cursor: string): Promise<string> {
    const records = [];
    let pageToken: string | null = null;
    let last = cursor;
    for (let page = 0; ; page += 1) {
      if (page >= MAX_HISTORY_PAGES) throw new HistoryTooLong();
      const result = await api.history(cursor, pageToken);
      records.push(...result.history);
      last = result.historyId ?? last;
      pageToken = result.nextPageToken;
      if (!pageToken) break;
    }
    const {arrived, changed} = historyChanges(records);
    const accountId = this.accountId(context);
    const known = knownProviderIds(context.store, accountId, [...new Set([...arrived, ...changed])]);
    await this.fetchNew(api, context, [...arrived].filter(id => !known.has(id)), false);
    await this.reread(api, context, [...new Set([...arrived, ...changed])].filter(id => known.has(id)));
    return last;
  }

  /** History is gone: start over from now, backfill again and compare all 365 days. */
  private async resync(api: GmailApi, context: AdapterContext): Promise<string> {
    const historyId = (await api.profile()).historyId;
    startBackfill(context.store, context.source.id, 0, null);
    await this.reconcile(api, context, BACKFILL_DAYS);
    return historyId;
  }

  /** Fetches whole messages the record doesn't have and adds them. */
  private async fetchNew(api: GmailApi, context: AdapterContext, ids: string[], backfill: boolean) {
    if (!ids.length) return;
    const now = context.store.now();
    const fetched = await mapLimit(ids, this.options.concurrency, async id => {
      const message = await api.raw(id);
      return message?.raw ? toFetched(message, now) : null;
    });
    upsertMessages(context.store, this.accountId(context), fetched.filter((message): message is FetchedMessage => message !== null), {backfill});
  }

  /** Re-reads known messages' labels and applies them; one Gmail no longer has is removed. */
  private async reread(api: GmailApi, context: AdapterContext, ids: string[]) {
    if (!ids.length) return;
    const labels = await mapLimit(ids, this.options.concurrency, id => api.labels(id));
    const states = new Map<string, ProviderState>();
    const gone: string[] = [];
    ids.forEach((id, at) => {
      const message = labels[at];
      if (message) states.set(id, stateFromLabels(message.labelIds));
      else gone.push(id);
    });
    const accountId = this.accountId(context);
    applyProviderStates(context.store, accountId, states);
    removeMessages(context.store, accountId, gone);
  }

  /**
   * The reconciliation: the inbox and its unread mail over a window, compared with the record.
   * Messages that differ are re-read (bounded per sweep); inbox mail the record lacks is fetched,
   * unless the backfill hasn't reached it yet.
   */
  private async reconcile(api: GmailApi, context: AdapterContext, days: number) {
    const since = context.store.now().getTime() - days * DAY_MS;
    const q = afterQuery(since);
    const inbox = await api.listAll({labelIds: ['INBOX'], q});
    const unread = await api.listAll({labelIds: ['INBOX', 'UNREAD'], q});
    const inInbox = new Set(inbox.ids);
    const isUnread = new Set(unread.ids);
    const accountId = this.accountId(context);
    const rows = recordedSince(context.store, accountId, new Date(since).toISOString());
    const differ = rows.filter(row => {
      const shownInInbox = !row.trashedAt && !row.archivedAt;
      if (inbox.complete && shownInInbox !== inInbox.has(row.providerId)) return true;
      return unread.complete && inInbox.has(row.providerId) && row.unread !== isUnread.has(row.providerId);
    }).map(row => row.providerId);
    await this.reread(api, context, differ.slice(0, MAX_SWEEP_REREADS));
    const backfill = readBackfill(context.store, context.source.id);
    if (backfill && !backfill.done) return;
    const known = new Set(rows.map(row => row.providerId));
    await this.fetchNew(api, context, inbox.ids.filter(id => !known.has(id)).slice(0, MAX_SWEEP_REREADS), false);
  }

  /** A few pages of the backfill, newest first; queues the next step if there's more. */
  private async backfillStep(api: GmailApi, context: AdapterContext) {
    let state = readBackfill<string>(context.store, context.source.id);
    if (!state || state.done) return;
    const q = afterQuery(Date.parse(state.since));
    for (let page = 0; page < this.options.backfillPagesPerStep && !state.done; page += 1) {
      const result = await api.list({labelIds: ['INBOX'], q, pageToken: state.cursor, maxResults: this.options.pageSize});
      const ids = result.messages.map(message => message.id);
      const known = knownProviderIds(context.store, this.accountId(context), ids);
      await this.fetchNew(api, context, ids.filter(id => !known.has(id)), true);
      const seen: number = state.fetched + ids.length;
      const done = !result.nextPageToken;
      const next: BackfillState<string> = {
        ...state, fetched: seen, cursor: result.nextPageToken, done, finishedAt: done ? context.store.now().toISOString() : null,
        // Gmail's estimate, never below what's been seen (plus a page while there's more).
        total: done ? seen : Math.max(state.total, result.resultSizeEstimate, seen + ids.length),
      };
      state = next;
      writeBackfill(context.store, context.source.id, state);
    }
    // Keyed by position: the job running this step still holds its own key.
    if (!state.done) enqueueJob(context.store, {kind: 'sync', key: `backfill:${context.source.id}:${state.fetched}`, sourceId: context.source.id});
  }

  /** An attachment: the message's source (format=raw) again, and the part the sync's parse named. */
  async attachment(context: AdapterContext, message: {providerId: string}, attachmentId: string): Promise<AttachmentBytes | null> {
    const found = await this.api(context).raw(message.providerId);
    if (!found?.raw) return null;
    return attachmentFromSource(Buffer.from(found.raw, 'base64url'), attachmentId);
  }

  async execute(context: AdapterContext, command: CommandRow): Promise<void> {
    const api = this.api(context);
    if (command.kind === 'mark_all_read') {
      const ids = providerIds(context.store, (command.payload.message_ids ?? []) as number[]);
      for (let at = 0; at < ids.length; at += BATCH_MODIFY_MAX) await api.batchModify(ids.slice(at, at + BATCH_MODIFY_MAX), [], ['UNREAD']);
      return;
    }
    const [id] = providerIds(context.store, [command.targetId]);
    if (!id) throw new ProviderError('permanent', 'That email is no longer in Setpoint.');
    switch (command.kind) {
      case 'open':
      case 'mark_read':
        return api.modify(id, [], ['UNREAD']);
      case 'mark_unread':
        return api.modify(id, ['UNREAD'], []);
      case 'trash':
        return api.trash(id);
      case 'untrash':
        return api.untrash(id);
      default:
        throw new ProviderError('permanent', `Gmail can't carry out ${command.kind}.`);
    }
  }
}

function providerIds(store: Store, messageIds: number[]): string[] {
  if (!messageIds.length) return [];
  return store.db.select({providerId: t.messages.providerId}).from(t.messages).where(inArray(t.messages.id, messageIds)).all().map(row => row.providerId);
}

/** A raw Gmail message as the mirror takes it: Gmail's thread, arrival time and labels. */
async function toFetched(message: GmailMessage, now: Date): Promise<FetchedMessage> {
  const internal = Number(message.internalDate);
  return fetchedMessage('gmail', Buffer.from(message.raw!, 'base64url'), {
    providerId: message.id, threadId: message.threadId ?? null,
    receivedAt: Number.isFinite(internal) && internal > 0 ? new Date(internal).toISOString() : null,
    ...stateFromLabels(message.labelIds),
  }, now);
}
