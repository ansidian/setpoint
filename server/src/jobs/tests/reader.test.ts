// Jobs reading mail as it runs (J2), against an ephemeral database holding the seed's mail, with
// triage and Haiku faked at the HTTP boundary (tests/fakeModels.ts): the hook from triage, a recorded
// set of invented emails making the expected applications, events and Needs you items, read once and
// never again, the ledger, the AI down and back, a key missing, a missed nudge, a status set by hand,
// blocked emails, emails held behind one triage hasn't sorted, and that Jobs is passive.
import {SEED_NOW} from '@setpoint/shared';
import {jobsPageSchema} from '@setpoint/shared';
import {and, asc, eq, inArray, lte} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import {FAKE_KEYS, fakeModels} from '../../../tests/fakeModels.ts';
import type {FakeAnswer, FakeRequest} from '../../../tests/fakeModels.ts';
import {liveEvents, world} from '../../../tests/helpers.ts';
import * as t from '../../db/schema.ts';
import {setSecret} from '../../secrets/store.ts';
import {SyncEngine} from '../../sync/engine.ts';
import {upsertMessages} from '../../sync/mailMirror.ts';
import {Adapters} from '../../sync/registry.ts';
import {TriageWorker} from '../../triage/worker.ts';
import {jobsDb} from '../db.ts';
import {emailsToRead} from '../mail.ts';
import {NO_JOBS_KEY} from '../models.ts';
import {jobsPage} from '../queries.ts';
import {JobsReader, readEmail} from '../reader.ts';
import * as j from '../schema.ts';
import {RECORDED_EMAILS} from './emails.ts';
import type {RecordedEmail} from './emails.ts';

// Real HTTP round trips to the fake, dozens per test.
vi.setConfig({testTimeout: 30_000});

const TURNED_ON = '2026-10-08T00:00:00.000Z';
const BY_SUBJECT = new Map(RECORDED_EMAILS.map(email => [email.subject, email]));
const isJobs = (request: FakeRequest) => request.body.tools?.[0]?.name === 'submit_job_email';
const subjectOf = (request: FakeRequest) => /^Subject: (.*)$/m.exec(request.input)?.[1] ?? '';

/** Triage's answer for a recorded email. */
function triageAnswer(email: RecordedEmail): FakeAnswer {
  return {tool: {...email.triage, key_date: null, security: null, protected_class: null, confidence: 0.95}};
}

/** Jobs's answer for a recorded email; one Jobs should never ask about fails the test's request. */
function jobsAnswer(email: RecordedEmail): FakeAnswer {
  if (!email.jobs) return {status: 400, body: {type: 'error', error: {type: 'invalid_request_error', message: `Jobs asked about "${email.subject}"`}}};
  return {tool: email.jobs, usage: {input: 700, output: 60}};
}

/**
 * The seed's mail with triage and Jobs's reader on the engine, both on the fake, and Jobs starting
 * over: its sample cleared, turned on at TURNED_ON reading Jobs (every email) and Business (Career).
 */
