// Sent mail in the record: a fact on the row (`sent`), with mail the user sent to others only
// (`received` false) kept out of triage, the history pass, search terms, Jobs, the Inbox and its
// counts, All, the mail day, Home Assistant, Mark all as read and ntfy, and out of search unless the
// caller asks. The providers' side is in gmailSent.test.ts and icloudSent.test.ts, Jobs' in
// src/jobs/tests/sentMail.test.ts.
import {searchInput} from '@setpoint/shared';
import type {SearchInput} from '@setpoint/shared';
import {eq, inArray} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import {markAllRead} from '../src/commands/mail.ts';
import * as t from '../src/db/schema.ts';
import {Notifier} from '../src/notify/index.ts';
import {allMail, inbox, mailCounts, mailDayOf} from '../src/queries/mail.ts';
import {haStatus} from '../src/queries/status.ts';
import {searchMail} from '../src/search/search.ts';
import {queueSearchTerms, startSearchTermsPass} from '../src/search/terms.ts';
import {setSecret} from '../src/secrets/store.ts';
import {updateSettings} from '../src/settings.ts';
import {upsertMessages} from '../src/sync/mailMirror.ts';
import type {FetchedMessage} from '../src/sync/mailMirror.ts';
import {unsortedCount} from '../src/triage/health.ts';
import {historyProgress} from '../src/triage/history.ts';
import {resortUnsorted, sortHistory} from '../src/triage/intake.ts';
import {rereadCodes} from '../src/triage/codes.ts';
import {createRule} from '../src/triage/learning.ts';
import {RuleTrashScheduler} from '../src/triage/ruleTrash.ts';
import {FAKE_KEYS, fakeModels} from './fakeModels.ts';
import type {FakeAnswer} from './fakeModels.ts';
import {fakeNtfy} from './fakeNtfy.ts';
import {signedIn, world as plainWorld} from './helpers.ts';
import {triageWorld} from './triageWorld.ts';

vi.setConfig({testTimeout: 30_000});

const decision = (): FakeAnswer => ({tool: {
  lane: 'fyi', kind: 'updates', organisation: 'Northwind Engineering', via: null, type: 'newsletter', key_date: null, summary: 'New posts', security: null,
  protected_class: null, confidence: 0.9,
}});

const RECIPIENTS = {to: [{name: 'Sam Ortiz', address: 'sam.ortiz@example.org'}], cc: [], replyTo: [], references: [], inReplyTo: null};

/** A sent-only email as a provider gives one: in the provider's view unread and out of the inbox, which a sent copy never is. */
const sentOnly = (w: ReturnType<typeof triageWorld>, changes: Partial<FetchedMessage> = {}) => w.fetched({
  fromName: 'User', fromAddress: 'user.jobs@example.com', subject: 'Quarterly lantern report', bodyText: 'The lantern report is attached, Sam.',
  recipients: RECIPIENTS, sent: true, received: false, unread: true, archived: true, receivedAt: w.store.now().toISOString(), ...changes,
});

