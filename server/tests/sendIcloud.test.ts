// Sending through iCloud against a fake SMTP server and a fake IMAP server on 127.0.0.1: SMTP with
// the app password, the envelope naming Bcc and the delivered copy not; the copy APPENDed to "Sent
// Messages" with its Bcc line, unless one with its Message-ID is there; the Sent row in at once
// and kept one row by the poll; iCloud's own copy matched by Message-ID when the append is off;
// mail to yourself as one row; a refusal in iCloud's words; and a dropped answer never sent twice
// without the user's say.
import {SEED_NOW, SEND_HOLD_MS} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {ICloudAdapter, icloudConnector} from '../src/providers/icloud/index.ts';
import {parseEmail} from '../src/providers/mime.ts';
import {SendWorker} from '../src/sending/worker.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeImap} from './fakeImap.ts';
import {fakeSmtp} from './fakeSmtp.ts';
import {signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';
import {rawEmail} from './rawEmail.ts';

vi.setConfig({testTimeout: 30_000});

const ADDRESS = 'user@icloud.example.com';
const PASSWORD = 'abcd-efgh-ijkl-mnop';
const MINUTE = 60_000;
const SENT = 'Sent Messages';
const ago = (ms: number) => new Date(Date.parse(SEED_NOW) - ms).toISOString();
const paragraph = (text: string) => [{type: 'paragraph', runs: [{text, marks: [], href: null}]}];

async function setup({appendSent = true}: {appendSent?: boolean} = {}) {
  const w = world();
  const imap = await fakeImap();
  const smtp = await fakeSmtp();
  imap.addUser(ADDRESS, PASSWORD);
  smtp.addUser(ADDRESS, PASSWORD);
  const adapter = new ICloudAdapter({endpoint: {host: imap.host, port: imap.port, secure: false}, smtp: {host: smtp.host, port: smtp.port, requireTLS: false}, appendSent, connectTimeoutMs: 2000});
  const engine: SyncEngine = new SyncEngine({store: w.store, adapters: new Adapters({icloud: adapter}), timeoutMs: 5000, workers: [new SendWorker({
    store: w.store, send: (sourceId, mail) => engine.sendMail(sourceId, mail), findSent: (sourceId, query) => engine.findSent(sourceId, query),
    attachment: (sourceId, message, id) => engine.attachment(sourceId, message, id),
  })]});
  const api = await signedIn(w, {engine, connectors: {icloud: icloudConnector(w.store, adapter)}});
  const drain = async () => {
    for (let round = 0; round < 40; round += 1) {
      await engine.tick();
      await engine.settled();
      if (!w.store.db.select().from(t.jobs).where(and(eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, w.store.now().toISOString()))).all().length) return;
    }
    throw new Error('The engine never went idle.');
  };
  const poll = async () => {
    w.advance(2 * MINUTE);
    await drain();
  };
  expect((await api.send('POST', '/api/accounts/icloud', {body: {address: ADDRESS, app_password: PASSWORD}})).status).toBe(201);
  await drain();
  /** Writes, holds and sends a draft, past its hold. */
  const sendDraft = async (start: Record<string, unknown>, fields: Record<string, unknown>) => {
    const draft = (await api.send('POST', '/api/mail/drafts', {body: start})).body;
    await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: fields});
    await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
    w.advance(SEND_HOLD_MS);
    await drain();
    return draft.id as number;
  };
  return {w, imap, smtp, api, drain, poll, sendDraft};
}

const sentRows = (w: World) => w.store.db.select().from(t.messages).where(eq(t.messages.sent, true)).all();

