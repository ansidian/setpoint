// Who an email was sent to and what it answers: To, Cc, Reply-To, References and In-Reply-To.
// New mail keeps them as it arrives from Gmail and iCloud. Mail held from before gets them through
// a one-time header pass, headers only (Gmail's format=metadata, IMAP's BODY.PEEK[HEADER]), that
// resumes where it stopped, skips what the provider no longer has, and costs no AI call.
import {SEED_NOW} from '@setpoint/shared';
import {and, eq, inArray, lte} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {Notifier} from '../src/notify/index.ts';
import {GmailAdapter} from '../src/providers/gmail/adapter.ts';
import {gmailConnector} from '../src/providers/gmail/connect.ts';
import {ICloudAdapter, icloudConnector} from '../src/providers/icloud/index.ts';
import {parseEmail, parseHeaderBlock} from '../src/providers/mime.ts';
import {deleteCursor, HEADERS_SCOPE, readHeaderBackfill} from '../src/sync/cursors.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeGoogle} from './fakeGoogle.ts';
import {fakeImap} from './fakeImap.ts';
import {client, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';
import {gmailVerdict, rawEmail} from './rawEmail.ts';

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.parse(SEED_NOW) - ms).toISOString();

// A reply to a thread, sent to the user and another person, copied to two more, answers to a list.
const REPLY = {
  from: 'Sam Ortiz <sam@fabrikam.example.com>',
  to: '"User, The" <user@example.net>, dana@fabrikam.example.com',
  cc: 'Lee Park <LEE@Proseware.example.com>, Team: ana@contoso.example, bo@contoso.example;',
  replyTo: 'Planning list <planning@fabrikam.example.com>',
  references: '<root@fabrikam.example.com> <second@fabrikam.example.com>',
};
const STORED = {
  toRecipients: [{name: 'User, The', address: 'user@example.net'}, {name: null, address: 'dana@fabrikam.example.com'}],
  ccRecipients: [{name: 'Lee Park', address: 'lee@proseware.example.com'}, {name: null, address: 'ana@contoso.example'}, {name: null, address: 'bo@contoso.example'}],
  replyTo: [{name: 'Planning list', address: 'planning@fabrikam.example.com'}],
  referenceIds: ['<root@fabrikam.example.com>', '<second@fabrikam.example.com>'],
  inReplyTo: '<second@fabrikam.example.com>',
};
const NONE = {toRecipients: [], ccRecipients: [], replyTo: [], referenceIds: [], inReplyTo: null};
const UNREAD_HEADERS = {toRecipients: null, ccRecipients: null, replyTo: null, referenceIds: null, inReplyTo: null};

const columns = (row: typeof t.messages.$inferSelect) => ({
  toRecipients: row.toRecipients, ccRecipients: row.ccRecipients, replyTo: row.replyTo, referenceIds: row.referenceIds, inReplyTo: row.inReplyTo,
});
const bySubject = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!;

/** The rows as Setpoint held them before it kept these headers, and no header pass yet. */
function forget(w: World, sourceId: number) {
  w.store.db.update(t.messages).set(UNREAD_HEADERS).run();
  deleteCursor(w.store, sourceId, HEADERS_SCOPE);
}

/** Jobs that would cost money or sort mail again. */
const paidJobs = (w: World) => w.store.db.select().from(t.jobs).where(inArray(t.jobs.kind, ['triage', 'extract', 'search_terms', 'jobs_read'])).all().length;

