// The mail mirror: what the Gmail and iCloud adapters write to the message record. Providers own
// the email and its read, trash and inbox state. Setpoint owns what triage derives (lane, kind,
// organisation, …), Done, pins and when the user opened it, and the mirror never touches those. New
// mail arrives Unsorted (lane null) with a triage job. Backfilled history is sorted at once. New
// mail also wakes a snoozed email in its thread (src/commands/mail.ts wakeThreads).
//
// Sent mail is mirrored too, as a fact on the row (`sent`). Mail the user sent to others only
// (`received` false) is never triaged and never in the Inbox's state: it isn't unread or archived.
// Mail to yourself is one row, sent and received, and goes through triage as any received mail.
//
// A message whose own change is still waiting for its provider (or failed, held in place) keeps
// the state the command layer gave it. A sync that read the provider just before the change
// landed mustn't put it back (DESIGN.md › Interaction rules: nothing quietly reverts).
import {and, asc, desc, eq, gte, inArray} from 'drizzle-orm';
import {activeCommands} from '../commands/index.ts';
import {wakeThreads} from '../commands/mail.ts';
import {writeBody} from '../db/bodies.ts';
import * as t from '../db/schema.ts';
import {isDigest} from '../domain/mailpieces.ts';
import {searchBody} from '../domain/searchBody.ts';
import {senderAuthenticated} from '../domain/senderAuthentication.ts';
import type {SenderAuthentication} from '../domain/senderAuthentication.ts';
import type {Recipient} from '@setpoint/shared';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {triageIntake} from '../triage/intake.ts';
import {gatherReplies, joinedThread, threadMates} from './thread.ts';
import {enqueueJob} from './jobs.ts';

/** The job that reads a USPS digest's scans from its source. */
export const mailpiecesKey = (messageId: number) => `mailpieces:${messageId}`;

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

/** Who an email went to and what it answers, from its headers. Empty lists when a header is absent. */
export interface MessageHeaders {
  to: Recipient[];
  cc: Recipient[];
  replyTo: Recipient[];
  // The References header's ids in order, and In-Reply-To's.
  references: string[];
  inReplyTo: string | null;
}

/** The record's columns for them. */
export const headerColumns = (headers: MessageHeaders) => ({
  toRecipients: headers.to, ccRecipients: headers.cc, replyTo: headers.replyTo, referenceIds: headers.references, inReplyTo: headers.inReplyTo,
});

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
  // Absent where a caller builds one by hand without its headers: the row keeps what it has.
  recipients?: MessageHeaders;
  // The sender's unsubscribe page, when its List-Unsubscribe header has one.
  listUnsubscribe?: string;
  // The user sent it (Gmail's SENT label, iCloud's sent mailbox). False when absent.
  sent?: boolean;
  // It came to the user (in the inbox, or not sent by them). True when absent.
  received?: boolean;
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

/**
 * The record's columns for a provider state, given what the row holds now. A sent-only row was
 * never in the inbox: it is never unread and never archived, only trashed or not.
 */
