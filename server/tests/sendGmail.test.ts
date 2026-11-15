// Sending through Gmail against a fake Google on 127.0.0.1: Send held six seconds on a held clock,
// then messages.send in the answered email's thread; a restart during the hold still sends, once;
// a refusal keeps the draft with Google's words for Try again; an answer lost after Gmail took the
// email is never sent twice; a forward carries the original's attachments; and the Sent row goes in
// at once, the later sync keeping that one row. Aliases come from Gmail's "Send mail as" list.
import {SEED_NOW, SEND_HOLD_MS} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {GmailAdapter} from '../src/providers/gmail/adapter.ts';
import {gmailConnector} from '../src/providers/gmail/connect.ts';
import {parseEmail} from '../src/providers/mime.ts';
import {SendWorker} from '../src/sending/worker.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeGoogle} from './fakeGoogle.ts';
import type {FakeGoogle} from './fakeGoogle.ts';
import {client, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';
import {gmailVerdict, rawEmail} from './rawEmail.ts';

vi.setConfig({testTimeout: 30_000});

const ADDRESS = 'user.work@example.com';
const MINUTE = 60_000;
const ago = (ms: number) => new Date(Date.parse(SEED_NOW) - ms).toISOString();
const paragraph = (text: string) => [{type: 'paragraph', runs: [{text, marks: [], href: null}]}];

/** An engine with the send worker on the adapters, as server.ts wires it. */
function engineFor(w: World, google: FakeGoogle) {
  const adapter = new GmailAdapter({topic: null, client: google.client()});
  const engine: SyncEngine = new SyncEngine({store: w.store, adapters: new Adapters({gmail: adapter}), timeoutMs: 5000, workers: [new SendWorker({
    store: w.store, send: (sourceId, mail) => engine.sendMail(sourceId, mail), findSent: (sourceId, id) => engine.findSent(sourceId, id),
    attachment: (sourceId, message, id) => engine.attachment(sourceId, message, id),
  })]});
  return engine;
}

async function setup() {
  const w = world();
  const google = await fakeGoogle({clock: () => w.store.now()});
  google.addMailbox(ADDRESS);
  let engine = engineFor(w, google);
  const connectors = {gmail: gmailConnector(w.store, google.client(), false)};
  const api = await signedIn(w, {engine, connectors});
  const drain = async () => {
    for (let round = 0; round < 40; round += 1) {
      await engine.tick();
      await engine.settled();
      if (!w.store.db.select().from(t.jobs).where(and(eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, w.store.now().toISOString()))).all().length) return;
    }
    throw new Error('The engine never went idle.');
  };
  const started = await api.send('POST', '/api/accounts/gmail/authorize', {body: {}});
  const state = new URL(started.body.url).searchParams.get('state')!;
  await client(w, {engine, connectors}).send('GET', `/api/ea/accounts/gmail/callback?code=${encodeURIComponent(google.issueCode(ADDRESS))}&state=${encodeURIComponent(state)}`);
  const source = w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'gmail')).get()!;
  const sync = async () => {
    engine.pushed(source.id);
    await drain();
  };
  /** The server stopped and started again: a new engine on the same database. */
  const restart = () => {
    engine.stop();
    engine = engineFor(w, google);
  };
  return {w, google, api, drain, sync, source, restart, get engine() {
    return engine;
  }};
}

/** Sam's email to the user and June, synced. */
async function samWrites(google: FakeGoogle, w: World, sync: () => Promise<void>, extra: Partial<Parameters<typeof rawEmail>[0]> = {}) {
  const raw = rawEmail({
    from: 'Sam Ortiz <sam.ortiz@example.org>', to: `User <${ADDRESS}>, June Park <june.park@example.org>`, cc: 'Theo Walsh <theo@example.net>',
    subject: 'Thursday', date: ago(30 * MINUTE), text: 'Are we on for Thursday?', messageId: '<thursday-1@example.org>', references: '<root@example.org>',
    received: gmailVerdict('example.org'), ...extra,
  });
  const gmailId = google.deliver(ADDRESS, {raw, date: ago(30 * MINUTE), threadId: 'thread-thursday'});
  await sync();
  const row = w.store.db.select().from(t.messages).where(eq(t.messages.providerId, gmailId)).get()!;
  return {gmailId, row};
}

const sentRows = (w: World) => w.store.db.select().from(t.messages).where(eq(t.messages.sent, true)).all();

