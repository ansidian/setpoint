// Mail changes (DESIGN.md › Interaction rules). Read state and trash are the provider's, so these
// are commands: opening an unread email marks it read in Gmail or iCloud (counts drop at once), Mark
// read / unread, Trash and its Undo, Mark all as read (one provider call per account), and a
// written rule's Mark read and Trash on new mail. Done, Pin and Snooze are Setpoint's own (no
// provider has them), so they change at once with no command. A snoozed email's return marks it
// unread with the user's own Mark unread, as the provider owns its read state.
import type {RuleTrash} from '@setpoint/shared';
import {and, eq, inArray, isNotNull, notInArray} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {markAllReadTargets} from '../domain/inbox.ts';
import {trashDueAt} from '../domain/triageRules.ts';
import {conflict, invalid, notFound} from '../errors.ts';
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

const before = (row: Pick<MessageRow, 'id' | 'unread' | 'trashedAt' | 'openedAt'>): Previous => ({messages: [{id: row.id, unread: row.unread, trashedAt: row.trashedAt, openedAt: row.openedAt}]});

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

/** Trash (`E`) moves it to the provider's trash. Undo is untrash. */
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

// A code's trash and a rule's delayed trash on the same email: the earlier one is due.
const earlier = (a: string | null, b: string | null) => (a === null ? b : b === null ? a : a < b ? a : b);

/**
 * A written rule's actions on new mail it just sorted, carried out as the user's own Mark read and
 * Trash are. Each is a command, the mirror changes at once, and a refusal fails in place with Try
 * again and Move back. Trash now with Mark read is one trash command that marks it read first,
 * because an email takes one change at a time. A delayed trash only stores when it's due, for the
 * minute pass (ruleTrashDue). Returns the command, or null when there's nothing to send.
 */
export function ruleActions(store: Store, messageId: number, ruleId: number, actions: {markRead: boolean; trash: RuleTrash}): CommandRow | null {
  const row = message(store, messageId);
  const due = earlier(row.trashDueAt, trashDueAt(row.receivedAt, actions.trash));
  if (due !== null && due !== row.trashDueAt && row.pinnedAt === null) store.db.update(t.messages).set({trashDueAt: due}).where(eq(t.messages.id, row.id)).run();
  const markRead = actions.markRead && row.unread;
  const trashNow = actions.trash === 'now' && row.trashedAt === null;
  if (!markRead && !trashNow) return null;
  return createCommand(store, {
    target: 'message', kind: trashNow ? 'trash' : 'mark_read', sourceId: mailSourceId(store, row.accountId),
    payload: trashNow ? {message_id: row.id, mark_read: markRead, rule_id: ruleId} : {message_id: row.id, unread: false, rule_id: ruleId},
    prepare: () => {
      store.db.update(t.messages).set({...(markRead ? {unread: false} : {}), ...(trashNow ? {trashedAt: isoNow(store)} : {})}).where(eq(t.messages.id, row.id)).run();
      return {targetId: row.id, previous: before(row), touched: {messages: [row.id], accounts: [row.accountId]}};
    },
  });
}

/**
 * Mark all as read: every unread email outside Attention, Noise included, as one command (one
 * provider call) per account. The emails read at once, as opening one does, so a load before the
 * provider confirms doesn't bring them back. An email with its own change waiting is left to it.
 */
