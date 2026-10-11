// The iCloud adapter (BUILD-PLAN.md › B2): IMAP with an app-specific password over one pooled
// connection per account, polled every 2 minutes; the \Seen flag both ways; Trash with Undo; and
// the 365-day backfill. Harvested from v1's server/email/icloud.ts (see SV-3).
//
// Each poll (sync) selects INBOX and
// - fetches what arrived since the stored UID (the cursor is UIDVALIDITY and the last UID seen;
//   a new UIDVALIDITY means every UID changed, so the backfill starts again and matches emails
//   by Message-ID);
// - reads every INBOX message's flags: read elsewhere shows here, and a message gone from INBOX
//   left it (moved to Archive or Deleted Messages in Apple Mail) unless Setpoint trashed it;
// - takes the next step of the backfill.
import {createHash} from 'node:crypto';
import {eq, inArray} from 'drizzle-orm';
import {ImapFlow} from 'imapflow';
import type {FetchMessageObject} from 'imapflow';
import * as t from '../../db/schema.ts';
import type {AdapterContext, AttachmentBytes, CommandRow, SourceAdapter, SyncResult} from '../../sync/adapter.ts';
import {readBackfill, readCursor, startBackfill, writeBackfill, writeCursor} from '../../sync/cursors.ts';
import {ProviderError} from '../../sync/errors.ts';
import {enqueueJob} from '../../sync/jobs.ts';
import {applyProviderStates, knownProviderIds, upsertMessages} from '../../sync/mailMirror.ts';
import type {FetchedMessage, ProviderState} from '../../sync/mailMirror.ts';
import {attachmentFromSource, fetchedMessage} from '../mime.ts';

export interface ImapEndpoint {
  host: string;
  port: number;
  // TLS from the start (iCloud's 993); plain only for the test server on 127.0.0.1.
  secure: boolean;
}

export const ICLOUD_IMAP: ImapEndpoint = {host: 'imap.mail.me.com', port: 993, secure: true};

export interface ICloudAdapterOptions {
  endpoint?: ImapEndpoint;
  // v1: close a pooled connection after 10 minutes unused.
  idleMs?: number;
  // v1: give up on a connect after 15 seconds.
  connectTimeoutMs?: number;
  // Backfill: messages fetched per step.
  backfillChunk?: number;
}

const DAY_MS = 24 * 60 * 60_000;
const INBOX = 'INBOX';
const SEEN = '\\Seen';

interface Cursor {
  uidValidity: string;
  lastUid: number;
}

const providerId = (uidValidity: string | bigint, uid: number) => `${uidValidity}:${uid}`;
const uidOf = (id: string, uidValidity: string) => (id.startsWith(`${uidValidity}:`) ? Number(id.slice(uidValidity.length + 1)) : null);

/**
 * An IMAP refusal as a ProviderError: a refused login is needs-reconnect (the app password was
 * revoked or mistyped); server trouble and dropped connections are transient; anything else the
 * server said no to is permanent, in its own words.
 */
export function imapError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  const e = error as {authenticationFailed?: boolean; serverResponseCode?: string; responseText?: string; response?: string; code?: string; message?: string};
  const said = e.responseText || e.response || e.message || 'iCloud closed the connection.';
  if (e.authenticationFailed || e.serverResponseCode === 'AUTHENTICATIONFAILED' || e.serverResponseCode === 'AUTHORIZATIONFAILED') {
    return new ProviderError('auth', `iCloud refused the app password: ${said.replace(/^\[[A-Z]+\]\s*/, '')}`);
  }
  if (['UNAVAILABLE', 'INUSE', 'SERVERBUG', 'LIMIT', 'OVERQUOTA'].includes(e.serverResponseCode ?? '')) return new ProviderError('transient', `iCloud: ${said}`);
  if (e.code && /^(E[A-Z]+|NoConnection|ClosedAfterConnect.*|ProtocolError|Timeout.*)$/.test(e.code)) return new ProviderError('transient', `iCloud: ${said}`);
  if ((e as {responseStatus?: string}).responseStatus === 'NO' || (e as {responseStatus?: string}).responseStatus === 'BAD') return new ProviderError('permanent', `iCloud: ${said}`);
  return new ProviderError('transient', `iCloud: ${said}`);
}

