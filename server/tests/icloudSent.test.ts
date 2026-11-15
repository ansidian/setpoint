// iCloud's sent mail against a fake IMAP server on 127.0.0.1: the mailbox flagged \Sent ("Sent
// Messages") backfilled over 365 days, resumably and without the Inbox's Indexing line; mail sent
// from any client arriving by the poll; ids that never collide with INBOX's; sent mail never archived
// by the INBOX poll and trashed when it leaves the Sent mailbox; and mail to yourself as one row
// whichever copy comes first.
import {SEED_NOW} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {ICloudAdapter, icloudConnector} from '../src/providers/icloud/index.ts';
import {readBackfill, SENT_BACKFILL_SCOPE} from '../src/sync/cursors.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeImap} from './fakeImap.ts';
import type {FakeImap} from './fakeImap.ts';
import {signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';
import {rawEmail} from './rawEmail.ts';

vi.setConfig({testTimeout: 30_000});

const ADDRESS = 'user@icloud.example.com';
const PASSWORD = 'abcd-efgh-ijkl-mnop';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.parse(SEED_NOW) - ms).toISOString();
const SENT = 'Sent Messages';

function receive(imap: FakeImap, subject: string, at: string, messageId?: string) {
  const raw = rawEmail({from: 'Proseware <billing@proseware.example.com>', to: ADDRESS, subject, date: at, text: `${subject}.`, messageId});
  return imap.deliver(ADDRESS, raw, at);
}

/** Mail the user sent, as Apple Mail files it: read, in the sent mailbox. */
function send(imap: FakeImap, subject: string, at: string, {to = 'Sam Ortiz <sam.ortiz@example.org>', messageId}: {to?: string; messageId?: string} = {}) {
  const raw = rawEmail({from: `User <${ADDRESS}>`, to, subject, date: at, text: `${subject}.`, messageId});
  return imap.deliver(ADDRESS, raw, at, ['\\Seen'], SENT);
}

async function setup() {
  const w = world();
  const imap = await fakeImap();
  imap.addUser(ADDRESS, PASSWORD);
  // The same UIDVALIDITY as INBOX's, so the two mailboxes' UIDs would collide without the mailbox in the id.
  imap.folder(ADDRESS, SENT).uidValidity = imap.folder(ADDRESS).uidValidity;
  const adapter = new ICloudAdapter({endpoint: {host: imap.host, port: imap.port, secure: false}, backfillChunk: 3, connectTimeoutMs: 2000});
  const engine = new SyncEngine({store: w.store, adapters: new Adapters({icloud: adapter}), timeoutMs: 3000});
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
  const connect = async () => {
    expect((await api.send('POST', '/api/accounts/icloud', {body: {address: ADDRESS, app_password: PASSWORD}})).status).toBe(201);
    return w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'icloud')).get()!;
  };
  return {w, imap, adapter, engine, api, drain, poll, connect};
}

const rows = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).all();
const bySubject = (w: World, subject: string) => rows(w, subject)[0]!;

