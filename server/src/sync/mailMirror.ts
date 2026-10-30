// The mail mirror: what the Gmail and iCloud adapters write to the message record. Providers own
// the email and its read, trash and inbox state; Setpoint owns what triage derives (lane, kind,
// organisation, …), Done, pins and when the user opened it, and the mirror never touches those. New
// mail arrives Unsorted (lane null) with a triage job; backfilled history is sorted at once (B3).
//
// A message whose own change is still waiting for its provider (or failed, held in place) keeps
// the state the command layer gave it: a sync that read the provider just before the change
// landed mustn't put it back (DESIGN.md › Interaction rules: nothing quietly reverts).
import {and, eq, gte, inArray} from 'drizzle-orm';
import {activeCommands} from '../commands/index.ts';
import * as t from '../db/schema.ts';
import {searchBody} from '../domain/searchBody.ts';
import {senderAuthenticated} from '../domain/senderAuthentication.ts';
import type {SenderAuthentication} from '../domain/senderAuthentication.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {triageIntake} from '../triage/intake.ts';

type MessageRow = typeof t.messages.$inferSelect;

/** The provider's state of a message: read, in its trash, or out of its inbox. */
export interface ProviderState {
  unread: boolean;
  trashed: boolean;
  archived: boolean;
}

export interface FetchedAttachment {
  providerId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}

/** One email as its provider has it, parsed. */
export interface FetchedMessage extends ProviderState {
  providerId: string;
  threadId: string;
  rfc822Id: string | null;
  fromName: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string | null;
  receivedAt: string;
  senderAuth: SenderAuthentication | null;
  attachments: FetchedAttachment[];
}

/** Messages whose read or trash state belongs to a command right now. */
export function messagesWithActiveCommands(store: Store): Set<number> {
  const busy = new Set<number>();
  for (const row of activeCommands(store)) {
    if (row.target === 'message') busy.add(row.targetId);
    if (row.target === 'account' && row.kind === 'mark_all_read') for (const id of (row.payload.message_ids ?? []) as number[]) busy.add(id);
  }
  return busy;
}

/** The record's columns for a provider state, given what the row holds now. */
function stateColumns(state: ProviderState, row: Pick<MessageRow, 'trashedAt' | 'archivedAt'> | null, now: string) {
  return {
    unread: state.unread,
    trashedAt: state.trashed ? row?.trashedAt ?? now : null,
    archivedAt: state.archived && !state.trashed ? row?.archivedAt ?? now : null,
  };
}

function find(store: Store, accountId: number, providerId: string): MessageRow | undefined {
  return store.db.select().from(t.messages).where(and(eq(t.messages.accountId, accountId), eq(t.messages.providerId, providerId))).get();
}

export interface UpsertOptions {
  // The 365-day backfill rather than new mail.
  backfill?: boolean;
  // IMAP: a message that moved (Trash and back, a new UIDVALIDITY) gets a new UID but keeps its
  // Message-ID, so a row with the same Message-ID is the same email under its new id.
  matchByRfc822Id?: boolean;
}

/**
 * Writes fetched emails to the record: new ones inserted Unsorted, known ones refreshed with the
 * provider's fields and state. Returns the ids it inserted and updated, and notes one `mail` event.
 */
export function upsertMessages(store: Store, accountId: number, fetched: FetchedMessage[], options: UpsertOptions = {}): {inserted: number[]; updated: number[]} {
  if (!fetched.length) return {inserted: [], updated: []};
  return transaction(store, () => {
    const now = isoNow(store);
    const busy = messagesWithActiveCommands(store);
    const inserted: number[] = [];
    const updated: number[] = [];
    for (const message of fetched) {
      let row = find(store, accountId, message.providerId);
      if (!row && options.matchByRfc822Id && message.rfc822Id) {
        row = store.db.select().from(t.messages).where(and(eq(t.messages.accountId, accountId), eq(t.messages.rfc822Id, message.rfc822Id))).get();
      }
      const fields = {
        providerId: message.providerId, threadId: message.threadId, rfc822Id: message.rfc822Id, fromName: message.fromName,
        fromAddress: message.fromAddress, subject: message.subject, snippet: message.snippet, bodyText: message.bodyText, searchBody: searchBody(message.bodyText), bodyHtml: message.bodyHtml,
        receivedAt: message.receivedAt, senderAuth: message.senderAuth, senderAuthenticated: senderAuthenticated(message.senderAuth),
      };
      if (!row) {
        const created = store.db.insert(t.messages).values({
          accountId, ...fields, ...stateColumns(message, null, now), lane: null, backfill: options.backfill ?? false,
        }).returning({id: t.messages.id}).get();
        for (const file of message.attachments) store.db.insert(t.attachments).values({messageId: created.id, ...file}).run();
        inserted.push(created.id);
        continue;
      }
      const state = busy.has(row.id) ? {} : stateColumns(message, row, now);
      // A fetch that lacks an identity or a verdict never erases a stored one (v1's COALESCE).
      const kept = {rfc822Id: message.rfc822Id ?? row.rfc822Id, senderAuth: message.senderAuth ?? row.senderAuth,
        senderAuthenticated: message.senderAuth ? fields.senderAuthenticated : row.senderAuthenticated};
      store.db.update(t.messages).set({...fields, ...kept, ...state}).where(eq(t.messages.id, row.id)).run();
      const known = store.db.select().from(t.attachments).where(eq(t.attachments.messageId, row.id)).all();
      const same = known.length === message.attachments.length
        && known.every((file, index) => file.providerId === message.attachments[index]!.providerId && file.filename === message.attachments[index]!.filename);
      if (!same) {
        store.db.delete(t.attachments).where(eq(t.attachments.messageId, row.id)).run();
        for (const file of message.attachments) store.db.insert(t.attachments).values({messageId: row.id, ...file}).run();
      }
      updated.push(row.id);
    }
    // B3: new mail is queued for triage; backfilled history is sorted now by the rules-only pass.
    triageIntake(store, inserted, options.backfill ?? false);
    applyPendingPins(store, accountId, inserted);
    noteLive(store, {type: 'mail', messages: [...inserted, ...updated], accounts: [accountId], commands: []});
    return {inserted, updated};
  });
}

