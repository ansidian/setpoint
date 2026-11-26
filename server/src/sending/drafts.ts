// Drafts, kept in Setpoint only (DESIGN.md's exception to "providers are the truth"): started
// filled by the rules in shared/src/draftFill.ts, saved as the user types (only the fields sent
// change, and the last write wins), listed for the Drafts row, and discarded. A draft Send holds or
// is sending is frozen: a late save must not change what goes out.
//
// A draft still exactly as it was filled (draftEmpty) is left out of Drafts, its count and its
// email's "Draft" mark, and swept once untouched for EMPTY_DRAFTS_KEPT_MS.
//
// The addresses an account can send as are its own and, for Gmail, the verified aliases read from
// its "Send mail as" list (src/sending/aliases.ts).
import type {DraftCreateInput, DraftOut, DraftRowOut, DraftSavedOut, DraftsOut, DraftUpdateInput, FromOut, Recipient} from '@setpoint/shared';
import {plainText} from '@setpoint/shared/richText';
import {and, asc, desc, eq, inArray, isNull, lte} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {draftEmpty, fillAnswer, NEW_MESSAGE_FILL, newMessageAccount} from '@setpoint/shared/draftFill';
import type {AnsweredEmail, DraftFill} from '@setpoint/shared/draftFill';
import {conflict, invalid, notFound} from '../errors.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';

export type DraftRow = typeof t.drafts.$inferSelect;

/** How long an empty draft no one touches is kept: a closing tab discards its own at once, this is the net. */
export const EMPTY_DRAFTS_KEPT_MS = 24 * 60 * 60_000;

/** An address an account sends as, with the name it sends with. */
export interface SendAddress {
  address: string;
  name: string | null;
  primary: boolean;
}

/**
 * Each account's addresses, in the sidebar's order: its own first, then its aliases. An account's
 * own address has the name its alias list gives it, else the name on the mail it last sent.
 */
export function sendAddresses(store: Store): Map<number, SendAddress[]> {
  const accounts = store.db.select().from(t.accounts).orderBy(asc(t.accounts.position), asc(t.accounts.id)).all();
  const aliases = store.db.select().from(t.sendAs).orderBy(asc(t.sendAs.position), asc(t.sendAs.id)).all();
  const out = new Map<number, SendAddress[]>();
  for (const account of accounts) {
    const own = account.address.toLowerCase();
    const listed = aliases.filter(alias => alias.accountId === account.id);
    const primaryName = listed.find(alias => alias.address === own)?.name ?? null;
    out.set(account.id, [
      {address: own, name: primaryName || lastSentName(store, account.id, own), primary: true},
      ...listed.filter(alias => alias.address !== own).map(alias => ({address: alias.address, name: alias.name || null, primary: false})),
    ]);
  }
  return out;
}

/** The display name on the latest mail an address sent, or null. */
function lastSentName(store: Store, accountId: number, address: string): string | null {
  const row = store.db.select({fromName: t.messages.fromName}).from(t.messages)
    .where(and(eq(t.messages.accountId, accountId), eq(t.messages.sent, true), eq(t.messages.fromAddress, address)))
    .orderBy(desc(t.messages.receivedAt)).limit(1).get();
  return row?.fromName.trim() || null;
}

/** The account the user last sent mail from (in Setpoint or anywhere else), or null. */
function lastSentAccount(store: Store): number | null {
  return store.db.select({accountId: t.messages.accountId}).from(t.messages).where(eq(t.messages.sent, true))
    .orderBy(desc(t.messages.receivedAt), desc(t.messages.id)).limit(1).get()?.accountId ?? null;
}

/** The From picker: every account with its addresses, and the account a new message starts from. */
export function fromOptions(store: Store): FromOut {
  const addresses = sendAddresses(store);
  return {
    accounts: [...addresses].map(([accountId, list]) => ({account_id: accountId, addresses: list})),
    default_account_id: newMessageAccount([...addresses.keys()], null, lastSentAccount(store)),
  };
}

export function getDraftRow(store: Store, draftId: number): DraftRow {
  const row = store.db.select().from(t.drafts).where(eq(t.drafts.id, draftId)).get();
  if (!row) throw notFound('No such draft.');
  return row;
}

export function presentDraft(store: Store, row: DraftRow): DraftOut {
  const files = store.db.select().from(t.draftFiles).where(eq(t.draftFiles.draftId, row.id)).orderBy(asc(t.draftFiles.id)).all();
  return {
    id: row.id, kind: row.kind, message_id: row.messageId, from: {account_id: row.accountId, address: row.fromAddress},
    to: row.toRecipients, cc: row.ccRecipients, bcc: row.bccRecipients, subject: row.subject, body: row.body, quote: row.quote, removed_attachments: row.removedAttachments,
    files: files.map(file => ({id: file.id, filename: file.filename, mime_type: file.mimeType, size_bytes: file.sizeBytes})), write: row.write,
    created_at: row.createdAt, updated_at: row.updatedAt,
    send: row.sendState ? {state: row.sendState, send_at: row.sendState === 'held' ? row.sendAt : null, error: row.sendError} : null,
  };
}

