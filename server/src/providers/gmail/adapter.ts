// The Gmail adapter: the history cursor, the reconciliation sweep, the
// 365-day backfill, the users.watch behind Pub/Sub push, and read state, trash and Mark all as read
// sent back to Gmail.
//
// - sync (on a push, or every 2 minutes without Pub/Sub): pages history from the stored history
//   id, fetches what arrived in the inbox, and re-reads the labels of what changed. A 404 (history
//   older than Gmail keeps) or a burst past the page cap is a full resync: a fresh cursor, the
//   backfill restarted and a reconciliation over all 365 days.
// - sweep (every 5 minutes behind push): the same, then compares the last 30 days of inbox and
//   unread with the record and repairs what a missed push left.
// - backfill: 365 days of inbox, a few pages per job, resumable from its page token, with progress.
//   SENT has its own over the same days, beside it: mail the user sent, from any client.
// - the header pass (src/sync/headers.ts), once the backfill is done: To, Cc, Reply-To and the
//   reply headers for mail held from before they were kept, by format=metadata.
// - the "Send mail as" list, once a day, for the composer's From (src/sending/aliases.ts).
// - send: messages.send, in the answered email's thread, on the gmail.modify scope already held.
import {inArray} from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import type {Store} from '../../store.ts';
import {aliasesDue, replaceAliases} from '../../sending/aliases.ts';
import type {AdapterContext, AttachmentBytes, CommandRow, OutgoingMail, SentMail, SourceAdapter, SyncResult} from '../../sync/adapter.ts';
import {BACKFILL_DAYS, BACKFILL_SCOPE, readBackfill, readCursor, SENT_BACKFILL_SCOPE, startBackfill, writeBackfill, writeCursor} from '../../sync/cursors.ts';
import type {BackfillState} from '../../sync/cursors.ts';
import {ProviderError} from '../../sync/errors.ts';
import {enqueueJob} from '../../sync/jobs.ts';
import {applyProviderStates, knownProviderIds, markSent, recordedSince, removeMessages, sentOnlyIds, upsertMessages} from '../../sync/mailMirror.ts';
import type {FetchedMessage, ProviderState} from '../../sync/mailMirror.ts';
import {headerPassStep} from '../../sync/headers.ts';
import type {HeaderRow} from '../../sync/headers.ts';
import type {MessageHeaders} from '../../sync/mailMirror.ts';
import {attachmentFromSource, fetchedMessage, parseHeaderBlock} from '../mime.ts';
import {GmailApi, HistoryGone} from './api.ts';
import type {GmailMessage} from './api.ts';
import {GoogleTokens} from '../google/auth.ts';
import type {GoogleClient} from '../google/auth.ts';
import {historyChanges, originFromLabels, stateFromLabels} from './history.ts';

export interface GmailAdapterOptions {
  client: GoogleClient;
  // The Pub/Sub topic users.watch publishes to. Null without push (the source is then polled).
  topic: string | null;
  // Backfill: ids per page and pages per job.
  pageSize?: number;
  backfillPagesPerStep?: number;
  // Messages fetched at once.
  concurrency?: number;
  // The header pass: rows per job.
  headerChunk?: number;
  // The sweep's window.
  sweepDays?: number;
}

// More history pages than this between syncs means recovering by resync, not paging on.
const MAX_HISTORY_PAGES = 20;
// Renew a watch a day before it lapses (watches last about a week).
const WATCH_RENEWAL_LEAD_MS = 24 * 60 * 60_000;
// A sweep re-reads at most this many messages' labels. The next sweep carries on.
const MAX_SWEEP_REREADS = 500;
// Gmail's batchModify takes up to 1,000 ids.
const BATCH_MODIFY_MAX = 1000;
const DAY_MS = 24 * 60 * 60_000;

// The headers the header pass asks Gmail for.
const HEADER_NAMES = ['To', 'Cc', 'Reply-To', 'References', 'In-Reply-To'] as const;

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

/** The two backfills: the inbox's, and SENT's beside it. Each step's next job is keyed by its own prefix. */
const BACKFILLS = [
  {scope: BACKFILL_SCOPE, label: 'INBOX', key: 'backfill'},
  {scope: SENT_BACKFILL_SCOPE, label: 'SENT', key: 'sent'},
] as const;
type Backfill = (typeof BACKFILLS)[number];

export class GmailAdapter implements SourceAdapter {
  private readonly options: Required<Omit<GmailAdapterOptions, 'topic'>> & {topic: string | null};
  private readonly tokens: GoogleTokens;
  // One sync, sweep or backfill step per source at a time, because they share the cursor.
  private readonly locks = new Map<number, Promise<unknown>>();

