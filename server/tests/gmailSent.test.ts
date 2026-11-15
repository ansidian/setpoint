// Gmail's sent mail against a fake Google on 127.0.0.1: the SENT label's 365 days backfilled,
// resumably and without the Inbox's Indexing line; mail sent from any client arriving by history;
// mail to yourself as one row; an account synced before sent mail was kept starting its own
// backfill; and the watch and the sweep covering SENT.
import {SEED_NOW} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {GmailAdapter} from '../src/providers/gmail/adapter.ts';
import {gmailConnector} from '../src/providers/gmail/connect.ts';
import {deleteCursor, readBackfill, SENT_BACKFILL_SCOPE} from '../src/sync/cursors.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeGoogle} from './fakeGoogle.ts';
import type {FakeGoogle} from './fakeGoogle.ts';
import {client, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';
import {gmailVerdict, rawEmail} from './rawEmail.ts';

vi.setConfig({testTimeout: 30_000});

const ADDRESS = 'user.work@example.com';
const TOPIC = 'projects/setpoint-test/topics/gmail';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.parse(SEED_NOW) - ms).toISOString();

function receive(google: FakeGoogle, subject: string, at: string, labels = ['INBOX', 'UNREAD']) {
  const raw = rawEmail({from: 'Contoso Coffee <news@contosocoffee.example>', to: ADDRESS, subject, date: at, text: `${subject}.`, received: gmailVerdict('contosocoffee.example')});
  return google.deliver(ADDRESS, {raw, date: at, labels});
}

/** Mail the user sent, as Gmail keeps it: labelled SENT, read, with no INBOX. */
function send(google: FakeGoogle, subject: string, at: string, {to = 'Sam Ortiz <sam.ortiz@example.org>', labels = ['SENT']}: {to?: string; labels?: string[]} = {}) {
  const raw = rawEmail({from: `User <${ADDRESS}>`, to, cc: 'June Park <june.park@example.org>', subject, date: at, text: `${subject}.`});
  return google.deliver(ADDRESS, {raw, date: at, labels});
}

async function setup() {
  const w = world();
  const google = await fakeGoogle({clock: () => w.store.now()});
  google.addMailbox(ADDRESS);
  const googleClient = google.client();
  const adapter = new GmailAdapter({topic: TOPIC, pageSize: 3, backfillPagesPerStep: 1, client: googleClient});
  const engine = new SyncEngine({store: w.store, adapters: new Adapters({gmail: adapter}), timeoutMs: 5000});
  const connectors = {gmail: gmailConnector(w.store, googleClient, true)};
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
  const consent = new URL(started.body.url);
  const browser = client(w, {engine, connectors});
  await browser.send('GET', `/api/ea/accounts/gmail/callback?code=${encodeURIComponent(google.issueCode(ADDRESS))}&state=${encodeURIComponent(consent.searchParams.get('state')!)}`);
  const source = w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'gmail')).get()!;
  /** A sync now, as a push would start one. */
  const pushed = async () => {
    engine.pushed(source.id);
    await drain();
  };
  return {w, google, engine, api, drain, pushed, source};
}

const bySubject = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!;
const subjects = (w: World, where: Partial<{sent: boolean; received: boolean}>) => w.store.db.select().from(t.messages).all()
  .filter(row => (where.sent === undefined || row.sent === where.sent) && (where.received === undefined || row.received === where.received)).map(row => row.subject).sort();

