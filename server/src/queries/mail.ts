// Mail's read queries over the message record (SV-2 decision D4): the Inbox's groups and counts,
// All by day, and one email. Every view is a query; nothing is copied per view. The rules for what
// the Inbox shows and counts are src/domain/inbox.ts.
import type {AllOut, CommandOut, InboxOut, IndexingOut, MailCountsOut, MessageOut, MessageRowOut, TrustedDomainOut} from '@setpoint/shared';
import {and, count, desc, eq, inArray, lt, or} from 'drizzle-orm';
import {activeCommands, commandPresenter} from '../commands/index.ts';
import * as t from '../db/schema.ts';
import {inboxCounts, inboxGroups, nextInboxChange} from '../domain/inbox.ts';
import type {InboxCandidate} from '../domain/inbox.ts';
import {isTrustedDomain, trustDomainOf, remoteContent} from '../domain/remoteContent.ts';
import {localDay} from '../domain/time.ts';
import {notFound} from '../errors.ts';
import {backfillProgress, readBackfill} from '../sync/cursors.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';

type MessageRow = typeof t.messages.$inferSelect;
type Candidate = MessageRow & InboxCandidate & {command: CommandOut | null; attachmentCount: number};

/** PDF, image and CSV open a preview (BRIEF.md › The reader). */
const PREVIEWABLE = /^(application\/pdf|image\/(png|jpeg|gif|webp)|text\/csv)$/;

/** Each email's active command: its own, or the Mark all as read it's waiting on. */
function commandsByMessage(store: Store): Map<number, CommandOut> {
  const present = commandPresenter(store);
  const byMessage = new Map<number, CommandOut>();
  for (const row of activeCommands(store)) {
    if (row.target === 'message') byMessage.set(row.targetId, present(row));
    if (row.target === 'account' && row.kind === 'mark_all_read') {
      for (const id of (row.payload.message_ids ?? []) as number[]) if (!byMessage.has(id)) byMessage.set(id, present(row));
    }
  }
  return byMessage;
}

function candidates(store: Store, accountId?: number): Candidate[] {
  const commands = commandsByMessage(store);
  const attachments = new Map(store.db.select({id: t.attachments.messageId, n: count()}).from(t.attachments).groupBy(t.attachments.messageId).all().map(row => [row.id, row.n]));
  return store.db.select().from(t.messages).where(accountId ? eq(t.messages.accountId, accountId) : undefined).all().map(row => {
    const command = commands.get(row.id) ?? null;
    return {...row, command, held: command?.state === 'failed', attachmentCount: attachments.get(row.id) ?? 0};
  });
}

/** The decisive fact on a security row: "New sign-in · MacBook Pro · Los Angeles". */
function factOf(row: MessageRow): string | null {
  const facts = row.securityFacts;
  if (!facts) return null;
  return [facts.what, facts.device, facts.location, facts.app].filter(Boolean).join(' · ');
}

function presentRow(row: Candidate): MessageRowOut {
  return {
    id: row.id, account_id: row.accountId, from_name: row.fromName, from_address: row.fromAddress, organisation: row.organisation, via: row.via,
    subject: row.subject, summary: row.summary, received_at: row.receivedAt, unread: row.unread, lane: row.lane, kind: row.kind, type: row.type,
    protected: row.protected, pinned: row.pinnedAt !== null, done: row.doneAt !== null, fact: row.code ? null : factOf(row),
    code: row.code && row.codeExpiresAt ? {value: row.code, expires_at: row.codeExpiresAt} : null,
    attachment_count: row.attachmentCount, command: row.command,
  };
}

function countsOf(all: Candidate[], now: string, accountIds: number[]): MailCountsOut {
  const counts = inboxCounts(all, now);
  return {
    attention: counts.attention, unread: counts.unread, unread_fyi: counts.unreadFyi,
    accounts: accountIds.map(id => ({account_id: id, unread: counts.byAccount.get(id) ?? 0})),
  };
}

const accountIdsOf = (store: Store) => store.db.select({id: t.accounts.id}).from(t.accounts).orderBy(t.accounts.position).all().map(row => row.id);

export function mailCounts(store: Store): MailCountsOut {
  return countsOf(candidates(store), isoNow(store), accountIdsOf(store));
}

/** The Inbox, optionally for one account; the counts are always every account's (the sidebar's). */
export function inbox(store: Store, accountId?: number): InboxOut {
  const now = isoNow(store);
  const all = candidates(store);
  const shown = accountId ? all.filter(row => row.accountId === accountId) : all;
  return {
    account_id: accountId ?? null,
    groups: inboxGroups(shown, now).map(group => ({
      group: group.group, count: group.rows.length, unread: group.unread, rows: group.rows.map(presentRow),
    })),
    counts: countsOf(all, now, accountIdsOf(store)),
    next_change_at: nextInboxChange(shown, now),
  };
}