async function setup({key = true, hook = true}: {key?: boolean; hook?: boolean} = {}) {
  const fake = await fakeModels();
  const w = world({seed: true});
  const store = w.store;
  const db = jobsDb(store.sqlite);
  for (const table of [j.jobsEvents, j.jobsNeedsYou, j.jobsPostings, j.jobsJdCandidates, j.jobsHandSet, j.jobsEmailsRead, j.jobsBlockedEmails, j.jobsApplications]) db.delete(table).run();
  const accountId = (label: string) => store.db.select().from(t.accounts).where(eq(t.accounts.label, label)).get()!.id;
  db.update(j.jobsSettings).set({
    enabled: true, enabledAt: TURNED_ON, updatedAt: TURNED_ON,
    accounts: [{account_id: accountId('Jobs'), reads: 'every'}, {account_id: accountId('Business'), reads: 'career'}],
  }).run();
  if (key) setSecret(store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  fake.answer(request => {
    const email = BY_SUBJECT.get(subjectOf(request));
    if (!email) return {status: 500, body: {type: 'error', error: {type: 'api_error', message: `No recorded email "${subjectOf(request)}"`}}};
    return isJobs(request) ? jobsAnswer(email) : triageAnswer(email);
  });

  const reader = new JobsReader({store, endpoints: fake.endpoints, timeoutMs: 2000});
  const triage = new TriageWorker({store, endpoints: fake.endpoints, timeoutMs: 2000, onSorted: hook ? () => reader.nudge() : null});
  const engine = new SyncEngine({store, adapters: new Adapters(), workers: [triage, reader]});
  const due = () => store.db.select({id: t.jobs.id}).from(t.jobs)
    .where(and(inArray(t.jobs.kind, ['triage', 'jobs_read']), eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, store.now().toISOString()))).all().length;
  const drain = async () => {
    for (let round = 0; round < 50; round += 1) {
      await engine.tick();
      await engine.settled();
      if (!due()) return;
    }
    throw new Error('Jobs kept coming');
  };
  const ids = new Map<string, number>();
  /** Delivers recorded emails as new mail, a minute after each arrives, without running anything. */
  const deliver = (...keys: string[]) => {
    for (const key of keys) {
      const email = RECORDED_EMAILS.find(each => each.key === key)!;
      w.at(new Date(Date.parse(email.at) + 60_000).toISOString());
      const [id] = upsertMessages(store, accountId(email.account), [{
        providerId: `p-${key}`, threadId: `thread-${key}`, rfc822Id: null, fromName: email.from[0], fromAddress: email.from[1], subject: email.subject,
        snippet: email.body.slice(0, 120), bodyText: email.body, bodyHtml: null, receivedAt: email.at, senderAuth: null, attachments: [],
        unread: true, trashed: false, archived: false,
      }]).inserted;
      ids.set(key, id!);
    }
  };
  /** Delivers each email and lets triage and Jobs run, one after another, as mail arrives. */
  const arrive = async (...keys: string[]) => {
    for (const key of keys) {
      deliver(key);
      await drain();
    }
  };
  const jobsRequests = () => fake.requests.filter(isJobs);
  const applications = () => db.select().from(j.jobsApplications).orderBy(asc(j.jobsApplications.id)).all();
  const eventsOf = (applicationId: number) =>
    db.select().from(j.jobsEvents).where(eq(j.jobsEvents.applicationId, applicationId)).orderBy(asc(j.jobsEvents.at), asc(j.jobsEvents.id)).all();
  const read = (key: string) => db.select().from(j.jobsEmailsRead).where(eq(j.jobsEmailsRead.messageId, ids.get(key)!)).get();
  const readJob = () => store.db.select().from(t.jobs).where(eq(t.jobs.kind, 'jobs_read')).orderBy(asc(t.jobs.id)).all().at(-1);
  return {w, store, db, fake, reader, triage, engine, drain, deliver, arrive, ids, jobsRequests, applications, eventsOf, read, readJob, accountId};
}