describe('The parser reads who an email went to', () => {
  test('To, Cc and Reply-To as names and lowercased addresses, groups opened, References in order and In-Reply-To', async () => {
    const email = await parseEmail(rawEmail({...REPLY, subject: 'Thursday', date: SEED_NOW, text: 'See you then.'}));
    expect({toRecipients: email.to, ccRecipients: email.cc, replyTo: email.replyTo, referenceIds: email.references, inReplyTo: email.inReplyTo}).toEqual(STORED);
  });

  test('names in other scripts: encoded words, raw UTF-8, and Gmail\'s metadata values already decoded, read alike by the header pass', async () => {
    const source = rawEmail({
      from: 'Sam <sam@fabrikam.example.com>', subject: 'Hola', date: SEED_NOW,
      to: '=?UTF-8?B?Sm9zw6kgTsO6w7Fleg==?= <jose@fabrikam.example.com>', cc: 'Zoë Brontë <zoe@contoso.example>',
    });
    const email = await parseEmail(source);
    expect(email.to).toEqual([{name: 'José Núñez', address: 'jose@fabrikam.example.com'}]);
    expect(email.cc).toEqual([{name: 'Zoë Brontë', address: 'zoe@contoso.example'}]);
    const header = source.subarray(0, source.indexOf('\r\n\r\n'));
    const fromHeader = await parseHeaderBlock(header);
    expect(fromHeader).toEqual({to: email.to, cc: email.cc, replyTo: email.replyTo, references: email.references, inReplyTo: email.inReplyTo});
    expect((await parseHeaderBlock('To: José Núñez <Jose@Fabrikam.example.com>')).to).toEqual([{name: 'José Núñez', address: 'jose@fabrikam.example.com'}]);
  });

  test('an email with only a sender has empty lists, known rather than unread', async () => {
    const email = await parseEmail(Buffer.from('From: a@example.com\r\nSubject: Hi\r\n\r\nHello\r\n'));
    expect({toRecipients: email.to, ccRecipients: email.cc, replyTo: email.replyTo, referenceIds: email.references, inReplyTo: email.inReplyTo}).toEqual(NONE);
  });
});

