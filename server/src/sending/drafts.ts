// Drafts, kept in Setpoint only (DESIGN.md's exception to "providers are the truth"): started
// filled by the rules in shared/src/draftFill.ts, saved as the user types (only the fields sent
// change, and the last write wins), listed for the Drafts row, and discarded. A draft Send holds or
// is sending is frozen: a late save must not change what goes out.
//
// The addresses an account can send as are its own and, for Gmail, the verified aliases read from
// its "Send mail as" list (src/sending/aliases.ts).
import type {DraftCreateInput, DraftOut, DraftRowOut, DraftSavedOut, DraftsOut, DraftUpdateInput, FromOut, Recipient} from '@setpoint/shared';
import {plainText} from '@setpoint/shared/richText';
import {and, asc, desc, eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {fillAnswer, newMessageAccount} from '@setpoint/shared/draftFill';
import {conflict, invalid, notFound} from '../errors.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';

export type DraftRow = typeof t.drafts.$inferSelect;

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

/** A draft's change on the live stream: the Drafts row and count, and its email's row (its draft mark). */
export function noteDraft(store: Store, row: Pick<DraftRow, 'id' | 'messageId' | 'accountId'>) {
  noteLive(store, {type: 'mail', messages: row.messageId === null ? [] : [row.messageId], accounts: [row.accountId], commands: [], drafts: [row.id]});
}

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
      const filled = fillAnswer(input.kind, {
        fromName: email.fromName, fromAddress: email.fromAddress, subject: email.subject, to: email.toRecipients, cc: email.ccRecipients, replyTo: email.replyTo, sent: email.sent,
      }, (addresses.get(email.accountId) ?? []).map(address => address.address), own);
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
    noteDraft(store, updated);
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

/** The Drafts list, the last changed first, with its count. */
export function listDrafts(store: Store): DraftsOut {
  const rows = store.db.select().from(t.drafts).orderBy(desc(t.drafts.updatedAt), desc(t.drafts.id)).all();
  const drafts: DraftRowOut[] = rows.map(row => ({
    id: row.id, kind: row.kind, message_id: row.messageId, account_id: row.accountId, to: row.toRecipients, subject: row.subject,
    snippet: plainText(row.body).replace(/\s+/g, ' ').trim().slice(0, 140), updated_at: row.updatedAt, send_state: row.sendState,
  }));
  return {drafts, count: drafts.length};
}

/** Which of these emails have a draft answering them, for their rows' mark. */
export function draftedMessages(store: Store): Set<number> {
  return new Set(store.db.select({messageId: t.drafts.messageId}).from(t.drafts).all().flatMap(row => (row.messageId === null ? [] : [row.messageId])));
}
