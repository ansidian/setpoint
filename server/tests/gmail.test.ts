// The Gmail adapter against a fake Google on 127.0.0.1 (BUILD-PLAN.md › B2 › Done when): Connect
// Gmail, a resumable 365-day backfill with progress, new mail by Pub/Sub pull, read elsewhere, opening
// in Setpoint, Mark all as read in one batchModify, trash with undo, history too old (full resync),
// 429, timeouts, an expired access token and a revoked one; with the counts following the rules.
import {generateKeyPairSync} from 'node:crypto';
import {SEED_NOW} from '@setpoint/shared';
import {and, eq, lte} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {Notifier} from '../src/notify/index.ts';
import {GmailAdapter} from '../src/providers/gmail/adapter.ts';
import type {GmailAdapterOptions} from '../src/providers/gmail/adapter.ts';
import {gmailConnector} from '../src/providers/gmail/connect.ts';
import {decodeNotification, GmailPushPuller} from '../src/providers/gmail/pubsub.ts';
import {historyChanges, stateFromLabels} from '../src/providers/gmail/history.ts';
import {sourceList} from '../src/queries/sources.ts';
import {updateSettings} from '../src/settings.ts';
import {readBackfill, readCursor} from '../src/sync/cursors.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeGoogle} from './fakeGoogle.ts';
import type {FakeGoogle} from './fakeGoogle.ts';
import {fakeNtfy} from './fakeNtfy.ts';
import {client, liveEvents, signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';
import {gmailVerdict, rawEmail} from './rawEmail.ts';

const ADDRESS = 'user.work@example.com';
const TOPIC = 'projects/setpoint-test/topics/gmail';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ago = (ms: number) => new Date(Date.parse(SEED_NOW) - ms).toISOString();

function deliver(google: FakeGoogle, subject: string, at: string, {labels, from = 'Contoso Coffee <news@contosocoffee.example>'}: {labels?: string[]; from?: string} = {}) {
  const domain = from.match(/@([^>]+)/)![1]!;
  return google.deliver(ADDRESS, {raw: rawEmail({from, subject, date: at, text: `${subject}.`, received: gmailVerdict(domain)}), date: at, labels});
}

// The Pub/Sub service account's key, made once for the file: an RSA-2048 key takes a while to make.
const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048, publicKeyEncoding: {type: 'spki', format: 'pem'}, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}});

async function setup(adapterOptions: Partial<GmailAdapterOptions> = {}) {
  const w = world();
  const google = await fakeGoogle({publicKey, clock: () => w.store.now()});
  google.addMailbox(ADDRESS);
  const ntfy = await fakeNtfy();
  updateSettings(w.store, {notifications: {ntfy_server: ntfy.url}});
  const googleClient = {...google.client(), ...adapterOptions.client};
  const adapter = new GmailAdapter({topic: TOPIC, pageSize: 3, backfillPagesPerStep: 1, ...adapterOptions, client: googleClient});
  const engine = new SyncEngine({store: w.store, adapters: new Adapters({gmail: adapter}), notifier: new Notifier(w.store, {publicUrl: 'https://setpoint.example.com'}), timeoutMs: 5000});
  const connectors = {gmail: gmailConnector(w.store, googleClient, true)};
  const api = await signedIn(w, {engine, connectors});
  const puller = new GmailPushPuller({
    store: w.store, endpoints: google.endpoints, onPush: id => engine.pushed(id),
    settings: {topic: TOPIC, subscription: 'projects/setpoint-test/subscriptions/setpoint-v2', serviceAccount: {client_email: 'pull@setpoint-test.iam.example.com', private_key: privateKey}},
  });
  /** Runs the engine until nothing is due now (retries scheduled later wait for the clock). */
  const drain = async () => {
    for (let round = 0; round < 30; round += 1) {
      await engine.tick();
      await engine.settled();
      const now = w.store.now().toISOString();
      const due = w.store.db.select().from(t.jobs).where(and(eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, now))).all();
      if (!due.length) return;
    }
    throw new Error('The engine never went idle.');
  };
  return {w, google, googleClient, ntfy, adapter, engine, api, puller, drain, connectors};
}