/** A Message-ID header as v1 and v2 compare it: without its angle brackets. */
export const bareMessageId = (value: string | null | undefined) => value?.trim().replace(/^<|>$/g, '') || null;

/** v1's pins waiting for their emails (src/importV1.ts): applied as the emails land, then forgotten. */
export function applyPendingPins(store: Store, accountId: number, messageIds: number[]) {
  if (!messageIds.length) return;
  const pending = store.db.select().from(t.pendingPins).where(eq(t.pendingPins.accountId, accountId)).all();
  if (!pending.length) return;
  const rows = store.db.select({id: t.messages.id, providerId: t.messages.providerId, rfc822Id: t.messages.rfc822Id}).from(t.messages).where(inArray(t.messages.id, messageIds)).all();
  for (const row of rows) {
    const bare = bareMessageId(row.rfc822Id);
    const pin = pending.find(one => one.providerId === row.providerId || (bare !== null && one.messageId === bare));
    if (!pin) continue;
    store.db.update(t.messages).set({pinnedAt: pin.pinnedAt}).where(eq(t.messages.id, row.id)).run();
    store.db.delete(t.pendingPins).where(eq(t.pendingPins.id, pin.id)).run();
  }
}

/**
 * Applies the provider's state to known emails (read elsewhere, trashed or archived there, back
 * in the inbox), leaving alone any whose own change is waiting. Returns the ids that changed.
 */
export function applyProviderStates(store: Store, accountId: number, states: Map<string, ProviderState>): number[] {
  if (!states.size) return [];
  return transaction(store, () => {
    const now = isoNow(store);
    const busy = messagesWithActiveCommands(store);
    const changed: number[] = [];
    const ids = [...states.keys()];
    for (let at = 0; at < ids.length; at += 500) {
      const rows = store.db.select().from(t.messages)
        .where(and(eq(t.messages.accountId, accountId), inArray(t.messages.providerId, ids.slice(at, at + 500)))).all();
      for (const row of rows) {
        if (busy.has(row.id)) continue;
        const next = stateColumns(states.get(row.providerId)!, row, now);
        if (next.unread === row.unread && next.trashedAt === row.trashedAt && next.archivedAt === row.archivedAt) continue;
        store.db.update(t.messages).set(next).where(eq(t.messages.id, row.id)).run();
        changed.push(row.id);
      }
    }
    if (changed.length) noteLive(store, {type: 'mail', messages: changed, accounts: [accountId], commands: []});
    return changed;
  });
}

/** Emails the provider no longer has at all (deleted for good): gone from the record too. */
export function removeMessages(store: Store, accountId: number, providerIds: string[]): number[] {
  if (!providerIds.length) return [];
  return transaction(store, () => {
    const rows = store.db.select({id: t.messages.id}).from(t.messages)
      .where(and(eq(t.messages.accountId, accountId), inArray(t.messages.providerId, providerIds))).all();
    const ids = rows.map(row => row.id);
    if (!ids.length) return [];
    // A command about a deleted email can't land any more; its history goes with it.
    store.db.delete(t.commands).where(and(eq(t.commands.target, 'message'), inArray(t.commands.targetId, ids))).run();
    store.db.update(t.aiUsage).set({messageId: null}).where(inArray(t.aiUsage.messageId, ids)).run();
    store.db.delete(t.messages).where(inArray(t.messages.id, ids)).run();
    noteLive(store, {type: 'mail', messages: ids, accounts: [accountId], commands: []});
    return ids;
  });
}

/** Which of these provider ids the record already holds. */
export function knownProviderIds(store: Store, accountId: number, providerIds: string[]): Set<string> {
  const known = new Set<string>();
  for (let at = 0; at < providerIds.length; at += 500) {
    for (const row of store.db.select({providerId: t.messages.providerId}).from(t.messages)
      .where(and(eq(t.messages.accountId, accountId), inArray(t.messages.providerId, providerIds.slice(at, at + 500)))).all()) known.add(row.providerId);
  }
  return known;
}

/** The record's emails for an account, received since an instant: what a sweep compares against. */
export function recordedSince(store: Store, accountId: number, since: string): MessageRow[] {
  return store.db.select().from(t.messages).where(and(eq(t.messages.accountId, accountId), gte(t.messages.receivedAt, since))).all();
}
