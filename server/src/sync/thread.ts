// Threads in the mirror. For a provider with no thread id (IMAP), an email's thread is first the one
// its parsed headers name (References' first id, else In-Reply-To, else its own Message-ID: providers/mime.ts).
// That splits a thread when a reply names only the email it answers and that email is not the
// first, so the mirror joins it to the thread of any email it names that Setpoint holds, and an
// email that arrives after its replies gathers those that named it into its own thread.
import {and, eq, inArray, ne} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import type {Store} from '../store.ts';
import type {FetchedMessage} from './mailMirror.ts';

/** The thread a new email joins: that of the first email it names that the account holds, else its own. */
export function joinedThread(store: Store, accountId: number, message: FetchedMessage): string {
  const named = [...(message.recipients?.references ?? []), message.recipients?.inReplyTo].filter((id): id is string => Boolean(id));
  if (!named.length) return message.threadId;
  const held = store.db.select({rfc822Id: t.messages.rfc822Id, threadId: t.messages.threadId}).from(t.messages)
    .where(and(eq(t.messages.accountId, accountId), inArray(t.messages.rfc822Id, named))).all();
  for (const id of named) {
    const found = held.find(row => row.rfc822Id === id);
    if (found) return found.threadId;
  }
  return message.threadId;
}

/** Replies held before this email came, whose thread its Message-ID started, join its thread. */
export function gatherReplies(store: Store, accountId: number, message: FetchedMessage, threadId: string) {
  if (!message.rfc822Id || message.rfc822Id === threadId) return;
  store.db.update(t.messages).set({threadId})
    .where(and(eq(t.messages.accountId, accountId), eq(t.messages.threadId, message.rfc822Id), ne(t.messages.threadId, threadId))).run();
}

/** The other emails of the sent emails' threads among `ids`, for a live event: their "You replied" changed. */
export function threadMates(store: Store, accountId: number, ids: number[]): number[] {
  if (!ids.length) return [];
  const threads = store.db.selectDistinct({threadId: t.messages.threadId}).from(t.messages)
    .where(and(inArray(t.messages.id, ids), eq(t.messages.sent, true))).all().map(row => row.threadId);
  if (!threads.length) return [];
  return store.db.select({id: t.messages.id}).from(t.messages)
    .where(and(eq(t.messages.accountId, accountId), inArray(t.messages.threadId, threads))).all().map(row => row.id);
}
