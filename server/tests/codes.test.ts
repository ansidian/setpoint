// Reading sorted mail again for its code (SV-68): what would change, applying it, and the code
// emails still without a code. Unsorted mail is left for triage.
import {eq} from 'drizzle-orm';
import {expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import type {FetchedMessage} from '../src/sync/mailMirror.ts';
import {rereadCodes} from '../src/triage/codes.ts';
import {world} from './helpers.ts';

const RECEIVED = '2026-10-07T16:00:00.000Z';

function setup() {
  const w = world({seed: true});
  const accountId = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Personal')).get()!.id;
  const add = (changes: Partial<FetchedMessage>, sorted: Partial<typeof t.messages.$inferInsert> | null) => {
    const fetched: FetchedMessage = {
      providerId: `p-${Math.random().toString(36).slice(2)}`, threadId: 'thread', rfc822Id: null, fromName: 'Contoso', fromAddress: 'no-reply@contoso.example',
      subject: 'Hello', snippet: '', bodyText: '', bodyHtml: null, receivedAt: RECEIVED, senderAuth: null, attachments: [], unread: true, trashed: false, archived: false,
      ...changes,
    };
    const id = upsertMessages(w.store, accountId, [fetched]).inserted[0]!;
    if (sorted) w.store.db.update(t.messages).set(sorted).where(eq(t.messages.id, id)).run();
    return id;
  };
  const codeOf = (id: number) => w.store.db.select({code: t.messages.code, expiresAt: t.messages.codeExpiresAt}).from(t.messages).where(eq(t.messages.id, id)).get();
  return {w, add, codeOf};
}

test('lists what reading again would change and the code emails still without one, writing nothing until applied', () => {
  const {w, add, codeOf} = setup();
  const sorted = {lane: 'fyi', kind: 'security', type: 'verification_code'} as const;
  const htmlOnly = add({subject: 'Your loan one-time passcode', bodyHtml: '<p>This one-time code is only valid for 15 minutes:<br><br>730158</p>'}, sorted);
  const runTogether = add({
    subject: 'One-time code to access your Contoso account.', bodyText: 'Enter the One-time code.418265Please do not share it.',
    bodyHtml: '<p>Enter the One-time code.</p><p><b>418265</b></p><p>Please do not share it.</p>',
  }, {...sorted, code: '418265Please', codeExpiresAt: '2026-10-07T16:15:00.000Z'});
  const linkOnly = add({subject: 'Verify your email address', bodyText: 'Open the link to verify your email: https://contoso.example/verify'}, sorted);
  const unsorted = add({subject: 'Your login code: 771204'}, null);
  const settled = add({subject: 'Your login code: 552901'}, {...sorted, code: '552901', codeExpiresAt: '2026-10-07T16:15:00.000Z'});

  const dry = rereadCodes(w.store, {apply: false});
  expect(dry.changes).toEqual([
    {id: htmlOnly, fromAddress: 'no-reply@contoso.example', subject: 'Your loan one-time passcode', before: null, after: '730158'},
    {id: runTogether, fromAddress: 'no-reply@contoso.example', subject: 'One-time code to access your Contoso account.', before: '418265Please', after: '418265'},
  ]);
  expect(dry.missing.map(email => email.id)).toEqual([linkOnly]);
  expect(codeOf(htmlOnly)).toEqual({code: null, expiresAt: null});

  rereadCodes(w.store, {apply: true});
  // The expiry counts from arrival, at Settings › Mail's 15 minutes.
  expect(codeOf(htmlOnly)).toEqual({code: '730158', expiresAt: '2026-10-07T16:15:00.000Z'});
  expect(codeOf(runTogether)?.code).toBe('418265');
  expect(codeOf(settled)?.code).toBe('552901');
  expect(codeOf(unsorted)).toEqual({code: null, expiresAt: null});
  expect(rereadCodes(w.store, {apply: false}).changes).toEqual([]);
});