function stateColumns(state: ProviderState, row: Pick<MessageRow, 'trashedAt' | 'archivedAt'> | null, now: string, received: boolean) {
  return {
    unread: received && state.unread,
    trashedAt: state.trashed ? row?.trashedAt ?? now : null,
    archivedAt: received && state.archived && !state.trashed ? row?.archivedAt ?? now : null,
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
  // IMAP: these are copies from the sent mailbox. One whose Message-ID a received row holds (mail
  // to yourself, its inbox copy) marks that row sent and changes nothing else on it.
  sentCopy?: boolean;
  // IMAP: the provider has no thread id, so a thread rests on References and In-Reply-To (src/sync/thread.ts).
  threadsByHeaders?: boolean;
}

/** The account's row with this Message-ID: a received one first, as that is the one the Inbox shows. */
function byRfc822Id(store: Store, accountId: number, rfc822Id: string): MessageRow | undefined {
  return store.db.select().from(t.messages).where(and(eq(t.messages.accountId, accountId), eq(t.messages.rfc822Id, rfc822Id)))
    .orderBy(desc(t.messages.received), asc(t.messages.id)).get();
}

/**
 * Writes fetched emails to the record: new ones inserted Unsorted, known ones refreshed with the
 * provider's fields and state. Returns the ids it inserted and updated, and notes one `mail` event.
 * Only received mail is handed to triage: a sent-only row is inserted and left alone.
 */
export function upsertMessages(store: Store, accountId: number, fetched: FetchedMessage[], options: UpsertOptions = {}): {inserted: number[]; updated: number[]} {
  if (!fetched.length) return {inserted: [], updated: []};
  return transaction(store, () => {
    const now = isoNow(store);
    const busy = messagesWithActiveCommands(store);
    const inserted: number[] = [];
    const updated: number[] = [];
    // New digests and sent-only mail, inserted but kept from triage.
    const untriaged: number[] = [];
    for (const message of fetched) {
      const sent = message.sent ?? false;
      const received = message.received ?? true;
      let row = find(store, accountId, message.providerId);
      if (!row && options.matchByRfc822Id && message.rfc822Id) {
        row = byRfc822Id(store, accountId, message.rfc822Id);
        // The sent copy of mail to yourself: its inbox copy's row is the email, now known as sent too.
        if (row && options.sentCopy && row.received) {
          if (!row.sent) store.db.update(t.messages).set({sent: true}).where(eq(t.messages.id, row.id)).run();
          updated.push(row.id);
          continue;
        }
      }
      const threadId = options.threadsByHeaders ? (row?.threadId ?? joinedThread(store, accountId, message)) : message.threadId;
      const fields = {
        providerId: message.providerId, threadId, rfc822Id: message.rfc822Id, fromName: message.fromName,
        fromAddress: message.fromAddress, subject: message.subject, snippet: message.snippet, searchBody: searchBody(message.bodyText),
        receivedAt: message.receivedAt, senderAuth: message.senderAuth, senderAuthenticated: senderAuthenticated(message.senderAuth),
        ...(message.recipients ? headerColumns(message.recipients) : {}),
        ...(message.listUnsubscribe ? {listUnsubscribe: message.listUnsubscribe} : {}),
      };
      // USPS's daily digest goes to the agenda rail, not the Inbox. It's sorted as it arrives
      // (never triaged, so never notified), and a job reads its scans from its source.
      const digest = received && isDigest({...fields, senderAuthenticated: fields.senderAuthenticated});
      if (!row) {
        const created = store.db.insert(t.messages).values({
          accountId, ...fields, ...stateColumns(message, null, now, received), lane: null, backfill: options.backfill ?? false, sent, received,
          ...(digest ? {uspsDigest: true, lane: 'fyi', kind: 'deliveries', triageSource: 'rule', triagedAt: now} as const : {}),
        }).returning({id: t.messages.id}).get();
        writeBody(store.db, created.id, message);
        for (const file of message.attachments) store.db.insert(t.attachments).values({messageId: created.id, ...file}).run();
        if (options.threadsByHeaders) gatherReplies(store, accountId, message, threadId);
        if (digest) enqueueJob(store, {kind: 'mailpieces', key: mailpiecesKey(created.id), messageId: created.id});
        if (digest || !received) untriaged.push(created.id);
        else inserted.push(created.id);
        continue;
      }
      // A sent-only row whose inbox copy just came (mail to yourself): received from now on, and new
      // to triage, which never saw it.
      const arriving = !row.received && received;
      const nowReceived = row.received || received;
      const state = busy.has(row.id) ? {} : stateColumns(message, row, now, nowReceived);
      // A fetch that lacks an identity or a verdict never erases a stored one.
      const kept = {rfc822Id: message.rfc822Id ?? row.rfc822Id, senderAuth: message.senderAuth ?? row.senderAuth,
        senderAuthenticated: message.senderAuth ? fields.senderAuthenticated : row.senderAuthenticated};
      store.db.update(t.messages).set({
        ...fields, ...kept, ...state, ...(digest ? {uspsDigest: true} : {}), sent: row.sent || sent, received: nowReceived,
        ...(arriving ? {backfill: options.backfill ?? false} : {}),
      }).where(eq(t.messages.id, row.id)).run();
      writeBody(store.db, row.id, message);
      const known = store.db.select().from(t.attachments).where(eq(t.attachments.messageId, row.id)).all();
      const same = known.length === message.attachments.length
        && known.every((file, index) => file.providerId === message.attachments[index]!.providerId && file.filename === message.attachments[index]!.filename);
      if (!same) {
        store.db.delete(t.attachments).where(eq(t.attachments.messageId, row.id)).run();
        for (const file of message.attachments) store.db.insert(t.attachments).values({messageId: row.id, ...file}).run();
      }
      if (arriving) inserted.push(row.id);
      else updated.push(row.id);
    }
    // New mail is queued for triage. Backfilled history is sorted now by the rules-only pass.
    triageIntake(store, inserted, options.backfill ?? false);
    // New mail wakes what's snoozed in its thread. History arriving by backfill isn't new.
    const woken = options.backfill ? [] : wakeThreads(store, accountId, inserted);
    // Sent mail changes the emails it answers ("You replied"), so its thread's other emails are named too.
    const changed = [...inserted, ...untriaged, ...updated, ...woken];
    noteLive(store, {type: 'mail', messages: [...new Set([...changed, ...threadMates(store, accountId, fetched.some(message => message.sent) ? changed : [])])], accounts: [accountId], commands: []});
    return {inserted: [...inserted, ...untriaged], updated};
  });
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
        const next = stateColumns(states.get(row.providerId)!, row, now, row.received);
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
    // A command about a deleted email can't land any more. Its history goes with it.
    store.db.delete(t.commands).where(and(eq(t.commands.target, 'message'), inArray(t.commands.targetId, ids))).run();
    store.db.update(t.aiUsage).set({messageId: null}).where(inArray(t.aiUsage.messageId, ids)).run();
    store.db.delete(t.messages).where(inArray(t.messages.id, ids)).run();
    noteLive(store, {type: 'mail', messages: ids, accounts: [accountId], commands: []});
    return ids;
  });
}

/** Known emails the provider lists as sent: marked sent where they weren't (mail to yourself held from before). */
export function markSent(store: Store, accountId: number, providerIds: string[]): number[] {
  if (!providerIds.length) return [];
  return transaction(store, () => {
    const changed: number[] = [];
    for (let at = 0; at < providerIds.length; at += 500) {
      changed.push(...store.db.update(t.messages).set({sent: true})
        .where(and(eq(t.messages.accountId, accountId), inArray(t.messages.providerId, providerIds.slice(at, at + 500)), eq(t.messages.sent, false)))
        .returning({id: t.messages.id}).all().map(row => row.id));
    }
    if (changed.length) noteLive(store, {type: 'mail', messages: changed, accounts: [accountId], commands: []});
    return changed;
  });
}

/** Which of these provider ids are sent-only rows. */
export function sentOnlyIds(store: Store, accountId: number, providerIds: string[]): Set<string> {
  const found = new Set<string>();
  for (let at = 0; at < providerIds.length; at += 500) {
    for (const row of store.db.select({providerId: t.messages.providerId}).from(t.messages)
      .where(and(eq(t.messages.accountId, accountId), inArray(t.messages.providerId, providerIds.slice(at, at + 500)), eq(t.messages.received, false))).all()) found.add(row.providerId);
  }
  return found;
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