/** Connect Gmail through the API: the consent URL, then Google's redirect back without a session cookie. */
async function connect(env: Awaited<ReturnType<typeof setup>>, accountId?: number) {
  const started = await env.api.send('POST', '/api/accounts/gmail/authorize', {body: accountId ? {account_id: accountId} : {}});
  expect(started.status).toBe(200);
  const consent = new URL(started.body.url);
  expect(consent.origin + consent.pathname).toBe(env.google.endpoints.consent);
  expect(consent.searchParams.get('redirect_uri')).toBe('http://localhost/api/ea/accounts/gmail/callback');
  expect(consent.searchParams.get('scope')).toContain('gmail.modify');
  expect(consent.searchParams.get('scope')).toContain('calendar.events');
  const browser = client(env.w, {engine: env.engine, connectors: env.connectors});
  const back = await browser.send('GET', `/api/ea/accounts/gmail/callback?code=${encodeURIComponent(env.google.issueCode(ADDRESS))}&state=${encodeURIComponent(consent.searchParams.get('state')!)}`);
  expect(back.status).toBe(302);
  return back.headers.get('location')!;
}

const gmailSource = (w: World) => w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'gmail')).get()!;
const bySubject = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!;
const rawFetches = (google: FakeGoogle) => google.requests.filter(request => /\/messages\/[^/]+$/.test(request.path) && request.query.get('format') === 'raw').length;