describe('a recorded set of invented emails (Done when)', () => {
  test('makes the expected applications, events and Needs you items, and a second pass reads nothing', async () => {
    const s = await setup();
    await s.arrive(...RECORDED_EMAILS.map(email => email.key));

    const byKey = (key: string) => s.ids.get(key)!;
    const apps = s.applications();
    expect(apps.map(row => ({
      company: row.company, title: row.title, requisitionId: row.requisitionId, status: row.status, statusSetBy: row.statusSetBy, step: row.step,
      platform: row.platform, account: row.accountId === s.accountId('Business') ? 'Business' : 'Jobs', jdLookup: row.jdLookup,
      reappliedFrom: row.reappliedFromId === null ? null : apps.find(other => other.id === row.reappliedFromId)!.company,
    }))).toEqual([
      {company: 'Fabrikam Labs', title: 'Software Engineer II (Java) (2026-1042)', requisitionId: '2026-1042', status: 'in_process', statusSetBy: 'email',
        step: 'Interview Tue Oct 13, 2:00 PM', platform: 'Greenhouse', account: 'Jobs', jdLookup: 'looking', reappliedFrom: null},
      {company: 'Humongous Insurance', title: 'Data Analyst', requisitionId: 'R-100', status: 'applied', statusSetBy: 'email', step: null, platform: 'Workday',
        account: 'Jobs', jdLookup: 'looking', reappliedFrom: null},
      {company: 'Humongous Insurance', title: 'Data Analyst', requisitionId: 'R-200', status: 'in_process', statusSetBy: 'email', step: 'Case study due Oct 19',
        platform: 'Workday', account: 'Jobs', jdLookup: 'looking', reappliedFrom: null},
      {company: 'Tailspin Toys', title: 'Full Stack Developer', requisitionId: null, status: 'applied', statusSetBy: 'email', step: null, platform: 'Indeed',
        account: 'Jobs', jdLookup: 'looking', reappliedFrom: null},
      {company: 'Adventure Works', title: 'Web Developer', requisitionId: null, status: 'applied', statusSetBy: 'email', step: null, platform: 'Lever',
        account: 'Jobs', jdLookup: 'looking', reappliedFrom: null},
      {company: 'City Power & Light', title: 'IT Technician II', requisitionId: null, status: 'applied', statusSetBy: 'email', step: null, platform: 'GovernmentJobs',
        account: 'Business', jdLookup: 'looking', reappliedFrom: null},
      {company: 'Woodgrove Bank', title: 'Junior Developer', requisitionId: null, status: 'rejected', statusSetBy: 'email', step: null, platform: 'Workday',
        account: 'Jobs', jdLookup: 'looking', reappliedFrom: null},
      {company: 'Woodgrove Bank', title: 'Junior Developer', requisitionId: null, status: 'applied', statusSetBy: 'email', step: null, platform: 'Workday',
        account: 'Jobs', jdLookup: 'looking', reappliedFrom: 'Woodgrove Bank'},
    ]);
    // Each application's Applied date is its confirmation's; the re-application links the rejected one.
    expect(apps[3]!.appliedAt).toBe(RECORDED_EMAILS.find(email => email.key === 'tailspin-applied')!.at);
    expect(apps[7]!.reappliedFromId).toBe(apps[6]!.id);
    expect(apps.every(row => !row.companyUnknown)).toBe(true);

    const timeline = (index: number) => s.eventsOf(apps[index]!.id).map(event => [event.kind, event.subject, event.line, event.messageId]);
    expect(timeline(0)).toEqual([
      ['applied', 'Thank you for applying to Fabrikam Labs', null, byKey('fabrikam-applied')],
      ['verification', 'Verify your email to continue with Fabrikam Labs', null, byKey('fabrikam-verify')],
      ['duplicate', 'Thank you for applying to Fabrikam', null, byKey('fabrikam-again')],
      ['interview', 'Interview for Software Engineer II', 'Interview Tue Oct 13, 2:00 PM', byKey('fabrikam-interview')],
      ['form', 'Voluntary self-identification', null, byKey('fabrikam-form')],
    ]);
    expect(s.eventsOf(apps[0]!.id)[3]).toMatchObject({sender: 'Dana Park', at: '2026-10-12T17:00:00.000Z'});
    expect(timeline(2)).toEqual([
      ['applied', 'Application received: Data Analyst (R-200)', null, byKey('humongous-r200')],
      ['assessment', 'Next step: a case study for Data Analyst', 'Case study due Oct 19', byKey('humongous-case')],
    ]);
    // Indeed's pair: the match email read first joins the application its confirmation made.
    expect(timeline(3)).toEqual([
      ['match', 'Full Stack Developer @ Tailspin Toys', null, byKey('tailspin-match')],
      ['applied', 'Indeed Application: Full Stack Developer', null, byKey('tailspin-applied')],
    ]);
    expect(timeline(6).map(([kind]) => kind)).toEqual(['applied', 'rejection']);
    expect(timeline(7).map(([kind]) => kind)).toEqual(['applied']);

    const page = jobsPageSchema.parse(jobsPage(s.store));
    expect(page.needs_you.map(item => ({
      kind: item.kind, reason: item.reason, company: item.company, title: item.title, event_kind: item.event_kind, line: item.line, subject: item.subject,
      message_id: item.message_id, from_history: item.from_history,
    }))).toEqual([
      {kind: 'update_to_assign', reason: 'names_no_role', company: 'Humongous Insurance', title: null, event_kind: 'rejection', line: 'Not moving forward',
        subject: 'An update on your application', message_id: byKey('humongous-update'), from_history: false},
      {kind: 'email_to_track', reason: 'no_application', company: 'Proseware', title: 'Junior Developer', event_kind: 'interview', line: 'Phone screen, pick a slot',
        subject: 'Schedule your phone screen', message_id: byKey('proseware-screen'), from_history: false},
      {kind: 'update_to_assign', reason: 'names_other_role', company: 'Adventure Works', title: 'Product Designer', event_kind: 'interview',
        line: 'Interview Mon Oct 19, 10:00 AM', subject: 'Interview: Product Designer', message_id: byKey('adventure-interview'), from_history: false},
    ]);
    expect(page.from_history).toEqual([]);
    expect(page.counts).toEqual({all: 8, ghosted: 0, by_status: {applied: 5, in_process: 2, offer: 0, rejected: 1, withdrawn: 0}});
    expect(page.reading).toEqual({waiting: 0, state: 'healthy', since: null, reason: null, cause: null, retrying: false});
    expect(page.rows.find(row => row.company === 'Tailspin Toys')!.jd).toMatchObject({state: 'looking'});

    // Each email Jobs reads is read once; Business mail that isn't Career never is.
    const outcomes = Object.fromEntries(RECORDED_EMAILS.map(email => [email.key, s.read(email.key)?.outcome ?? 'not read']));
    expect(outcomes).toEqual({
      'tailspin-match': 'event', 'fabrikam-applied': 'application', 'fabrikam-verify': 'event', 'humongous-r100': 'application', 'humongous-r200': 'application',
      'tailspin-applied': 'application', 'humongous-update': 'needs_you', 'fabrikam-again': 'event', 'adventure-applied': 'application',
      'fabrikam-interview': 'event', 'lucerne-rejection': 'ignored', 'proseware-screen': 'needs_you', 'city-applied': 'application',
      'business-order': 'not read', 'contoso-recruiter': 'ignored', 'woodgrove-applied': 'application', 'humongous-case': 'event',
      'woodgrove-rejected': 'event', 'fabrikam-form': 'event', 'adventure-interview': 'needs_you', 'woodgrove-reapplied': 'application', newsletter: 'ignored',
    });
    expect(s.read('fabrikam-applied')).toMatchObject({event: 'confirmation', company: 'Fabrikam Labs', titleKey: 'software engineer ii', requisitionId: '2026-1042'});
    const asked = s.jobsRequests();
    expect(asked).toHaveLength(21);
    expect(asked.every(request => request.model === 'claude-haiku-5-5')).toBe(true);
    expect(asked.map(subjectOf)).not.toContain('Your order has shipped');

    // The ledger counts each as Jobs's "emails", with its email.
    const ledger = s.store.db.select().from(t.aiUsage).where(eq(t.aiUsage.purpose, 'jobs_emails')).all();
    expect(ledger).toHaveLength(21);
    expect(ledger[0]).toMatchObject({provider: 'anthropic', model: 'claude-haiku-5-5', messageId: byKey('tailspin-match'), inputTokens: 700, outputTokens: 60});
    expect(ledger[0]!.costMicros).toBe(100);

    // A second pass reads nothing again and charges nothing.
    s.reader.nudge();
    s.w.advance(10 * 60_000);
    await s.drain();
    const never = async () => {
      throw new Error('asked again');
    };
    for (const [key, id] of s.ids) if (key !== 'business-order') expect(await readEmail(s.store, never, id)).toBe('already');
    expect(s.jobsRequests()).toHaveLength(21);
    expect(s.store.db.select().from(t.aiUsage).where(eq(t.aiUsage.purpose, 'jobs_emails')).all()).toHaveLength(21);
  });
});