interface Pooled {
  key: string;
  client: Promise<ImapFlow>;
  lastUsed: number;
}

/**
 * One persistent connection per source (v1's pool): concurrent callers share the connect in
 * flight; a dead or failed connection is evicted so the next call connects afresh; idle ones close.
 */
class ImapPool {
  private readonly entries = new Map<number, Pooled>();
  private readonly options: Required<Pick<ICloudAdapterOptions, 'endpoint' | 'idleMs' | 'connectTimeoutMs'>>;
  private readonly sweeper: NodeJS.Timeout;

  constructor(options: Required<Pick<ICloudAdapterOptions, 'endpoint' | 'idleMs' | 'connectTimeoutMs'>>) {
    this.options = options;
    this.sweeper = setInterval(() => this.closeIdle(), 60_000);
    this.sweeper.unref();
  }

  newClient(username: string, password: string): ImapFlow {
    const {endpoint, connectTimeoutMs} = this.options;
    return new ImapFlow({
      host: endpoint.host, port: endpoint.port, secure: endpoint.secure, auth: {user: username, pass: password}, logger: false,
      connectionTimeout: connectTimeoutMs, greetingTimeout: connectTimeoutMs, socketTimeout: 5 * 60_000, disableAutoIdle: true,
      ...(endpoint.secure ? {} : {doSTARTTLS: false}),
    });
  }

  async get(sourceId: number, username: string, password: string): Promise<ImapFlow> {
    // Keyed by the credentials too, so a reconnect with a new app password never reuses the old session.
    const key = createHash('sha256').update(`${username}\0${password}`).digest('hex');
    const existing = this.entries.get(sourceId);
    if (existing && existing.key === key) {
      try {
        const client = await existing.client;
        if (client.usable) {
          existing.lastUsed = Date.now();
          return client;
        }
      } catch {
        // Its connect failed; it was evicted, and a fresh one follows.
      }
    }
    if (existing) this.evict(sourceId, existing);
    // Claim the slot before awaiting, so a second caller shares this connect (v1 REL-06).
    const entry: Pooled = {key, lastUsed: Date.now(), client: Promise.resolve(null as unknown as ImapFlow)};
    entry.client = (async () => {
      const client = this.newClient(username, password);
      client.on('error', () => this.evict(sourceId, entry));
      client.on('close', () => this.evict(sourceId, entry));
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          client.connect(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new ProviderError('transient', 'iCloud didn\'t answer in time.')), this.options.connectTimeoutMs);
          }),
        ]);
        return client;
      } catch (error) {
        this.evict(sourceId, entry);
        client.close();
        throw error;
      } finally {
        clearTimeout(timer);
      }
    })();
    this.entries.set(sourceId, entry);
    return entry.client;
  }

  private evict(sourceId: number, entry: Pooled) {
    if (this.entries.get(sourceId) === entry) this.entries.delete(sourceId);
  }

  /** Whether a source's session is pooled: one iCloud closes leaves the pool as its client sees it go. */
  holds(sourceId: number): boolean {
    return this.entries.has(sourceId);
  }

  /** Drops a source's connection (after an error that may have left it in an unknown state). */
  drop(sourceId: number) {
    const entry = this.entries.get(sourceId);
    if (!entry) return;
    this.entries.delete(sourceId);
    entry.client.then(client => client.close(), () => {});
  }

  private closeIdle() {
    const now = Date.now();
    for (const [sourceId, entry] of this.entries) {
      if (now - entry.lastUsed > this.options.idleMs) {
        this.entries.delete(sourceId);
        entry.client.then(client => client.logout().catch(() => client.close()), () => {});
      }
    }
  }

  async closeAll() {
    clearInterval(this.sweeper);
    const entries = [...this.entries.values()];
    this.entries.clear();
    await Promise.all(entries.map(entry => entry.client.then(client => client.logout().catch(() => client.close()), () => {})));
  }
}

export class ICloudAdapter implements SourceAdapter {
  private readonly pool: ImapPool;
  private readonly backfillChunk: number;
  private readonly locks = new Map<number, Promise<unknown>>();