describe('Gmail: a mailbox through backfill, new mail, read state, Mark all as read, trash and a revoked token', () => {
  test('the whole way', async () => {
    const env = await setup();
    const {w, google, api, puller, drain} = env;
    // A year of mail and one older email the backfill leaves out.
    for (let n = 1; n <= 7; n += 1) deliver(google, `Old ${n}`, ago(n * 40 * DAY), {labels: n % 2 ? ['INBOX'] : ['INBOX', 'UNREAD']});
    deliver(google, 'Too old', ago(400 * DAY), {labels: ['INBOX']});

    // Connect Gmail: an account with its Gmail and Calendar sources, credentials stored encrypted.
    const location = await connect(env);
    const account = w.store.db.select().from(t.accounts).get()!;
    expect(location).toBe(`/settings/accounts?connected=${account.id}`);
    expect(account).toMatchObject({provider: 'gmail', address: ADDRESS, label: 'User.work', colour: 'warm'});
    expect(w.store.db.select().from(t.sources).all().map(source => [source.provider, source.syncMode, source.credentials?.startsWith('sp2:')])).toEqual([
      ['gmail', 'push', true], ['google_calendar', 'push', true],
    ]);

    // The backfill's first step: 3 of an estimated 7, then a restart (a new adapter and engine)
    // resumes from the stored page token rather than starting over.
    await env.engine.tick();
    await env.engine.settled();
    const source = gmailSource(w);
    expect(readBackfill(w.store, source.id)).toMatchObject({fetched: 3, total: 7, done: false});
    expect((await api.send('GET', '/api/mail/indexing')).body).toEqual({indexing: {progress: 3 / 7}, accounts: [{account_id: account.id, progress: 3 / 7, done: false}]});
    expect(source.pushRenewsAt).not.toBeNull();
    const restarted = await setupAgain(env);
    await restarted.drain();
    expect(readBackfill(w.store, source.id)).toMatchObject({fetched: 7, total: 7, done: true});
    expect(rawFetches(google)).toBe(7);
    expect((await api.send('GET', '/api/mail/indexing')).body.indexing).toBeNull();
    const backfilled = w.store.db.select().from(t.messages).all();
    expect(backfilled.map(message => message.subject).sort()).toEqual(['Old 1', 'Old 2', 'Old 3', 'Old 4', 'Old 5', 'Old 6', 'Old 7']);
    // B3: history is sorted at once by the rules-only pass, never left Unsorted.
    expect(backfilled.every(message => message.lane !== null && message.triageSource !== null && message.backfill && message.senderAuthenticated === true)).toBe(true);
    expect((await api.send('GET', '/api/mail/counts')).body).toMatchObject({unread: 3, accounts: [{account_id: account.id, unread: 3}]});

    // New mail: Gmail publishes to the topic, the pull queues a sync, the notification is acked,
    // and the email arrives Unsorted with a live event.
    const newId = deliver(google, 'Interview availability', ago(5 * MINUTE), {from: 'Northwind Talent <talent@northwind.example.com>'});
    google.publish(ADDRESS);
    expect(await puller.pullOnce()).toEqual({received: 1, pushed: [source.id]});
    expect(google.pending).toBe(0);
    await drain();
    const fresh = bySubject(w, 'Interview availability');
    expect(fresh).toMatchObject({providerId: newId, lane: null, unread: true, backfill: false, senderAuthenticated: true});
    expect(liveEvents(w).some(event => event.type === 'mail' && event.messages.includes(fresh.id))).toBe(true);
    expect((await api.send('GET', '/api/mail/counts')).body.unread).toBe(4);

    // Read elsewhere (Gmail's app): read here too after the next push.
    const old2 = bySubject(w, 'Old 2');
    google.change(ADDRESS, old2.providerId, [], ['UNREAD']);
    google.publish(ADDRESS);
    await puller.pullOnce();
    await drain();
    expect(bySubject(w, 'Old 2').unread).toBe(false);
    expect((await api.send('GET', '/api/mail/counts')).body.unread).toBe(3);

    // Opening an unread email in Setpoint: the unread count drops at once, and Gmail hears of it.
    // Triage put it in Attention (B3): the pill counts it, read or not, until Done.
    w.store.db.update(t.messages).set({lane: 'attention'}).where(eq(t.messages.id, fresh.id)).run();
    expect((await api.send('GET', '/api/mail/counts')).body).toMatchObject({attention: 1, unread: 3});
    const opened = await api.send('POST', `/api/mail/messages/${fresh.id}/open`);
    expect(opened.body).toMatchObject({unread: false, command: {kind: 'open', state: 'pending', provider: 'gmail'}});
    expect((await api.send('GET', '/api/mail/counts')).body).toMatchObject({attention: 1, unread: 2, accounts: [{unread: 2}]});
    await drain();
    expect(google.labels(ADDRESS, newId)).toEqual(['INBOX']);
    expect((await api.send('GET', `/api/mail/messages/${fresh.id}`)).body.command).toBeNull();
    // Done takes it out of Attention: the pill drops.
    await api.send('POST', `/api/mail/messages/${fresh.id}/done`, {body: {done: true}});
    expect((await api.send('GET', '/api/mail/counts')).body).toMatchObject({attention: 0, unread: 2});

    // Mark all as read: one command and one batchModify for the account, read at once (D84).
    deliver(google, 'Arriving today', ago(3 * MINUTE));
    deliver(google, 'Statement ready', ago(2 * MINUTE));
    google.publish(ADDRESS);
    await puller.pullOnce();
    await drain();
    expect((await api.send('GET', '/api/mail/counts')).body.unread).toBe(4);
    const marked = await api.send('POST', '/api/mail/mark-all-read', {body: {}});
    expect(marked.body.commands).toHaveLength(1);
    expect((await api.send('GET', '/api/mail/counts')).body.unread).toBe(0);
    await drain();
    expect(google.count(/POST \/gmail\/v1\/users\/me\/messages\/batchModify/)).toBe(1);
    const batch = google.requests.find(request => request.path.endsWith('batchModify'))!;
    expect((batch.body as {ids: string[]}).ids).toHaveLength(4);
    expect((await api.send('GET', '/api/mail/counts')).body.unread).toBe(0);
    // Gmail's own history of that change agrees with the record: nothing flips back.
    google.publish(ADDRESS);
    await puller.pullOnce();
    await drain();
    expect(w.store.db.select().from(t.messages).all().filter(message => message.unread)).toEqual([]);

    // Trash and Undo.
    const statement = bySubject(w, 'Statement ready');
    await api.send('POST', `/api/mail/messages/${statement.id}/trash`);
    await drain();
    expect(google.labels(ADDRESS, statement.providerId)).toEqual(['TRASH']);
    await api.send('POST', `/api/mail/messages/${statement.id}/untrash`);
    await drain();
    expect(google.labels(ADDRESS, statement.providerId)).toEqual(['INBOX']);
    google.publish(ADDRESS);
    await puller.pullOnce();
    await drain();
    expect(bySubject(w, 'Statement ready')).toMatchObject({trashedAt: null, archivedAt: null});

    // Revoked: Google refuses the refresh token. Needs reconnect, one ntfy, and no more checks.
    google.revoke(ADDRESS);
    google.publish(ADDRESS);
    await puller.pullOnce();
    await drain();
    const health = sourceList(w.store).find(row => row.id === source.id)!.health;
    expect(health).toMatchObject({state: 'needs_reconnect', reason: 'Google refused Setpoint\'s access: Token has been expired or revoked. (invalid_grant) (400 Bad Request)'});
    expect(env.ntfy.published.map(message => message.body.title)).toEqual(['User.work needs sign-in']);
    const before = google.requests.length;
    w.advance(10 * MINUTE);
    await drain();
    expect(google.requests.length).toBe(before);

    // Reconnect: the same account, new credentials, healthy again.
    expect(await connect(env, account.id)).toBe(`/settings/accounts?connected=${account.id}`);
    await drain();
    expect(sourceList(w.store).find(row => row.id === source.id)!.health.state).toBe('healthy');
    expect(w.store.db.select().from(t.accounts).all()).toHaveLength(1);
  });
});

