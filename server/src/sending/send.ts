// Send and Undo (DESIGN.md's undo rule, applied to Send). Send doesn't go to the provider at once:
// the draft is held, frozen, with a `send` job due SEND_HOLD_MS later, so a closed tab or a restart
// during the hold still sends it, once. Undo within the hold takes the job back and returns the
// draft as it was. Once the worker has claimed the job (src/sending/worker.ts), Undo is refused.
//
// Sending stays outside the command layer: a command's kind is a pinned enum in the iPhone app's
// contract, and a send has no mirror row to change up front or Move back.
import {SEND_HOLD_MS} from '@setpoint/shared';
import type {DraftOut} from '@setpoint/shared';
import {and, eq} from 'drizzle-orm';
import {randomBytes} from 'node:crypto';
import * as t from '../db/schema.ts';
import {conflict, invalid} from '../errors.ts';
import {enqueueJob} from '../sync/jobs.ts';
import {transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {assertEditable, getDraftRow, noteDraft, presentDraft} from './drafts.ts';
import {assertWithinLimit} from './files.ts';

export const sendKey = (draftId: number) => `send:${draftId}`;

/** A Message-ID Setpoint sets: unique, on the sending address's domain. */
export function newMessageId(draftId: number, fromAddress: string, now: Date): string {
  const domain = fromAddress.split('@')[1] || 'setpoint.invalid';
  return `<sp.${draftId}.${now.getTime().toString(36)}.${randomBytes(6).toString('hex')}@${domain}>`;
}

/**
 * Send, or Try again after a failure: the draft is held for SEND_HOLD_MS, then sent. Its
 * Message-ID is set once and kept, so a provider that already took it is never sent it again.
 */
export function holdSend(store: Store, draftId: number): DraftOut {
  return transaction(store, () => {
    const row = getDraftRow(store, draftId);
    assertEditable(row);
    if (!row.toRecipients.length && !row.ccRecipients.length && !row.bccRecipients.length) throw invalid('Add someone to send it to.');
    assertWithinLimit(store, row);
    const now = store.now();
    const sendAt = new Date(now.getTime() + SEND_HOLD_MS).toISOString();
    const updated = store.db.update(t.drafts).set({
      sendState: 'held', sendAt, sendError: null, rfc822Id: row.rfc822Id ?? newMessageId(row.id, row.fromAddress, now),
    }).where(eq(t.drafts.id, draftId)).returning().get()!;
    if (!enqueueJob(store, {kind: 'send', key: sendKey(draftId), draftId, runAt: sendAt})) throw conflict('draft_sending', 'This message is sending.');
    noteDraft(store, updated);
    return presentDraft(store, updated);
  });
}

/** Undo: the held send is taken back, and the draft returns untouched. Refused once it's sending. */
export function undoSend(store: Store, draftId: number): DraftOut {
  return transaction(store, () => {
    const row = getDraftRow(store, draftId);
    if (row.sendState !== 'held') throw conflict('draft_not_held', row.sendState === 'sending' ? 'It has already gone to the provider.' : 'This message isn\'t being sent.');
    const taken = store.db.delete(t.jobs).where(and(eq(t.jobs.draftId, draftId), eq(t.jobs.kind, 'send'), eq(t.jobs.state, 'queued'))).run().changes;
    if (!taken) throw conflict('draft_not_held', 'It has already gone to the provider.');
    const updated = store.db.update(t.drafts).set({sendState: null, sendAt: null}).where(eq(t.drafts.id, draftId)).returning().get()!;
    noteDraft(store, updated);
    return presentDraft(store, updated);
  });
}