describe('Gmail', () => {
  const ADDRESS = 'user.work@example.com';

  async function setup(headerChunk = 100) {
    const w = world();
    const google = await fakeGoogle({clock: () => w.store.now()});
    google.addMailbox(ADDRESS);
    const adapter = new GmailAdapter({topic: null, pageSize: 50, backfillPagesPerStep: 1, headerChunk, client: google.client()});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({gmail: adapter}), notifier: new Notifier(w.store, {publicUrl: 'https://setpoint.example.com'}), timeoutMs: 5000});
    const connectors = {gmail: gmailConnector(w.store, google.client(), false)};
    const api = await signedIn(w, {engine, connectors});
    // Connect Gmail: the consent, then Google's redirect back.
    const consent = new URL((await api.send('POST', '/api/accounts/gmail/authorize', {body: {}})).body.url);
    const back = await client(w, {engine, connectors})
      .send('GET', `/api/ea/accounts/gmail/callback?code=${encodeURIComponent(google.issueCode(ADDRESS))}&state=${encodeURIComponent(consent.searchParams.get('state')!)}`);
    expect(back.status).toBe(302);
    const source = w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'gmail')).get()!;
    const drain = async () => {
      for (let round = 0; round < 40; round += 1) {
        await engine.tick();
        await engine.settled();
        if (!w.store.db.select().from(t.jobs).where(and(eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, w.store.now().toISOString()))).all().length) return;
      }
      throw new Error('The engine never went idle.');
    };
    const sync = async () => {
      w.advance(2 * MINUTE);
      await drain();
    };
    const deliver = (subject: string, at: string, extra: Partial<typeof REPLY> = {}) =>
      google.deliver(ADDRESS, {raw: rawEmail({from: 'Contoso <news@contoso.example>', subject, date: at, text: `${subject}.`, received: gmailVerdict('contoso.example'), ...extra}), date: at});
    return {w, google, api, source, drain, sync, deliver};
  }

  const fetches = (google: Awaited<ReturnType<typeof fakeGoogle>>, format: string) =>
    google.requests.filter(request => /\/messages\/[^/]+$/.test(request.path) && request.query.get('format') === format);

  test('new mail keeps its recipients and reply headers as it arrives, and the reader\'s detail shows them', async () => {
    const env = await setup();
    await env.drain();
    env.deliver('Thursday', ago(MINUTE), REPLY);
    env.deliver('Plain', ago(MINUTE));
    await env.sync();
    expect(columns(bySubject(env.w, 'Thursday'))).toEqual(STORED);
    expect(columns(bySubject(env.w, 'Plain'))).toMatchObject({toRecipients: [{name: null, address: 'user@example.net'}], ccRecipients: [], replyTo: [], referenceIds: [], inReplyTo: null});
    const detail = await env.api.send('GET', `/api/mail/messages/${bySubject(env.w, 'Thursday').id}`);
    expect(detail.body).toMatchObject({
      to: [{name: 'User, The', address: 'user@example.net'}, {name: null, address: 'dana@fabrikam.example.com'}],
      cc: STORED.ccRecipients, reply_to: STORED.replyTo, references: STORED.referenceIds, in_reply_to: STORED.inReplyTo,
    });
  });

  test('mail held from before is filled by a header pass, metadata only, resuming after a failure and skipping what Gmail deleted', async () => {
    const env = await setup(2);
    const {w, google} = env;
    const ids = [0, 1, 2, 3, 4].map(n => env.deliver(`Bill ${n}`, ago((n + 1) * DAY), n === 2 ? REPLY : {}));
    await env.drain();
    expect(w.store.db.select().from(t.messages).all()).toHaveLength(5);
    // As the record stood before: no recipients on any row, and no pass yet.
    forget(w, env.source.id);
    const raw = fetches(google, 'raw').length;
    const usage = w.store.db.select().from(t.aiUsage).all().length;
    const jobs = paidJobs(w);
    const unread = w.store.db.select({id: t.messages.id, unread: t.messages.unread}).from(t.messages).all();
    // Rows go oldest id first, two at a time: Bill 0 and 1, then 2 and 3, then 4. Gmail no longer
    // has Bill 3 (its history hasn't said so yet), and Bill 4's first read fails.
    google.inject(new RegExp(`GET /gmail/v1/users/me/messages/${ids[3]}$`), {status: 404, body: {error: {code: 404, message: 'Requested entity was not found.', status: 'NOT_FOUND'}}}, 10);
    google.inject(new RegExp(`GET /gmail/v1/users/me/messages/${ids[4]}$`), {status: 500});

    await env.sync();
    expect(readHeaderBackfill(w.store, env.source.id)).toMatchObject({done: false, total: 5, read: 3, skipped: 1});
    // The failed step resumes from where it stood, not from the start.
    w.advance(5 * MINUTE);
    await env.drain();
    expect(readHeaderBackfill(w.store, env.source.id)).toMatchObject({done: true, total: 5, read: 4, skipped: 1});
    expect(columns(bySubject(w, 'Bill 2'))).toEqual(STORED);
    for (const subject of ['Bill 0', 'Bill 1', 'Bill 4']) expect(bySubject(w, subject).toRecipients).toEqual([{name: null, address: 'user@example.net'}]);
    // Bill 3 is skipped, not asked for again.
    expect(bySubject(w, 'Bill 3').toRecipients).toBeNull();
    const metadata = fetches(google, 'metadata');
    for (const id of ids.slice(0, 3)) expect(metadata.filter(request => request.path.endsWith(id))).toHaveLength(1);
    expect(metadata.every(request => request.query.getAll('metadataHeaders').sort().join() === 'Cc,In-Reply-To,References,Reply-To,To')).toBe(true);
    // Headers only, no AI, nothing sorted again, read state untouched.
    expect(fetches(google, 'raw')).toHaveLength(raw);
    expect(w.store.db.select().from(t.aiUsage).all()).toHaveLength(usage);
    expect(paidJobs(w)).toBe(jobs);
    expect(w.store.db.select({id: t.messages.id, unread: t.messages.unread}).from(t.messages).all()).toEqual(unread);

    // Finished: later syncs ask Gmail for no more headers.
    const asked = fetches(google, 'metadata').length;
    await env.sync();
    expect(fetches(google, 'metadata')).toHaveLength(asked);
  });
});

