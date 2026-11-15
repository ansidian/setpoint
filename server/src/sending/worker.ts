// The `send` job: a held draft, sent through its account's provider once its Undo hold ends.
//
// - It builds the email once (src/domain/outgoingMessage.ts): the user's text with the quote or the
//   forwarded email (and a forward's attachments, fetched through the reader's attachment path),
//   In-Reply-To and References from the answered email's headers, and the Message-ID the draft kept.
// - Before the provider is asked, the draft records that a send reached it (`attempted_at`). A job
//   run again after that (a restart mid-send) first asks the provider for that Message-ID: found,
//   the send is done; not found where the provider files every send (Gmail), it sends; not found
//   where a copy may only be late (iCloud), it fails visibly rather than risk sending twice.
// - The provider accepted it: the Sent row goes in at once from the bytes sent (src/sync/mailMirror.ts,
//   so the later sync finds and keeps the same row: Gmail by its id, iCloud by Message-ID), and the
//   draft is deleted.
// - The provider refused: the draft stays, failed with the provider's words, for Try again. A send
//   is never retried by itself: a timeout may hide an accepted email.
import type {Recipient} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {mailSourceId} from '../commands/mail.ts';
import * as t from '../db/schema.ts';
import {composeBody} from '../domain/outgoingBody.ts';
import {buildMessage, replyHeaders} from '../domain/outgoingMessage.ts';
import type {OutgoingAttachment} from '../domain/outgoingMessage.ts';
import {fetchedMessage} from '../providers/mime.ts';
import type {AttachmentBytes, OutgoingMail, SentMail} from '../sync/adapter.ts';
import type {JobWorker} from '../sync/engine.ts';
import {asProviderError, ProviderError} from '../sync/errors.ts';
import {finishJob} from '../sync/jobs.ts';
import type {Job} from '../sync/jobs.ts';
import {upsertMessages} from '../sync/mailMirror.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import type {DraftRow} from './drafts.ts';
import {noteDraft, sendAddresses} from './drafts.ts';

type MessageRow = typeof t.messages.$inferSelect;

export interface SendWorkerOptions {
  store: Store;
  // The engine's, so tests and the dev run go through the adapters as production does.
  send: (sourceId: number, mail: OutgoingMail) => Promise<SentMail>;
  findSent: (sourceId: number, rfc822Id: string) => Promise<{sent: SentMail | null; certain: boolean}>;
  attachment: (sourceId: number, message: {providerId: string}, attachmentId: string) => Promise<AttachmentBytes | null>;
}

const UNSURE = 'Setpoint lost touch with the provider while sending, and can\'t tell whether it went. Check Sent before you try again.';

export class SendWorker implements JobWorker {
  readonly kind = 'send' as const;
  private readonly options: SendWorkerOptions;

  constructor(options: SendWorkerOptions) {
    this.options = options;
  }

  async run(job: Job) {
    const {store} = this.options;
    const draft = job.draftId === null ? undefined : store.db.select().from(t.drafts).where(eq(t.drafts.id, job.draftId)).get();
    // Undone or discarded meanwhile, or already settled.
    if (!draft || (draft.sendState !== 'held' && draft.sendState !== 'sending')) return finishJob(store, job.id);
    const sending = transaction(store, () => {
      const row = store.db.update(t.drafts).set({sendState: 'sending', sendAt: null}).where(eq(t.drafts.id, draft.id)).returning().get()!;
      noteDraft(store, row);
      return row;
    });
    const sourceId = mailSourceId(store, sending.accountId);
    try {
      if (sourceId === null) throw new ProviderError('permanent', 'Setpoint has no connection to send this account\'s mail through.');
      if (sending.attemptedAt) {
        const found = await this.options.findSent(sourceId, sending.rfc822Id!);
        if (found.sent) return await this.sent(job, sending, found.sent, null);
        if (!found.certain) throw new Unsure();
      }
      const mail = await this.build(sending, sourceId);
      store.db.update(t.drafts).set({attemptedAt: isoNow(store)}).where(eq(t.drafts.id, sending.id)).run();
      const result = await this.options.send(sourceId, mail);
      await this.sent(job, sending, result, mail);
    } catch (caught) {
      const unsure = caught instanceof Unsure;
      const message = unsure ? UNSURE : asProviderError(caught).message;
      transaction(store, () => {
        // After the unsure answer, the user's Try again sends without asking again: they checked.
        const row = store.db.update(t.drafts).set({sendState: 'failed', sendError: message, ...(unsure ? {attemptedAt: null} : {})})
          .where(eq(t.drafts.id, sending.id)).returning().get();
        if (row) noteDraft(store, row);
        finishJob(store, job.id);
      });
    }
  }