describe('Gmail: sent mail', () => {
  test('a year of SENT is backfilled resumably, apart from the Inbox\'s Indexing line, each with who it went to', async () => {
    const {w, google, api, drain, engine, source} = await setup();
    for (let n = 1; n <= 2; n += 1) receive(google, `Received ${n}`, ago(n * 30 * DAY));
    for (let n = 1; n <= 5; n += 1) send(google, `Sent ${n}`, ago(n * 50 * DAY));
    send(google, 'Sent too long ago', ago(400 * DAY));
    // Mail to yourself: one message with both labels.
    send(google, 'Note to self', ago(10 * DAY), {to: `User <${ADDRESS}>`, labels: ['SENT', 'INBOX', 'UNREAD']});

    // One step: three of the five sent, resumable from its own page token.
    await engine.tick();
    await engine.settled();
    expect(readBackfill(w.store, source.id, SENT_BACKFILL_SCOPE)).toMatchObject({fetched: 3, done: false});
    await drain();
    expect(readBackfill(w.store, source.id, SENT_BACKFILL_SCOPE)).toMatchObject({fetched: 6, done: true});
    expect((await api.send('GET', '/api/mail/indexing')).body.indexing).toBeNull();
    // Each fetched once, whichever pass came to it first.
    const raws = google.requests.filter(request => /\/messages\/[^/]+$/.test(request.path) && request.query.get('format') === 'raw').map(request => request.path);
    expect(raws.length).toBe(new Set(raws).size);

    expect(subjects(w, {sent: true, received: false})).toEqual(['Sent 1', 'Sent 2', 'Sent 3', 'Sent 4', 'Sent 5']);
    expect(subjects(w, {received: true})).toEqual(['Note to self', 'Received 1', 'Received 2']);
    expect(bySubject(w, 'Note to self')).toMatchObject({sent: true, received: true, unread: true});
    expect(bySubject(w, 'Sent 1')).toMatchObject({
      lane: null, unread: false, archivedAt: null, backfill: true,
      toRecipients: [{name: 'Sam Ortiz', address: 'sam.ortiz@example.org'}], ccRecipients: [{name: 'June Park', address: 'june.park@example.org'}],
    });
    const sent = (await api.send('GET', '/api/mail/sent')).body;
    expect(sent.days.flatMap((day: {rows: {subject: string}[]}) => day.rows.map(row => row.subject))).toEqual(['Note to self', 'Sent 1', 'Sent 2', 'Sent 3', 'Sent 4', 'Sent 5']);
    expect(sent.days.flatMap((day: {rows: unknown[]}) => day.rows)[1]).toMatchObject({subject: 'Sent 1', to: [{name: 'Sam Ortiz', address: 'sam.ortiz@example.org'}]});
  });

  test('mail sent from any client arrives by history, a sent draft too, and mail to yourself is one row in the Inbox', async () => {
    const {w, google, api, drain, pushed} = await setup();
    await drain();
    send(google, 'Sent from the phone', ago(2 * MINUTE));
    // Gmail's own composer: a draft that becomes sent mail.
    const draft = send(google, 'Drafted then sent', ago(MINUTE), {labels: ['DRAFT']});
    google.change(ADDRESS, draft, ['SENT'], ['DRAFT']);
    send(google, 'Reminder to self', ago(MINUTE), {to: ADDRESS, labels: ['SENT', 'INBOX', 'UNREAD']});
    await pushed();

    expect(bySubject(w, 'Sent from the phone')).toMatchObject({sent: true, received: false, lane: null, backfill: false, unread: false, archivedAt: null});
    expect(bySubject(w, 'Drafted then sent')).toMatchObject({sent: true, received: false});
    expect(w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Reminder to self')).all()).toHaveLength(1);
    const self = bySubject(w, 'Reminder to self');
    expect(self).toMatchObject({sent: true, received: true, unread: true});
    // Received mail goes to triage; sent mail never does.
    const triage = w.store.db.select().from(t.jobs).where(eq(t.jobs.kind, 'triage')).all().map(job => job.messageId);
    expect(triage).toEqual([self.id]);
    expect((await api.send('GET', '/api/mail/counts')).body.unread).toBe(1);
    // The watch covers both labels.
    const watch = google.requests.find(request => request.path.endsWith('/watch'))!;
    expect(watch.body).toMatchObject({labelIds: ['INBOX', 'SENT']});

    // Trashed in Gmail: out of Sent.
    google.change(ADDRESS, bySubject(w, 'Sent from the phone').providerId, ['TRASH'], []);
    await pushed();
    expect(bySubject(w, 'Sent from the phone').trashedAt).not.toBeNull();
    expect((await api.send('GET', '/api/mail/sent')).body.days.flatMap((day: {rows: {subject: string}[]}) => day.rows.map(row => row.subject)))
      .toEqual(['Reminder to self', 'Drafted then sent']);
  });

  test('an account synced before sent mail was kept backfills it, and the sweep neither re-reads sent mail nor misses it', async () => {
    const {w, google, drain, pushed, source} = await setup();
    receive(google, 'Received before', ago(20 * DAY));
    send(google, 'Sent last month', ago(30 * DAY));
    await drain();
    // As an account synced before sent mail was kept stands: its own backfill done, no sent mail and
    // no sent backfill yet.
    w.store.db.delete(t.messages).where(eq(t.messages.sent, true)).run();
    deleteCursor(w.store, source.id, SENT_BACKFILL_SCOPE);
    await pushed();
    expect(bySubject(w, 'Sent last month')).toMatchObject({sent: true, received: false, backfill: true});
    expect(readBackfill(w.store, source.id, SENT_BACKFILL_SCOPE)).toMatchObject({done: true});

    // Mail to yourself mirrored from INBOX before sent mail was kept: the sent backfill marks it sent
    // without fetching it again.
    const selfId = send(google, 'Old note to self', ago(40 * DAY), {to: ADDRESS, labels: ['SENT', 'INBOX']});
    w.store.db.delete(t.messages).where(eq(t.messages.sent, true)).run();
    deleteCursor(w.store, source.id, SENT_BACKFILL_SCOPE);
    await pushed();
    expect(bySubject(w, 'Old note to self')).toMatchObject({providerId: selfId, sent: true, received: true});
    w.store.db.update(t.messages).set({sent: false}).where(eq(t.messages.providerId, selfId)).run();
    deleteCursor(w.store, source.id, SENT_BACKFILL_SCOPE);
    const raws = () => google.requests.filter(request => request.path.endsWith(`/messages/${selfId}`) && request.query.get('format') === 'raw').length;
    const rawBefore = raws();
    await pushed();
    expect(bySubject(w, 'Old note to self').sent).toBe(true);
    expect(raws()).toBe(rawBefore);

    // A sent-only email moved to the inbox in Gmail becomes received, and goes to triage.
    const moved = bySubject(w, 'Sent last month');
    google.change(ADDRESS, moved.providerId, ['INBOX'], []);
    await pushed();
    expect(bySubject(w, 'Sent last month')).toMatchObject({sent: true, received: true, archivedAt: null});
    expect(w.store.db.select().from(t.jobs).where(and(eq(t.jobs.kind, 'triage'), eq(t.jobs.messageId, moved.id))).all()).toHaveLength(1);

    // Sweeps every 5 minutes: a sent-only row is never re-read for its labels.
    send(google, 'Sent yesterday', ago(DAY));
    await pushed();
    expect(bySubject(w, 'Sent yesterday')).toMatchObject({sent: true, received: false});
    const labelReads = () => google.requests.filter(request => request.query.get('format') === 'minimal').length;
    const before = labelReads();
    w.advance(6 * MINUTE);
    await drain();
    w.advance(6 * MINUTE);
    await drain();
    expect(labelReads()).toBe(before);

    // A sent email the history missed (its record gone) is fetched by the next sweep.
    const missed = send(google, 'Missed by history', ago(MINUTE));
    google.mailboxes.get(ADDRESS)!.history.pop();
    w.advance(6 * MINUTE);
    await drain();
    expect(bySubject(w, 'Missed by history')).toMatchObject({providerId: missed, sent: true, received: false, backfill: false});
  });
});
