// Jobs's one window on mail: small, read-only functions over mail's tables (D303). Mail never
// imports Jobs; Jobs reads mail only through here: J1's lookups, J2's email as triage left it and
// the emails waiting to be read, and J4's history pass: what's left for it, sorted or not.
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

/** An email as the JD lookup reads it for links (J3): its sender, text and HTML, whether or not triage has sorted it; null once it's gone. */
export function lookupEmail(store: MailReader, messageId: number): {fromAddress: string; text: string; html: string | null} | null {
  const row = store.db.select({fromAddress: t.messages.fromAddress, bodyText: t.messages.bodyText, bodyHtml: t.messages.bodyHtml, snippet: t.messages.snippet})
    .from(t.messages).where(eq(t.messages.id, messageId)).get();
  return row ? {fromAddress: row.fromAddress, text: row.bodyText.trim() || row.snippet, html: row.bodyHtml} : null;
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

/**
 * Hiring platforms' own mail domains, as the part before the top-level domain, matched at the end
 * ("us.greenhouse-mail.io" is Greenhouse's, "hire.lever.co" Lever's). Kept short: the platforms
 * applications come through, not job boards' alerts.
 */
export const HIRING_PLATFORM_SENDERS = ['greenhouse-mail', 'greenhouse', 'hire.lever', 'ashbyhq', 'myworkday', 'icims', 'smartrecruiters', 'workablemail'] as const;

/** The sender's domain is a hiring platform's: `…@[sub.]<name>.<tld>`. */
const fromHiringPlatform = or(...HIRING_PLATFORM_SENDERS.flatMap(name => [
  sql`lower(${t.messages.fromAddress}) like ${`%@${name}.%`}`, sql`lower(${t.messages.fromAddress}) like ${`%.${name}.%`}`,
]));

/**
 * A Career-only account's email Jobs reads (decision 56, D355): triage's Career; and, for backfilled
 * mail only, which the rules sorted without a model and whose kind triage's extraction never changes,
 * one typed a confirmation or rejection (by the extraction, or the rules until it runs) or sent by a
 * hiring platform. Live mail stays Career only.
 */
const careerMail = or(
  eq(t.messages.kind, 'career'),
  and(eq(t.messages.backfill, true), or(inArray(t.messages.type, ['confirmation', 'rejection']), fromHiringPlatform)),
);

function windowWhere(window: ReadWindow): SQL | undefined {
  const every = window.accounts.filter(account => account.reads === 'every').map(account => account.account_id);
  const career = window.accounts.filter(account => account.reads === 'career').map(account => account.account_id);
  return and(
    or(every.length ? inArray(t.messages.accountId, every) : sql`0`, career.length ? and(inArray(t.messages.accountId, career), careerMail) : sql`0`),
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

/**
 * What the history pass (J4) has left in its window: emails it can read now (sorted by triage, as
 * `emailsWaiting` counts them), and emails triage hasn't sorted yet in any account it lists, which it
 * waits for, since only triage's kind says whether a Career-only account's email is one to read.
 */
export function historyLeft(store: MailReader, window: ReadWindow): {sorted: number; unsorted: number} {
  const accounts = window.accounts.map(account => account.account_id);
  if (!accounts.length) return {sorted: 0, unsorted: 0};
  const unsorted = store.db.select({n: count()}).from(t.messages).where(and(
    inArray(t.messages.accountId, accounts), isNull(t.messages.lane), unread,
    window.from ? gte(t.messages.receivedAt, window.from) : undefined, window.before ? lt(t.messages.receivedAt, window.before) : undefined,
  )).get()?.n ?? 0;
  return {sorted: emailsWaiting(store, window), unsorted};
}

/** Which of these are mail's accounts. */
export function existingAccounts(store: MailReader, ids: number[]): Set<number> {
  if (!ids.length) return new Set();
  return new Set(store.db.select({id: t.accounts.id}).from(t.accounts).where(inArray(t.accounts.id, ids)).all().map(row => row.id));
}