/** The same database with a fresh adapter and engine, as after a restart. */
async function setupAgain(env: Awaited<ReturnType<typeof setup>>) {
  const adapter = new GmailAdapter({client: env.google.client(), topic: TOPIC, pageSize: 3, backfillPagesPerStep: 1});
  const engine = new SyncEngine({store: env.w.store, adapters: new Adapters({gmail: adapter}), timeoutMs: 5000});
  return {
    drain: async () => {
      for (let round = 0; round < 30; round += 1) {
        await engine.tick();
        await engine.settled();
        if (!env.w.store.db.select().from(t.jobs).where(and(eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, env.w.store.now().toISOString()))).all().length) return;
      }
    },
  };
}

describe('Gmail: recovery and Google\'s errors', () => {
  async function connected(adapterOptions: Partial<GmailAdapterOptions> = {}) {
    const env = await setup({pageSize: 50, ...adapterOptions});
    deliver(env.google, 'Welcome', ago(2 * DAY));
    await connect(env);
    await env.drain();
    return env;
  }

  test('history too old (404): a full resync with a fresh cursor, the backfill again and every difference repaired', async () => {
    const env = await connected();
    const {w, google} = env;
    const source = gmailSource(w);
    const welcome = bySubject(w, 'Welcome');
    google.change(ADDRESS, welcome.providerId, [], ['UNREAD', 'INBOX']);
    deliver(google, 'Missed while away', ago(DAY));
    google.forgetHistory(ADDRESS);
    w.advance(5 * MINUTE);
    await env.drain();
    expect(readCursor(w.store, source.id)).toBe(String(google.mailboxes.get(ADDRESS)!.historyId));
    expect(bySubject(w, 'Welcome')).toMatchObject({unread: false});
    expect(bySubject(w, 'Welcome').archivedAt).not.toBeNull();
    expect(bySubject(w, 'Missed while away')).toMatchObject({unread: true, backfill: true});
    expect(readBackfill(w.store, source.id)).toMatchObject({done: true});
    expect(sourceList(w.store).find(row => row.id === source.id)!.health.state).toBe('healthy');
  });

  test('the sweep repairs what a missed push left, without history', async () => {
    const env = await connected();
    const {w, google} = env;
    const welcome = bySubject(w, 'Welcome');
    // Changed at Gmail with no history and no push (as if both were lost).
    google.mailboxes.get(ADDRESS)!.messages.get(welcome.providerId)!.labels.delete('UNREAD');
    w.advance(5 * MINUTE);
    await env.drain();
    expect(bySubject(w, 'Welcome').unread).toBe(false);
  });

  test('deleted for good at Gmail: gone from the record', async () => {
    const env = await connected();
    const {w, google, puller} = env;
    google.deleteForever(ADDRESS, bySubject(w, 'Welcome').providerId);
    google.publish(ADDRESS);
    await puller.pullOnce();
    await env.drain();
    expect(w.store.db.select().from(t.messages).all()).toEqual([]);
  });

  test('429 with Retry-After: failing, retried no sooner than Gmail asked, then healthy', async () => {
    const env = await connected();
    const {w, google, engine} = env;
    const source = gmailSource(w);
    w.advance(MINUTE);
    google.inject(/GET \/gmail\/v1\/users\/me\/history/, {status: 429, headers: {'retry-after': '120'}, body: {error: {code: 429, message: 'Too many concurrent requests for user.', errors: [{reason: 'rateLimitExceeded'}]}}});
    engine.pushed(source.id);
    await env.drain();
    expect(sourceList(w.store).find(row => row.id === source.id)!.health).toMatchObject({state: 'failing', reason: 'Too many concurrent requests for user. (429 Too Many Requests)'});
    const job = w.store.db.select().from(t.jobs).where(eq(t.jobs.key, `sync:${source.id}`)).all().at(-1)!;
    expect(Date.parse(job.runAt) - w.store.now().getTime()).toBe(120_000);
    w.advance(120_000);
    await env.drain();
    expect(sourceList(w.store).find(row => row.id === source.id)!.health.state).toBe('healthy');
  });

  test('a 500 and a timeout are transient failures, with Google\'s words or the timeout\'s', async () => {
    const env = await connected();
    const {w, google, googleClient, engine} = env;
    const source = gmailSource(w);
    w.advance(MINUTE);
    google.inject(/GET \/gmail\/v1\/users\/me\/history/, {status: 500, body: {error: {code: 500, message: 'Backend Error'}}});
    engine.pushed(source.id);
    await env.drain();
    expect(sourceList(w.store).find(row => row.id === source.id)!.health).toMatchObject({state: 'failing', reason: 'Backend Error (500 Internal Server Error)'});
    // A short request limit for the hung history call only: connecting and the backfill take what they take.
    const limit = googleClient.requestTimeoutMs;
    googleClient.requestTimeoutMs = 200;
    google.inject(/GET \/gmail\/v1\/users\/me\/history/, 'hang');
    w.advance(30_000);
    await env.drain();
    expect(sourceList(w.store).find(row => row.id === source.id)!.health).toMatchObject({state: 'failing', reason: 'The provider didn\'t answer in time.'});
    googleClient.requestTimeoutMs = limit;
    w.advance(60_000);
    await env.drain();
    expect(sourceList(w.store).find(row => row.id === source.id)!.health.state).toBe('healthy');
  });

  test('an access token Google stopped taking early is refreshed once and the request retried', async () => {
    const env = await connected();
    const {w, google, engine} = env;
    const source = gmailSource(w);
    google.expireAccessTokens();
    const refreshes = google.count(/POST \/token/);
    deliver(google, 'After expiry', ago(MINUTE));
    engine.pushed(source.id);
    await env.drain();
    expect(google.count(/POST \/token/)).toBe(refreshes + 1);
    expect(bySubject(w, 'After expiry')).toBeDefined();
    expect(sourceList(w.store).find(row => row.id === source.id)!.health.state).toBe('healthy');
  });

  test('a change Gmail refuses fails in place with Gmail\'s words, and Try again sends it', async () => {
    const env = await connected();
    const {w, google, api} = env;
    const welcome = bySubject(w, 'Welcome');
    google.inject(/POST \/gmail\/v1\/users\/me\/messages\/[^/]+\/trash/, {status: 400, body: {error: {code: 400, message: 'Invalid id value'}}});
    const trashed = await api.send('POST', `/api/mail/messages/${welcome.id}/trash`);
    await env.drain();
    const failed = (await api.send('GET', `/api/mail/messages/${welcome.id}`)).body;
    expect(failed.command).toMatchObject({state: 'failed', provider_message: 'Invalid id value (400 Bad Request)', can_retry: true});
    // Failed in place: still in the Inbox.
    expect((await api.send('GET', '/api/mail/inbox')).body.groups.flatMap((group: {rows: {id: number}[]}) => group.rows.map(row => row.id))).toContain(welcome.id);
    await api.send('POST', `/api/commands/${trashed.body.id}/retry`);
    await env.drain();
    expect(google.labels(ADDRESS, welcome.providerId)).toEqual(['TRASH', 'UNREAD']);
  });

  test('Connect Gmail refuses a forged or expired state, and a reconnect as another account', async () => {
    const env = await setup();
    const browser = client(env.w, {connectors: env.connectors});
    const forged = await browser.send('GET', `/api/ea/accounts/gmail/callback?code=${env.google.issueCode(ADDRESS)}&state=forged`);
    expect(forged.headers.get('location')).toBe('/settings/accounts?error=bad_state');
    const started = await env.api.send('POST', '/api/accounts/gmail/authorize', {body: {}});
    const state = new URL(started.body.url).searchParams.get('state')!;
    env.w.advance(11 * MINUTE);
    const late = await browser.send('GET', `/api/ea/accounts/gmail/callback?code=${env.google.issueCode(ADDRESS)}&state=${encodeURIComponent(state)}`);
    expect(late.headers.get('location')).toBe('/settings/accounts?error=expired_state');
    expect(env.w.store.db.select().from(t.accounts).all()).toEqual([]);
    await connect(env);
    const account = env.w.store.db.select().from(t.accounts).get()!;
    env.google.addMailbox('someone.else@example.com');
    const reconnect = await env.api.send('POST', '/api/accounts/gmail/authorize', {body: {account_id: account.id}});
    expect(new URL(reconnect.body.url).searchParams.get('login_hint')).toBe(ADDRESS);
    const wrong = await browser.send('GET', `/api/ea/accounts/gmail/callback?code=${env.google.issueCode('someone.else@example.com')}&state=${encodeURIComponent(new URL(reconnect.body.url).searchParams.get('state')!)}`);
    expect(wrong.headers.get('location')).toBe('/settings/accounts?error=wrong_account');
  });

  test('without a Google client the routes say so', async () => {
    const w = world();
    const api = await signedIn(w);
    expect((await api.send('POST', '/api/accounts/gmail/authorize', {body: {}})).body.error.code).toBe('google_not_configured');
    expect((await client(w).send('GET', '/api/ea/accounts/gmail/callback?code=x&state=y')).headers.get('location')).toBe('/settings/accounts?error=google_not_configured');
  });
});