describe('iCloud: sent mail', () => {
  test('the Sent mailbox\'s year is backfilled resumably beside INBOX, apart from the Indexing line, with ids of its own', async () => {
    const {w, imap, api, engine, drain, connect} = await setup();
    receive(imap, 'Received 1', ago(5 * DAY));
    receive(imap, 'Received 2', ago(6 * DAY));
    for (let n = 1; n <= 5; n += 1) send(imap, `Sent ${n}`, ago(n * 40 * DAY));
    send(imap, 'Sent too long ago', ago(400 * DAY));
    const source = await connect();

    await engine.tick();
    await engine.settled();
    expect(readBackfill(w.store, source.id, SENT_BACKFILL_SCOPE)).toMatchObject({total: 5, fetched: 3, done: false});
    await drain();
    expect(readBackfill(w.store, source.id, SENT_BACKFILL_SCOPE)).toMatchObject({total: 5, fetched: 5, done: true});
    expect((await api.send('GET', '/api/mail/indexing')).body.indexing).toBeNull();

    // INBOX's UID 1 and Sent's UID 1 are two rows.
    expect(bySubject(w, 'Received 1').providerId).toBe('1700000001:1');
    expect(bySubject(w, 'Sent 1')).toMatchObject({
      providerId: 'sent:1700000001:1', sent: true, received: false, lane: null, unread: false, archivedAt: null, backfill: true,
      toRecipients: [{name: 'Sam Ortiz', address: 'sam.ortiz@example.org'}],
    });
    expect(rows(w, 'Sent too long ago')).toEqual([]);
    const sent = (await api.send('GET', '/api/mail/sent')).body;
    expect(sent.days.flatMap((day: {rows: {subject: string}[]}) => day.rows.map(row => row.subject))).toEqual(['Sent 1', 'Sent 2', 'Sent 3', 'Sent 4', 'Sent 5']);
    expect((await api.send('GET', '/api/mail/all')).body.days.flatMap((day: {rows: {subject: string}[]}) => day.rows.map(row => row.subject))).toEqual(['Received 1', 'Received 2']);
  });

  test('new sent mail arrives by the poll, the INBOX poll never archives it, and it leaves Sent when it leaves the mailbox', async () => {
    const {w, imap, drain, poll, connect} = await setup();
    await connect();
    await drain();
    const uid = send(imap, 'Sent from the Mac', ago(MINUTE));
    await poll();
    expect(bySubject(w, 'Sent from the Mac')).toMatchObject({sent: true, received: false, backfill: false, archivedAt: null, trashedAt: null});
    await poll();
    await poll();
    expect(bySubject(w, 'Sent from the Mac')).toMatchObject({archivedAt: null, trashedAt: null});
    expect(w.store.db.select().from(t.jobs).where(eq(t.jobs.kind, 'triage')).all()).toEqual([]);

    imap.move(ADDRESS, uid, 'Deleted Messages', SENT);
    await poll();
    expect(bySubject(w, 'Sent from the Mac').trashedAt).not.toBeNull();
  });

  test('mail to yourself is one row, in the Inbox and sent, whichever copy the poll sees first', async () => {
    const {w, imap, drain, poll, connect} = await setup();
    await connect();
    await drain();

    // The inbox copy first: the sent copy marks it sent and changes nothing else.
    const inboxUid = receive(imap, 'Note to self', ago(2 * MINUTE), '<note-1@icloud.example.com>');
    await poll();
    send(imap, 'Note to self', ago(2 * MINUTE), {to: ADDRESS, messageId: '<note-1@icloud.example.com>'});
    await poll();
    expect(rows(w, 'Note to self')).toHaveLength(1);
    expect(bySubject(w, 'Note to self')).toMatchObject({providerId: `1700000001:${inboxUid}`, sent: true, received: true, unread: true, archivedAt: null});

    // The sent copy first: a sent-only row, which the inbox copy then makes received, for triage.
    send(imap, 'Reminder to self', ago(MINUTE), {to: ADDRESS, messageId: '<note-2@icloud.example.com>'});
    await poll();
    expect(bySubject(w, 'Reminder to self')).toMatchObject({sent: true, received: false, unread: false});
    const second = receive(imap, 'Reminder to self', ago(MINUTE), '<note-2@icloud.example.com>');
    await poll();
    expect(rows(w, 'Reminder to self')).toHaveLength(1);
    const self = bySubject(w, 'Reminder to self');
    expect(self).toMatchObject({providerId: `1700000001:${second}`, sent: true, received: true, unread: true, archivedAt: null});
    expect(w.store.db.select().from(t.jobs).where(eq(t.jobs.kind, 'triage')).all().map(job => job.messageId).sort())
      .toEqual([bySubject(w, 'Note to self').id, self.id].sort());

    // Polls after keep both as they are.
    await poll();
    expect([bySubject(w, 'Note to self'), bySubject(w, 'Reminder to self')].map(row => [row.sent, row.received, row.archivedAt, row.trashedAt]))
      .toEqual([[true, true, null, null], [true, true, null, null]]);
  });
});