describe('Gmail: sending', () => {
  test('Send holds the reply six seconds, then sends it in its thread; the Sent row is there at once and the sync keeps it one row', async () => {
    const {w, google, api, drain, sync} = await setup();
    const {row: sam} = await samWrites(google, w, sync);
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply_all', message_id: sam.id}})).body;
    await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: {body: paragraph('Yes, see you there.'), bcc: [{name: null, address: 'hidden@example.org'}]}});
    await api.send('POST', `/api/mail/drafts/${draft.id}/send`);

    w.advance(SEND_HOLD_MS - 1000);
    await drain();
    expect(google.sent).toEqual([]);
    expect((await api.send('GET', `/api/mail/drafts/${draft.id}`)).body.send.state).toBe('held');

    w.advance(1000);
    await drain();
    expect(google.sent).toHaveLength(1);
    const [sent] = google.sent;
    expect(sent!.threadId).toBe('thread-thursday');
    const parsed = await parseEmail(sent!.raw);
    expect(parsed).toMatchObject({
      fromAddress: ADDRESS, subject: 'Re: Thursday', inReplyTo: '<thursday-1@example.org>', references: ['<root@example.org>', '<thursday-1@example.org>'],
      to: [{name: 'Sam Ortiz', address: 'sam.ortiz@example.org'}, {name: 'June Park', address: 'june.park@example.org'}], cc: [{name: 'Theo Walsh', address: 'theo@example.net'}],
    });
    expect(parsed.text).toContain('Yes, see you there.\n\nOn Oct 7, 2026, Sam Ortiz wrote:\n> Are we on for Thursday?');
    // Gmail takes Bcc from the headers.
    expect(sent!.raw.toString()).toContain('Bcc: hidden@example.org');

    // The draft is gone, and Sent and "You replied" show the reply before any sync.
    expect((await api.send('GET', `/api/mail/drafts/${draft.id}`)).status).toBe(404);
    expect(sentRows(w)).toMatchObject([{providerId: sent!.id, threadId: 'thread-thursday', sent: true, received: false, subject: 'Re: Thursday', rfc822Id: parsed.rfc822Id,
      toRecipients: [{name: 'Sam Ortiz', address: 'sam.ortiz@example.org'}, {name: 'June Park', address: 'june.park@example.org'}]}]);
    expect((await api.send('GET', '/api/mail/sent')).body.days[0].rows[0]).toMatchObject({subject: 'Re: Thursday', sent_only: true});
    expect((await api.send('GET', `/api/mail/messages/${sam.id}`)).body.replied_at).toBeDefined();

    // Gmail's history then names the sent email: still one row.
    await sync();
    expect(sentRows(w)).toHaveLength(1);
  });

  test('a server restart during the hold still sends, once', async () => {
    const s = await setup();
    const {row: sam} = await samWrites(s.google, s.w, s.sync);
    const draft = (await s.api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: sam.id}})).body;
    await s.api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    s.restart();
    s.w.advance(SEND_HOLD_MS);
    await s.drain();
    s.restart();
    await s.drain();
    expect(s.google.sent).toHaveLength(1);
    expect(sentRows(s.w)).toHaveLength(1);
  });

  test('Undo inside the hold: nothing reaches Gmail', async () => {
    const {w, google, api, drain, sync} = await setup();
    const {row: sam} = await samWrites(google, w, sync);
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: sam.id}})).body;
    await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    w.advance(SEND_HOLD_MS - 1);
    expect((await api.send('POST', `/api/mail/drafts/${draft.id}/undo`)).status).toBe(200);
    w.advance(MINUTE);
    await drain();
    expect(google.sent).toEqual([]);
    expect(google.count(/messages\/send/)).toBe(0);
    expect((await api.send('GET', `/api/mail/drafts/${draft.id}`)).body.send).toBeNull();
  });

  test('a refusal keeps the draft, failed with Google\'s words; Try again sends it', async () => {
    const {w, google, api, drain, sync} = await setup();
    const {row: sam} = await samWrites(google, w, sync);
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: sam.id}})).body;
    await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: {body: paragraph('Yes.')}});
    google.inject(/messages\/send/, {status: 400, body: {error: {code: 400, message: 'Invalid To header', errors: [{reason: 'invalidArgument'}]}}});
    await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    w.advance(SEND_HOLD_MS);
    await drain();
    const failed = (await api.send('GET', `/api/mail/drafts/${draft.id}`)).body;
    expect(failed).toMatchObject({body: paragraph('Yes.'), send: {state: 'failed', send_at: null, error: 'Invalid To header (400 Bad Request)'}});
    expect((await api.send('GET', '/api/mail/drafts')).body.drafts[0].send_state).toBe('failed');
    expect(sentRows(w)).toEqual([]);

    await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    w.advance(SEND_HOLD_MS);
    await drain();
    expect(google.sent).toHaveLength(1);
    expect((await api.send('GET', `/api/mail/drafts/${draft.id}`)).status).toBe(404);
  });

  test('Gmail took it but the answer was lost: Try again finds it by its Message-ID and never sends it twice', async () => {
    const {w, google, api, drain, sync} = await setup();
    const {row: sam} = await samWrites(google, w, sync);
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: sam.id}})).body;
    google.inject(/messages\/send/, 'lost');
    await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    w.advance(SEND_HOLD_MS);
    await drain();
    expect(google.sent).toHaveLength(1);
    expect((await api.send('GET', `/api/mail/drafts/${draft.id}`)).body.send.state).toBe('failed');

    await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    w.advance(SEND_HOLD_MS);
    await drain();
    expect(google.sent).toHaveLength(1);
    expect(google.count(/messages\/send/)).toBe(1);
    expect((await api.send('GET', `/api/mail/drafts/${draft.id}`)).status).toBe(404);
    await sync();
    expect(sentRows(w)).toMatchObject([{providerId: google.sent[0]!.id, received: false}]);
  });

  test('a forward carries the email in full with its attachments, as a new conversation', async () => {
    const {w, google, api, drain, sync} = await setup();
    const {row: sam} = await samWrites(google, w, sync, {attachments: [{filename: 'Itinerary.pdf', contentType: 'application/pdf', content: '%PDF-1.4 itinerary'}]});
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'forward', message_id: sam.id}})).body;
    await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: {to: [{name: 'Mom', address: 'mom@example.net'}], body: paragraph('FYI')}});
    await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    w.advance(SEND_HOLD_MS);
    await drain();
    const [sent] = google.sent;
    expect(sent!.threadId).toBeNull();
    const parsed = await parseEmail(sent!.raw);
    expect(parsed).toMatchObject({subject: 'Fwd: Thursday', inReplyTo: null, references: [], to: [{name: 'Mom', address: 'mom@example.net'}]});
    expect(parsed.text).toContain('---------- Forwarded message ---------\nFrom: Sam Ortiz <sam.ortiz@example.org>');
    expect(parsed.attachments.map(file => [file.filename, file.sizeBytes])).toEqual([['Itinerary.pdf', 18]]);
  });

  test('mail to yourself is one row, sent and received', async () => {
    const {w, api, drain, sync} = await setup();
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'new'}})).body;
    await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: {to: [{name: null, address: ADDRESS}], subject: 'Note to self', body: paragraph('Milk.')}});
    await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    w.advance(SEND_HOLD_MS);
    await drain();
    await sync();
    expect(w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Note to self')).all()).toMatchObject([{sent: true, received: true, unread: true}]);
  });
});

