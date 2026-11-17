// Mail's read queries over the message record: the Inbox's groups and counts,
// All by day, and one email. Every view is a query. Nothing is copied per view. The rules for what
// the Inbox shows and counts are src/domain/inbox.ts.
import type {AllOut, CommandOut, GmailLinkOut, InboxOut, IndexingOut, MailCountsOut, MailDayOut, MessageOut, MessageRowOut, SentOut, SentRowOut, TrustedDomainOut} from '@setpoint/shared';
import {and, count, desc, eq, getTableColumns, inArray, isNull, lt, or, sql} from 'drizzle-orm';
import type {SQL} from 'drizzle-orm';
import {activeCommands, commandPresenter} from '../commands/index.ts';
import * as t from '../db/schema.ts';
import {withBody} from '../db/bodies.ts';
import {inboxCounts, inboxGroups, mailDay, nextInboxChange} from '../domain/inbox.ts';
import type {InboxCandidate} from '../domain/inbox.ts';
import {isTrustedDomain, trustDomainOf, remoteContent} from '../domain/remoteContent.ts';
import {localDay, zonedInstant} from '../domain/time.ts';
import {notFound} from '../errors.ts';
import {backfillProgress, readBackfill} from '../sync/cursors.ts';
import {isoNow} from '../store.ts';
import {draftedMessages} from '../sending/drafts.ts';
import {conversationOf, repliesOf} from './thread.ts';
import type {Store} from '../store.ts';

type MessageRow = typeof t.messages.$inferSelect;

// A list reads few columns of many emails, from messages_list, an index that holds them all, which
// is smaller to read than the table: a column added here goes in that index too.
const listColumns = {
  id: t.messages.id, accountId: t.messages.accountId, lane: t.messages.lane, kind: t.messages.kind, unread: t.messages.unread,
  receivedAt: t.messages.receivedAt, organisation: t.messages.organisation, fromName: t.messages.fromName, pinnedAt: t.messages.pinnedAt,
  doneAt: t.messages.doneAt, trashedAt: t.messages.trashedAt, codeExpiresAt: t.messages.codeExpiresAt, archivedAt: t.messages.archivedAt,
  triagedAt: t.messages.triagedAt, triageSource: t.messages.triageSource,
};

// What a row shows, read only for the rows a list shows: everything but search's text.
const {searchBody: _body, searchTerms: _terms, searchRecipients: _recipients, ...rowColumns} = getTableColumns(t.messages);
type ListedRow = Omit<MessageRow, 'searchBody' | 'searchTerms' | 'searchRecipients'>;
type Presented = ListedRow & {command: CommandOut | null; held: boolean; attachmentCount: number};
type Candidate = {[K in keyof typeof listColumns]: ListedRow[K]} & InboxCandidate & {command: CommandOut | null; attachmentCount: number};

/** The shown columns of these emails, by id. Missing ids are left out. */
function listedRows(store: Store, ids: number[]): Map<number, ListedRow> {
  const rows = new Map<number, ListedRow>();
  for (let at = 0; at < ids.length; at += 500) {
    for (const row of store.db.select(rowColumns).from(t.messages).where(inArray(t.messages.id, ids.slice(at, at + 500))).all()) rows.set(row.id, row);
  }
  return rows;
}

/** PDF, image and CSV open a preview. */
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
  // USPS's digest is out of the Inbox and its counts. Its scans are the agenda rail's. Mail the user
  // sent to others never came in.
  const shown = and(eq(t.messages.uspsDigest, false), eq(t.messages.received, true));
  return store.db.select(listColumns).from(t.messages).where(accountId ? and(shown, eq(t.messages.accountId, accountId)) : shown).all().map(row => {
    const command = commands.get(row.id) ?? null;
    return {...row, command, held: command?.state === 'failed', attachmentCount: attachments.get(row.id) ?? 0};
  });
}