describe('iCloud', () => {
  const ADDRESS = 'user@icloud.example.com';
  const PASSWORD = 'abcd-efgh-ijkl-mnop';

  async function setup(headerChunk = 100) {
    const w = world();
    const imap = await fakeImap();
    imap.addUser(ADDRESS, PASSWORD);
    const adapter = new ICloudAdapter({endpoint: {host: imap.host, port: imap.port, secure: false}, backfillChunk: 50, headerChunk, connectTimeoutMs: 2000});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({icloud: adapter}), notifier: new Notifier(w.store, {publicUrl: 'https://setpoint.example.com'}), timeoutMs: 3000});
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
    const deliver = (subject: string, at: string, extra: Partial<typeof REPLY> = {}) =>
      imap.deliver(ADDRESS, rawEmail({from: 'Proseware <billing@proseware.example.com>', subject, date: at, text: `${subject}.`, ...extra}), at);
    const connect = async () => {
      expect((await api.send('POST', '/api/accounts/icloud', {body: {address: ADDRESS, app_password: PASSWORD}})).status).toBe(201);
      return w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'icloud')).get()!;
    };
    return {w, imap, api, adapter, drain, poll, deliver, connect};
  }

  test('new mail keeps its recipients and reply headers as it arrives', async () => {
    const env = await setup();
    await env.connect();
    await env.drain();
    env.deliver('Thursday', ago(MINUTE), REPLY);
    await env.poll();
    expect(columns(bySubject(env.w, 'Thursday'))).toEqual(STORED);
    await env.adapter.close();
  });

  test('mail held from before is filled by a header pass, headers only, resuming after a dropped connection and skipping what left the inbox', async () => {
    const env = await setup(2);
    const {w, imap} = env;
    const uids = [0, 1, 2, 3, 4].map(n => env.deliver(`Bill ${n}`, ago((n + 1) * DAY), n === 2 ? REPLY : {}));
    const source = await env.connect();
    await env.drain();
    expect(w.store.db.select().from(t.messages).all()).toHaveLength(5);
    forget(w, source.id);
    const usage = w.store.db.select().from(t.aiUsage).all().length;
    const jobs = paidJobs(w);
    // Rows go oldest id first (the backfill took the newest first: Bill 0, 1, …), two at a time. Bill 1
    // was moved to Archive in Apple Mail, and the second chunk's FETCH loses its connection once.
    imap.move(ADDRESS, uids[1]!, 'Archive');
    const seen = uids.filter(uid => uid !== uids[1]).map(uid => imap.flags(ADDRESS, uid));

    imap.inject(/^UID FETCH 3[,:]4 /, 'drop');
    await env.poll();
    expect(readHeaderBackfill(w.store, source.id)).toMatchObject({done: false, total: 5, read: 1, skipped: 1});
    w.advance(5 * MINUTE);
    await env.drain();
    expect(readHeaderBackfill(w.store, source.id)).toMatchObject({done: true, total: 5, read: 4, skipped: 1});
    expect(columns(bySubject(w, 'Bill 2'))).toEqual(STORED);
    for (const subject of ['Bill 0', 'Bill 3', 'Bill 4']) expect(bySubject(w, subject).toRecipients).toEqual([{name: null, address: 'user@example.net'}]);
    expect(bySubject(w, 'Bill 1').toRecipients).toBeNull();
    // BODY.PEEK leaves \Seen alone; no AI call and nothing sorted again.
    expect(uids.filter(uid => uid !== uids[1]).map(uid => imap.flags(ADDRESS, uid))).toEqual(seen);
    expect(w.store.db.select().from(t.aiUsage).all()).toHaveLength(usage);
    expect(paidJobs(w)).toBe(jobs);
    await env.adapter.close();
  });
});