describe('Gmail: Send mail as', () => {
  test('verified aliases join From, each with its name, and an alias the email came to answers it', async () => {
    const {w, google, api, sync} = await setup();
    google.setOwnName(ADDRESS, 'User Work');
    google.setAliases(ADDRESS, [
      {sendAsEmail: 'hello@example.com', displayName: 'Hello desk'},
      {sendAsEmail: 'pending@example.com', verificationStatus: 'pending'},
    ]);
    // The list was read at the first check, before the aliases: it's read again a day later.
    w.advance(24 * 60 * MINUTE);
    await sync();
    const account = (await api.send('GET', '/api/mail/from')).body.accounts[0];
    expect(account.addresses).toEqual([
      {address: ADDRESS, name: 'User Work', primary: true},
      {address: 'hello@example.com', name: 'Hello desk', primary: false},
    ]);
    const {row} = await samWrites(google, w, sync, {to: 'hello@example.com', messageId: '<to-alias@example.org>'});
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'reply', message_id: row.id}})).body;
    expect(draft.from).toEqual({account_id: account.account_id, address: 'hello@example.com'});
    // Read once a day, not at every check.
    const reads = google.count(/settings\/sendAs/);
    await sync();
    expect(google.count(/settings\/sendAs/)).toBe(reads);
  });

  test('a failed read leaves the list and the sync healthy', async () => {
    const {google, api, sync, w, source} = await setup();
    google.inject(/settings\/sendAs/, {status: 500});
    w.advance(24 * 60 * MINUTE);
    await sync();
    expect((await api.send('GET', '/api/mail/from')).body.accounts[0].addresses).toEqual([{address: ADDRESS, name: null, primary: true}]);
    expect(w.store.db.select().from(t.sources).where(eq(t.sources.id, source.id)).get()!.lastError).toBeNull();
  });
});
