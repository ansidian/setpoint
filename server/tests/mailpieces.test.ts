// SV-274 (D564): USPS Informed Delivery's digest. Its rules as tables; its scans read from an
// invented digest's source (src/dev/digest.ts), ads left out; the mirror keeping it out of triage,
// the Inbox, All and Mark all as read; the worker keeping each day's scans 30 days, fetching the
// source through a stand-in for the adapter; and the routes the agenda rail reads.
import {readFileSync} from 'node:fs';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {markAllRead} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {DEV_DIGEST_AUTH, DEV_DIGESTS, devDigestSource, devDigestSubject} from '../src/dev/digest.ts';
import {campaignCount, DIGEST_SENDER, digestDay, isDigest, pieceSources, statedPieces} from '../src/domain/mailpieces.ts';
import {evaluateGmailSenderAuthentication} from '../src/domain/senderAuthentication.ts';
import type {SenderAuthentication} from '../src/domain/senderAuthentication.ts';
import {firstKeptDay, MailpiecesWorker, pruneMailpieces, queueMailpieces} from '../src/mailpieces/worker.ts';
import {readDigest} from '../src/providers/mime.ts';
import {allMail, inbox} from '../src/queries/mail.ts';
import {claimDueJobs} from '../src/sync/jobs.ts';
import {mailpiecesKey, upsertMessages} from '../src/sync/mailMirror.ts';
import type {FetchedMessage} from '../src/sync/mailMirror.ts';
import {client, liveEvents, signedIn, world} from './helpers.ts';

// Gmail's verdict on a real digest's headers, through the evaluator: its DMARC result names usps.com,
// the parent of the From domain, which an invented exact-match verdict had hidden.
const PASS = evaluateGmailSenderAuthentication(DEV_DIGEST_AUTH, DIGEST_SENDER, new Date('2026-10-07T16:00:00.000Z'));

const digestEmail = (day: string, overrides: Partial<FetchedMessage> = {}): FetchedMessage => ({
  providerId: `digest-${day}`, threadId: `digest-${day}`, rfc822Id: null, fromName: 'USPS Informed Delivery', fromAddress: DIGEST_SENDER,
  subject: devDigestSubject(day), snippet: 'You have 3 mailpiece(s)', bodyText: 'You have 3 mailpiece(s)', bodyHtml: null,
  receivedAt: '2026-10-07T14:30:00.000Z', senderAuth: PASS, attachments: [], unread: true, trashed: false, archived: false, ...overrides,
});

describe('the digest\'s rules', () => {
  test.each([
    ['USPS\'s sender, authenticated, the digest\'s subject', DIGEST_SENDER, 'Your Daily Digest for Thu, 11/12 is ready to view', true, true],
    ['the sender in capitals, as USPS writes it', 'USPSInformeddelivery@email.informeddelivery.usps.com', 'Your Daily Digest for Thu, 11/12 is ready to view', true, true],
    ['not authenticated: someone else claiming to be USPS', DIGEST_SENDER, 'Your Daily Digest for Thu, 11/12 is ready to view', null, false],
    ['authentication failed', DIGEST_SENDER, 'Your Daily Digest for Thu, 11/12 is ready to view', false, false],
    ['USPS\'s other mail', DIGEST_SENDER, 'Your package has been delivered', true, false],
    ['another sender with the digest\'s subject', 'news@usps.example', 'Your Daily Digest for Thu, 11/12 is ready to view', true, false],
  ])('%s', (_name, fromAddress, subject, senderAuthenticated, expected) => {
    expect(isDigest({fromAddress, subject, senderAuthenticated})).toBe(expected);
  });

  test.each([
    ['Your Daily Digest for Thu, 11/12 is ready to view', '2026-11-12', '2026-11-12'],
    ['Your Daily Digest for Sat, 10/3 is ready to view', '2026-10-03', '2026-10-03'],
    ['Your Daily Digest for Thu, 12/31 is ready to view', '2027-01-01', '2026-12-31'],
    ['Your Daily Digest for Fri, 1/1 is ready to view', '2026-12-31', '2027-01-01'],
    ['Your package is on its way', '2026-11-12', null],
    ['Your Daily Digest for Thu, 13/40 is ready to view', '2026-11-12', null],
  ])('the day of "%s", arriving %s, is %s', (subject, received, expected) => {
    expect(digestDay(subject, received)).toBe(expected);
  });

  test.each([
    ['Hi! You have 6 mailpiece(s) and 0 inbound package(s) arriving soon.', 6],
    ['You\n      have   0\n mailpiece(s)', 0],
    ['You have 1 inbound package(s) arriving soon.', null],
  ])('"%s" says %s are coming', (text, expected) => {
    expect(statedPieces(text)).toBe(expected);
  });

  test('the mailpieces\' scans in order, each once: never a mailer\'s campaign (D572), ride-along ads, logos or pixels', () => {
    const html = [
      '<img id="email-tracking-href-id" height="0" width="0" src="https://informeddelivery.example/pixel">',
      '<img src="https://www.usps.example/logo.png" alt="USPS Logo">',
      '<img id="campaign-representative-image-src-id" alt="campaign" src="cid:mailer-1.jpg">',
      '<img id="campaign-ridealong-image-src-id" src="cid:content-1.jpg" alt="RideAlong image">',
      '<img id="campaign-ridealong-image-src-id-secondary" src="cid:content-1.jpg" alt="RideAlong">',
      '<img id="mailpiece-image-src-id" style="padding-top:15px;" src="cid:100-038.jpg" alt="Mailpiece Image">',
      '<IMG ID=\'mailpiece-image-src-id\' SRC=\'cid:101-038.jpg\'>',
      '<img id="mailpiece-image-src-id" src="cid:100-038.jpg">',
      '<img id="mailpiece-image-src-id" src="https://informeddelivery.example/remote.jpg">',
    ].join('\n');
    expect(pieceSources(html)).toEqual(['100-038.jpg', '101-038.jpg']);
    expect(campaignCount(html)).toBe(1);
  });
});