describe('the hook', () => {
  test('triage sorting an email nudges Jobs, which reads it at once, not at the next rescan', async () => {
    const s = await setup();
    await s.arrive('fabrikam-applied');
    expect(s.read('fabrikam-applied')).toMatchObject({outcome: 'application'});
    // Within the rescan's five minutes: only the nudge can queue the read.
    s.deliver('fabrikam-verify');
    s.w.at('2026-10-08T16:06:30.000Z');
    await s.drain();
    expect(s.read('fabrikam-verify')).toMatchObject({outcome: 'event'});
  });

  test('a missed nudge or a restart loses nothing: the rescan finds what waits', async () => {
    const s = await setup({hook: false});
    await s.arrive('fabrikam-applied');
    // Triage sorted it and nothing told Jobs: it waits for the rescan, five minutes on.
    expect(s.read('fabrikam-applied')).toBeUndefined();
    expect(jobsPage(s.store).reading.waiting).toBe(1);
    s.w.advance(5 * 60_000);
    await s.drain();
    expect(s.read('fabrikam-applied')?.outcome).toBe('application');
    s.deliver('fabrikam-verify', 'fabrikam-again');
    s.w.at('2026-10-10T15:01:30.000Z');
    // Triage sorts them; nothing tells Jobs.
    await s.drain();
    expect(s.read('fabrikam-verify')).toBeUndefined();
    expect(jobsPage(s.store).reading.waiting).toBe(2);

    // A new process: a fresh reader on a fresh engine, never nudged.
    const reader = new JobsReader({store: s.store, endpoints: s.fake.endpoints, timeoutMs: 2000});
    const engine = new SyncEngine({store: s.store, adapters: new Adapters(), workers: [reader]});
    for (let round = 0; round < 3; round += 1) {
      await engine.tick();
      await engine.settled();
    }
    expect(s.read('fabrikam-verify')?.outcome).toBe('event');
    expect(s.read('fabrikam-again')?.outcome).toBe('event');
    expect(jobsPage(s.store).reading.waiting).toBe(0);
  });

  test('a confirmation is read before its update, even when triage sorts the update first', async () => {
    const s = await setup();
    s.deliver('woodgrove-applied');
    // The rejection arrives two days later, but triage sorts it while the confirmation is still Unsorted.
    s.deliver('woodgrove-rejected');
    const rejection = s.ids.get('woodgrove-rejected')!;
    const confirmation = s.ids.get('woodgrove-applied')!;
    const window = {accounts: [{account_id: s.accountId('Jobs'), reads: 'every' as const}], from: TURNED_ON};
    s.store.db.update(t.messages).set({lane: 'fyi', kind: 'career'}).where(eq(t.messages.id, rejection)).run();
    // Held behind the confirmation while it's been Unsorted for under a day.
    expect(emailsToRead(s.store, window, '2026-10-15T12:00:00.000Z')).toEqual([]);
    // Unsorted for more than a day (triage down, a key missing), it stops holding the rest.
    expect(emailsToRead(s.store, window, s.store.now().toISOString())).toEqual([rejection]);
    s.store.db.update(t.messages).set({lane: 'fyi', kind: 'career'}).where(eq(t.messages.id, confirmation)).run();
    expect(emailsToRead(s.store, window, s.store.now().toISOString())).toEqual([confirmation, rejection]);
    // Read in that order, the rejection closes the application the confirmation made.
    await s.drain();
    expect(s.applications().map(row => [row.company, row.status])).toEqual([['Woodgrove Bank', 'rejected']]);
  });

  test('mail from before Jobs was turned on is the history pass\'s, not read as it\'s triaged', async () => {
    const s = await setup();
    s.store.db.update(j.jobsSettings).set({enabledAt: '2026-10-09T00:00:00.000Z'}).run();
    await s.arrive('fabrikam-applied', 'tailspin-applied');
    expect(s.read('fabrikam-applied')).toBeUndefined();
    expect(s.read('tailspin-applied')?.outcome).toBe('application');
  });

  test('with Jobs off, nothing is read or asked', async () => {
    const s = await setup();
    s.store.db.update(j.jobsSettings).set({enabled: false}).run();
    await s.arrive('fabrikam-applied');
    expect(s.read('fabrikam-applied')).toBeUndefined();
    expect(s.jobsRequests()).toEqual([]);
    expect(jobsPage(s.store).reading.waiting).toBe(0);
  });
});

