// Changes to a whole conversation, as a row's and the reader's tools make them. State stays each
// email's, so each is the email's own change made to every email it fits: Done, Pin and Snooze to
// those that came to the user, Mark read and unread to those whose read state differs, and Trash to
// every email, the user's sent replies included. Read state and trash are the provider's, so those
// are a command per email. Each change answers its Undo, which puts each email back as it was:
// its own fields as they were, and the provider's state by the opposite commands.
import type {ConversationUndo} from '@setpoint/shared';
import {and, asc, eq, inArray} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {conflict, notFound} from '../errors.ts';
import {noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {activeCommand} from './index.ts';
import type {CommandRow} from './index.ts';
import {openMessage, setDone, setPinned, setRead, snoozeMessage, trashMessage, unsnoozeMessage} from './mail.ts';

type MessageRow = typeof t.messages.$inferSelect;

export interface ConversationChange {
  commands: CommandRow[];
  undo: ConversationUndo;
}

/** Every email of the conversation an email is in, trashed ones included, oldest first. */
function conversationOf(store: Store, messageId: number): MessageRow[] {
  const row = store.db.select({accountId: t.messages.accountId, threadId: t.messages.threadId}).from(t.messages).where(eq(t.messages.id, messageId)).get();
  if (!row) throw notFound('No such email.');
  return store.db.select().from(t.messages).where(and(eq(t.messages.accountId, row.accountId), eq(t.messages.threadId, row.threadId)))
    .orderBy(asc(t.messages.receivedAt), asc(t.messages.id)).all();
}

const kept = (rows: MessageRow[]) => rows.filter(row => row.trashedAt === null);
const cameIn = (rows: MessageRow[]) => kept(rows).filter(row => row.received);

/** An email's own fields, as Undo puts them back. */
const stateOf = (row: MessageRow): ConversationUndo['emails'][number] => ({
  id: row.id, done_at: row.doneAt, opened_before_done: row.openedBeforeDone, pinned_at: row.pinnedAt,
  snoozed_until: row.snoozedUntil, returned_at: row.returnedAt, trash_due_at: row.trashDueAt,
});

const nothing = (): ConversationUndo => ({emails: [], read: [], trashed: []});

/** A change to Setpoint's own fields (Done, Pin, Snooze) on these emails, with the Undo that restores them. */
function local(store: Store, rows: MessageRow[], change: (row: MessageRow) => void): ConversationChange {
  return transaction(store, () => {
    for (const row of rows) change(row);
    return {commands: [], undo: {...nothing(), emails: rows.map(stateOf)}};
  });
}

/** Done, or not Done, for every email that came in. */
export function setConversationDone(store: Store, messageId: number, done: boolean): ConversationChange {
  return local(store, cameIn(conversationOf(store, messageId)).filter(row => (row.doneAt !== null) !== done), row => setDone(store, row.id, done));
}

/** Pin, or unpin, every email that came in. */
export function setConversationPinned(store: Store, messageId: number, pinned: boolean): ConversationChange {
  return local(store, cameIn(conversationOf(store, messageId)).filter(row => (row.pinnedAt !== null) !== pinned), row => setPinned(store, row.id, pinned));
}

/** Snooze every email that came in until `until`. A snoozed conversation returns at that time, or when a new email arrives in it. */
export function snoozeConversation(store: Store, messageId: number, until: string): ConversationChange {
  const rows = cameIn(conversationOf(store, messageId));
  if (!rows.length) throw conflict('unchanged', 'Only mail that came to you can be snoozed.');
  return local(store, rows, row => snoozeMessage(store, row.id, until));
}

/** Unsnooze: every snoozed email is back as it was. */
export function unsnoozeConversation(store: Store, messageId: number): ConversationChange {
  const rows = cameIn(conversationOf(store, messageId)).filter(row => row.snoozedUntil !== null);
  if (!rows.length) throw conflict('unchanged', 'That conversation isn\'t snoozed.');
  return local(store, rows, row => unsnoozeMessage(store, row.id));
}

/** Mark read, or Mark unread, every email whose read state differs: a command each. */
export function setConversationRead(store: Store, messageId: number, unread: boolean): ConversationChange {
  const rows = cameIn(conversationOf(store, messageId)).filter(row => row.unread !== unread);
  if (!rows.length) throw conflict('unchanged', unread ? 'That conversation is already unread.' : 'That conversation is already read.');
  return transaction(store, () => ({
    commands: rows.map(row => setRead(store, row.id, unread)),
    undo: {...nothing(), read: rows.map(row => ({id: row.id, unread: row.unread}))},
  }));
}

/** Trash every email, the user's sent replies included: a command each. */
export function trashConversation(store: Store, messageId: number): ConversationChange {
  const rows = kept(conversationOf(store, messageId));
  if (!rows.length) throw conflict('unchanged', 'That conversation is already in the trash.');
  return transaction(store, () => ({commands: rows.map(row => trashMessage(store, row.id, true)), undo: {...nothing(), trashed: rows.map(row => row.id)}}));
}

/**
 * Undo: each email back as it was before the change. Its own fields are restored as they were, and
 * its read state and trash by the opposite command, only where they still differ. Refused, changing
 * nothing, while one of those emails' changes still waits for its provider.
 */
export function undoConversation(store: Store, undo: ConversationUndo): ConversationChange {
  return transaction(store, () => {
    const ids = [...new Set([...undo.emails.map(email => email.id), ...undo.read.map(email => email.id), ...undo.trashed])];
    const rows = new Map((ids.length ? store.db.select().from(t.messages).where(inArray(t.messages.id, ids)).all() : []).map(row => [row.id, row]));
    const touched: MessageRow[] = [];
    for (const email of undo.emails) {
      const row = rows.get(email.id);
      if (!row) continue;
      store.db.update(t.messages).set({
        doneAt: email.done_at, openedBeforeDone: email.opened_before_done, pinnedAt: email.pinned_at,
        snoozedUntil: email.snoozed_until, returnedAt: email.returned_at, trashDueAt: email.trash_due_at,
      }).where(eq(t.messages.id, row.id)).run();
      touched.push(row);
    }
    if (touched.length) noteLive(store, {type: 'mail', messages: touched.map(row => row.id), accounts: [...new Set(touched.map(row => row.accountId))], commands: []});
    const commands: CommandRow[] = [];
    for (const id of undo.trashed) if (rows.get(id)?.trashedAt) commands.push(trashMessage(store, id, false));
    for (const email of undo.read) {
      const row = rows.get(email.id);
      if (row && row.unread !== email.unread) commands.push(setRead(store, row.id, email.unread));
    }
    return {commands, undo: nothing()};
  });
}

/**
 * Opening a conversation opens each of its emails: each unread one is marked read at its provider,
 * except one with a change of its own still waiting, which is left as it is. Answers which emails
 * were unread before, so the reader still opens them expanded.
 */
export function openConversation(store: Store, messageId: number): Set<number> {
  return transaction(store, () => {
    const rows = kept(conversationOf(store, messageId));
    const unread = new Set(rows.filter(row => row.unread).map(row => row.id));
    for (const row of rows) {
      if (row.unread && activeCommand(store, 'message', row.id)) continue;
      openMessage(store, row.id);
    }
    return unread;
  });
}