/** All: every email, Noise included, newest first, by local day; trashed mail left out. */
export function allMail(store: Store, input: {account_id?: number; before?: string; limit: number}): AllOut {
  const commands = commandsByMessage(store);
  let where = input.account_id ? eq(t.messages.accountId, input.account_id) : undefined;
  if (input.before) {
    const [at, id] = input.before.split('|') as [string, string];
    where = and(where, or(lt(t.messages.receivedAt, at), and(eq(t.messages.receivedAt, at), lt(t.messages.id, Number(id)))));
  }
  const rows = store.db.select().from(t.messages).where(where).orderBy(desc(t.messages.receivedAt), desc(t.messages.id)).all()
    .filter(row => !row.trashedAt || commands.get(row.id)?.state === 'failed');
  const page = rows.slice(0, input.limit);
  const attachments = new Map(page.length
    ? store.db.select({id: t.attachments.messageId, n: count()}).from(t.attachments).where(inArray(t.attachments.messageId, page.map(row => row.id))).groupBy(t.attachments.messageId).all().map(row => [row.id, row.n])
    : []);
  const days: AllOut['days'] = [];
  for (const row of page) {
    const date = localDay(row.receivedAt, store.timeZone);
    if (days.at(-1)?.date !== date) days.push({date, rows: []});
    const command = commands.get(row.id) ?? null;
    days.at(-1)!.rows.push(presentRow({...row, command, held: command?.state === 'failed', attachmentCount: attachments.get(row.id) ?? 0}));
  }
  const last = page.at(-1);
  return {days, next_before: rows.length > input.limit && last ? `${last.receivedAt}|${last.id}` : null};
}

/** Rows for the given emails (search's page), as every list shows them; missing ids are left out. */
export function messageRows(store: Store, ids: number[]): Map<number, {row: MessageRow; out: MessageRowOut}> {
  if (!ids.length) return new Map();
  const commands = commandsByMessage(store);
  const rows = store.db.select().from(t.messages).where(inArray(t.messages.id, ids)).all();
  const attachments = new Map(store.db.select({id: t.attachments.messageId, n: count()}).from(t.attachments).where(inArray(t.attachments.messageId, ids)).groupBy(t.attachments.messageId).all().map(row => [row.id, row.n]));
  return new Map(rows.map(row => {
    const command = commands.get(row.id) ?? null;
    return [row.id, {row, out: presentRow({...row, command, held: command?.state === 'failed', attachmentCount: attachments.get(row.id) ?? 0})}];
  }));
}

const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase();

function isTrusted(store: Store, domain: string): boolean {
  return isTrustedDomain(new Set(store.db.select({domain: t.trustedDomains.domain}).from(t.trustedDomains).all().map(row => row.domain)), domain);
}

/** One email for the reading pane. Reading it doesn't mark it read; opening does (POST …/open). */
export function messageDetail(store: Store, messageId: number): MessageOut {
  const row = store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get();
  if (!row) throw notFound('No such email.');
  const account = store.db.select().from(t.accounts).where(eq(t.accounts.id, row.accountId)).get()!;
  const command = commandsByMessage(store).get(row.id) ?? null;
  const attachments = store.db.select().from(t.attachments).where(eq(t.attachments.messageId, row.id)).orderBy(t.attachments.id).all();
  const domain = domainOf(row.fromAddress);
  const trusted = isTrusted(store, domain);
  return {
    ...presentRow({...row, command, held: command?.state === 'failed', attachmentCount: attachments.length}),
    thread_id: row.threadId,
    body_text: row.bodyText,
    body_html: row.bodyHtml,
    key_date: row.keyDate,
    security: row.securityFacts,
    attachments: attachments.map(file => ({id: file.id, filename: file.filename, mime_type: file.mimeType, size_bytes: file.sizeBytes, previewable: PREVIEWABLE.test(file.mimeType)})),
    remote_content: {domain, trust_domain: trustDomainOf(domain), sender_authenticated: row.senderAuthenticated, trusted, ...remoteContent({trusted, senderAuthenticated: row.senderAuthenticated, lane: row.lane})},
    open_url: account.provider === 'gmail' ? `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.address)}#all/${encodeURIComponent(row.providerId)}` : null,
  };
}

/**
 * The first backfill's progress across mail accounts ("Indexing · 62% · showing what's indexed so
 * far"): fetched over total, a finished account counting whole. Null once none is backfilling.
 */
export function indexing(store: Store): IndexingOut {
  const sources = store.db.select().from(t.sources).where(inArray(t.sources.provider, ['gmail', 'icloud'])).all();
  const accounts: IndexingOut['accounts'] = [];
  let fetched = 0;
  let total = 0;
  for (const source of sources) {
    const state = source.accountId === null ? null : readBackfill(store, source.id);
    if (!state || source.accountId === null) continue;
    const progress = backfillProgress(state);
    accounts.push({account_id: source.accountId, progress, done: state.done});
    total += Math.max(state.total, 1);
    fetched += state.done ? Math.max(state.total, 1) : Math.min(state.fetched, state.total);
  }
  const busy = accounts.some(account => !account.done);
  return {indexing: busy ? {progress: Math.min(0.99, total ? fetched / total : 0)} : null, accounts};
}

export function trustedDomains(store: Store): TrustedDomainOut[] {
  return store.db.select().from(t.trustedDomains).orderBy(t.trustedDomains.domain).all().map(row => ({domain: row.domain, created_at: row.createdAt}));
}
