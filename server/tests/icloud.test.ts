// The iCloud adapter against a fake IMAP server on 127.0.0.1 (BUILD-PLAN.md › B2 › Done when):
// Connect iCloud, a resumable backfill with progress, new mail by polling, read elsewhere (\Seen),
// opening in Setpoint, Mark all as read in one STORE, trash with undo (Deleted Messages and back),
// moved away in Apple Mail, a new UIDVALIDITY, a dropped connection, and a revoked app password.
import {SEED_NOW} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {Notifier} from '../src/notify/index.ts';
import {ICloudAdapter, icloudConnector} from '../src/providers/icloud/index.ts';
import {sourceList} from '../src/queries/sources.ts';
import {updateSettings} from '../src/settings.ts';
import {readBackfill} from '../src/sync/cursors.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeImap} from './fakeImap.ts';
import type {FakeImap} from './fakeImap.ts';
import {fakeNtfy} from './fakeNtfy.ts';
import {client, liveEvents, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';
import {rawEmail} from './rawEmail.ts';

const ADDRESS = 'user@icloud.example.com';
const PASSWORD = 'abcd-efgh-ijkl-mnop';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.parse(SEED_NOW) - ms).toISOString();

// iCloud's own verdict block, as its SMTP ingress adds it (see senderAuthentication.test.ts).
const appleVerdict = (domain: string): [string, string][] => [
  ['Received', 'from p01-icloudmta-smtpin-example by p01-mailgateway-smtp-example (mailgateway)'],
  ['Received', `from smtp.${domain} by p01-icloudmta-smtpin-example (Postfix)`],
  ['X-ICL-Repid', 'redacted'], ['X-ICL-Info', 'redacted'], ['X-ICL-Score', 'redacted'],
  ['Authentication-Results', 'bimi.icloud.com; bimi=none'],
  ['Authentication-Results', 'arc.icloud.com; arc=none'],
  ['Authentication-Results', `dmarc.icloud.com; dmarc=pass header.from=${domain}`],
  ['Authentication-Results', `dkim-verifier.icloud.com; dkim=pass header.d=${domain}`],
  ['Authentication-Results', `spf.icloud.com; spf=pass smtp.mailfrom=${domain}`],
];

function deliver(imap: FakeImap, subject: string, at: string, seen = false) {
  const raw = rawEmail({from: 'Proseware <billing@proseware.example.com>', subject, date: at, text: `${subject}.`, received: appleVerdict('proseware.example.com')});
  return imap.deliver(ADDRESS, raw, at, seen ? ['\\Seen'] : []);
}

async function setup() {
  const w = world();
  const imap = await fakeImap();
  imap.addUser(ADDRESS, PASSWORD);
  const ntfy = await fakeNtfy();
  updateSettings(w.store, {notifications: {ntfy_server: ntfy.url}});
  const adapter = new ICloudAdapter({endpoint: {host: imap.host, port: imap.port, secure: false}, backfillChunk: 3, connectTimeoutMs: 2000});
  const engine = new SyncEngine({store: w.store, adapters: new Adapters({icloud: adapter}), notifier: new Notifier(w.store, {publicUrl: 'https://setpoint.example.com'}), timeoutMs: 3000});
  const api = await signedIn(w, {engine, connectors: {icloud: icloudConnector(w.store, adapter)}});
  const drain = async () => {
    for (let round = 0; round < 30; round += 1) {
      await engine.tick();
      await engine.settled();
      if (!w.store.db.select().from(t.jobs).where(and(eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, w.store.now().toISOString()))).all().length) return;
    }
    throw new Error('The engine never went idle.');
  };
  // Every 2 minutes, as the source is scheduled.
  const poll = async () => {
    w.advance(2 * MINUTE);
    await drain();
  };
  return {w, imap, ntfy, adapter, engine, api, drain, poll};
}

const bySubject = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!;
const icloudSource = (w: World) => w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'icloud')).get()!;