async function setup() {
  const fake = await fakeModels();
  const ntfy = await fakeNtfy();
  const w = triageWorld(fake.endpoints, {notifier: store => new Notifier(store, {publicUrl: 'https://setpoint.example.com'})});
  setSecret(w.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  updateSettings(w.store, {notifications: {ntfy_server: ntfy.url, attention_mail: true, fyi_mail: true}});
  fake.answer(() => decision());
  // The seed's Unsorted mail sorted first, so what follows reads only this test's mail.
  await w.drain();
  const account = w.accountId('Jobs');
  const deliver = (message: FetchedMessage, backfill = false) => upsertMessages(w.store, account, [message], {backfill}).inserted[0]!;
  return {fake, ntfy, w, account, deliver};
}

describe('mail the user sent to others', () => {
  test('is never triaged, sorted as history, re-sorted, extracted, given search terms or notified, and no model is called for it', async () => {
    const {fake, ntfy, w, deliver} = await setup();
    const unsortedBefore = unsortedCount(w.store);
    const historyBefore = historyProgress(w.store).total;
    const calls = fake.requests.length;

    const sent = deliver(sentOnly(w));
    const sentHistory = deliver(sentOnly(w, {subject: 'Lantern report, last spring', receivedAt: '2026-04-02T16:00:00.000Z'}), true);
    const received = deliver(w.fetched({subject: 'A reply came', receivedAt: w.store.now().toISOString()}));
    await w.drain();

    expect([w.message(sent).lane, w.message(sentHistory).lane, w.message(received).lane]).toEqual([null, null, 'fyi']);
    expect([w.job(sent), w.job(sentHistory)]).toEqual([undefined, undefined]);
    expect(fake.requests.length).toBe(calls + 1);
    expect(ntfy.published.map(message => message.body.message)).toEqual(['A reply came']);

    // Unsorted mail is triaged again, history by the rules: neither picks it up.
    expect(resortUnsorted(w.store)).toEqual({queued: 0, sorted: 0});
    sortHistory(w.store, [sentHistory]);
    expect(w.message(sentHistory).lane).toBeNull();
    expect(unsortedCount(w.store)).toBe(unsortedBefore);
    expect(w.status().unsorted).toBe(unsortedBefore);

    // The history pass counts backfilled received mail only, so it can finish.
    expect(historyProgress(w.store).total).toBe(historyBefore);

    // Search terms: the pass and new mail's queue leave it out.
    startSearchTermsPass(w.store);
    queueSearchTerms(w.store);
    expect(w.store.db.select().from(t.jobs).where(inArray(t.jobs.messageId, [sent, sentHistory])).all()).toEqual([]);
    expect(w.store.db.select().from(t.aiUsage).where(inArray(t.aiUsage.messageId, [sent, sentHistory])).all()).toEqual([]);
  });

  test('is never given a code or a written rule\'s trash, however it reads', async () => {
    const {w, deliver} = await setup();
    // A written rule that trashes mail from the user's own domain an hour after it arrives.
    createRule(w.store, {match: {from_domains: ['example.com']}, lane: 'noise', kind: null, enabled: true, mark_read: false, trash: '1h'});
    const sent = deliver(sentOnly(w, {subject: 'Your sign-in code', bodyText: 'Your verification code is 482913. It expires in 10 minutes.'}));
    await w.drain();
    rereadCodes(w.store, {apply: true});
    w.advance(2 * 60 * 60_000);
    await new RuleTrashScheduler({store: w.store}).tick();
    expect(w.message(sent)).toMatchObject({lane: null, code: null, codeExpiresAt: null, trashDueAt: null, triageRuleId: null, trashedAt: null});
    expect(w.store.db.select().from(t.commands).where(eq(t.commands.targetId, sent)).all()).toEqual([]);
  });

  test('is never unread or archived', async () => {
    const {w, deliver} = await setup();
    const sent = deliver(sentOnly(w));
    expect(w.message(sent)).toMatchObject({sent: true, received: false, unread: false, archivedAt: null, lane: null});
  });

  test('leaves the Inbox, its counts, All, the mail day, Home Assistant and Mark all as read as they were', async () => {
    const {w, account, deliver} = await setup();
    const views = () => ({
      inbox: inbox(w.store), account: inbox(w.store, account), counts: mailCounts(w.store), day: mailDayOf(w.store),
      all: allMail(w.store, {limit: 500}), accountAll: allMail(w.store, {account_id: account, limit: 500}), ha: haStatus(w.store, 'https://setpoint.example.com'),
    });
    const before = views();
    const sent = [
      deliver(sentOnly(w)),
      deliver(sentOnly(w, {subject: 'Lantern report, last spring', receivedAt: '2026-04-02T16:00:00.000Z'}), true),
      deliver(sentOnly(w, {subject: 'Binned', trashed: true})),
    ];
    // A sent-only row that some path left unread still counts for nothing.
    w.store.db.update(t.messages).set({unread: true}).where(inArray(t.messages.id, sent)).run();
    expect(views()).toEqual(before);
    const commands = markAllRead(w.store);
    expect(commands.flatMap(command => command.payload.message_ids as number[]).filter(id => sent.includes(id))).toEqual([]);
  });

  test('is in the search index but found only when the caller asks for sent mail', async () => {
    const {w, account, deliver} = await setup();
    const sent = deliver(sentOnly(w));
    const received = deliver(w.fetched({subject: 'Lantern report reply', bodyText: 'Thanks for the lantern report.', receivedAt: w.store.now().toISOString()}));
    const search = (input: Partial<SearchInput>) => searchMail(w.store, searchInput.parse({text: 'lantern report', ...input}), {log: false}).results.map(result => result.id);
    expect(search({})).toEqual([received]);
    expect(search({sent: 'include'}).sort()).toEqual([sent, received].sort());
    expect(search({sent: 'only'})).toEqual([sent]);
    expect(search({sent: 'only', account_id: account + 100})).toEqual([]);
    expect(search({sent: 'only', account_id: account})).toEqual([sent]);
  });

  test('is found by who it went to, To and Cc, as a received email is by its sender; mail that came in is not found by its recipients', async () => {
    const {w, deliver} = await setup();
    const sent = deliver(sentOnly(w, {recipients: {...RECIPIENTS, cc: [{name: null, address: 'june.park@fabrikam.example.org'}]}}));
    const unknown = deliver(sentOnly(w, {subject: 'Headers not read yet', recipients: undefined}));
    const received = deliver(w.fetched({subject: 'Team notes', bodyText: 'Notes.', receivedAt: w.store.now().toISOString(), recipients: RECIPIENTS}));
    const search = (text: string, sentMail: 'include' | 'only' = 'include') => searchMail(w.store, searchInput.parse({text, sent: sentMail}), {log: false}).results
      .filter(result => [sent, unknown, received].includes(result.id)).map(result => [result.id, result.reasons.map(reason => reason.label)]);
    expect(search('ortiz')).toEqual([[sent, ['To ortiz']]]);
    expect(search('sam ortiz', 'only')).toEqual([[sent, ['To sam ortiz']]]);
    expect(search('fabrikam')).toEqual([[sent, ['To fabrikam']]]);
    // Headers read later are indexed then.
    w.store.db.update(t.messages).set({toRecipients: [{name: 'Lena Fischer', address: 'lena@example.org'}], ccRecipients: []}).where(eq(t.messages.id, unknown)).run();
    expect(search('fischer')).toEqual([[unknown, ['To fischer']]]);
    // Mail to yourself that arrives makes the row received: its recipients leave the index.
    w.store.db.update(t.messages).set({received: true}).where(eq(t.messages.id, unknown)).run();
    expect(search('fischer')).toEqual([]);
  });

  test('Sent\'s search carries no reply mark, as Sent\'s list doesn\'t; the Inbox\'s search of the same conversation does', () => {
    const w = plainWorld({seed: true});
    const cabin = (sent: 'include' | 'only') => searchMail(w.store, searchInput.parse({text: 'from:theo.walsh@example.org', sent}), {log: false}).results;
    expect(cabin('include').map(result => result.replied_at)).toEqual([expect.any(String)]);
    const sentOnly = searchMail(w.store, searchInput.parse({text: 'to:theo', sent: 'only'}), {log: false}).results;
    expect(sentOnly.map(result => [result.subject, result.replied_at])).toEqual([['Re: Cabin weekend in November', undefined]]);
  });

  test('marks itself sent-only, and its search result says who it went to; mail to yourself does only in Sent\'s search', async () => {
    const {w, deliver} = await setup();
    const sent = deliver(sentOnly(w));
    const unknown = deliver(sentOnly(w, {subject: 'Lantern report, unread headers', recipients: undefined}));
    const self = deliver(sentOnly(w, {subject: 'Lantern report to self', received: true, archived: false, recipients: {...RECIPIENTS, to: [{name: null, address: 'user.jobs@example.com'}]}}));
    const results = (input: Partial<SearchInput>) => new Map(searchMail(w.store, searchInput.parse({text: 'lantern report', ...input}), {log: false}).results.map(result => [result.id, result]));
    const pick = (result: {sent_only?: true; to?: unknown; cc?: unknown} | undefined) => ({sent_only: result?.sent_only, has: 'to' in (result ?? {}), to: result?.to, cc: result?.cc});

    const inbox = results({sent: 'include'});
    expect(pick(inbox.get(sent))).toEqual({sent_only: true, has: true, to: RECIPIENTS.to, cc: []});
    expect(pick(inbox.get(unknown))).toEqual({sent_only: true, has: true, to: null, cc: null});
    expect(pick(inbox.get(self))).toEqual({sent_only: undefined, has: false, to: undefined, cc: undefined});
    expect(pick(results({sent: 'only'}).get(self))).toEqual({sent_only: undefined, has: true, to: [{name: null, address: 'user.jobs@example.com'}], cc: []});
    // The rows every list draws carry it too, and the reader's email.
    expect(allMail(w.store, {limit: 200}).days.flatMap(day => day.rows).some(row => 'sent_only' in row)).toBe(false);
  });
});

describe('the Sent list', () => {
  test('newest first by local day, paged as All is, by account, with who each went to and the accounts that have any', async () => {
    const w = plainWorld({seed: true});
    const accounts = new Map(w.store.db.select().from(t.accounts).all().map(account => [account.label, account.id]));
    const fetched = (subject: string, receivedAt: string, changes: Partial<FetchedMessage> = {}): FetchedMessage => ({
      providerId: `sent-${subject}`, threadId: subject, rfc822Id: null, fromName: 'User', fromAddress: 'user@example.com', subject, snippet: subject,
      bodyText: subject, bodyHtml: null, receivedAt, senderAuth: null, attachments: [], unread: false, trashed: false, archived: true,
      recipients: RECIPIENTS, sent: true, received: false, ...changes,
    });
    const personal = accounts.get('Personal')!;
    const work = accounts.get('Work')!;
    const jobs = accounts.get('Jobs')!;
    const sentBefore = w.store.db.select({accountId: t.messages.accountId}).from(t.messages).where(eq(t.messages.sent, true)).all();
    w.store.db.delete(t.messages).where(eq(t.messages.sent, true)).run();
    expect(sentBefore.length).toBeGreaterThan(0);

    const [first] = upsertMessages(w.store, personal, [fetched('First', '2026-10-05T17:00:00.000Z')]).inserted;
    const [second] = upsertMessages(w.store, work, [fetched('Second', '2026-10-06T17:00:00.000Z')]).inserted;
    const [third] = upsertMessages(w.store, personal, [fetched('Third', '2026-10-06T18:00:00.000Z')]).inserted;
    upsertMessages(w.store, personal, [fetched('Trashed', '2026-10-06T19:00:00.000Z', {trashed: true})]);
    // Mail to yourself is sent mail too, and stays in the Inbox.
    const [self] = upsertMessages(w.store, work, [fetched('Note to self', '2026-10-06T20:00:00.000Z', {received: true, unread: true, archived: false})]).inserted;

    const api = await signedIn(w);
    const page = (await api.send('GET', '/api/mail/sent?limit=2')).body;
    expect(page.days.map((day: {date: string; rows: {id: number}[]}) => [day.date, day.rows.map(row => row.id)])).toEqual([['2026-10-06', [self, third]]]);
    expect(page.days[0].rows[1]).toMatchObject({id: third, subject: 'Third', account_id: personal, to: RECIPIENTS.to, cc: []});
    expect(page.accounts).toEqual([personal, work]);
    expect(page.accounts).not.toContain(jobs);
    const next = (await api.send('GET', `/api/mail/sent?limit=2&before=${encodeURIComponent(page.next_before)}`)).body;
    expect(next.days.map((day: {date: string; rows: {id: number}[]}) => [day.date, day.rows.map(row => row.id)])).toEqual([['2026-10-06', [second]], ['2026-10-05', [first]]]);
    expect(next.next_before).toBeNull();
    const work_ = (await api.send('GET', `/api/mail/sent?account_id=${work}`)).body;
    expect(work_.days.flatMap((day: {rows: {id: number}[]}) => day.rows.map(row => row.id))).toEqual([self, second]);
    expect(work_.accounts).toEqual([personal, work]);

    // The self note is still the Inbox's; the others are not.
    const inboxIds = inbox(w.store).groups.flatMap(group => group.rows.map(row => row.id));
    expect(inboxIds).toContain(self);
    expect(inboxIds).not.toContain(third);
  });
});