describe('what the reader sees', () => {
  test('an HTML-only email reaches the model with its words, not an empty body (SV-128)', async () => {
    const {store, drain, jobsRequests, accountId} = await setup();
    const email = RECORDED_EMAILS.find(each => each.key === 'fabrikam-applied')!;
    upsertMessages(store, accountId(email.account), [{
      providerId: 'p-html', threadId: 'thread-html', rfc822Id: null, fromName: email.from[0], fromAddress: email.from[1], subject: email.subject,
      snippet: '', bodyText: '', bodyHtml: `<table><tr><td><p>${email.body}</p></td></tr></table>`, receivedAt: email.at, senderAuth: null, attachments: [],
      unread: true, trashed: false, archived: false,
    }]);
    await drain();
    const asked = jobsRequests().find(request => subjectOf(request) === email.subject);
    expect(asked?.input).toContain(email.body);
  });
});

describe('the AI down (When things break)', () => {
  test('emails wait and are counted, then are read once it\'s back; nothing is lost', async () => {
    const s = await setup();
    await s.arrive('fabrikam-applied');
    const healthy = jobsPage(s.store).reading;
    expect(healthy).toEqual({waiting: 0, state: 'healthy', since: null, reason: null, cause: null, retrying: false});

    // Anthropic overloaded for Jobs; triage still sorts.
    s.fake.answer(request => {
      const email = BY_SUBJECT.get(subjectOf(request))!;
      return isJobs(request) ? 'overloaded' : triageAnswer(email);
    });
    await s.arrive('fabrikam-interview', 'proseware-screen');
    expect(s.store.db.select().from(t.messages).where(eq(t.messages.id, s.ids.get('proseware-screen')!)).get()!.lane).toBe('attention');
    const down = jobsPage(s.store).reading;
    expect(down).toEqual({waiting: 2, state: 'down', since: '2026-10-12T17:01:00.000Z', reason: 'Anthropic: Overloaded (529)', cause: 'unreachable', retrying: true});
    expect(s.readJob()).toMatchObject({state: 'queued', lastError: 'Anthropic: Overloaded (529)'});
    expect(s.read('fabrikam-interview')).toBeUndefined();
    expect(s.applications()[0]!.status).toBe('applied');
    // A failed call charges nothing.
    expect(s.store.db.select().from(t.aiUsage).where(eq(t.aiUsage.purpose, 'jobs_emails')).all()).toHaveLength(1);
    // It said so: a `jobs` event naming nothing, so the page asks again.
    expect(liveEvents(s.w)).toContainEqual({type: 'jobs', applications: [], needs_you: []});

    // Back: the retry reads both, in order.
    s.fake.answer(request => {
      const email = BY_SUBJECT.get(subjectOf(request))!;
      return isJobs(request) ? jobsAnswer(email) : triageAnswer(email);
    });
    s.w.advance(31 * 60_000);
    await s.drain();
    expect(jobsPage(s.store).reading).toEqual({waiting: 0, state: 'healthy', since: null, reason: null, cause: null, retrying: false});
    expect(s.read('fabrikam-interview')?.outcome).toBe('event');
    expect(s.read('proseware-screen')?.outcome).toBe('needs_you');
    expect(s.applications()[0]).toMatchObject({status: 'in_process', step: 'Interview Tue Oct 13, 2:00 PM'});
  });

  test('with no Anthropic key, emails wait for one, then are read', async () => {
    const s = await setup({key: false});
    // Triage sorts with OpenAI meanwhile; Jobs reads only with Anthropic's.
    setSecret(s.store, 'openai_api_key', FAKE_KEYS.openai);
    await s.arrive('fabrikam-applied');
    expect(s.read('fabrikam-applied')).toBeUndefined();
    expect(jobsPage(s.store).reading).toEqual({waiting: 1, state: 'down', since: expect.any(String), reason: NO_JOBS_KEY, cause: 'no_key', retrying: false});
    expect(s.readJob()).toMatchObject({state: 'failed'});

    setSecret(s.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    // The rescan queues it again.
    s.w.advance(5 * 60_000);
    await s.drain();
    expect(s.read('fabrikam-applied')?.outcome).toBe('application');
    expect(jobsPage(s.store).reading.state).toBe('healthy');
  });

  test('an email the provider refuses outright is passed over, and the rest are read', async () => {
    const s = await setup();
    s.fake.answer(request => {
      const email = BY_SUBJECT.get(subjectOf(request))!;
      if (isJobs(request) && email.key === 'fabrikam-applied') return {status: 400, body: {type: 'error', error: {type: 'invalid_request_error', message: 'Bad request'}}};
      return isJobs(request) ? jobsAnswer(email) : triageAnswer(email);
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    s.deliver('fabrikam-applied', 'humongous-r100');
    await s.drain();
    expect(s.read('fabrikam-applied')).toBeUndefined();
    expect(s.read('humongous-r100')?.outcome).toBe('application');
    expect(jobsPage(s.store).reading).toMatchObject({waiting: 1, state: 'healthy'});
  });

  test('an answer without the tool reads as nothing, and isn\'t asked again', async () => {
    const s = await setup();
    s.fake.answer(request => (isJobs(request) ? 'no_tool' : triageAnswer(BY_SUBJECT.get(subjectOf(request))!)));
    await s.arrive('fabrikam-applied');
    expect(s.read('fabrikam-applied')).toMatchObject({outcome: 'ignored', event: null});
    expect(s.applications()).toEqual([]);
    expect(s.jobsRequests()).toHaveLength(1);
  });
});

describe('statuses and corrections that stick', () => {
  test('a status set by hand gives way only to an email that sets one (decision 68)', async () => {
    const s = await setup();
    await s.arrive('fabrikam-applied');
    const [application] = s.applications();
    // The user sets Offer by hand on Oct 9, news that came by phone (J6's correction, by hand here).
    s.db.update(j.jobsApplications).set({status: 'offer', statusSetBy: 'user', statusSetAt: '2026-10-09T16:00:00.000Z'}).where(eq(j.jobsApplications.id, application!.id)).run();
    s.db.insert(j.jobsHandSet).values({applicationId: application!.id, field: 'status', setAt: '2026-10-09T16:00:00.000Z'}).run();

    // A duplicate confirmation is quiet: Offer stands.
    await s.arrive('fabrikam-again');
    expect(s.applications()[0]).toMatchObject({status: 'offer', statusSetBy: 'user'});
    await s.arrive('fabrikam-interview');
    const after = s.applications()[0]!;
    expect(s.eventsOf(after.id).map(event => event.kind)).toEqual(['applied', 'duplicate', 'interview']);
    // The interview, after the status set by hand, wins over it.
    expect(after).toMatchObject({status: 'in_process', statusSetBy: 'email', step: 'Interview Tue Oct 13, 2:00 PM'});
    expect(s.db.select().from(j.jobsHandSet).all()).toEqual([]);
    await s.arrive('fabrikam-form');
    expect(s.applications()[0]).toMatchObject({status: 'in_process', statusSetBy: 'email'});
  });

  test('a quiet email never undoes a status set by hand', async () => {
    const s = await setup();
    await s.arrive('fabrikam-applied');
    const id = s.applications()[0]!.id;
    s.db.update(j.jobsApplications).set({status: 'in_process', statusSetBy: 'user', statusSetAt: '2026-10-08T18:00:00.000Z'}).where(eq(j.jobsApplications.id, id)).run();
    s.db.insert(j.jobsHandSet).values({applicationId: id, field: 'status', setAt: '2026-10-08T18:00:00.000Z'}).run();
    await s.arrive('fabrikam-again', 'fabrikam-form');
    expect(s.eventsOf(id).map(event => event.kind)).toEqual(['applied', 'duplicate', 'form']);
    expect(s.applications()[0]).toMatchObject({status: 'in_process', statusSetBy: 'user'});
    expect(s.db.select().from(j.jobsHandSet).all()).toHaveLength(1);
  });

  test('an email of an application marked Not an application never makes one again (D321)', async () => {
    const s = await setup();
    await s.arrive('woodgrove-applied');
    const [application] = s.applications();
    // Not an application (J6): its emails blocked, the application hidden; here it's gone.
    s.db.insert(j.jobsBlockedEmails).values({messageId: s.ids.get('woodgrove-applied')!, blockedAt: '2026-10-15T16:00:00.000Z'}).run();
    s.db.delete(j.jobsApplications).where(eq(j.jobsApplications.id, application!.id)).run();
    // Its later confirmation, the same company and role from another email, makes nothing.
    await s.arrive('woodgrove-reapplied');
    expect(s.applications()).toEqual([]);
    expect(s.read('woodgrove-reapplied')).toMatchObject({outcome: 'ignored', event: 'confirmation'});
    // The read email still names what it was, with no application to point at.
    expect(s.read('woodgrove-applied')).toMatchObject({outcome: 'application', applicationId: null, company: 'Woodgrove Bank'});
  });
});

describe('passive (decision 59)', () => {
  test('reading changes nothing in mail and sends nothing but the jobs event', async () => {
    const s = await setup();
    s.store.db.update(j.jobsSettings).set({enabled: false}).run();
    await s.arrive(...RECORDED_EMAILS.slice(0, 8).map(email => email.key));
    const mail = () => ({
      messages: s.store.db.select().from(t.messages).orderBy(asc(t.messages.id)).all(),
      notifications: s.store.db.select().from(t.notifications).all(),
      items: s.store.db.select().from(t.items).all(),
    });
    const before = mail();
    const events = s.w.events.length;

    s.store.db.update(j.jobsSettings).set({enabled: true}).run();
    s.reader.nudge();
    await s.drain();
    expect(s.applications()).toHaveLength(4);
    expect(mail()).toEqual(before);
    const sent = liveEvents({...s.w, events: s.w.events.slice(events)});
    expect(new Set(sent.map(event => event.type))).toEqual(new Set(['jobs']));
    expect(sent).toContainEqual({type: 'jobs', applications: [s.applications()[0]!.id], needs_you: []});
  });
});

describe('the seed', () => {
  test('its emails are all read: a reader on it asks nothing, and nothing waits', async () => {
    const fake = await fakeModels();
    const w = world({seed: true});
    setSecret(w.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
    expect(w.store.now().toISOString()).toBe(SEED_NOW);
    const reader = new JobsReader({store: w.store, endpoints: fake.endpoints});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters(), workers: [reader]});
    await engine.tick();
    await engine.settled();
    expect(fake.requests).toEqual([]);
    expect(jobsPage(w.store).reading).toEqual({waiting: 0, state: 'healthy', since: null, reason: null, cause: null, retrying: false});
    expect(jobsPage(w.store).counts.all).toBe(62);
  });
});