describe('reading a digest\'s source', () => {
  test('the scans alone, in order: a mailer\'s campaign is neither kept nor counted, nor its ride-along ad (D572)', async () => {
    const digest = await readDigest(devDigestSource({day: '2026-10-03', scans: 3, campaigns: 1, seed: 5}));
    expect(digest.pieces).toBe(3);
    expect(digest.scans).toHaveLength(3);
    expect(digest.scans.every(scan => scan.mimeType === 'image/png' && scan.content.subarray(1, 4).toString() === 'PNG')).toBe(true);
    // A digest of campaigns alone says 1 mailpiece and is no mail.
    expect(await readDigest(devDigestSource({day: '2026-10-03', scans: 0, campaigns: 1, seed: 5}))).toEqual({pieces: 0, scans: []});
  });

  test('a piece USPS has no picture of counts, without a scan; "0 mailpiece(s)" is no mail', async () => {
    expect(await readDigest(devDigestSource({day: '2026-10-01', scans: 2, withoutImage: 1}))).toMatchObject({pieces: 3, scans: [{}, {}]});
    expect(await readDigest(devDigestSource({day: '2026-10-05', scans: 0}))).toEqual({pieces: 0, scans: []});
  });
});

describe('the mirror', () => {
  test('a new digest is sorted as it arrives, never triaged, and its scans are queued', () => {
    const w = world({seed: true});
    const account = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Personal')).get()!.id;
    const [id] = upsertMessages(w.store, account, [digestEmail('2026-10-08')]).inserted;
    const row = w.store.db.select().from(t.messages).where(eq(t.messages.id, id!)).get()!;
    expect(row).toMatchObject({uspsDigest: true, lane: 'fyi', kind: 'deliveries', triageSource: 'rule'});
    const jobs = w.store.db.select().from(t.jobs).where(eq(t.jobs.messageId, id!)).all();
    expect(jobs.map(job => [job.kind, job.key])).toEqual([['mailpieces', mailpiecesKey(id!)]]);
  });

  test('an unauthenticated "digest" is ordinary mail, triaged', () => {
    const w = world({seed: true});
    const account = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Personal')).get()!.id;
    const [id] = upsertMessages(w.store, account, [digestEmail('2026-10-08', {senderAuth: null})]).inserted;
    expect(w.store.db.select().from(t.messages).where(eq(t.messages.id, id!)).get()).toMatchObject({uspsDigest: false, lane: null});
    expect(w.store.db.select().from(t.jobs).where(eq(t.jobs.messageId, id!)).all().map(job => job.kind)).toEqual(['triage']);
  });

  test('the digest is out of the Inbox, its counts, All and Mark all as read', () => {
    const w = world({seed: true});
    const account = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Personal')).get()!.id;
    const before = inbox(w.store);
    const [id] = upsertMessages(w.store, account, [digestEmail('2026-10-08')]).inserted;
    const after = inbox(w.store);
    expect(after.counts).toEqual(before.counts);
    expect(after.groups.flatMap(group => group.rows.map(row => row.id))).not.toContain(id);
    expect(allMail(w.store, {limit: 500}).days.flatMap(day => day.rows.map(row => row.id))).not.toContain(id);
    // The seed's digests too.
    expect(allMail(w.store, {limit: 500}).days.flatMap(day => day.rows.map(row => row.subject))).not.toContainEqual(expect.stringContaining('Daily Digest'));
    const commands = markAllRead(w.store, account);
    expect(commands.flatMap(command => (command.payload.message_ids ?? []) as number[])).not.toContain(id);
    expect(w.store.db.select().from(t.messages).where(eq(t.messages.id, id!)).get()!.unread).toBe(true);
  });
});

