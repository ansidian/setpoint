// An email's conversation: the emails of its thread in the same account, received and sent, oldest
// first, and the reply the user sent to it (src/domain/thread.ts). Trashed mail is left out.
import {and, asc, eq, inArray, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {conversationKey} from '../domain/inbox.ts';
import {replyOf} from '../domain/thread.ts';
import type {ThreadEmail} from '../domain/thread.ts';
import type {Store} from '../store.ts';

type Threaded = Pick<typeof t.messages.$inferSelect, 'id' | 'accountId' | 'threadId'>;

const threadColumns = {
  id: t.messages.id, accountId: t.messages.accountId, threadId: t.messages.threadId, receivedAt: t.messages.receivedAt, sent: t.messages.sent, received: t.messages.received,
  rfc822Id: t.messages.rfc822Id, inReplyTo: t.messages.inReplyTo, referenceIds: t.messages.referenceIds,
};

const keyOf = conversationKey;

const memberColumns = {
  id: t.messages.id, accountId: t.messages.accountId, threadId: t.messages.threadId, fromName: t.messages.fromName, fromAddress: t.messages.fromAddress,
  sent: t.messages.sent, received: t.messages.received, receivedAt: t.messages.receivedAt, unread: t.messages.unread, pinnedAt: t.messages.pinnedAt,
  doneAt: t.messages.doneAt, snoozedUntil: t.messages.snoozedUntil,
};
export type Member = {[K in keyof typeof memberColumns]: (typeof t.messages.$inferSelect)[K]};

/**
 * The conversations of these emails, by conversationKey: every email of each one's thread in its
 * account, received and sent, oldest first, trashed mail left out. One query per account and 500
 * threads, on the thread index.
 */
export function membersOf(store: Store, rows: {accountId: number; threadId: string}[]): Map<string, Member[]> {
  const members = new Map<string, Member[]>();
  const byAccount = new Map<number, Set<string>>();
  for (const row of rows) byAccount.set(row.accountId, (byAccount.get(row.accountId) ?? new Set()).add(row.threadId));
  for (const [accountId, threads] of byAccount) {
    const threadIds = [...threads];
    for (let at = 0; at < threadIds.length; at += 500) {
      for (const row of store.db.select(memberColumns).from(t.messages)
        .where(and(eq(t.messages.accountId, accountId), inArray(t.messages.threadId, threadIds.slice(at, at + 500)), isNull(t.messages.trashedAt)))
        .orderBy(asc(t.messages.receivedAt), asc(t.messages.id)).all()) {
        const key = keyOf(row);
        members.set(key, [...(members.get(key) ?? []), row]);
      }
    }
  }
  return members;
}

/**
 * The reply each email has, by id: the sent email's id and when it was sent. One query for the lot:
 * only threads holding untrashed sent mail are read.
 */
export function repliesOf(store: Store, rows: (Threaded & ThreadEmail)[]): Map<number, {id: number; at: string}> {
  const replies = new Map<number, {id: number; at: string}>();
  const asked = rows.filter(row => row.received);
  if (!asked.length) return replies;
  const threadIds = [...new Set(asked.map(row => row.threadId))];
  const withSent = new Set<string>();
  for (let at = 0; at < threadIds.length; at += 500) {
    const chunk = threadIds.slice(at, at + 500);
    for (const row of store.db.selectDistinct({accountId: t.messages.accountId, threadId: t.messages.threadId}).from(t.messages)
      .where(and(inArray(t.messages.threadId, chunk), eq(t.messages.sent, true), isNull(t.messages.trashedAt))).all()) withSent.add(keyOf(row));
  }
  const wanted = asked.filter(row => withSent.has(keyOf(row)));
  if (!wanted.length) return replies;
  const threads = new Map<string, ThreadEmail[]>();
  const wantedIds = [...new Set(wanted.map(row => row.threadId))];
  for (let at = 0; at < wantedIds.length; at += 500) {
    for (const row of store.db.select(threadColumns).from(t.messages)
      .where(and(inArray(t.messages.threadId, wantedIds.slice(at, at + 500)), isNull(t.messages.trashedAt))).all()) {
      const key = keyOf(row);
      if (!withSent.has(key)) continue;
      threads.set(key, [...(threads.get(key) ?? []), row]);
    }
  }
  for (const row of wanted) {
    const reply = replyOf(row, threads.get(keyOf(row)) ?? []);
    if (reply) replies.set(row.id, {id: reply.id, at: reply.receivedAt});
  }
  return replies;
}

/** Another email of an email's thread, as Alfred reads it. */
export interface ThreadMate {
  id: number;
  from_name: string;
  from_address: string;
  // The user sent it.
  sent: boolean;
  received_at: string;
  subject: string;
  // Its first words.
  excerpt: string;
}

/** The other emails of an email's thread, oldest first, trashed mail left out. */
export function conversationOf(store: Store, row: Threaded): ThreadMate[] {
  return store.db.select({
    id: t.messages.id, fromName: t.messages.fromName, fromAddress: t.messages.fromAddress, sent: t.messages.sent, receivedAt: t.messages.receivedAt,
    subject: t.messages.subject, snippet: t.messages.snippet,
  }).from(t.messages)
    .where(and(eq(t.messages.accountId, row.accountId), eq(t.messages.threadId, row.threadId), isNull(t.messages.trashedAt)))
    .orderBy(asc(t.messages.receivedAt), asc(t.messages.id)).all()
    .filter(other => other.id !== row.id)
    .map(other => ({
      id: other.id, from_name: other.fromName, from_address: other.fromAddress, sent: other.sent, received_at: other.receivedAt,
      subject: other.subject, excerpt: other.snippet,
    }));
}