describe('iCloud: an attachment for the reader\'s preview', () => {
  test('served through the adapter from the message\'s source (UID FETCH), by the part the sync named', async () => {
    const env = await setup();
    const {w, imap, api, drain} = env;
    imap.deliver(ADDRESS, rawEmail({
      from: 'Woodgrove Bank <alerts@woodgrovebank.example.com>', subject: 'Statement ready', date: ago(DAY), text: 'Attached.', received: appleVerdict('woodgrovebank.example.com'),
      attachments: [
      {filename: 'Statement Oct.csv', contentType: 'text/csv', content: 'Date,Amount\r\n2026-10-01,42.00\r\n'},
      {filename: 'logo.png', contentType: 'image/png', content: 'not shown', inline: true},
      {filename: 'notes.html', contentType: 'text/html', content: '<script>alert(1)</script>'},
    ],
    }), ago(DAY), []);
    expect((await api.send('POST', '/api/accounts/icloud', {body: {address: ADDRESS, app_password: PASSWORD}})).status).toBe(201);
    await drain();
    const message = bySubject(w, 'Statement ready');
    // The attachment the record lists, by its id, with its type and a Content-Disposition.
    const row = w.store.db.select().from(t.attachments).where(eq(t.attachments.messageId, message.id)).all();
    expect(row.map(file => [file.filename, file.mimeType])).toEqual([['Statement Oct.csv', 'text/csv'], ['notes.html', 'text/html']]);
    const csv = await api.send('GET', `/api/mail/messages/${message.id}/attachments/${row[0]!.id}`);
    expect(csv.status).toBe(200);
    expect(csv.body).toBe('Date,Amount\r\n2026-10-01,42.00\r\n');
    expect(csv.headers.get('content-type')).toBe('text/csv');
    expect(csv.headers.get('content-disposition')).toBe(`inline; filename="Statement Oct.csv"; filename*=UTF-8''Statement%20Oct.csv`);
    expect(csv.headers.get('x-content-type-options')).toBe('nosniff');
    // A type a browser would run is served as bytes to save, never as itself.
    const html = await api.send('GET', `/api/mail/messages/${message.id}/attachments/${row[1]!.id}`);
    expect(html.headers.get('content-type')).toBe('application/octet-stream');
    expect(html.headers.get('content-disposition')).toMatch(/^attachment; filename="notes.html"/);
    // Another email's attachment id, or none, is not found; signed out is refused.
    expect((await api.send('GET', `/api/mail/messages/${message.id}/attachments/999`)).status).toBe(404);
    expect((await client(w).send('GET', `/api/mail/messages/${message.id}/attachments/${row[0]!.id}`)).status).toBe(401);
  });
});