describe('the worker', () => {
  function setup(source: (providerId: string) => Promise<Buffer | null> = async providerId => {
    const day = providerId.replace('digest-', '');
    return devDigestSource({day, scans: 2, campaigns: 1});
  }) {
    const w = world({seed: true});
    const account = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Personal')).get()!.id;
    const asked: string[] = [];
    const worker = new MailpiecesWorker({store: w.store, fetchSource: async (_sourceId, message) => {
      asked.push(message.providerId);
      return source(message.providerId);
    }});
    const runDue = async () => {
      for (const job of claimDueJobs(w.store, new Set()).filter(job => job.kind === 'mailpieces')) await worker.run(job);
    };
    const deliver = (day: string, overrides: Partial<FetchedMessage> = {}) => upsertMessages(w.store, account, [digestEmail(day, overrides)]).inserted[0]!;
    const digestOf = (id: number) => w.store.db.select().from(t.mailDigests).where(eq(t.mailDigests.messageId, id)).get();
    const scansOf = (digestId: number) => w.store.db.select().from(t.mailScans).where(eq(t.mailScans.digestId, digestId)).all();
    const jobOf = (id: number) => w.store.db.select().from(t.jobs).where(eq(t.jobs.messageId, id)).all().at(-1)!;
    return {w, worker, asked, runDue, deliver, digestOf, scansOf, jobOf};
  }

  test('keeps the day\'s count and scans, in order, from the source fetched again, once', async () => {
    const {w, asked, runDue, deliver, digestOf, scansOf, jobOf} = setup();
    const id = deliver('2026-10-08');
    w.events.length = 0;
    await runDue();
    const digest = digestOf(id)!;
    // Two scans; the source's campaign is neither kept nor counted (D572).
    expect(digest).toMatchObject({day: '2026-10-08', pieces: 2});
    expect(scansOf(digest.id).map(scan => scan.position)).toEqual([0, 1]);
    expect(jobOf(id).state).toBe('done');
    expect(liveEvents(w)).toContainEqual(expect.objectContaining({type: 'mail', messages: [id]}));
    // Queued again (a resync), it reads nothing twice.
    queueMailpieces(w.store);
    await runDue();
    expect(asked).toEqual(['digest-2026-10-08']);
  });

  test('a digest the provider no longer has gets no day; one that fails is retried', async () => {
    const gone = setup(async () => null);
    const id = gone.deliver('2026-10-08');
    await gone.runDue();
    expect(gone.digestOf(id)).toBeUndefined();
    expect(gone.jobOf(id).state).toBe('done');

    const failing = setup(async () => {
      throw new Error('socket hang up');
    });
    const other = failing.deliver('2026-10-08');
    await failing.runDue();
    expect(failing.digestOf(other)).toBeUndefined();
    expect(failing.jobOf(other)).toMatchObject({state: 'queued', lastError: expect.stringContaining('socket hang up')});
  });

  test('a digest older than the 30 days kept is never fetched', async () => {
    const {asked, runDue, deliver, digestOf} = setup();
    const id = deliver('2026-09-01', {receivedAt: '2026-09-01T14:30:00.000Z'});
    await runDue();
    expect(asked).toEqual([]);
    expect(digestOf(id)).toBeUndefined();
  });

  test('digests already mirrored without a day are queued; days older than 30 go with their scans', async () => {
    const {w, runDue, deliver, digestOf} = setup();
    const id = deliver('2026-10-06');
    w.store.db.delete(t.jobs).run();
    expect(queueMailpieces(w.store)).toBe(1);
    await runDue();
    expect(digestOf(id)?.day).toBe('2026-10-06');

    expect(firstKeptDay(w.store)).toBe('2026-09-08');
    const kept = w.store.db.select().from(t.mailDigests).all().length;
    // Thirty days after the seed's first digest (Sep 30) it's the oldest kept no more.
    w.at('2026-10-30T16:00:00.000Z');
    expect(pruneMailpieces(w.store)).toBe(1);
    expect(w.store.db.select().from(t.mailDigests).all()).toHaveLength(kept - 1);
    expect(w.store.db.select().from(t.mailDigests).where(eq(t.mailDigests.day, '2026-09-30')).all()).toEqual([]);
    expect(w.store.db.select({n: t.mailScans.id}).from(t.mailScans).innerJoin(t.mailDigests, eq(t.mailDigests.id, t.mailScans.digestId)).all().length)
      .toBe(w.store.db.select().from(t.mailScans).all().length);
  });
});