  constructor(options: GmailAdapterOptions) {
    this.options = {pageSize: 100, backfillPagesPerStep: 5, concurrency: 10, sweepDays: 30, headerChunk: 100, ...options};
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
    // The sent backfill, on the first run and on an account synced before sent mail was kept.
    if (!readBackfill(context.store, context.source.id, SENT_BACKFILL_SCOPE)) startBackfill(context.store, context.source.id, 0, null, SENT_BACKFILL_SCOPE);
    if (sweep && !resynced) await this.reconcile(api, context, this.options.sweepDays);
    for (const backfill of BACKFILLS) await this.backfillStep(api, context, backfill);
    await headerPassStep(context.store, {id: context.source.id, accountId: this.accountId(context)}, this.options.headerChunk, rows => this.readHeaders(api, rows));
    await this.readAliases(api, context);
    return {cursor: next};
  }

  /** The "Send mail as" list, once a day: verified aliases only. A failed read waits for the next check. */
  private async readAliases(api: GmailApi, context: AdapterContext) {
    if (!aliasesDue(context.store, context.source.id)) return;
    let list;
    try {
      list = await api.sendAs();
    } catch (error) {
      if (error instanceof ProviderError && error.kind !== 'auth') return;
      throw error;
    }
    const usable = list.filter(entry => entry.isPrimary || entry.verificationStatus === 'accepted');
    replaceAliases(context.store, context.source.id, this.accountId(context),
      usable.map(entry => ({address: entry.sendAsEmail, name: entry.displayName ?? null, primary: entry.isPrimary === true})));
  }

  /** messages.send in the answered email's thread. The id and thread are Gmail's, as its sync will see them. */
  async send(context: AdapterContext, mail: OutgoingMail): Promise<SentMail> {
    const sent = await this.api(context).send(mail.raw, mail.threadId);
    return {providerId: sent.id, threadId: sent.threadId ?? null};
  }