  constructor(options: ICloudAdapterOptions = {}) {
    this.pool = new ImapPool({endpoint: options.endpoint ?? ICLOUD_IMAP, idleMs: options.idleMs ?? 10 * 60_000, connectTimeoutMs: options.connectTimeoutMs ?? 15_000});
    this.backfillChunk = options.backfillChunk ?? 50;
  }

  /** Connect iCloud: logs in once with the app password, outside the pool. Throws the refusal. */
  async verify(username: string, password: string): Promise<void> {
    const client = this.pool.newClient(username, password);
    try {
      await client.connect();
      await client.logout();
    } catch (error) {
      client.close();
      throw imapError(error);
    }
  }

  /** Whether a session for the source is pooled, for a test to wait until iCloud's close has reached it. */
  pooled(sourceId: number): boolean {
    return this.pool.holds(sourceId);
  }

  async close() {
    await this.pool.closeAll();
  }

  /** The source's pooled connection, used under one mailbox lock; an aborted check closes it. */
  private async withMailbox<T>(context: AdapterContext, mailbox: string, work: (client: ImapFlow) => Promise<T>): Promise<T> {
    const credentials = context.credentials();
    if (!credentials || credentials.kind !== 'app_password') throw new ProviderError('auth', 'iCloud has no app password; reconnect it in Settings › Accounts.');
    let client: ImapFlow;
    try {
      client = await this.pool.get(context.source.id, credentials.username, credentials.password);
    } catch (error) {
      throw imapError(error);
    }
    const abort = () => this.pool.drop(context.source.id);
    context.signal.addEventListener('abort', abort, {once: true});
    try {
      const lock = await client.getMailboxLock(mailbox);
      try {
        return await work(client);
      } finally {
        lock.release();
      }
    } catch (error) {
      const failure = imapError(error);
      if (failure.kind === 'transient') this.pool.drop(context.source.id);
      throw failure;
    } finally {
      context.signal.removeEventListener('abort', abort);
    }
  }

  private async locked<T>(context: AdapterContext, work: () => Promise<T>): Promise<T> {
    const id = context.source.id;
    const run = (this.locks.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    this.locks.set(id, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(id) === run) this.locks.delete(id);
    }
  }

  async sync(context: AdapterContext, cursor: string | null): Promise<SyncResult> {
    return this.locked(context, () => this.poll(context, cursor));
  }

  async sweep(context: AdapterContext): Promise<void> {
    await this.locked(context, async () => {
      const result = await this.poll(context, readCursor(context.store, context.source.id));
      if (result.cursor) writeCursor(context.store, context.source.id, result.cursor);
    });
  }

  private accountId(context: AdapterContext): number {
    if (context.source.accountId === null) throw new ProviderError('permanent', 'This iCloud source has no account.');
    return context.source.accountId;
  }

  private async poll(context: AdapterContext, raw: string | null): Promise<SyncResult> {
    const {store} = context;
    const accountId = this.accountId(context);
    return this.withMailbox(context, INBOX, async client => {
      // Selected again on purpose: the pooled session's view of UIDVALIDITY and UIDNEXT is from
      // its last SELECT, which may be hours old.
      const mailbox = await client.mailboxOpen(INBOX);
      if (!mailbox) throw new ProviderError('transient', 'iCloud didn\'t open the inbox.');
      const uidValidity = String(mailbox.uidValidity);
      let cursor = raw ? JSON.parse(raw) as Cursor : null;
      if (!cursor || cursor.uidValidity !== uidValidity) {
        // First run, or every UID changed: backfill the window again, newest first.
        const since = new Date(store.now().getTime() - 365 * DAY_MS);
        const uids = await search(client, {since});
        const pending = uids.filter(uid => uid < mailbox.uidNext).sort((a, b) => b - a);
        startBackfill(store, context.source.id, pending.length, {uidValidity, pending});
        cursor = {uidValidity, lastUid: mailbox.uidNext - 1};
      }

      // New mail since the last UID seen ("n:*" always names the last message, so filter).
      const arrived = (await search(client, {uid: `${cursor.lastUid + 1}:*`})).filter(uid => uid > cursor!.lastUid);
      if (arrived.length) {
        upsertMessages(store, accountId, await fetchSources(client, arrived, uidValidity, store.now()), {matchByRfc822Id: true});
        cursor = {uidValidity, lastUid: Math.max(cursor.lastUid, ...arrived)};
      }

      // Read state and presence for everything in INBOX.
      const present = new Map<string, ProviderState>();
      // An empty INBOX has no "1:*" to fetch (some servers answer BAD).
      if (mailbox.exists > 0) {
        for await (const message of client.fetch('1:*', {uid: true, flags: true}, {uid: true})) {
          present.set(providerId(uidValidity, message.uid), {unread: !message.flags?.has(SEEN), trashed: false, archived: false});
        }
      }
      const recorded = store.db.select({providerId: t.messages.providerId, trashRef: t.messages.trashRef, unread: t.messages.unread})
        .from(t.messages).where(eq(t.messages.accountId, accountId)).all();
      const states = new Map(present);
      for (const row of recorded) {
        if (present.has(row.providerId)) continue;
        // Gone from INBOX: in Trash if Setpoint put it there, otherwise moved away in Apple Mail.
        states.set(row.providerId, {unread: row.unread, trashed: row.trashRef !== null, archived: row.trashRef === null});
      }
      applyProviderStates(store, accountId, states);

      await this.backfillStep(context, client, uidValidity);
      return {cursor: JSON.stringify(cursor)};
    });
  }

