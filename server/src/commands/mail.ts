// Mail changes (BRIEF.md › Read state and Done; DESIGN.md › Interaction rules). Read state and
// trash are the provider's, so they're commands: opening an unread email marks it read in Gmail or
// iCloud (counts drop at once), Mark read / unread, Trash and its Undo, and Mark all as read (one
// provider call per account). Done and Pin are Setpoint's own (no provider has them), so they
// change at once with no command.
import {and, eq, inArray} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {markAllReadTargets} from '../domain/inbox.ts';
import {conflict, notFound} from '../errors.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {activeCommand, createCommand} from './index.ts';
import type {CommandRow, Previous} from './index.ts';

type MessageRow = typeof t.messages.$inferSelect;

function message(store: Store, messageId: number): MessageRow {
  const row = store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get();
  if (!row) throw notFound('No such email.');
  return row;
}

/** The account's mail source, which carries its read state and trash. */
export function mailSourceId(store: Store, accountId: number): number | null {
  return store.db.select({id: t.sources.id}).from(t.sources)
    .where(and(eq(t.sources.accountId, accountId), inArray(t.sources.provider, ['gmail', 'icloud']))).get()?.id ?? null;
}

const before = (row: MessageRow): Previous => ({messages: [{id: row.id, unread: row.unread, trashedAt: row.trashedAt, openedAt: row.openedAt}]});

/**
 * Opening an email (a click or Enter) records that it was opened and, if it was unread, marks it
 * read at its provider. Returns the command, or null when there was nothing to send.
 */
export function openMessage(store: Store, messageId: number): CommandRow | null {
  return transaction(store, () => {
    const row = message(store, messageId);
    if (!row.unread) {
      if (!row.openedAt) {
        store.db.update(t.messages).set({openedAt: isoNow(store)}).where(eq(t.messages.id, row.id)).run();
        noteLive(store, {type: 'mail', messages: [row.id], accounts: [row.accountId], commands: []});
      }
      return null;
    }
    return createCommand(store, {
      target: 'message', kind: 'open', sourceId: mailSourceId(store, row.accountId), payload: {message_id: row.id},
      prepare: () => {
        store.db.update(t.messages).set({unread: false, openedAt: row.openedAt ?? isoNow(store)}).where(eq(t.messages.id, row.id)).run();
        return {targetId: row.id, previous: before(row), touched: {messages: [row.id], accounts: [row.accountId]}};
      },
    });
  });
}

/** Mark read or Mark unread. */
export function setRead(store: Store, messageId: number, unread: boolean): CommandRow {
  const row = message(store, messageId);
  if (row.unread === unread) throw conflict('unchanged', unread ? 'That email is already unread.' : 'That email is already read.');
  return createCommand(store, {
    target: 'message', kind: unread ? 'mark_unread' : 'mark_read', sourceId: mailSourceId(store, row.accountId), payload: {message_id: row.id, unread},
    prepare: () => {
      store.db.update(t.messages).set({unread}).where(eq(t.messages.id, row.id)).run();
      return {targetId: row.id, previous: before(row), touched: {messages: [row.id], accounts: [row.accountId]}};
    },
  });
}

/** Trash (`E`) moves it to the provider's trash; Undo is untrash. */
export function trashMessage(store: Store, messageId: number, trashed: boolean): CommandRow {
  const row = message(store, messageId);
  if ((row.trashedAt !== null) === trashed) throw conflict('unchanged', trashed ? 'That email is already in the trash.' : 'That email isn\'t in the trash.');
  return createCommand(store, {
    target: 'message', kind: trashed ? 'trash' : 'untrash', sourceId: mailSourceId(store, row.accountId), payload: {message_id: row.id},
    prepare: () => {
      store.db.update(t.messages).set({trashedAt: trashed ? isoNow(store) : null}).where(eq(t.messages.id, row.id)).run();
      return {targetId: row.id, previous: before(row), touched: {messages: [row.id], accounts: [row.accountId]}};
    },
  });
}

/**
 * Mark all as read: every unread email outside Attention, Noise included, as one command (one
 * provider call) per account. The emails read at once, as opening one does, so a load before the
 * provider confirms doesn't bring them back (D84); an email with its own change waiting is left to it.
 */
export function markAllRead(store: Store, accountId?: number): CommandRow[] {
  return transaction(store, () => {
    const candidates = store.db.select().from(t.messages).where(accountId ? eq(t.messages.accountId, accountId) : undefined).all();
    const busy = new Set(store.db.select({id: t.commands.targetId}).from(t.commands)
      .where(and(eq(t.commands.target, 'message'), inArray(t.commands.state, ['pending', 'failed']))).all().map(row => row.id));
    const byAccount = new Map<number, MessageRow[]>();
    for (const row of markAllReadTargets(candidates)) {
      if (busy.has(row.id)) continue;
      byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
    }
    return [...byAccount].filter(([account]) => !activeCommand(store, 'account', account)).map(([account, rows]) => {
      const ids = rows.map(row => row.id);
      return createCommand(store, {
        target: 'account', kind: 'mark_all_read', sourceId: mailSourceId(store, account), payload: {message_ids: ids},
        prepare: () => {
          store.db.update(t.messages).set({unread: false}).where(inArray(t.messages.id, ids)).run();
          return {targetId: account, previous: {messages: rows.flatMap(row => before(row).messages!)}, touched: {messages: ids, accounts: [account]}};
        },
      });
    });
  });
}

/**
 * Done (`H`) takes an email out of Attention, recording whether it was opened first, which teaches
 * triage quietly (decision 27). Not Done puts it back.
 */
export function setDone(store: Store, messageId: number, done: boolean): MessageRow {
  return transaction(store, () => {
    const row = message(store, messageId);
    const updated = store.db.update(t.messages).set(done
      ? {doneAt: row.doneAt ?? isoNow(store), openedBeforeDone: row.doneAt ? row.openedBeforeDone : row.openedAt !== null}
      : {doneAt: null, openedBeforeDone: null}).where(eq(t.messages.id, row.id)).returning().get()!;
    noteLive(store, {type: 'mail', messages: [row.id], accounts: [row.accountId], commands: []});
    return updated;
  });
}

/** Pin (`P`) keeps an email on the Pinned shelf until it's unpinned. */
export function setPinned(store: Store, messageId: number, pinned: boolean): MessageRow {
  return transaction(store, () => {
    const row = message(store, messageId);
    const updated = store.db.update(t.messages).set({pinnedAt: pinned ? row.pinnedAt ?? isoNow(store) : null}).where(eq(t.messages.id, row.id)).returning().get()!;
    noteLive(store, {type: 'mail', messages: [row.id], accounts: [row.accountId], commands: []});
    return updated;
  });
}
