// Mail's routes: the Inbox, All, Sent and Snoozed, an email and its body, attachments and USPS
// scans, read, Done, pin, snooze and trash, a conversation and the same changes to all of it, drafts and sending with their files, and trusted
// domains. Mounted under /api behind the session (app.ts), with triage's (triage.ts) right after.
import {
  allInput, conversationUndoSchema, sentInput, doneInput, inboxInput, mailpiecesInput, markAllReadInput, pinInput, readInput, snoozeInput, trustedDomainInput, gmailLinkInput, draftCreateInput, draftFilesTakeInput, draftUpdateInput, draftWriteInput, peopleInput, sendInput,
} from '@setpoint/shared';
import type {ConversationChangeOut, MarkAllReadOut} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {z} from 'zod';
import {writeDraft} from '../alfred/write.ts';
import type {WriteOptions} from '../alfred/write.ts';
import {commandPresenter} from '../commands/index.ts';
import type {CommandRow} from '../commands/index.ts';
import {readImport} from '../calendar/icsImport.ts';
import {openConversation, setConversationDone, setConversationPinned, setConversationRead, snoozeConversation, trashConversation, undoConversation, unsnoozeConversation} from '../commands/conversation.ts';
import type {ConversationChange} from '../commands/conversation.ts';
import {markAllRead, openMessage, setDone, setPinned, setRead, snoozeMessage, trashMessage, unsnoozeMessage} from '../commands/mail.ts';
import * as t from '../db/schema.ts';
import {conflict, invalid, parse, SetpointError} from '../errors.ts';
import {suggestPeople} from '../sending/people.ts';
import {createDraft, discardDraft, fromOptions, getDraftRow, listDrafts, presentDraft, updateDraft} from '../sending/drafts.ts';
import {addDraftFile, removeDraftFile, sweepDraftFiles, takeDraftFiles} from '../sending/files.ts';
import {holdSend, undoSend} from '../sending/send.ts';
import {allMail, conversationDetail, gmailLink, inbox, indexing, mailCounts, mailDayOf, messageDetail, sentMail, snoozedMail, trustedDomains} from '../queries/mail.ts';
import {attachmentFile, messageBody} from '../queries/mailBody.ts';
import {mailpieces, mailScan} from '../queries/mailpieces.ts';
import {ProviderError} from '../sync/errors.ts';
import {isoNow, noteLive} from '../store.ts';
import type {Store} from '../store.ts';
import type {SyncEngine} from '../sync/engine.ts';

const id = (value: string) => parse(z.coerce.number().pipe(z.int().positive()), value);

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw invalid('The body must be JSON.');
  }
}

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw invalid('The body must be JSON.');
  }
}

// How long the browser keeps an email's body page: a sitting's worth, so a release's changes to it reach the reader soon.
const BODY_KEPT_S = 3600;

export interface MailApiOptions {
  engine: SyncEngine | null;
  drafting: WriteOptions;
  draftFiles: string | null;
}