  /** SENT's message with this Message-ID. Gmail files every send there, so its absence is certain. */
  async findSent(context: AdapterContext, rfc822Id: string): Promise<{sent: SentMail | null; certain: boolean}> {
    const {messages} = await this.api(context).list({q: `rfc822msgid:${rfc822Id.replace(/^<|>$/g, '')}`, labelIds: ['SENT'], maxResults: 1});
    const found = messages[0];
    return {sent: found ? {providerId: found.id, threadId: found.threadId ?? null} : null, certain: true};
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
    for (const {scope} of BACKFILLS) startBackfill(context.store, context.source.id, 0, null, scope);
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

  /**
   * Re-reads known messages' labels and applies them. One Gmail no longer has is removed. A sent-only
   * one now in the inbox is fetched whole, so the mirror takes it as received mail, for triage.
   */
  private async reread(api: GmailApi, context: AdapterContext, ids: string[]) {
    if (!ids.length) return;
    const labels = await mapLimit(ids, this.options.concurrency, id => api.labels(id));
    const states = new Map<string, ProviderState>();
    const gone: string[] = [];
    const inInbox: string[] = [];
    ids.forEach((id, at) => {
      const message = labels[at];
      if (message) states.set(id, stateFromLabels(message.labelIds));
      else gone.push(id);
      if (message && originFromLabels(message.labelIds).received) inInbox.push(id);
    });
    const accountId = this.accountId(context);
    applyProviderStates(context.store, accountId, states);
    removeMessages(context.store, accountId, gone);
    await this.fetchNew(api, context, [...sentOnlyIds(context.store, accountId, inInbox)], false);
  }

  /**
   * The reconciliation: the inbox and its unread mail, and SENT, over a window, compared with the
   * record. Messages that differ are re-read (bounded per sweep): received mail by the inbox, mail
   * sent to others only by SENT (trashed or deleted in Gmail). Inbox or sent mail the record lacks
   * is fetched, unless its backfill hasn't reached it yet.
   */
  private async reconcile(api: GmailApi, context: AdapterContext, days: number) {
    const since = context.store.now().getTime() - days * DAY_MS;
    const q = afterQuery(since);
    const inbox = await api.listAll({labelIds: ['INBOX'], q});
    const unread = await api.listAll({labelIds: ['INBOX', 'UNREAD'], q});
    const sent = await api.listAll({labelIds: ['SENT'], q});
    const inInbox = new Set(inbox.ids);
    const isUnread = new Set(unread.ids);
    const inSent = new Set(sent.ids);
    const accountId = this.accountId(context);
    const rows = recordedSince(context.store, accountId, new Date(since).toISOString());
    const differ = rows.filter(row => {
      // Sent only: gone from SENT (trashed or deleted in Gmail), or now in the inbox.
      if (!row.received) return (sent.complete && !row.trashedAt && !inSent.has(row.providerId)) || inInbox.has(row.providerId);
      const shownInInbox = !row.trashedAt && !row.archivedAt;
      if (inbox.complete && shownInInbox !== inInbox.has(row.providerId)) return true;
      return unread.complete && inInbox.has(row.providerId) && row.unread !== isUnread.has(row.providerId);
    }).map(row => row.providerId);
    await this.reread(api, context, differ.slice(0, MAX_SWEEP_REREADS));
    const known = new Set(rows.map(row => row.providerId));
    markSent(context.store, accountId, sent.ids.filter(id => known.has(id)));
    const missing = [inbox, sent].flatMap((listed, at) => {
      const backfill = readBackfill(context.store, context.source.id, BACKFILLS[at]!.scope);
      return backfill && !backfill.done ? [] : listed.ids.filter(id => !known.has(id));
    });
    await this.fetchNew(api, context, [...new Set(missing)].slice(0, MAX_SWEEP_REREADS), false);
  }

  /** A few pages of a backfill, newest first. Queues the next step if there's more. */
  private async backfillStep(api: GmailApi, context: AdapterContext, backfill: Backfill) {
    let state = readBackfill<string>(context.store, context.source.id, backfill.scope);
    if (!state || state.done) return;
    const q = afterQuery(Date.parse(state.since));
    for (let page = 0; page < this.options.backfillPagesPerStep && !state.done; page += 1) {
      const result = await api.list({labelIds: [backfill.label], q, pageToken: state.cursor, maxResults: this.options.pageSize});
      const ids = result.messages.map(message => message.id);
      const known = knownProviderIds(context.store, this.accountId(context), ids);
      // Mail to yourself the record held from the inbox before sent mail was kept: sent too.
      if (backfill.label === 'SENT') markSent(context.store, this.accountId(context), ids.filter(id => known.has(id)));
      await this.fetchNew(api, context, ids.filter(id => !known.has(id)), true);
      const seen: number = state.fetched + ids.length;
      const done = !result.nextPageToken;
      const next: BackfillState<string> = {
        ...state, fetched: seen, cursor: result.nextPageToken, done, finishedAt: done ? context.store.now().toISOString() : null,
        // Gmail's estimate, never below what's been seen (plus a page while there's more).
        total: done ? seen : Math.max(state.total, result.resultSizeEstimate, seen + ids.length),
      };
      state = next;
      writeBackfill(context.store, context.source.id, state, backfill.scope);
    }
    // Keyed by position: the job running this step still holds its own key.
    if (!state.done) enqueueJob(context.store, {kind: 'sync', key: `${backfill.key}:${context.source.id}:${state.fetched}`, sourceId: context.source.id});
  }

  /** The header pass's rows by format=metadata, those Gmail still has. */
  private async readHeaders(api: GmailApi, rows: HeaderRow[]): Promise<Map<number, MessageHeaders>> {
    const found = new Map<number, MessageHeaders>();
    await mapLimit(rows, this.options.concurrency, async row => {
      const message = await api.metadata(row.providerId, HEADER_NAMES);
      if (!message) return;
      const lines = (message.payload?.headers ?? []).map(header => `${header.name}: ${header.value}`).join('\r\n');
      found.set(row.id, await parseHeaderBlock(lines));
    });
    return found;
  }

  /** An attachment: the message's source (format=raw) again, and the part the sync's parse named. */
  async attachment(context: AdapterContext, message: {providerId: string}, attachmentId: string): Promise<AttachmentBytes | null> {
    const found = await this.api(context).raw(message.providerId);
    if (!found?.raw) return null;
    return attachmentFromSource(Buffer.from(found.raw, 'base64url'), attachmentId);
  }

  /** The message's source (format=raw) again. */
  async source(context: AdapterContext, message: {providerId: string}): Promise<Buffer | null> {
    const found = await this.api(context).raw(message.providerId);
    return found?.raw ? Buffer.from(found.raw, 'base64url') : null;
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
        // A written rule's Trash with Mark read: read first, as the user's Mark read does.
        if (command.payload.mark_read === true) await api.modify(id, [], ['UNREAD']);
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
    ...stateFromLabels(message.labelIds), ...originFromLabels(message.labelIds),
  }, now);
}