describe('iCloud: a mailbox through backfill, new mail, read state, Mark all as read, trash and a revoked app password', () => {
  test('the whole way', async () => {
    const env = await setup();
    const {w, imap, api, drain, poll} = env;
    // Delivered oldest first, as UIDs grow.
    deliver(imap, 'Too old', ago(400 * DAY), true);
    for (let n = 5; n >= 1; n -= 1) deliver(imap, `Bill ${n}`, ago(n * 60 * DAY), n % 2 === 0);

    // A wrong app password is refused before anything is stored.
    const refused = await api.send('POST', '/api/accounts/icloud', {body: {address: ADDRESS, app_password: 'wrong-pass-word-here'}});
    expect(refused.status).toBe(400);
    expect(refused.body.error.code).toBe('icloud_refused');
    expect(w.store.db.select().from(t.accounts).all()).toEqual([]);

    // Connect iCloud: the account and its polled source.
    const connected = await api.send('POST', '/api/accounts/icloud', {body: {address: ADDRESS, app_password: PASSWORD}});
    expect(connected.status).toBe(201);
    expect(connected.body).toMatchObject({provider: 'icloud', label: 'iCloud', address: ADDRESS, icon: 'cloud'});
    const source = icloudSource(w);
    expect(source).toMatchObject({syncMode: 'poll', intervalSeconds: 120});

    // The backfill, three at a time, newest first, with progress; resumable from the UIDs left.
    await env.engine.tick();
    await env.engine.settled();
    expect(readBackfill(w.store, source.id)).toMatchObject({total: 5, fetched: 3, done: false});
    expect((await api.send('GET', '/api/mail/indexing')).body.indexing).toEqual({progress: 0.6});
    expect(w.store.db.select().from(t.messages).all().map(message => message.subject).sort()).toEqual(['Bill 1', 'Bill 2', 'Bill 3']);
    await drain();
    expect(readBackfill(w.store, source.id)).toMatchObject({total: 5, fetched: 5, done: true});
    const all = w.store.db.select().from(t.messages).all();
    expect(all.map(message => message.subject).sort()).toEqual(['Bill 1', 'Bill 2', 'Bill 3', 'Bill 4', 'Bill 5']);
    // B3: history is sorted at once by the rules-only pass, never left Unsorted.
    expect(all.every(message => message.lane !== null && message.triageSource !== null && message.backfill && message.senderAuthenticated === true)).toBe(true);
    expect((await api.send('GET', '/api/mail/counts')).body.unread).toBe(3);
    // One pooled connection did all of it.
    expect(imap.logins).toBe(2);

    // New mail, found by the next poll.
    deliver(imap, 'Bill is ready · $89.99', ago(5 * MINUTE));
    await poll();
    const bill = bySubject(w, 'Bill is ready · $89.99');
    expect(bill).toMatchObject({lane: null, unread: true, backfill: false});
    expect(liveEvents(w).some(event => event.type === 'mail' && event.messages.includes(bill.id))).toBe(true);

    // Read elsewhere: \Seen set in Apple Mail.
    const bill1 = bySubject(w, 'Bill 1');
    imap.setSeen(ADDRESS, Number(bill1.providerId.split(':')[1]), true);
    await poll();
    expect(bySubject(w, 'Bill 1').unread).toBe(false);
    expect((await api.send('GET', '/api/mail/counts')).body.unread).toBe(3);

    // Opening in Setpoint: unread drops at once, and \Seen reaches iCloud.
    await api.send('POST', `/api/mail/messages/${bill.id}/open`);
    expect((await api.send('GET', '/api/mail/counts')).body.unread).toBe(2);
    await drain();
    expect(imap.flags(ADDRESS, Number(bill.providerId.split(':')[1]))).toEqual(['\\Seen']);

    // Mark all as read: one UID STORE for every unread email.
    const stores = imap.commands.filter(command => command.startsWith('UID STORE')).length;
    await api.send('POST', '/api/mail/mark-all-read', {body: {}});
    await drain();
    expect(imap.commands.filter(command => command.startsWith('UID STORE')).length).toBe(stores + 1);
    expect((await api.send('GET', '/api/mail/counts')).body.unread).toBe(0);
    await poll();
    expect(w.store.db.select().from(t.messages).all().filter(message => message.unread)).toEqual([]);

    // Trash to Deleted Messages, and Undo back to the inbox under a new UID; polls agree.
    await api.send('POST', `/api/mail/messages/${bill.id}/trash`);
    await drain();
    expect(imap.folder(ADDRESS, 'Deleted Messages').messages).toHaveLength(1);
    await poll();
    expect(bySubject(w, 'Bill is ready · $89.99').trashedAt).not.toBeNull();
    await api.send('POST', `/api/mail/messages/${bill.id}/untrash`);
    await drain();
    expect(imap.folder(ADDRESS, 'Deleted Messages').messages).toHaveLength(0);
    await poll();
    expect(bySubject(w, 'Bill is ready · $89.99')).toMatchObject({id: bill.id, trashedAt: null, archivedAt: null, trashRef: null});
    expect(w.store.db.select().from(t.messages).all()).toHaveLength(6);

    // Moved to Archive in Apple Mail: out of the Inbox, still in the record.
    const bill2 = bySubject(w, 'Bill 2');
    imap.move(ADDRESS, Number(bill2.providerId.split(':')[1]), 'Archive');
    await poll();
    expect(bySubject(w, 'Bill 2').archivedAt).not.toBeNull();

    // Revoked app password: needs reconnect, one ntfy, no more polls.
    expect(env.adapter.pooled(source.id)).toBe(true);
    imap.revoke(ADDRESS);
    // The pooled session sees iCloud close it well before the next poll.
    await vi.waitFor(() => expect(env.adapter.pooled(source.id)).toBe(false));
    await poll();
    expect(sourceList(w.store).find(row => row.id === source.id)!.health).toMatchObject({state: 'needs_reconnect', reason: 'iCloud refused the app password: Authentication failed.'});
    expect(env.ntfy.published.map(message => message.body.title)).toEqual(['iCloud needs sign-in']);
    const commands = imap.commands.length;
    await poll();
    expect(imap.commands.length).toBe(commands);
    await env.adapter.close();
  });
});