describe('Gmail: when an email was received', () => {
  // A Received header's date as Gmail writes it, in Pacific time with the zone's comment.
  const pacific = (at: string) => new Date(Date.parse(at) - 7 * 60 * MINUTE).toUTCString().replace('GMT', '-0700 (PDT)');

  test('when Gmail received it, by its own Received header, not the Date header a held email carries', async () => {
    const env = await setup({pageSize: 50});
    const {w, google} = env;
    await connect(env);
    await env.drain();
    // The sender wrote it five hours ago, and its mail service held it until a minute ago. Gmail's
    // internalDate follows the Date header, so the fake's does too.
    const written = ago(5 * 60 * MINUTE);
    const arrived = ago(MINUTE);
    const held = (subject: string, received: [string, string][]) => google.deliver(ADDRESS, {
      date: written,
      raw: rawEmail({from: 'Fabrikam Water <no-reply@fabrikam.example.com>', subject, date: written, received: [...received, ...gmailVerdict('fabrikam.example.com')]}),
    });
    held('Invoice held by its sender', [
      ['Received', `by 2002:a05:6638:ad52:b0:616:c4f4:7466 with SMTP id ly18csp507574jab;\r\n        ${pacific(arrived)}`],
      ['X-Received', `by 2002:a05:622a:1ba1:b0:535:70b4:3f82 with SMTP id d75a77b69052e;\r\n        ${pacific(ago(30 * MINUTE))}`],
      ['Received', `from mail.fabrikam.example.com by mx.google.com with ESMTPS id d75a77b6;\r\n        ${pacific(arrived)}`],
      ['Received', `from app.fabrikam.example.com by mail.fabrikam.example.com with SMTP id 6aca2a31; ${new Date(written).toUTCString()}`],
    ]);
    // Without a Received header (sent from Gmail itself), or with one Setpoint can't read, internalDate stands.
    held('Sent from Gmail', []);
    held('Unreadable Received', [['Received', 'by 2002:a05:6638:ad52 with SMTP id ly18csp507574jab; sometime today']]);
    google.publish(ADDRESS);
    await env.puller.pullOnce();
    await env.drain();
    expect(bySubject(w, 'Invoice held by its sender').receivedAt).toBe(arrived);
    expect(bySubject(w, 'Sent from Gmail').receivedAt).toBe(written);
    expect(bySubject(w, 'Unreadable Received').receivedAt).toBe(written);
  });
});