/**
 * A draft's change on the live stream: the Drafts row and count, and its email's row (its draft
 * mark). A save names the draft only, unless it `flipped` the draft written or empty again, since
 * the mark changes only then or when the draft starts or goes: typing a reply then reloads Drafts
 * and the draft, not every mail list.
 */
export function noteDraft(store: Store, row: Pick<DraftRow, 'id' | 'messageId' | 'accountId'>, {saved = false, flipped = false} = {}) {
  const named = (!saved || flipped) && row.messageId !== null ? [row.messageId] : [];
  noteLive(store, {type: 'mail', messages: named, accounts: [row.accountId], commands: [], drafts: [row.id]});
}

/** An email as the shared fill rule reads it. */
const answered = (email: typeof t.messages.$inferSelect): AnsweredEmail => ({
  fromName: email.fromName, fromAddress: email.fromAddress, subject: email.subject, to: email.toRecipients, cc: email.ccRecipients, replyTo: email.replyTo, sent: email.sent,
});

/** Which of these drafts are still exactly as the server filled them (shared/src/draftFill.ts). */
export function emptyDrafts(store: Store, rows: DraftRow[]): Set<number> {
  // Only drafts with no words, quote or Send can be empty: the rest need nothing read.
  const candidates = rows.filter(row => row.sendState === null && row.quote === null && !row.removedAttachments.length && !row.bccRecipients.length);
  if (!candidates.length) return new Set();
  const ids = candidates.map(row => row.id);
  const withFiles = new Set(store.db.select({draftId: t.draftFiles.draftId}).from(t.draftFiles).where(inArray(t.draftFiles.draftId, ids)).all().map(row => row.draftId));
  const emailIds = [...new Set(candidates.flatMap(row => (row.messageId === null ? [] : [row.messageId])))];
  const emails = new Map((emailIds.length ? store.db.select().from(t.messages).where(inArray(t.messages.id, emailIds)).all() : []).map(email => [email.id, email]));
  const addresses = emailIds.length ? sendAddresses(store) : new Map<number, SendAddress[]>();
  const own = [...addresses.values()].flat().map(address => address.address);
  const fillOf = (row: DraftRow): DraftFill | null => {
    if (row.kind === 'new') return NEW_MESSAGE_FILL;
    const email = row.messageId === null ? undefined : emails.get(row.messageId);
    const account = email ? (addresses.get(email.accountId) ?? []).map(address => address.address) : [];
    return email && account.length ? fillAnswer(row.kind, answered(email), account, own) : null;
  };
  return new Set(candidates.filter(row => draftEmpty({
    to: row.toRecipients, cc: row.ccRecipients, bcc: row.bccRecipients, subject: row.subject, body: row.body, quote: row.quote,
    removedAttachments: row.removedAttachments, files: withFiles.has(row.id) ? 1 : 0, sending: row.sendState !== null,
  }, fillOf(row))).map(row => row.id));
}

/** Whether a draft is still exactly as the server filled it. */
export const isEmptyDraft = (store: Store, row: DraftRow) => emptyDrafts(store, [row]).has(row.id);

/**
 * Starts a draft, filled on the server. A reply, reply all or forward of an email that already has
 * one returns that one, as it was left.
 */
export function createDraft(store: Store, input: DraftCreateInput): DraftOut {
  return transaction(store, () => {
    const now = isoNow(store);
    const addresses = sendAddresses(store);
    let values: Omit<typeof t.drafts.$inferInsert, 'createdAt' | 'updatedAt' | 'kind'>;
    if (input.kind === 'new') {
      const accountId = newMessageAccount([...addresses.keys()], input.account_id ?? null, lastSentAccount(store));
      if (accountId === null) throw conflict('no_account', 'Connect a mail account in Settings › Accounts first.');
      values = {messageId: null, accountId, fromAddress: addresses.get(accountId)![0]!.address, toRecipients: [], ccRecipients: [], bccRecipients: [], subject: '', body: []};
    } else {
      const messageId = input.message_id!;
      const existing = store.db.select().from(t.drafts).where(and(eq(t.drafts.messageId, messageId), eq(t.drafts.kind, input.kind))).get();
      if (existing) return presentDraft(store, existing);
      const email = store.db.select().from(t.messages).where(eq(t.messages.id, messageId)).get();
      if (!email || email.trashedAt) throw notFound('That email is no longer in Setpoint.');
      const own = [...addresses.values()].flat().map(address => address.address);
      const filled = fillAnswer(input.kind, answered(email), (addresses.get(email.accountId) ?? []).map(address => address.address), own);
      values = {messageId, accountId: email.accountId, fromAddress: filled.fromAddress, toRecipients: filled.to, ccRecipients: filled.cc, bccRecipients: [], subject: filled.subject, body: []};
    }
    const row = store.db.insert(t.drafts).values({...values, kind: input.kind, createdAt: now, updatedAt: now}).returning().get();
    noteDraft(store, row);
    return presentDraft(store, row);
  });
}