/** The decisive fact on a security row: "New sign-in · MacBook Pro · Los Angeles". */
function factOf(row: ListedRow): string | null {
  const facts = row.securityFacts;
  if (!facts) return null;
  return [facts.what, facts.device, facts.location, facts.app].filter(Boolean).join(' · ');
}

type Replies = Map<number, {id: number; at: string}>;

function presentRow(row: Presented, replies?: Replies, drafted?: Set<number>): MessageRowOut {
  const reply = replies?.get(row.id);
  return {
    id: row.id, account_id: row.accountId, from_name: row.fromName, from_address: row.fromAddress, organisation: row.organisation, via: row.via,
    subject: row.subject, summary: row.summary, received_at: row.receivedAt, unread: row.unread, lane: row.lane, kind: row.kind, type: row.type,
    protected: row.protected, pinned: row.pinnedAt !== null, done: row.doneAt !== null, fact: row.code ? null : factOf(row),
    code: row.code && row.codeExpiresAt ? {value: row.code, expires_at: row.codeExpiresAt} : null,
    trash_due_at: row.pinnedAt === null ? row.trashDueAt : null, attachment_count: row.attachmentCount, command: row.command,
    ...(row.sent && !row.received ? {sent_only: true} as const : {}),
    ...(reply ? {replied_at: reply.at} : {}),
    ...(drafted?.has(row.id) ? {draft: true} as const : {}),
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

/**
 * How the mail day is going: today's counts since the user's midnight, and every email kept
 * with its size (its text and HTML as stored, and its attachments as the provider gave their size)
 * and the oldest one's arrival.
 */
export function mailDayOf(store: Store): MailDayOut {
  const now = isoNow(store);
  const day = mailDay(candidates(store), now, zonedInstant(localDay(now, store.timeZone), '00:00', store.timeZone));
  const kept = and(isNull(t.messages.trashedAt), eq(t.messages.received, true));
  // octet_length reads a body's size from its row's header, without reading the body.
  const stored = store.db.select({total: count()}).from(t.messages).where(kept).get()!;
  const bodies = store.db.select({bytes: sql<number>`coalesce(sum(octet_length(${t.messageBodies.bodyText}) + coalesce(octet_length(${t.messageBodies.bodyHtml}), 0)), 0)`})
    .from(t.messageBodies).innerJoin(t.messages, eq(t.messages.id, t.messageBodies.messageId)).where(kept).get()!;
  const oldest = store.db.select({at: sql<string | null>`min(${t.messages.receivedAt})`}).from(t.messages).where(kept).get()!.at;
  const attached = store.db.select({bytes: sql<number>`coalesce(sum(${t.attachments.sizeBytes}), 0)`})
    .from(t.attachments).innerJoin(t.messages, eq(t.messages.id, t.attachments.messageId)).where(kept).get()!;
  return {
    done: day.done, need_you: day.needYou, overdue: day.overdue, sorted_fyi: day.sortedFyi, sorted_noise: day.sortedNoise,
    total: stored.total, bytes: bodies.bytes + attached.bytes, oldest_at: oldest,
  };
}

/** The Inbox, optionally for one account. The counts are always every account's (the sidebar's). */
export function inbox(store: Store, accountId?: number): InboxOut {
  const now = isoNow(store);
  const all = candidates(store);
  const shown = accountId ? all.filter(row => row.accountId === accountId) : all;
  const groups = inboxGroups(shown, now);
  const rows = listedRows(store, [...new Set(groups.flatMap(group => group.rows.map(row => row.id)))]);
  const replies = repliesOf(store, [...rows.values()]);
  const drafted = draftedMessages(store);
  const present = (row: Candidate) => presentRow({...rows.get(row.id)!, command: row.command, held: row.held ?? false, attachmentCount: row.attachmentCount}, replies, drafted);
  return {
    account_id: accountId ?? null,
    groups: groups.map(group => ({
      group: group.group, count: group.rows.length, unread: group.unread, rows: group.rows.map(present),
    })),
    counts: countsOf(all, now, accountIdsOf(store)),
    next_change_at: nextInboxChange(shown, now),
  };
}

type PageInput = {account_id?: number; before?: string; limit: number};

/** A page of emails newest first, by local day, as All and Sent list them. Trashed mail is left out. */
function pageByDay<R>(store: Store, shown: SQL | undefined, input: PageInput, present: (row: ListedRow, out: MessageRowOut) => R): {days: {date: string; rows: R[]}[]; next_before: string | null} {
  const commands = commandsByMessage(store);
  let where = input.account_id ? and(shown, eq(t.messages.accountId, input.account_id)) : shown;
  if (input.before) {
    const [at, id] = input.before.split('|') as [string, string];
    where = and(where, or(lt(t.messages.receivedAt, at), and(eq(t.messages.receivedAt, at), lt(t.messages.id, Number(id)))));
  }
  // The order and the filter read only what messages_list holds; the page's own rows are read after.
  const rows = store.db.select({id: t.messages.id, receivedAt: t.messages.receivedAt, trashedAt: t.messages.trashedAt}).from(t.messages)
    .where(where).orderBy(desc(t.messages.receivedAt), desc(t.messages.id)).all()
    .filter(row => !row.trashedAt || commands.get(row.id)?.state === 'failed');
  const listed = listedRows(store, rows.slice(0, input.limit).map(row => row.id));
  const page = rows.slice(0, input.limit).map(row => listed.get(row.id)!);
  const attachments = new Map(page.length
    ? store.db.select({id: t.attachments.messageId, n: count()}).from(t.attachments).where(inArray(t.attachments.messageId, page.map(row => row.id))).groupBy(t.attachments.messageId).all().map(row => [row.id, row.n])
    : []);
  const replies = repliesOf(store, page);
  const drafted = draftedMessages(store);
  const days: {date: string; rows: R[]}[] = [];
  for (const row of page) {
    const date = localDay(row.receivedAt, store.timeZone);
    if (days.at(-1)?.date !== date) days.push({date, rows: []});
    const command = commands.get(row.id) ?? null;
    days.at(-1)!.rows.push(present(row, presentRow({...row, command, held: command?.state === 'failed', attachmentCount: attachments.get(row.id) ?? 0}, replies, drafted)));
  }
  const last = page.at(-1);
  return {days, next_before: rows.length > input.limit && last ? `${last.receivedAt}|${last.id}` : null};
}

/**
 * All: every email that came to the user, Noise included, newest first, by local day. Trashed mail,
 * USPS's digest and mail the user sent to others are left out.
 */
export function allMail(store: Store, input: PageInput): AllOut {
  // USPS's digest is the agenda rail's, out of All as it's out of the Inbox. Search finds it.
  return pageByDay(store, and(eq(t.messages.uspsDigest, false), eq(t.messages.received, true)), input, (_, out) => out);
}

/**
 * Sent: every email the user sent, mail to yourself included, newest first, by local day, with who
 * each went to, and the accounts that have any sent mail. Trashed mail is left out.
 */
export function sentMail(store: Store, input: PageInput): SentOut {
  const page = pageByDay(store, eq(t.messages.sent, true), input, (row, out): SentRowOut => ({...out, to: row.toRecipients, cc: row.ccRecipients}));
  const withSent = new Set(store.db.selectDistinct({id: t.messages.accountId}).from(t.messages).where(and(eq(t.messages.sent, true), isNull(t.messages.trashedAt))).all().map(row => row.id));
  return {...page, accounts: accountIdsOf(store).filter(id => withSent.has(id))};
}

/** Rows for the given emails (search's page), as every list shows them. Missing ids are left out. */
export function messageRows(store: Store, ids: number[]): Map<number, {row: MessageRow; out: MessageRowOut}> {
  if (!ids.length) return new Map();
  const commands = commandsByMessage(store);
  const rows = store.db.select().from(t.messages).where(inArray(t.messages.id, ids)).all();
  const attachments = new Map(store.db.select({id: t.attachments.messageId, n: count()}).from(t.attachments).where(inArray(t.attachments.messageId, ids)).groupBy(t.attachments.messageId).all().map(row => [row.id, row.n]));
  const replies = repliesOf(store, rows);
  const drafted = draftedMessages(store);
  return new Map(rows.map(row => {
    const command = commands.get(row.id) ?? null;
    return [row.id, {row, out: presentRow({...row, command, held: command?.state === 'failed', attachmentCount: attachments.get(row.id) ?? 0}, replies, drafted)}];
  }));
}

const domainOf = (address: string) => address.slice(address.lastIndexOf('@') + 1).toLowerCase();

function isTrusted(store: Store, domain: string): boolean {
  return isTrustedDomain(new Set(store.db.select({domain: t.trustedDomains.domain}).from(t.trustedDomains).all().map(row => row.domain)), domain);
}

/** One email for the reading pane. Reading it doesn't mark it read. Opening does (POST …/open). */
export function messageDetail(store: Store, messageId: number): MessageOut {
  const found = store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get();
  if (!found) throw notFound('No such email.');
  const row = withBody(store.db, found);
  const account = store.db.select().from(t.accounts).where(eq(t.accounts.id, row.accountId)).get()!;
  const command = commandsByMessage(store).get(row.id) ?? null;
  const attachments = store.db.select().from(t.attachments).where(eq(t.attachments.messageId, row.id)).orderBy(t.attachments.id).all();
  const domain = domainOf(row.fromAddress);
  const trusted = isTrusted(store, domain);
  const replies = repliesOf(store, [row]);
  const drafted = draftedMessages(store);
  const reply = replies.get(row.id);
  return {
    ...presentRow({...row, command, held: command?.state === 'failed', attachmentCount: attachments.length}, replies, drafted),
    thread_id: row.threadId,
    body_text: row.bodyText,
    body_html: row.bodyHtml,
    key_date: row.keyDate,
    security: row.securityFacts,
    attachments: attachments.map(file => ({id: file.id, filename: file.filename, mime_type: file.mimeType, size_bytes: file.sizeBytes, previewable: PREVIEWABLE.test(file.mimeType)})),
    remote_content: {domain, trust_domain: trustDomainOf(domain), sender_authenticated: row.senderAuthenticated, trusted, ...remoteContent({trusted, senderAuthenticated: row.senderAuthenticated, lane: row.lane})},
    open_url: account.provider === 'gmail' ? gmailUrl(account.address, row.providerId) : null,
    ...(row.toRecipients === null ? {} : {
      to: row.toRecipients, cc: row.ccRecipients ?? [], reply_to: row.replyTo ?? [], references: row.referenceIds ?? [], in_reply_to: row.inReplyTo,
    }),
    ...(reply ? {reply_id: reply.id} : {}),
    conversation: conversationOf(store, row),
  };
}

/** Open in Gmail's address for an email: its account and Gmail's message id. */
export const gmailUrl = (address: string, providerId: string) => `https://mail.google.com/mail/?authuser=${encodeURIComponent(address)}#all/${encodeURIComponent(providerId)}`;

/**
 * The email a Gmail address names, by its Gmail account's address (any case) and
 * Gmail's message id. Null when Setpoint doesn't have it, or has only trashed it.
 */
export function gmailLink(store: Store, address: string, providerId: string): GmailLinkOut {
  const row = store.db.select({id: t.messages.id}).from(t.messages).innerJoin(t.accounts, eq(t.accounts.id, t.messages.accountId))
    .where(and(eq(t.accounts.provider, 'gmail'), sql`lower(${t.accounts.address}) = ${address.toLowerCase()}`, eq(t.messages.providerId, providerId), isNull(t.messages.trashedAt))).get();
  return {message_id: row?.id ?? null};
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
