// Mail the user sent to others, as Jobs' window on mail sees it: never read, and never holding the
// rest back the way an email still with triage does.
import {describe, expect, test} from 'vitest';
import {world} from '../../../tests/helpers.ts';
import * as t from '../../db/schema.ts';
import {upsertMessages} from '../../sync/mailMirror.ts';
import type {FetchedMessage} from '../../sync/mailMirror.ts';
import {emailsToRead, historyLeft} from '../mail.ts';
import {eq} from 'drizzle-orm';

const fetched = (subject: string, receivedAt: string, changes: Partial<FetchedMessage> = {}): FetchedMessage => ({
  providerId: `p-${subject}`, threadId: subject, rfc822Id: null, fromName: 'Sender', fromAddress: 'sender@example.com', subject, snippet: subject,
  bodyText: subject, bodyHtml: null, receivedAt, senderAuth: null, attachments: [], unread: true, trashed: false, archived: false, ...changes,
});

describe('Jobs and sent mail', () => {
  test('a sent email is never read and holds nothing back', () => {
    const w = world({seed: true});
    const account = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Jobs')).get()!.id;
    const window = {accounts: [{account_id: account, reads: 'every' as const}]};
    const now = w.store.now().getTime();
    const toRead = emailsToRead(w.store, window, w.store.now().toISOString());
    const left = historyLeft(w.store, window);

    // Unsorted for good, an hour old: a received email like it would hold back what came after.
    upsertMessages(w.store, account, [fetched('Sent an hour ago', new Date(now - 60 * 60_000).toISOString(), {sent: true, received: false})]);
    const [later] = upsertMessages(w.store, account, [fetched('Sorted after it', new Date(now - 60_000).toISOString())]).inserted;
    w.store.db.update(t.messages).set({lane: 'fyi', kind: 'updates'}).where(eq(t.messages.id, later!)).run();

    expect(emailsToRead(w.store, window, w.store.now().toISOString())).toEqual([...toRead, later]);
    expect(historyLeft(w.store, window)).toEqual({...left, sorted: left.sorted + 1});
  });
});