/** Refuses a change to a draft whose send is held or under way. */
export function assertEditable(row: DraftRow) {
  if (row.sendState === 'held') throw conflict('draft_held', 'This message is about to send; undo it first.');
  if (row.sendState === 'sending') throw conflict('draft_sending', 'This message is sending.');
}

/** Saves what the user typed: only the fields given, the last write winning. */
export function updateDraft(store: Store, draftId: number, input: DraftUpdateInput): DraftSavedOut {
  return transaction(store, () => {
    const row = getDraftRow(store, draftId);
    assertEditable(row);
    const wasEmpty = isEmptyDraft(store, row);
    const changes: Partial<DraftRow> = {updatedAt: isoNow(store)};
    if (input.from) {
      const addresses = sendAddresses(store).get(input.from.account_id);
      if (!addresses?.some(address => address.address === input.from!.address)) throw invalid('From is not one of that account\'s addresses.');
      changes.accountId = input.from.account_id;
      changes.fromAddress = input.from.address;
    }
    if (input.to) changes.toRecipients = input.to as Recipient[];
    if (input.cc) changes.ccRecipients = input.cc as Recipient[];
    if (input.bcc) changes.bccRecipients = input.bcc as Recipient[];
    if (input.subject !== undefined) changes.subject = input.subject;
    if (input.body) changes.body = input.body;
    if (input.quote !== undefined) changes.quote = input.quote;
    if (input.removed_attachments) changes.removedAttachments = [...new Set(input.removed_attachments)];
    if (input.write !== undefined) changes.write = input.write;
    const updated = store.db.update(t.drafts).set(changes).where(eq(t.drafts.id, draftId)).returning().get()!;
    noteDraft(store, updated, {saved: true, flipped: wasEmpty !== isEmptyDraft(store, updated)});
    return {id: updated.id, updated_at: updated.updatedAt};
  });
}

/**
 * Discards a draft. A held send goes with it; one already sending can't be discarded. Its files
 * are released, kept a while for Discard's Undo to take back (src/sending/files.ts), then swept.
 */
export function discardDraft(store: Store, draftId: number) {
  transaction(store, () => {
    const row = getDraftRow(store, draftId);
    if (row.sendState === 'sending') throw conflict('draft_sending', 'This message is sending.');
    store.db.update(t.draftFiles).set({draftId: null, releasedAt: isoNow(store)}).where(eq(t.draftFiles.draftId, draftId)).run();
    // Its held send job goes with it (the job's draft_id cascades).
    store.db.delete(t.drafts).where(eq(t.drafts.id, draftId)).run();
    noteDraft(store, row);
  });
}

/** The Drafts list, the last changed first, with its count: the empty ones left out. */
export function listDrafts(store: Store): DraftsOut {
  const all = store.db.select().from(t.drafts).orderBy(desc(t.drafts.updatedAt), desc(t.drafts.id)).all();
  const empty = emptyDrafts(store, all);
  const rows = all.filter(row => !empty.has(row.id));
  const drafts: DraftRowOut[] = rows.map(row => ({
    id: row.id, kind: row.kind, message_id: row.messageId, account_id: row.accountId, to: row.toRecipients, subject: row.subject,
    snippet: plainText(row.body).replace(/\s+/g, ' ').trim().slice(0, 140), updated_at: row.updatedAt, send_state: row.sendState,
    send_at: row.sendState === 'held' ? row.sendAt : null,
  }));
  return {drafts, count: drafts.length};
}

/** Which emails have a draft answering them, for their rows' mark: an empty one doesn't count. */
export function draftedMessages(store: Store): Set<number> {
  const rows = store.db.select().from(t.drafts).all().filter(row => row.messageId !== null);
  const empty = emptyDrafts(store, rows);
  return new Set(rows.flatMap(row => (empty.has(row.id) ? [] : [row.messageId!])));
}

/** The newest draft that answers or forwards one of these emails (a conversation's), empty ones left out. */
export function draftAnswering(store: Store, messageIds: number[]): {id: number; message_id: number} | null {
  if (!messageIds.length) return null;
  const rows = store.db.select().from(t.drafts).where(inArray(t.drafts.messageId, messageIds)).orderBy(desc(t.drafts.updatedAt), desc(t.drafts.id)).all();
  const empty = emptyDrafts(store, rows);
  const row = rows.find(one => !empty.has(one.id));
  return row ? {id: row.id, message_id: row.messageId!} : null;
}

/** Discards the empty drafts no one has touched for EMPTY_DRAFTS_KEPT_MS. Answers how many went. */
export function sweepEmptyDrafts(store: Store): number {
  const before = new Date(store.now().getTime() - EMPTY_DRAFTS_KEPT_MS).toISOString();
  const stale = store.db.select().from(t.drafts).where(and(isNull(t.drafts.sendState), lte(t.drafts.updatedAt, before))).all();
  const empty = emptyDrafts(store, stale);
  for (const id of empty) discardDraft(store, id);
  return empty.size;
}