  /** The provider has it: the Sent row now, from the bytes sent, and the draft goes. */
  private async sent(job: Job, draft: DraftRow, result: SentMail, mail: OutgoingMail | null) {
    const {store} = this.options;
    const account = store.db.select().from(t.accounts).where(eq(t.accounts.id, draft.accountId)).get();
    const fetched = mail && account ? await fetchedMessage(account.provider, mail.raw, {
      providerId: result.providerId, threadId: result.threadId, receivedAt: isoNow(store), unread: false, trashed: false, archived: false, sent: true, received: false,
    }, store.now()) : null;
    transaction(store, () => {
      if (fetched && account) {
        const icloud = account.provider === 'icloud';
        upsertMessages(store, account.id, [fetched], icloud ? {matchByRfc822Id: true, sentCopy: true, threadsByHeaders: true} : {});
      }
      store.db.delete(t.drafts).where(eq(t.drafts.id, draft.id)).run();
      noteDraft(store, draft);
      finishJob(store, job.id);
    });
  }

  /** The email, built once for the provider: the copy it sends and the one SMTP delivers. */
  private async build(draft: DraftRow, sourceId: number): Promise<OutgoingMail> {
    const {store} = this.options;
    const answered: MessageRow | undefined = draft.messageId === null ? undefined : store.db.select().from(t.messages).where(eq(t.messages.id, draft.messageId)).get();
    const original = answered && draft.kind !== 'new' ? {kind: draft.kind === 'forward' ? 'forward' as const : 'reply' as const, email: {
      fromName: answered.fromName, fromAddress: answered.fromAddress, subject: answered.subject, receivedAt: answered.receivedAt,
      to: answered.toRecipients, cc: answered.ccRecipients, bodyText: answered.bodyText, bodyHtml: answered.bodyHtml,
    }} : null;
    const body = composeBody(draft.body, original, store.timeZone);
    const reply = original?.kind === 'reply' ? replyHeaders(answered!) : {inReplyTo: null, references: []};
    const attachments = original?.kind === 'forward' ? await this.forwarded(answered!, sourceId) : [];
    const name = sendAddresses(store).get(draft.accountId)?.find(address => address.address === draft.fromAddress)?.name ?? null;
    const message = {
      messageId: draft.rfc822Id!, date: store.now(), from: {name, address: draft.fromAddress} satisfies Recipient,
      to: draft.toRecipients, cc: draft.ccRecipients, bcc: draft.bccRecipients, subject: draft.subject,
      ...reply, text: body.text, html: body.html, attachments, boundarySeed: draft.rfc822Id!.replace(/[<>@]/g, ''),
    };
    return {
      raw: buildMessage(message, {bcc: true}), delivered: buildMessage(message, {bcc: false}), rfc822Id: draft.rfc822Id!, sender: draft.fromAddress,
      recipients: [...new Set([...draft.toRecipients, ...draft.ccRecipients, ...draft.bccRecipients].map(recipient => recipient.address))],
      threadId: original?.kind === 'reply' ? answered!.threadId : null,
    };
  }

  /** A forward's attachments, each fetched from the provider. One that's gone fails the send. */
  private async forwarded(email: MessageRow, sourceId: number): Promise<OutgoingAttachment[]> {
    const files = this.options.store.db.select().from(t.attachments).where(eq(t.attachments.messageId, email.id)).all();
    const out: OutgoingAttachment[] = [];
    for (const file of files) {
      const bytes = await this.options.attachment(sourceId, {providerId: email.providerId}, file.providerId);
      if (!bytes) throw new ProviderError('permanent', `The forwarded email's attachment ${file.filename} is no longer at the provider.`);
      out.push({filename: file.filename, mimeType: file.mimeType, content: bytes.content});
    }
    return out;
  }
}

class Unsure extends Error {}