  private async backfillStep(context: AdapterContext, client: ImapFlow, uidValidity: string) {
    const {store} = context;
    const state = readBackfill<{uidValidity: string; pending: number[]}>(store, context.source.id);
    if (!state || state.done || !state.cursor || state.cursor.uidValidity !== uidValidity) return;
    const chunk = state.cursor.pending.slice(0, this.backfillChunk);
    const rest = state.cursor.pending.slice(this.backfillChunk);
    const accountId = this.accountId(context);
    const known = knownProviderIds(store, accountId, chunk.map(uid => providerId(uidValidity, uid)));
    const wanted = chunk.filter(uid => !known.has(providerId(uidValidity, uid)));
    if (wanted.length) upsertMessages(store, accountId, await fetchSources(client, wanted, uidValidity, store.now()), {backfill: true, matchByRfc822Id: true});
    const done = rest.length === 0;
    const fetched = state.fetched + chunk.length;
    writeBackfill(store, context.source.id, {
      ...state, fetched, done, cursor: {uidValidity, pending: rest}, finishedAt: done ? store.now().toISOString() : null,
    });
    if (!done) enqueueJob(store, {kind: 'sync', key: `backfill:${context.source.id}:${fetched}`, sourceId: context.source.id});
  }

  /** An attachment: the message's source (UID FETCH BODY[]) again, and the part the sync's parse named. */
  async attachment(context: AdapterContext, message: {providerId: string}, attachmentId: string): Promise<AttachmentBytes | null> {
    return this.withMailbox(context, INBOX, async client => {
      const uid = uidOf(message.providerId, String(client.mailbox && client.mailbox.uidValidity));
      if (uid === null) return null;
      let source: Buffer | undefined;
      for await (const fetched of client.fetch(String(uid), {uid: true, source: true}, {uid: true})) source = fetched.source;
      return source ? attachmentFromSource(source, attachmentId) : null;
    });
  }