describe('Gmail: an attachment for the reader\'s preview', () => {
  test('served through the adapter from the message\'s source, by the part the sync named', async () => {
    const env = await setup({pageSize: 50});
    const {w, google, api} = env;
    google.deliver(ADDRESS, {raw: rawEmail({
      from: 'Woodgrove Bank <alerts@woodgrovebank.example.com>', subject: 'Statement ready', date: ago(DAY), text: 'Attached.', received: gmailVerdict('woodgrovebank.example.com'),
      attachments: [
      {filename: 'Statement Oct.csv', contentType: 'text/csv', content: 'Date,Amount\r\n2026-10-01,42.00\r\n'},
      {filename: 'logo.png', contentType: 'image/png', content: 'not shown', inline: true},
      {filename: 'notes.html', contentType: 'text/html', content: '<script>alert(1)</script>'},
    ],
    }), date: ago(DAY), labels: ['INBOX']});
    await connect(env);
    await env.drain();
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

    // Gmail no longer has the email: not found, in Setpoint's words.
    google.deleteForever(ADDRESS, message.providerId);
    const gone = await api.send('GET', `/api/mail/messages/${message.id}/attachments/${row[0]!.id}`);
    expect(gone.status).toBe(404);
  });
});

describe('Gmail push: Pub/Sub pull', () => {
  test('acks only after the sync is queued; drops what can\'t be processed; one sync per account per pull', async () => {
    const env = await setup();
    await connect(env);
    const {google, puller} = env;
    google.publish(ADDRESS);
    google.publish(ADDRESS);
    google.publishRaw(Buffer.from(JSON.stringify({emailAddress: 'nobody@example.com', historyId: 5})).toString('base64'));
    google.publishRaw(Buffer.from('not json').toString('base64'));
    const source = gmailSource(env.w);
    expect(await puller.pullOnce()).toEqual({received: 4, pushed: [source.id]});
    expect(google.pending).toBe(0);
    expect(env.w.store.db.select().from(t.jobs).where(eq(t.jobs.key, `sync:${source.id}`)).all()).toHaveLength(1);
  });

  test('a notification whose sync couldn\'t be queued is left for Pub/Sub to deliver again', async () => {
    const env = await setup();
    await connect(env);
    const failing = new GmailPushPuller({
      store: env.w.store, endpoints: env.google.endpoints, onPush: () => {
        throw new Error('database is locked');
      },
      settings: {topic: TOPIC, subscription: 'projects/setpoint-test/subscriptions/setpoint-v2', serviceAccount: (env.puller as unknown as {options: {settings: {serviceAccount: never}}}).options.settings.serviceAccount},
    });
    env.google.publish(ADDRESS);
    await failing.pullOnce();
    expect(env.google.pending).toBe(1);
    expect(failing.lastError).toBe('database is locked');
  });

  test('a service account with the wrong key is refused by Google', async () => {
    const env = await setup();
    const {privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048, privateKeyEncoding: {type: 'pkcs8', format: 'pem'}, publicKeyEncoding: {type: 'spki', format: 'pem'}});
    const stranger = new GmailPushPuller({
      store: env.w.store, endpoints: env.google.endpoints, onPush: () => {},
      settings: {topic: TOPIC, subscription: 'projects/setpoint-test/subscriptions/setpoint-v2', serviceAccount: {client_email: 'x@example.com', private_key: privateKey}},
    });
    await expect(stranger.pullOnce()).rejects.toThrow('Invalid JWT Signature. (invalid_grant)');
  });

  test.each([
    [Buffer.from(JSON.stringify({emailAddress: ' User.Work@Example.com ', historyId: 9})).toString('base64'), {emailAddress: 'user.work@example.com', historyId: '9'}],
    [Buffer.from(JSON.stringify({emailAddress: 'a@example.com'})).toString('base64'), null],
    [Buffer.from('{').toString('base64'), null],
    [undefined, null],
  ])('decodes Gmail\'s notification %#', (data, expected) => {
    expect(decodeNotification(data)).toEqual(expected);
  });
});

