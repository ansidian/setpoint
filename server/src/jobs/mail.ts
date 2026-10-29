// Jobs's one window on mail: small, read-only functions over mail's tables (D303). Mail never
// imports Jobs; Jobs reads mail only through here: J1's lookups, and J2's email as triage left it and
// the emails waiting to be read.
import type {JobsReadAccount, Kind, MessageType} from '@setpoint/shared';
import {and, asc, count, eq, gte, inArray, isNotNull, isNull, lt, or, sql} from 'drizzle-orm';
import type {SQL} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import type {Store} from '../store.ts';
import {jobsEmailsRead} from './schema.ts';

type MailReader = Pick<Store, 'db'>;

/** Which of these message ids are still emails Setpoint holds (an event links to its email while it exists, D317). */
export function existingMessages(store: MailReader, ids: (number | null)[]): Set<number> {
  const wanted = [...new Set(ids.filter((id): id is number => id !== null))];
  if (!wanted.length) return new Set();
  return new Set(store.db.select({id: t.messages.id}).from(t.messages).where(inArray(t.messages.id, wanted)).all().map(row => row.id));
}

/** The email with this subject received at this instant, if Setpoint holds it. */
export function findMessage(store: MailReader, subject: string, receivedAt: string): number | null {
  return store.db.select({id: t.messages.id}).from(t.messages).where(and(eq(t.messages.subject, subject), eq(t.messages.receivedAt, receivedAt))).get()?.id ?? null;
}

/** Mail's accounts by label ("Jobs", "Business"), for the accounts Jobs reads. */
export function accountsByLabel(store: MailReader): Map<string, number> {
  return new Map(store.db.select({id: t.accounts.id, label: t.accounts.label}).from(t.accounts).all().map(row => [row.label, row.id]));
}

/** An email as triage left it (J2): Jobs reuses its organisation, platform, type, kind and summary. */
export interface JobsEmail {
  id: number;
  accountId: number;
  accountLabel: string | null;
  fromName: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  // The text body, or the snippet when there's none.
  body: string;
  organisation: string | null;
  via: string | null;
  type: MessageType | null;
  kind: Kind | null;
  summary: string | null;
}

/** The email, once triage has sorted it; null while it's Unsorted or once it's gone. */
export function jobsEmail(store: MailReader, messageId: number): JobsEmail | null {
  const row = store.db.select({
    id: t.messages.id, accountId: t.messages.accountId, accountLabel: t.accounts.label, fromName: t.messages.fromName, fromAddress: t.messages.fromAddress,
    subject: t.messages.subject, receivedAt: t.messages.receivedAt, bodyText: t.messages.bodyText, snippet: t.messages.snippet,
    organisation: t.messages.organisation, via: t.messages.via, type: t.messages.type, kind: t.messages.kind, summary: t.messages.summary, lane: t.messages.lane,
  }).from(t.messages).leftJoin(t.accounts, eq(t.accounts.id, t.messages.accountId)).where(eq(t.messages.id, messageId)).get();
  if (!row || row.lane === null) return null;
  const {bodyText, snippet, lane: _, ...email} = row;
  return {...email, body: bodyText.trim() || snippet};
}

/** Which emails Jobs reads (decision 56): received in this window, in the accounts it lists, not read yet. */
export interface ReadWindow {
  accounts: JobsReadAccount[];
  // Received at or after (J2: since Jobs was turned on), and before (J4: history).
  from?: string | null;
  before?: string | null;
}

// An email that came minutes ago and is still with triage holds back the ones after it, so a
// confirmation is read before its update even when triage sorts them out of order; one Unsorted
// longer than this (triage down, a key missing) stops holding them.
const HOLD_BEHIND_UNSORTED_MS = 24 * 60 * 60_000;

function windowWhere(window: ReadWindow): SQL | undefined {
  const every = window.accounts.filter(account => account.reads === 'every').map(account => account.account_id);
  const career = window.accounts.filter(account => account.reads === 'career').map(account => account.account_id);
  return and(
    or(every.length ? inArray(t.messages.accountId, every) : sql`0`, career.length ? and(inArray(t.messages.accountId, career), eq(t.messages.kind, 'career')) : sql`0`),
    window.from ? gte(t.messages.receivedAt, window.from) : undefined,
    window.before ? lt(t.messages.receivedAt, window.before) : undefined,
  );
}

const unread = sql`not exists (select 1 from ${jobsEmailsRead} where ${jobsEmailsRead.messageId} = ${t.messages.id})`;

/** The oldest email still with triage that holds the rest back, if one does. */
function heldBehind(store: MailReader, window: ReadWindow, now: string): {receivedAt: string; id: number} | undefined {
  const accounts = window.accounts.map(account => account.account_id);
  if (!accounts.length) return undefined;
  const since = new Date(Date.parse(now) - HOLD_BEHIND_UNSORTED_MS).toISOString();
  return store.db.select({receivedAt: t.messages.receivedAt, id: t.messages.id}).from(t.messages).where(and(
    inArray(t.messages.accountId, accounts), isNull(t.messages.lane), gte(t.messages.receivedAt, since),
    window.from ? gte(t.messages.receivedAt, window.from) : undefined, window.before ? lt(t.messages.receivedAt, window.before) : undefined,
  )).orderBy(asc(t.messages.receivedAt), asc(t.messages.id)).limit(1).get();
}

function waitingWhere(store: MailReader, window: ReadWindow, now: string): SQL | undefined {
  const hold = heldBehind(store, window, now);
  return and(
    windowWhere(window), isNotNull(t.messages.lane), unread,
    hold ? or(lt(t.messages.receivedAt, hold.receivedAt), and(eq(t.messages.receivedAt, hold.receivedAt), lt(t.messages.id, hold.id))) : undefined,
  );
}

/** Emails triage has sorted in the window that Jobs hasn't read, oldest first (decision 72). */
export function emailsToRead(store: MailReader, window: ReadWindow, now: string, limit = 50): number[] {
  if (!window.accounts.length) return [];
  return store.db.select({id: t.messages.id}).from(t.messages).where(waitingWhere(store, window, now))
    .orderBy(asc(t.messages.receivedAt), asc(t.messages.id)).limit(limit).all().map(row => row.id);
}

/** How many emails wait for Jobs in the window: sorted by triage, not read yet ("5 emails not read yet"). */
export function emailsWaiting(store: MailReader, window: ReadWindow): number {
  if (!window.accounts.length) return 0;
  return store.db.select({n: count()}).from(t.messages).where(and(windowWhere(window), isNotNull(t.messages.lane), unread)).get()?.n ?? 0;
}