export function markAllRead(store: Store, accountId?: number): CommandRow[] {
  return transaction(store, () => {
    // USPS's digest and mail the user sent to others aren't in the Inbox, so Mark all as read leaves them as they are.
    const shown = and(eq(t.messages.uspsDigest, false), eq(t.messages.received, true));
    // Only the columns it needs, as it sorts every email it reads.
    const candidates = store.db.select({
      id: t.messages.id, accountId: t.messages.accountId, unread: t.messages.unread, lane: t.messages.lane, kind: t.messages.kind,
      doneAt: t.messages.doneAt, trashedAt: t.messages.trashedAt, archivedAt: t.messages.archivedAt, openedAt: t.messages.openedAt,
      snoozedUntil: t.messages.snoozedUntil,
    }).from(t.messages).where(accountId ? and(shown, eq(t.messages.accountId, accountId)) : shown).orderBy(t.messages.id).all();
    const busy = new Set(store.db.select({id: t.commands.targetId}).from(t.commands)
      .where(and(eq(t.commands.target, 'message'), inArray(t.commands.state, ['pending', 'failed']))).all().map(row => row.id));
    const byAccount = new Map<number, typeof candidates>();
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
 * triage quietly. Not Done puts it back.
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

/**
 * Pin (`P`) keeps an email on the Pinned shelf until it's unpinned. Pinning also cancels a waiting
 * trash. Unpinning doesn't bring a rule's back, but brings a code's back at its original
 * expiry while the code is live. Unpinned after it, the email stays.
 */
export function setPinned(store: Store, messageId: number, pinned: boolean): MessageRow {
  return transaction(store, () => {
    const row = message(store, messageId);
    const codeLive = row.codeTrash && row.trashedAt === null && row.codeExpiresAt !== null && row.codeExpiresAt > isoNow(store);
    const updated = store.db.update(t.messages)
      .set(pinned ? {pinnedAt: row.pinnedAt ?? isoNow(store), trashDueAt: null} : {pinnedAt: null, ...(codeLive && row.pinnedAt !== null ? {trashDueAt: row.codeExpiresAt} : {})})
      .where(eq(t.messages.id, row.id)).returning().get()!;
    noteLive(store, {type: 'mail', messages: [row.id], accounts: [row.accountId], commands: []});
    return updated;
  });
}

/**
 * A delayed trash, now due (the minute pass, src/triage/ruleTrash.ts): a rule's or a code's. It's
 * the user's own Trash command, sent once, so the due time goes as it's sent. Its payload says which:
 * `code` when the due time is the code's expiry, else the rule's `rule_id`. Refused, changing nothing,
 * while the email has a change of its own waiting. The due time then stays for the next pass. A trash
 * the provider refuses fails in place, and the pass tries it again (`delayed` in its payload).
 */
export function ruleTrashDue(store: Store, messageId: number): CommandRow {
  const row = message(store, messageId);
  const byCode = row.codeTrash && row.trashDueAt === row.codeExpiresAt;
  return createCommand(store, {
    target: 'message', kind: 'trash', sourceId: mailSourceId(store, row.accountId),
    payload: byCode ? {message_id: row.id, code: true, delayed: true} : {message_id: row.id, rule_id: row.triageRuleId, delayed: true},
    prepare: () => {
      store.db.update(t.messages).set({trashedAt: isoNow(store), trashDueAt: null}).where(eq(t.messages.id, row.id)).run();
      return {targetId: row.id, previous: before(row), touched: {messages: [row.id], accounts: [row.accountId]}};
    },
  });
}

/**
 * Snooze takes an email out of the Inbox until `until`, when it returns (returnFromSnooze). It keeps
 * its lane, pin and read state meanwhile, and stays in All and search. Snoozing it again moves the
 * time and clears the mark of an earlier return. As pinning does, it cancels a waiting trash (a
 * rule's or a code's), so the email the user set aside is never trashed before it returns.
 */
export function snoozeMessage(store: Store, messageId: number, until: string): MessageRow {
  return transaction(store, () => {
    const row = message(store, messageId);
    if (Date.parse(until) <= store.now().getTime()) throw invalid('A snooze ends in the future.');
    if (row.trashedAt) throw conflict('unchanged', 'That email is in the trash.');
    if (!row.received) throw conflict('unchanged', 'Only mail that came to you can be snoozed.');
    const updated = store.db.update(t.messages).set({snoozedUntil: new Date(until).toISOString(), returnedAt: null, trashDueAt: null})
      .where(eq(t.messages.id, row.id)).returning().get()!;
    noteLive(store, {type: 'mail', messages: [row.id], accounts: [row.accountId], commands: []});
    return updated;
  });
}

/** Unsnooze ends the snooze now: the email is back as it was, with no return mark and no notification. */
export function unsnoozeMessage(store: Store, messageId: number): MessageRow {
  return transaction(store, () => {
    const row = message(store, messageId);
    if (!row.snoozedUntil) throw conflict('unchanged', 'That email isn\'t snoozed.');
    const updated = store.db.update(t.messages).set({snoozedUntil: null}).where(eq(t.messages.id, row.id)).returning().get()!;
    noteLive(store, {type: 'mail', messages: [row.id], accounts: [row.accountId], commands: []});
    return updated;
  });
}

/**
 * A snoozed email returns as new: unread, out of Done, at the top of its group by its return time,
 * its arrival kept. A read one is marked unread by the user's own Mark unread command. One with a
 * change of its own waiting isn't returned yet: it's left due, for the minute pass (false). One
 * trashed meanwhile just loses its snooze. True once it's returned.
 */
export function returnFromSnooze(store: Store, messageId: number): boolean {
  return transaction(store, () => {
    const row = message(store, messageId);
    if (!row.snoozedUntil) return true;
    if (row.trashedAt) {
      store.db.update(t.messages).set({snoozedUntil: null}).where(eq(t.messages.id, row.id)).run();
      noteLive(store, {type: 'mail', messages: [row.id], accounts: [row.accountId], commands: []});
      return true;
    }
    if (activeCommand(store, 'message', row.id)) return false;
    const now = isoNow(store);
    store.db.update(t.messages).set({snoozedUntil: null, returnedAt: now, doneAt: null, openedBeforeDone: null}).where(eq(t.messages.id, row.id)).run();
    if (row.unread) noteLive(store, {type: 'mail', messages: [row.id], accounts: [row.accountId], commands: []});
    else {
      createCommand(store, {
        target: 'message', kind: 'mark_unread', sourceId: mailSourceId(store, row.accountId), payload: {message_id: row.id, unread: true, snooze: true},
        prepare: () => {
          store.db.update(t.messages).set({unread: true}).where(eq(t.messages.id, row.id)).run();
          return {targetId: row.id, previous: before(row), touched: {messages: [row.id], accounts: [row.accountId]}};
        },
      });
    }
    return true;
  });
}

/**
 * New mail wakes the snoozed emails in its threads, as a reply does in Gmail: each returns with it.
 * One that can't return yet is made due now, for the minute pass. Returns the ids it woke.
 */
export function wakeThreads(store: Store, accountId: number, arrived: number[]): number[] {
  if (!arrived.length) return [];
  return transaction(store, () => {
    const threads = [...new Set(store.db.select({threadId: t.messages.threadId}).from(t.messages).where(inArray(t.messages.id, arrived)).all().map(row => row.threadId))];
    const snoozedMates = store.db.select({id: t.messages.id}).from(t.messages)
      .where(and(eq(t.messages.accountId, accountId), inArray(t.messages.threadId, threads), isNotNull(t.messages.snoozedUntil), notInArray(t.messages.id, arrived))).all();
    for (const {id} of snoozedMates) {
      if (!returnFromSnooze(store, id)) store.db.update(t.messages).set({snoozedUntil: isoNow(store)}).where(eq(t.messages.id, id)).run();
    }
    return snoozedMates.map(row => row.id);
  });
}