export function mailApi(store: Store, {engine, drafting, draftFiles}: MailApiOptions) {
  const api = new Hono();
  const presentCommand = (row: CommandRow) => commandPresenter(store)(row);

  // ---- Mail ----

  api.get('/mail/inbox', c => c.json(inbox(store, parse(inboxInput, c.req.query()).account_id)));
  api.get('/mail/counts', c => c.json(mailCounts(store)));
  api.get('/mail/day', c => c.json(mailDayOf(store)));
  api.get('/mail/all', c => c.json(allMail(store, parse(allInput, c.req.query()))));
  api.get('/mail/sent', c => c.json(sentMail(store, parse(sentInput, c.req.query()))));
  api.get('/mail/messages/:id', c => c.json(messageDetail(store, id(c.req.param('id')))));
  api.get('/mail/gmail-link', c => {
    const input = parse(gmailLinkInput, c.req.query());
    return c.json(gmailLink(store, input.account, input.id));
  });
  // The HTML body as its own page, for the reader's sandboxed frame. It has its own policy, not the
  // app's. Plain-text email has none. ?images=show loads its images (the rule's or the images bar's
  // Show), ?images=hide doesn't, and without it the rule decides. The page named either way is
  // always the same page. So the browser keeps it a while, and an email opened again shows without
  // asking (sign-out clears it). ?quoted=fold leaves its quoted history out, which ••• shows again.
  api.get('/mail/messages/:id/body', c => {
    const images = c.req.query('images');
    const page = messageBody(store, id(c.req.param('id')), images === 'show' ? true : images === 'hide' ? false : null, c.req.query('quoted') === 'fold');
    if (images === 'show' || images === 'hide') c.header('Cache-Control', `private, max-age=${BODY_KEPT_S}`);
    c.header('Content-Security-Policy', page.policy);
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    return c.html(page.html);
  });
  // A day's USPS mail for the agenda rail, and a scan's picture (a scan never changes).
  api.get('/mail/mailpieces', c => c.json(mailpieces(store, parse(mailpiecesInput, c.req.query()).day)));
  api.get('/mail/mailpieces/scans/:id', c => {
    const scan = mailScan(store, id(c.req.param('id')));
    c.header('Content-Type', scan.mimeType);
    c.header('Cache-Control', 'private, max-age=86400, immutable');
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(new Uint8Array(scan.bytes));
  });
  // An attachment's bytes, through its account's adapter, for the reader's preview. An id's bytes
  // never change (a changed set gets new ids), so the browser keeps them.
  const fetchAttachment = async (messageId: string, attachmentId: string) => {
    try {
      return await attachmentFile(store, engine, id(messageId), id(attachmentId));
    } catch (error) {
      if (error instanceof ProviderError) throw new SetpointError('provider_failed', error.message, 502);
      throw error;
    }
  };
  api.get('/mail/messages/:id/attachments/:attachment', async c => {
    const file = await fetchAttachment(c.req.param('id'), c.req.param('attachment'));
    c.header('Content-Type', file.contentType);
    c.header('Content-Disposition', file.disposition);
    c.header('Cache-Control', 'private, max-age=86400, immutable');
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(new Uint8Array(file.content));
  });
  // An email's .ics read for the same review as a file from Calendar, from the
  // attachment's bytes on the server, nothing uploaded from the browser.
  api.post('/mail/messages/:id/attachments/:attachment/ics', async c => {
    const file = await fetchAttachment(c.req.param('id'), c.req.param('attachment'));
    return c.json(readImport(store, new Uint8Array(file.content)));
  });
  api.post('/mail/messages/:id/open', c => {
    const messageId = id(c.req.param('id'));
    openMessage(store, messageId);
    return c.json(messageDetail(store, messageId));
  });
  api.post('/mail/messages/:id/read', async c => c.json(presentCommand(setRead(store, id(c.req.param('id')), parse(readInput, await body(c)).unread))));
  api.post('/mail/messages/:id/trash', c => c.json(presentCommand(trashMessage(store, id(c.req.param('id')), true))));
  api.post('/mail/messages/:id/untrash', c => c.json(presentCommand(trashMessage(store, id(c.req.param('id')), false))));
  api.post('/mail/messages/:id/done', async c => {
    const messageId = id(c.req.param('id'));
    setDone(store, messageId, parse(doneInput, await body(c)).done);
    return c.json(messageDetail(store, messageId));
  });
  api.post('/mail/messages/:id/pin', async c => {
    const messageId = id(c.req.param('id'));
    setPinned(store, messageId, parse(pinInput, await body(c)).pinned);
    return c.json(messageDetail(store, messageId));
  });
  api.post('/mail/messages/:id/snooze', async c => {
    const messageId = id(c.req.param('id'));
    snoozeMessage(store, messageId, parse(snoozeInput, await body(c)).until);
    return c.json(messageDetail(store, messageId));
  });
  api.post('/mail/messages/:id/unsnooze', c => {
    const messageId = id(c.req.param('id'));
    unsnoozeMessage(store, messageId);
    return c.json(messageDetail(store, messageId));
  });
  api.get('/mail/snoozed', c => c.json(snoozedMail(store)));

  // A conversation, by any of its emails' ids: the reader's, and the tools that change all of it.
  const changed = (change: ConversationChange): ConversationChangeOut => ({commands: change.commands.map(presentCommand), undo: change.undo});
  api.get('/mail/conversations/:id', c => c.json(conversationDetail(store, id(c.req.param('id')))));
  api.post('/mail/conversations/undo', async c => c.json(changed(undoConversation(store, parse(conversationUndoSchema, await body(c))))));
  api.post('/mail/conversations/:id/open', c => {
    const messageId = id(c.req.param('id'));
    return c.json(conversationDetail(store, messageId, openConversation(store, messageId)));
  });
  api.post('/mail/conversations/:id/read', async c => c.json(changed(setConversationRead(store, id(c.req.param('id')), parse(readInput, await body(c)).unread))));
  api.post('/mail/conversations/:id/done', async c => c.json(changed(setConversationDone(store, id(c.req.param('id')), parse(doneInput, await body(c)).done))));
  api.post('/mail/conversations/:id/pin', async c => c.json(changed(setConversationPinned(store, id(c.req.param('id')), parse(pinInput, await body(c)).pinned))));
  api.post('/mail/conversations/:id/snooze', async c => c.json(changed(snoozeConversation(store, id(c.req.param('id')), parse(snoozeInput, await body(c)).until))));
  api.post('/mail/conversations/:id/unsnooze', c => c.json(changed(unsnoozeConversation(store, id(c.req.param('id'))))));
  api.post('/mail/conversations/:id/trash', c => c.json(changed(trashConversation(store, id(c.req.param('id'))))));
  api.post('/mail/mark-all-read', async c => {
    const input = parse(markAllReadInput, await body(c));
    return c.json({commands: markAllRead(store, input.account_id).map(presentCommand)} satisfies MarkAllReadOut);
  });
  api.get('/mail/indexing', c => c.json(indexing(store)));

  // ---- Drafts and sending (src/sending/) ----

  api.get('/mail/from', c => c.json(fromOptions(store)));
  api.get('/mail/drafts', c => c.json(listDrafts(store)));
  api.get('/mail/people', c => {
    const {q, limit, mode} = parse(peopleInput, c.req.query());
    return c.json(suggestPeople(store, q, limit, mode));
  });
  api.post('/mail/drafts', async c => c.json(createDraft(store, parse(draftCreateInput, await body(c))), 201));
  api.get('/mail/drafts/:id', c => c.json(presentDraft(store, getDraftRow(store, id(c.req.param('id'))))));
  api.patch('/mail/drafts/:id', async c => c.json(updateDraft(store, id(c.req.param('id')), parse(draftUpdateInput, await body(c)))));
  api.delete('/mail/drafts/:id', c => {
    discardDraft(store, id(c.req.param('id')));
    if (draftFiles) sweepDraftFiles(store, draftFiles);
    return c.body(null, 204);
  });
  // A draft's own files (src/sending/files.ts): the bytes are the body, the name in `name`.
  const filesDir = () => {
    if (!draftFiles) throw conflict('no_files_dir', 'This Setpoint keeps no attached files.');
    return draftFiles;
  };
  api.post('/mail/drafts/:id/files', async c => {
    const dir = filesDir();
    sweepDraftFiles(store, dir);
    const content = Buffer.from(await c.req.arrayBuffer());
    if (!content.length) throw invalid('That file is empty.');
    const filename = parse(z.string().max(1000), c.req.query('name') ?? '');
    return c.json(addDraftFile(store, dir, id(c.req.param('id')), {filename, mimeType: c.req.header('content-type') ?? '', content}), 201);
  });
  api.delete('/mail/drafts/:id/files/:file', c => {
    removeDraftFile(store, filesDir(), id(c.req.param('id')), id(c.req.param('file')));
    return c.body(null, 204);
  });
  api.post('/mail/drafts/:id/files/take', async c => c.json({files: takeDraftFiles(store, id(c.req.param('id')), parse(draftFilesTakeInput, await body(c)).ids)}));
  api.post('/mail/drafts/:id/send', async c => {
    // No body is Send; `send_at` is Send later.
    const text = await c.req.text();
    const input = text.trim() ? parse(sendInput, json(text)) : {};
    return c.json(holdSend(store, id(c.req.param('id')), input.send_at));
  });
  api.post('/mail/drafts/:id/undo', c => c.json(undoSend(store, id(c.req.param('id')))));
  api.post('/mail/drafts/:id/write', async c => c.json(await writeDraft(store, id(c.req.param('id')), parse(draftWriteInput, await body(c)), drafting)));
  api.get('/mail/trusted-domains', c => c.json(trustedDomains(store)));
  api.post('/mail/trusted-domains', async c => {
    const {domain} = parse(trustedDomainInput, await body(c));
    store.db.insert(t.trustedDomains).values({domain, createdAt: isoNow(store)}).onConflictDoNothing().run();
    noteLive(store, {type: 'mail', messages: [], accounts: [], commands: []});
    return c.json(trustedDomains(store), 201);
  });
  api.delete('/mail/trusted-domains/:domain', c => {
    store.db.delete(t.trustedDomains).where(eq(t.trustedDomains.domain, c.req.param('domain').toLowerCase())).run();
    return c.json(trustedDomains(store));
  });

  return api;
}