  async execute(context: AdapterContext, command: CommandRow): Promise<void> {
    const {store} = context;
    const rows = command.kind === 'mark_all_read'
      ? store.db.select().from(t.messages).where(inArray(t.messages.id, (command.payload.message_ids ?? []) as number[])).all()
      : store.db.select().from(t.messages).where(eq(t.messages.id, command.targetId)).all();
    if (!rows.length) throw new ProviderError('permanent', 'That email is no longer in Setpoint.');

    if (command.kind === 'untrash') return this.untrash(context, rows[0]!);
    await this.withMailbox(context, INBOX, async client => {
      const uidValidity = String(client.mailbox && client.mailbox.uidValidity);
      const uids = rows.map(row => uidOf(row.providerId, uidValidity)).filter((uid): uid is number => uid !== null);
      if (!uids.length) throw new ProviderError('permanent', 'That email has moved in iCloud since Setpoint last looked; it will catch up at the next check.');
      const range = uids.join(',');
      switch (command.kind) {
        case 'open':
        case 'mark_read':
        case 'mark_all_read':
          return expect(await client.messageFlagsAdd(range, [SEEN], {uid: true}), 'mark it read');
        case 'mark_unread':
          return expect(await client.messageFlagsRemove(range, [SEEN], {uid: true}), 'mark it unread');
        case 'trash': {
          const trash = await trashMailbox(client);
          const moved = await client.messageMove(range, trash, {uid: true});
          if (!moved) throw new ProviderError('permanent', `iCloud couldn't move it to ${trash}.`);
          const trashUid = moved.uidMap?.get(uids[0]!);
          store.db.update(t.messages).set({trashRef: trashUid && moved.uidValidity ? providerId(moved.uidValidity, trashUid) : `${trash}:?`})
            .where(eq(t.messages.id, rows[0]!.id)).run();
          return;
        }
        default:
          throw new ProviderError('permanent', `iCloud can't carry out ${command.kind}.`);
      }
    });
  }

  /** Undo: back from Trash to INBOX, found by the UID Trash gave it, or else by its Message-ID. */
  private async untrash(context: AdapterContext, row: typeof t.messages.$inferSelect) {
    const {store} = context;
    const pool = await this.withMailbox(context, INBOX, client => trashMailbox(client));
    await this.withMailbox(context, pool, async client => {
      const trashValidity = String(client.mailbox && client.mailbox.uidValidity);
      let uid = row.trashRef ? uidOf(row.trashRef, trashValidity) : null;
      if (uid === null && row.rfc822Id) uid = (await search(client, {header: {'message-id': row.rfc822Id}})).at(-1) ?? null;
      if (uid === null) throw new ProviderError('permanent', 'iCloud no longer has it in Deleted Messages.');
      const moved = await client.messageMove(String(uid), INBOX, {uid: true});
      if (!moved) throw new ProviderError('permanent', 'iCloud couldn\'t move it back to the inbox.');
      const inboxUid = moved.uidMap?.get(uid);
      // Its new INBOX UID; without UIDPLUS the next poll finds it by Message-ID.
      store.db.update(t.messages).set({trashRef: null, ...(inboxUid && moved.uidValidity ? {providerId: providerId(moved.uidValidity, inboxUid)} : {})})
        .where(eq(t.messages.id, row.id)).run();
    });
  }
}

function expect(result: boolean, what: string) {
  if (!result) throw new ProviderError('permanent', `iCloud couldn't ${what}.`);
}

async function search(client: ImapFlow, query: Parameters<ImapFlow['search']>[0]): Promise<number[]> {
  const result = await client.search(query, {uid: true});
  // v1 (strict checks): a failed SEARCH isn't an empty inbox.
  if (result === false) throw new ProviderError('transient', 'iCloud\'s search failed.');
  return Array.isArray(result) ? result : [];
}

/** The mailbox iCloud flags as \Trash ("Deleted Messages"); v1 assumed "Trash". */
async function trashMailbox(client: ImapFlow): Promise<string> {
  const folders = await client.list();
  return folders.find(folder => folder.specialUse === '\\Trash')?.path
    ?? folders.find(folder => /^(deleted messages|trash)$/i.test(folder.path))?.path
    ?? 'Deleted Messages';
}

/** Whole messages by UID, parsed for the record. */
async function fetchSources(client: ImapFlow, uids: number[], uidValidity: string, now: Date): Promise<FetchedMessage[]> {
  const fetched: FetchMessageObject[] = [];
  for await (const message of client.fetch(uids.join(','), {uid: true, flags: true, internalDate: true, source: true}, {uid: true})) fetched.push(message);
  const out: FetchedMessage[] = [];
  for (const message of fetched) {
    if (!message.source) continue;
    const internal = message.internalDate ? new Date(message.internalDate) : null;
    out.push(await fetchedMessage('icloud', message.source, {
      providerId: providerId(uidValidity, message.uid), receivedAt: internal && Number.isFinite(internal.getTime()) ? internal.toISOString() : null,
      unread: !message.flags?.has(SEEN), trashed: false, archived: false,
    }, now));
  }
  return out;
}