describe('iCloud: recovery', () => {
  async function connected() {
    const env = await setup();
    deliver(env.imap, 'Welcome', ago(DAY));
    await env.api.send('POST', '/api/accounts/icloud', {body: {address: ADDRESS, app_password: PASSWORD}});
    await env.drain();
    return env;
  }

  test('a new UIDVALIDITY: the same emails matched by Message-ID, not copied', async () => {
    const env = await connected();
    const {w, imap} = env;
    const before = bySubject(w, 'Welcome');
    const inbox = imap.folder(ADDRESS);
    inbox.uidValidity += 1;
    inbox.messages.forEach((message, at) => (message.uid = 100 + at));
    inbox.uidNext = 100 + inbox.messages.length;
    await env.poll();
    await env.drain();
    const after = bySubject(w, 'Welcome');
    expect(after.id).toBe(before.id);
    expect(after.providerId).toBe(`${inbox.uidValidity}:100`);
    expect(after.archivedAt).toBeNull();
    expect(w.store.db.select().from(t.messages).all()).toHaveLength(1);
    await env.adapter.close();
  });

  test('an empty inbox: healthy, its backfill done, and no FETCH of a range that doesn\'t exist', async () => {
    const env = await setup();
    await env.api.send('POST', '/api/accounts/icloud', {body: {address: ADDRESS, app_password: PASSWORD}});
    await env.drain();
    const source = icloudSource(env.w);
    expect(sourceList(env.w.store).find(row => row.id === source.id)!.health.state).toBe('healthy');
    expect(readBackfill(env.w.store, source.id)).toMatchObject({total: 0, done: true});
    expect(env.imap.commands.filter(command => command.startsWith('UID FETCH'))).toEqual([]);
    await env.adapter.close();
  });

  test('a dropped connection is a transient failure; the next poll reconnects', async () => {
    const env = await connected();
    const {w, imap} = env;
    imap.inject(/^UID FETCH 1:\*/, 'drop');
    await env.poll();
    const source = icloudSource(w);
    expect(sourceList(w.store).find(row => row.id === source.id)!.health.state).toBe('failing');
    deliver(imap, 'After the drop', ago(MINUTE));
    w.advance(30_000);
    await env.poll();
    expect(sourceList(w.store).find(row => row.id === source.id)!.health.state).toBe('healthy');
    expect(bySubject(w, 'After the drop')).toBeDefined();
    await env.adapter.close();
  });

  test('a change iCloud refuses fails in place with its words', async () => {
    const env = await connected();
    const {w, imap, api} = env;
    const welcome = bySubject(w, 'Welcome');
    imap.inject(/^UID STORE/, 'NO [CANNOT] Mailbox is read-only');
    await api.send('POST', `/api/mail/messages/${welcome.id}/open`);
    await env.drain();
    expect((await api.send('GET', `/api/mail/messages/${welcome.id}`)).body.command).toMatchObject({state: 'failed', provider: 'icloud'});
    await env.adapter.close();
  });
});
