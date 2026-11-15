// iCloud's threads against a fake IMAP server on 127.0.0.1. IMAP has no thread id, so a thread
// rests on References and In-Reply-To: a sent reply and the email it answers share one, whichever
// copy the poll sees first, and a reply that names only the email it answers (no References) joins
// that email's thread rather than starting one of its own.
import {SEED_NOW} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import {describe, expect, onTestFinished, test, vi} from 'vitest';
import * as t from '../src/db/schema.ts';
import {messageDetail} from '../src/queries/mail.ts';
import {ICloudAdapter, icloudConnector} from '../src/providers/icloud/index.ts';
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
const SAM = 'Sam Ortiz <sam@fabrikam.example.com>';

type Headers = {messageId: string; references?: string; inReplyTo?: string};

const receive = (imap: FakeImap, subject: string, at: string, headers: Headers) =>
  imap.deliver(ADDRESS, rawEmail({from: SAM, to: ADDRESS, subject, date: at, text: `${subject}.`, ...headers}), at);
const send = (imap: FakeImap, subject: string, at: string, headers: Headers) =>
  imap.deliver(ADDRESS, rawEmail({from: `User <${ADDRESS}>`, to: SAM, subject, date: at, text: `${subject}.`, ...headers}), at, ['\\Seen'], SENT);

async function setup() {
  const w = world();
  const imap = await fakeImap();
  imap.addUser(ADDRESS, PASSWORD);
  const adapter = new ICloudAdapter({endpoint: {host: imap.host, port: imap.port, secure: false}, backfillChunk: 10, connectTimeoutMs: 2000});
  // Its pooled connection and the pool's sweeper go with the test.
  onTestFinished(() => adapter.close());
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
  expect((await api.send('POST', '/api/accounts/icloud', {body: {address: ADDRESS, app_password: PASSWORD}})).status).toBe(201);
  await drain();
  return {w, imap, poll};
}

const threadOf = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!.threadId;

describe('iCloud: threads', () => {
  test('a sent reply and the email it answers share a thread, References or In-Reply-To alone', async () => {
    const {w, imap, poll} = await setup();
    receive(imap, 'Lunch?', ago(4 * DAY), {messageId: '<r1@fabrikam.example.com>'});
    send(imap, 'Re: Lunch?', ago(4 * DAY - 10 * MINUTE), {messageId: '<s1@icloud.example.com>', references: '<r1@fabrikam.example.com>'});
    receive(imap, 'Re: Lunch? (2)', ago(3 * DAY), {messageId: '<r2@fabrikam.example.com>', references: '<r1@fabrikam.example.com> <s1@icloud.example.com>'});
    // A client that names only the email it answers.
    send(imap, 'Re: Lunch? (3)', ago(3 * DAY - 10 * MINUTE), {messageId: '<s2@icloud.example.com>', inReplyTo: '<r2@fabrikam.example.com>'});
    await poll();

    const root = threadOf(w, 'Lunch?');
    expect(['Re: Lunch?', 'Re: Lunch? (2)', 'Re: Lunch? (3)'].map(subject => threadOf(w, subject))).toEqual([root, root, root]);
    // The ids compare as stored: the reply's In-Reply-To is the email's Message-ID, character for character.
    const s1 = w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Re: Lunch?')).get()!;
    expect(s1.inReplyTo).toBe(w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Lunch?')).get()!.rfc822Id);
    // Each received email has its own reply, and the reader lists the other three.
    const row = (subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!;
    expect(messageDetail(w.store, row('Lunch?').id)).toMatchObject({reply_id: s1.id});
    const second = messageDetail(w.store, row('Re: Lunch? (2)').id);
    expect(second.reply_id).toBe(row('Re: Lunch? (3)').id);
    expect(second.conversation!.map(other => [other.subject, other.sent])).toEqual([['Lunch?', false], ['Re: Lunch?', true], ['Re: Lunch? (3)', true]]);
  });

  test('a reply that came first joins its email\'s thread when that email arrives, and a later refresh keeps it there', async () => {
    const {w, imap, poll} = await setup();
    receive(imap, 'Keys', ago(5 * DAY), {messageId: '<k1@fabrikam.example.com>'});
    send(imap, 'Re: Keys (2)', ago(DAY), {messageId: '<k3@icloud.example.com>', inReplyTo: '<k2@fabrikam.example.com>'});
    await poll();
    receive(imap, 'Re: Keys', ago(2 * DAY), {messageId: '<k2@fabrikam.example.com>', references: '<k1@fabrikam.example.com>'});
    await poll();
    await poll();

    const root = threadOf(w, 'Keys');
    expect([threadOf(w, 'Re: Keys'), threadOf(w, 'Re: Keys (2)')]).toEqual([root, root]);
  });
});