describe('Gmail history records', () => {
  test('what arrived in the inbox and what changed', () => {
    const message = (id: string, labelIds?: string[]) => ({message: {id, ...(labelIds ? {labelIds} : {})}});
    expect(historyChanges([
      {messagesAdded: [message('new', ['INBOX', 'UNREAD']), message('sent', ['SENT'])]},
      {labelsAdded: [{...message('back'), labelIds: ['INBOX']}, {...message('starred'), labelIds: ['STARRED']}]},
      // v1: an event without its own labelIds carries the message's.
      {labelsRemoved: [message('read', ['UNREAD']), {...message('archived'), labelIds: ['INBOX']}]},
      {labelsAdded: [{...message('trashed'), labelIds: ['TRASH']}]},
      {messagesDeleted: [message('gone')]},
    ])).toEqual({arrived: new Set(['new', 'back']), changed: new Set(['back', 'read', 'archived', 'trashed', 'gone'])});
  });

  test.each([
    [['INBOX', 'UNREAD'], {unread: true, trashed: false, archived: false}],
    [['INBOX'], {unread: false, trashed: false, archived: false}],
    [['UNREAD'], {unread: true, trashed: false, archived: true}],
    [['TRASH', 'UNREAD'], {unread: true, trashed: true, archived: false}],
    [['INBOX', 'SPAM'], {unread: false, trashed: false, archived: true}],
  ])('labels %j are %j', (labels, state) => {
    expect(stateFromLabels(labels)).toEqual(state);
  });
});