describe('iCloud: sending', () => {
  test('a reply goes over SMTP, Bcc in the envelope only, and its copy is filed in Sent: one row, there at once and after the poll', async () => {
    const {w, imap, smtp, api, poll, sendDraft} = await setup();
    imap.deliver(ADDRESS, rawEmail({from: 'Sam Ortiz <sam.ortiz@example.org>', to: ADDRESS, subject: 'Flights', date: ago(30 * MINUTE), text: 'Which flight?', messageId: '<flights-1@example.org>'}), ago(30 * MINUTE));
    await poll();
    const sam = w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Flights')).get()!;
    const draftId = await sendDraft({kind: 'reply', message_id: sam.id}, {body: paragraph('The 9:40.'), bcc: [{name: null, address: 'hidden@example.org'}]});

    expect(smtp.accepted).toHaveLength(1);
    const [delivered] = smtp.accepted;
    expect(delivered).toMatchObject({user: ADDRESS, from: ADDRESS, to: ['sam.ortiz@example.org', 'hidden@example.org']});
    expect(delivered!.data.toString()).not.toContain('hidden@example.org');
    const parsed = await parseEmail(delivered!.data);
    expect(parsed).toMatchObject({subject: 'Re: Flights', inReplyTo: '<flights-1@example.org>', references: ['<flights-1@example.org>'], to: [{name: 'Sam Ortiz', address: 'sam.ortiz@example.org'}]});

    // Filed in Sent Messages with its Bcc line, read.
    expect(imap.appends).toHaveLength(1);
    expect(imap.appends[0]!.folder).toBe(SENT);
    expect(imap.appends[0]!.raw.toString()).toContain('Bcc: hidden@example.org');
    expect(imap.flags(ADDRESS, imap.appends[0]!.uid, SENT)).toEqual(['\\Seen']);

    const validity = imap.folder(ADDRESS, SENT).uidValidity;
    expect(sentRows(w)).toMatchObject([{providerId: `sent:${validity}:${imap.appends[0]!.uid}`, sent: true, received: false, threadId: sam.threadId, rfc822Id: parsed.rfc822Id}]);
    expect((await api.send('GET', `/api/mail/drafts/${draftId}`)).status).toBe(404);
    expect((await api.send('GET', `/api/mail/messages/${sam.id}`)).body.replied_at).toBeDefined();

    await poll();
    expect(sentRows(w)).toHaveLength(1);
    expect(sentRows(w)[0]!.trashedAt).toBeNull();
  });

  test('a copy with its Message-ID already in Sent is not filed twice', async () => {
    const {w, imap, smtp, sendDraft} = await setup();
    // iCloud files the SMTP copy itself, before the append looks.
    smtp.onAccept(message => imap.deliver(ADDRESS, message.data, w.store.now().toISOString(), ['\\Seen'], SENT));
    await sendDraft({kind: 'new'}, {to: [{name: null, address: 'sam.ortiz@example.org'}], subject: 'Hello'});
    expect(imap.appends).toEqual([]);
    expect(imap.folder(ADDRESS, SENT).messages).toHaveLength(1);
    expect(sentRows(w)).toMatchObject([{providerId: `sent:${imap.folder(ADDRESS, SENT).uidValidity}:1`}]);
  });

  test('with the append off, the row waits under a placeholder and iCloud\'s own copy takes it over by Message-ID', async () => {
    const {w, imap, poll, sendDraft} = await setup({appendSent: false});
    await sendDraft({kind: 'new'}, {to: [{name: null, address: 'sam.ortiz@example.org'}], subject: 'Hello'});
    expect(imap.appends).toEqual([]);
    const [row] = sentRows(w);
    expect(row!.providerId).toBe(`sent:pending:${row!.rfc822Id}`);
    await poll();
    expect(sentRows(w)).toMatchObject([{id: row!.id, providerId: `sent:pending:${row!.rfc822Id}`, trashedAt: null}]);
    // iCloud files its copy.
    const uid = imap.deliver(ADDRESS, rawEmail({from: ADDRESS, to: 'sam.ortiz@example.org', subject: 'Hello', date: w.store.now().toISOString(), text: '', messageId: row!.rfc822Id!}), w.store.now().toISOString(), ['\\Seen'], SENT);
    await poll();
    expect(sentRows(w)).toMatchObject([{id: row!.id, providerId: `sent:${imap.folder(ADDRESS, SENT).uidValidity}:${uid}`, trashedAt: null}]);
  });

  test.each([true, false])('Setpoint failing to record a send iCloud accepted still settles it (append %s): the draft goes and nothing can send it again', async appendSent => {
    const {w, smtp, api, imap, poll, sendDraft} = await setup({appendSent});
    if (!appendSent) smtp.onAccept(message => imap.deliver(ADDRESS, message.data, w.store.now().toISOString(), ['\\Seen'], SENT));
    w.store.sqlite.exec('CREATE TRIGGER refuse_sent BEFORE INSERT ON messages WHEN NEW.sent = 1 BEGIN SELECT RAISE(ABORT, \'disk I/O error\'); END');
    const draftId = await sendDraft({kind: 'new'}, {to: [{name: null, address: 'sam.ortiz@example.org'}], subject: 'Hello'});
    expect(smtp.accepted).toHaveLength(1);
    expect((await api.send('GET', `/api/mail/drafts/${draftId}`)).status).toBe(404);
    expect((await api.send('POST', `/api/mail/drafts/${draftId}/send`)).status).toBe(404);
    w.store.sqlite.exec('DROP TRIGGER refuse_sent');
    await poll();
    expect(sentRows(w)).toMatchObject([{subject: 'Hello', received: false}]);
  });

  test('mail to yourself: the inbox copy takes over the sent row, one row sent and received', async () => {
    const {w, imap, smtp, poll, sendDraft} = await setup();
    await sendDraft({kind: 'new'}, {to: [{name: null, address: ADDRESS}], subject: 'Note to self', body: paragraph('Milk.')});
    imap.deliver(ADDRESS, smtp.accepted[0]!.data, w.store.now().toISOString());
    await poll();
    expect(w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Note to self')).all()).toMatchObject([{sent: true, received: true}]);
  });

  test('a refused recipient keeps the draft, failed in iCloud\'s words, and nothing is filed', async () => {
    const {w, imap, smtp, api, sendDraft} = await setup();
    smtp.refuseRecipient('nobody@example.org', '550 5.1.1 <nobody@example.org>: Recipient address rejected: User unknown');
    const draftId = await sendDraft({kind: 'new'}, {to: [{name: null, address: 'nobody@example.org'}], subject: 'Hello', body: paragraph('Hi.')});
    expect((await api.send('GET', `/api/mail/drafts/${draftId}`)).body).toMatchObject({
      body: paragraph('Hi.'), send: {state: 'failed', error: expect.stringMatching(/^iCloud: 550 5\.1\.1 <nobody@example\.org>: Recipient address rejected/)},
    });
    expect(smtp.accepted).toEqual([]);
    expect(imap.appends).toEqual([]);
    expect(sentRows(w)).toEqual([]);
  });

  test('after a clear refusal, Try again with the address put right sends at once', async () => {
    const {smtp, api, w, drain, sendDraft} = await setup();
    smtp.refuseRecipient('nobody@example.org', '550 5.1.1 <nobody@example.org>: Recipient address rejected: User unknown');
    const draftId = await sendDraft({kind: 'new'}, {to: [{name: null, address: 'nobody@example.org'}], subject: 'Hello'});
    await api.send('PATCH', `/api/mail/drafts/${draftId}`, {body: {to: [{name: null, address: 'sam.ortiz@example.org'}]}});
    await api.send('POST', `/api/mail/drafts/${draftId}/send`);
    w.advance(SEND_HOLD_MS);
    await drain();
    expect((await api.send('GET', `/api/mail/drafts/${draftId}`)).status).toBe(404);
    expect(smtp.accepted.map(message => message.to)).toEqual([['sam.ortiz@example.org']]);
  });

  test('a refused app password fails the draft, not silently', async () => {
    const {api, smtp, sendDraft} = await setup();
    smtp.addUser(ADDRESS, 'another-password');
    const draftId = await sendDraft({kind: 'new'}, {to: [{name: null, address: 'sam.ortiz@example.org'}]});
    expect((await api.send('GET', `/api/mail/drafts/${draftId}`)).body.send).toMatchObject({state: 'failed', error: expect.stringMatching(/^iCloud refused the app password: 535/)});
  });

  test('the answer lost after DATA: Try again finds no copy, says so rather than sending twice, and sends only when asked again', async () => {
    const {w, smtp, imap, api, drain} = await setup();
    smtp.dropAfterData();
    const draft = (await api.send('POST', '/api/mail/drafts', {body: {kind: 'new'}})).body;
    await api.send('PATCH', `/api/mail/drafts/${draft.id}`, {body: {to: [{name: null, address: 'sam.ortiz@example.org'}], subject: 'Hello'}});
    const sendAgain = async () => {
      await api.send('POST', `/api/mail/drafts/${draft.id}/send`);
      w.advance(SEND_HOLD_MS);
      await drain();
      return (await api.send('GET', `/api/mail/drafts/${draft.id}`)).body;
    };
    expect((await sendAgain()).send.state).toBe('failed');
    expect(smtp.accepted).toHaveLength(1);

    expect((await sendAgain()).send).toMatchObject({state: 'failed', error: 'Setpoint lost touch with the provider while sending, and can\'t tell whether it went. Check Sent before you try again.'});
    expect(smtp.accepted).toHaveLength(1);

    // The user checked and asks again.
    await sendAgain();
    expect(smtp.accepted).toHaveLength(2);
    expect(imap.appends).toHaveLength(1);
    // The same email: its Message-ID was kept.
    expect((await parseEmail(smtp.accepted[1]!.data)).rfc822Id).toBe((await parseEmail(smtp.accepted[0]!.data)).rfc822Id);
  });
});