describe('GET /api/mail/mailpieces', () => {
  test('a day\'s count and scans in order; null on a day with no digest; 0 on one with no mail', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const saturday = DEV_DIGESTS.find(digest => digest.day === '2026-10-03')!;
    const got = await c.send('GET', '/api/mail/mailpieces?day=2026-10-03');
    expect(got.status).toBe(200);
    expect(got.body.digest.pieces).toBe(saturday.scans);
    expect(got.body.digest.scans).toHaveLength(saturday.scans);
    expect((await c.send('GET', '/api/mail/mailpieces?day=2026-10-04')).body).toEqual({day: '2026-10-04', digest: null});
    expect((await c.send('GET', '/api/mail/mailpieces?day=2026-10-05')).body).toEqual({day: '2026-10-05', digest: {pieces: 0, scans: []}});
    expect((await c.send('GET', '/api/mail/mailpieces?day=Oct-3')).status).toBe(400);
  });

  test('a scan\'s picture, kept by the browser, and nothing else served from it', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const [first] = (await c.send('GET', '/api/mail/mailpieces?day=2026-10-07')).body.digest.scans;
    const app = c.app;
    const response = await app.request(first.url, {headers: {cookie: c.cookie!}});
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('private');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    expect(Buffer.from(await response.arrayBuffer()).subarray(1, 4).toString()).toBe('PNG');
    expect((await c.send('GET', '/api/mail/mailpieces/scans/999999')).status).toBe(404);
  });

  test('signed out is refused', async () => {
    const w = world({seed: true});
    await signedIn(w);
    expect((await client(w).send('GET', '/api/mail/mailpieces?day=2026-10-07')).status).toBe(401);
  });
});

// 0041 puts right the verdicts stored before the evaluator took a parent DMARC domain: a subdomain
// sender's DMARC pass, stored as a fail, passes, and a real digest among them leaves the Inbox.
describe('migration 0041', () => {
  const sql = readFileSync(new URL('../drizzle/0041_sender_auth_parent_dmarc.sql', import.meta.url), 'utf8');
  const stale = (dmarc: {result: string; domain: string}) => ({
    version: 1, status: 'fail', provider: 'gmail', source: 'gmail_authentication_results', headerFromDomain: dmarc.domain,
    dkim: [], spf: null, dmarc: {...dmarc, aligned: false}, evaluatedAt: '2026-10-07T16:00:00.000Z',
  }) as SenderAuthentication;

  test('passes a stored parent-domain DMARC pass, and only that', () => {
    const w = world({seed: true});
    const account = w.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Personal')).get()!.id;
    const rows = [
      [DIGEST_SENDER, 'Your Daily Digest for Thu, 11/12 is ready to view', {result: 'pass', domain: 'usps.com'}],
      ['alerts@info6.citi.com', 'Your statement', {result: 'pass', domain: 'citi.com'}],
      ['notice@evilusps.com', 'Your Daily Digest for Thu, 11/12 is ready to view', {result: 'pass', domain: 'usps.com'}],
      ['notice@email.example.com', 'Hello', {result: 'fail', domain: 'example.com'}],
    ] as const;
    const ids = rows.map(([from, subject, dmarc], index) => upsertMessages(w.store, account, [digestEmail(`2026-10-0${index + 1}`, {
      providerId: `stale-${index}`, fromAddress: from, subject, senderAuth: stale(dmarc),
    })]).inserted[0]!);
    for (const statement of sql.split('--> statement-breakpoint')) w.store.sqlite.exec(statement);
    const after = ids.map(id => w.store.db.select().from(t.messages).where(eq(t.messages.id, id)).get()!);
    expect(after.map(row => [row.senderAuthenticated, row.senderAuth?.status, row.senderAuth?.dmarc?.aligned, row.uspsDigest]))
      .toEqual([[true, 'pass', true, true], [true, 'pass', true, false], [false, 'fail', false, false], [false, 'fail', false, false]]);
  });
});

// 0042 drops the days kept before D572 so the worker reads them again without campaigns.
describe('migration 0042', () => {
  test('the kept days go, with their scans, and every digest is queued to be read again', async () => {
    const w = world({seed: true});
    expect(w.store.db.select().from(t.mailDigests).all().length).toBeGreaterThan(0);
    const sql = readFileSync(new URL('../drizzle/0042_mailpieces_without_campaigns.sql', import.meta.url), 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) w.store.sqlite.exec(statement);
    expect([w.store.db.select().from(t.mailDigests).all(), w.store.db.select().from(t.mailScans).all()]).toEqual([[], []]);
    const digests = w.store.db.select({id: t.messages.id, receivedAt: t.messages.receivedAt}).from(t.messages).where(eq(t.messages.uspsDigest, true)).all();
    const since = w.store.now().getTime() - 31 * 86_400_000;
    expect(queueMailpieces(w.store)).toBe(digests.filter(digest => Date.parse(digest.receivedAt) >= since).length);
  });
});
