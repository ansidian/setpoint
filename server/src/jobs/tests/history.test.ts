// The history pass (J4), against an ephemeral database holding a recorded invented history
// (./history.ts) in three accounts, with Anthropic (Haiku for each email, the JD's check and reading,
// Sonnet's search) and the hiring platforms (./fakeWeb.ts) faked at the HTTP boundary. Jobs is turned
// on through its route. The Done-when list: the history makes the expected applications, updates
// finding the confirmations read before them, closed ones without JDs, old silent ones Ghosted and
// the unsure in From history; a pass stopped halfway goes on after a restart, reading and charging
// nothing twice; a second turn-on reads nothing; the progress counts; Dismiss all and its Undo.
import {jobsDismissedSchema, jobsPageSchema, jobsSettingsSchema} from '@setpoint/shared';
import type {JobsHistoryOut} from '@setpoint/shared';
import {and, asc, eq, isNull, like, lte} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import {FAKE_KEYS, fakeModels} from '../../../tests/fakeModels.ts';
import type {FakeAnswer, FakeRequest} from '../../../tests/fakeModels.ts';
import {client, liveEvents, signedIn, world} from '../../../tests/helpers.ts';
import * as t from '../../db/schema.ts';
import {setSecret} from '../../secrets/store.ts';
import {SyncEngine} from '../../sync/engine.ts';
import {LEASE_MS} from '../../sync/jobs.ts';
import {upsertMessages} from '../../sync/mailMirror.ts';
import {Adapters} from '../../sync/registry.ts';
import {jobsApi} from '../api.ts';
import {jobsDb, migrateJobs} from '../db.ts';
import {HISTORY_KEY} from '../history.ts';
import {requestLookup} from '../lookup.ts';
import {jobsPage} from '../queries.ts';
import {JobsReader} from '../reader.ts';
import * as j from '../schema.ts';
import {fakeWeb, serveFixtures} from './fakeWeb.ts';
import {HISTORY_EMAILS, TURNED_ON} from './history.ts';
import type {HistoryEmail} from './history.ts';

// Real HTTP round trips to the fakes, dozens per test.
vi.setConfig({testTimeout: 60_000});

const BY_SUBJECT = new Map(HISTORY_EMAILS.map(email => [email.subject, email]));
const toolOf = (request: FakeRequest): string => request.body.tools?.map((tool: {name: string}) => tool.name).find((name: string) => name.startsWith('submit_')) ?? '';
const subjectOf = (request: FakeRequest) => /^Subject: (.*)$/m.exec(request.input)?.[1] ?? '';
const companyOf = (request: FakeRequest) => /^Company: (.*)$/m.exec(request.input)?.[1] ?? '';

/**
 * What the pass reads: every email in Jobs; in Business, Career (City Power & Light's, the backfill's
 * rejection) and the backfill's confirmation and its hiring platform's interview (D355).
 */
const READ = HISTORY_EMAILS.filter(email => email.jobs !== null);
const NEVER_READ = HISTORY_EMAILS.filter(email => email.jobs === null).map(email => email.key);

const PROSEWARE_READING = {
  summary: 'A product designer on the platform team.\nYou own flows end to end with research.\nThey want shipped work and clear thinking.',
  location: 'Seattle, WA', workplace: 'on_site', workplace_detail: null, salary: null, must_haves: ['A portfolio of shipped work'], nice_to_haves: ['Figma'],
};

/** Haiku's answer for an email, as recorded; one Jobs should never ask about fails its request. */
function emailAnswer(email: HistoryEmail | undefined): FakeAnswer {
  if (!email?.jobs) return {status: 400, body: {type: 'error', error: {type: 'invalid_request_error', message: `Jobs asked about "${email?.subject}"`}}};
  return {tool: email.jobs, usage: {input: 700, output: 60}};
}

/**
 * The JD lookups at the pass's end: Proseware's Product Designer is confidently on Lever, Lucerne
 * Publishing's two Greenhouse postings are maybes (unsure), anything else a link or board finds is
 * no, and Sonnet's search finds nothing.
 */
function lookupAnswer(request: FakeRequest): FakeAnswer {
  const tool = toolOf(request);
  if (tool === 'submit_posting_check') {
    const candidates = request.input.match(/^Candidate \d+, on /gm)?.length ?? 1;
    const verdict = companyOf(request) === 'Proseware' ? 'match' : companyOf(request) === 'Lucerne Publishing' ? 'maybe' : 'no';
    return {tool: {verdicts: Array.from({length: candidates}, (_, index) => ({candidate: index + 1, verdict}))}, usage: {input: 2400, output: 40}};
  }
  if (tool === 'submit_posting_reading') return {tool: PROSEWARE_READING, usage: {input: 3000, output: 200}};
  if (tool === 'submit_posting_search') return {tool: {candidates: []}, usage: {input: 5000, output: 100}};
  return {status: 400, body: {type: 'error', error: {type: 'invalid_request_error', message: `Nothing should ask ${tool}`}}};
}

/**
 * A fresh install holding the recorded history in Jobs, Business and Personal, Jobs off; the clock
 * at TURNED_ON. Mail is stored newest first, so its ids run against its dates and only the pass's
 * own order puts each confirmation before its update.
 */
async function setup() {
  const models = await fakeModels();
  const web = await fakeWeb();
  serveFixtures(web);
  const w = world({now: TURNED_ON});
  const store = w.store;
  migrateJobs(store.sqlite);
  const db = jobsDb(store.sqlite);
  const accounts = new Map(['Jobs', 'Business', 'Personal'].map((label, position) => [label, store.db.insert(t.accounts).values({
    provider: 'gmail', label, address: `user.${label.toLowerCase()}@example.com`, colour: 'ink2', icon: 'mail', position, createdAt: '2025-10-01T00:00:00.000Z',
  }).returning().get().id]));
  setSecret(store, 'anthropic_api_key', FAKE_KEYS.anthropic);

  const ids = new Map<string, number>();
  const store1 = (email: HistoryEmail, unsorted = false) => {
    const [id] = upsertMessages(store, accounts.get(email.account)!, [{
      providerId: `p-${email.key}`, threadId: `thread-${email.key}`, rfc822Id: null, fromName: email.from[0], fromAddress: email.from[1], subject: email.subject,
      snippet: email.body.slice(0, 120), bodyText: email.body, bodyHtml: null, receivedAt: email.at, senderAuth: null, attachments: [],
      unread: false, trashed: false, archived: false,
    }], {backfill: !email.triage}).inserted;
    ids.set(email.key, id!);
    // Triage's model sorted it when it came (its job here is spent).
    if (email.triage && !unsorted) {
      store.db.update(t.messages).set({...email.triage, kind: email.triage.kind as never, type: email.triage.type as never, triageSource: 'cheap_model', triagedAt: email.at})
        .where(eq(t.messages.id, id!)).run();
    }
    store.db.update(t.jobs).set({state: 'done', finishedAt: TURNED_ON}).where(eq(t.jobs.kind, 'triage')).run();
    return id!;
  };
  for (const email of [...HISTORY_EMAILS].reverse()) store1(email);

  // Each email's Haiku answers that went through, by subject: never more than one.
  const answered: string[] = [];
  let down = false;
  models.answer(request => {
    if (toolOf(request) !== 'submit_job_email') return lookupAnswer(request);
    if (down) return 'overloaded';
    const subject = subjectOf(request);
    const answer = emailAnswer(BY_SUBJECT.get(subject) ?? extra.get(subject));
    if (typeof answer === 'object' && 'tool' in answer) answered.push(subject);
    return answer;
  });
  const extra = new Map<string, HistoryEmail>();

  const c = await signedIn(w, {routes: [jobsApi(store)]});
  let reader = new JobsReader({store, endpoints: models.endpoints, timeoutMs: 2000, web: web.web});
  let engine = new SyncEngine({store, adapters: new Adapters(), workers: [reader]});
  const due = () => store.db.select({id: t.jobs.id}).from(t.jobs)
    .where(and(eq(t.jobs.kind, 'jobs_read'), eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, store.now().toISOString()))).all().length;
  const drain = async () => {
    for (let round = 0; round < 60; round += 1) {
      await engine.tick();
      await engine.settled();
      if (!due()) return;
    }
    throw new Error('Jobs kept coming');
  };
  /** A new process: a fresh reader on a fresh engine, never nudged. */
  const restart = () => {
    reader = new JobsReader({store, endpoints: models.endpoints, timeoutMs: 2000, web: web.web});
    engine = new SyncEngine({store, adapters: new Adapters(), workers: [reader]});
  };
  const turn = async (enabled: boolean, more: Record<string, unknown> = {}) => {
    const response = await c.send('PATCH', '/api/jobs/settings', {body: {enabled, ...more}});
    expect(response.status).toBe(200);
    return jobsSettingsSchema.parse(response.body);
  };
  const reads = [{account_id: accounts.get('Jobs')!, reads: 'every'}, {account_id: accounts.get('Business')!, reads: 'career'}];
  const page = async () => jobsPageSchema.parse((await c.send('GET', '/api/jobs')).body);
  const applications = () => db.select().from(j.jobsApplications).orderBy(asc(j.jobsApplications.id)).all();
  const eventsOf = (applicationId: number) =>
    db.select().from(j.jobsEvents).where(eq(j.jobsEvents.applicationId, applicationId)).orderBy(asc(j.jobsEvents.at), asc(j.jobsEvents.id)).all();
  const read = (key: string) => db.select().from(j.jobsEmailsRead).where(eq(j.jobsEmailsRead.messageId, ids.get(key)!)).get();
  const lookupJobs = () => store.db.select().from(t.jobs).where(like(t.jobs.key, 'jobs_jd:%')).orderBy(asc(t.jobs.id)).all();
  const ledger = (purpose: string) => store.db.select().from(t.aiUsage).where(eq(t.aiUsage.purpose, purpose as never)).all();
  return {
    w, store, db, models, c, ids, accounts, answered, reads, extra, store1, drain, restart, turn, page, applications, eventsOf, read, lookupJobs, ledger,
    setDown: (value: boolean) => (down = value),
    get reader() {
      return reader;
    },
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Turns Jobs on reading Jobs (every email) and Business (Career), and lets the pass run to its end. */
async function runPass(s: Setup) {
  const settings = await s.turn(true, {accounts: s.reads});
  await s.drain();
  return settings;
}

describe('a recorded history (Done when)', () => {
  test('makes the expected applications: updates find their confirmations, closed ones get no JD, old silent ones are Ghosted, the unsure go to From history', async () => {
    const s = await setup();
    const started = await s.turn(true, {accounts: s.reads});
    expect(started.history).toEqual({state: 'running', read: 0, total: READ.length, started_at: TURNED_ON, finished_at: null});
    await s.drain();

    const apps = s.applications();
    const named = (id: number | null) => (id === null ? null : `${apps.find(other => other.id === id)!.company}`);
    expect(apps.map(row => ({
      company: row.company, title: row.title, requisitionId: row.requisitionId, status: row.status, step: row.step,
      account: [...s.accounts].find(([, id]) => id === row.accountId)![0], reappliedFrom: named(row.reappliedFromId),
    }))).toEqual([
      {company: 'Trey Research', title: 'Data Engineer', requisitionId: null, status: 'applied', step: null, account: 'Jobs', reappliedFrom: null},
      {company: 'Wingtip Toys', title: 'Support Engineer', requisitionId: null, status: 'rejected', step: null, account: 'Jobs', reappliedFrom: null},
      {company: 'Coho Winery', title: 'Marketing Analyst', requisitionId: null, status: 'rejected', step: null, account: 'Jobs', reappliedFrom: null},
      {company: 'Blue Yonder Airlines', title: 'IT Support Specialist', requisitionId: null, status: 'applied', step: null, account: 'Jobs', reappliedFrom: null},
      {company: 'School of Fine Art', title: 'Records Clerk', requisitionId: null, status: 'rejected', step: null, account: 'Business', reappliedFrom: null},
      {company: 'Relecloud', title: 'Cloud Support Associate', requisitionId: 'R-310', status: 'applied', step: null, account: 'Jobs', reappliedFrom: null},
      {company: 'Relecloud', title: 'Cloud Support Associate', requisitionId: 'R-322', status: 'applied', step: null, account: 'Jobs', reappliedFrom: null},
      {company: 'Fourth Coffee', title: 'Junior Data Analyst', requisitionId: null, status: 'rejected', step: null, account: 'Jobs', reappliedFrom: null},
      {company: 'Tailspin Toys', title: 'Full Stack Developer', requisitionId: null, status: 'applied', step: null, account: 'Jobs', reappliedFrom: null},
      {company: 'City Power & Light', title: 'IT Technician II', requisitionId: null, status: 'applied', step: null, account: 'Business', reappliedFrom: null},
      {company: 'Proseware', title: 'Product Designer', requisitionId: null, status: 'in_process', step: 'Interview Wed Sep 30, 11:00 AM', account: 'Jobs', reappliedFrom: null},
      {company: 'Fourth Coffee', title: 'Junior Data Analyst', requisitionId: null, status: 'in_process', step: 'Interview Thu Sep 24, 1:00 PM', account: 'Jobs', reappliedFrom: 'Fourth Coffee'},
      {company: 'Lucerne Publishing', title: 'Junior Developer', requisitionId: null, status: 'applied', step: null, account: 'Jobs', reappliedFrom: null},
    ]);
    // Each Applied date is its confirmation's.
    const at = (key: string) => HISTORY_EMAILS.find(email => email.key === key)!.at;
    expect(apps.map(row => row.appliedAt)).toEqual(['trey-applied', 'wingtip-applied', 'coho-applied', 'blueyonder-applied', 'school-applied', 'relecloud-310', 'relecloud-322',
      'fourth-applied', 'tailspin-applied', 'city-applied', 'proseware-applied', 'fourth-reapplied', 'lucerne-applied'].map(at));

    // Updates found the confirmations read before them, though stored before them.
    const timeline = (index: number) => s.eventsOf(apps[index]!.id).map(event => [event.kind, event.messageId]);
    expect(timeline(2)).toEqual([['applied', s.ids.get('coho-applied')], ['assessment', s.ids.get('coho-assessment')], ['rejection', s.ids.get('coho-rejected')]]);
    expect(s.ids.get('coho-rejected')!).toBeLessThan(s.ids.get('coho-applied')!);
    expect(timeline(1).map(([kind]) => kind)).toEqual(['applied', 'rejection']);
    // Business's backfilled confirmation, typed Other by the rules, found its rejection (D355).
    expect(timeline(4)).toEqual([['applied', s.ids.get('school-applied')], ['rejection', s.ids.get('school-rejected')]]);
    expect(timeline(7).map(([kind]) => kind)).toEqual(['applied', 'verification', 'form', 'rejection']);
    expect(timeline(8).map(([kind]) => kind)).toEqual(['match', 'applied']);
    expect(timeline(11).map(([kind]) => kind)).toEqual(['applied', 'interview']);

    // The page: Ghosted from the clock, the unsure in From history, nothing in today's Needs you.
    const page = await s.page();
    expect(page.history).toEqual({state: 'done', read: READ.length, total: READ.length, started_at: TURNED_ON, finished_at: TURNED_ON});
    expect(page.counts).toEqual({all: 13, ghosted: 6, by_status: {applied: 7, in_process: 2, offer: 0, rejected: 4, withdrawn: 0}});
    expect(page.rows.filter(row => row.ghosted).map(row => row.company).sort())
      .toEqual(['Blue Yonder Airlines', 'City Power & Light', 'Relecloud', 'Relecloud', 'Tailspin Toys', 'Trey Research']);
    expect(page.needs_you).toEqual([]);
    expect(page.from_history.map(item => [item.kind, item.reason, item.company, item.title, item.from_history])).toEqual([
      ['update_to_assign', 'names_other_role', 'Proseware', 'UX Researcher', true],
      ['jd_to_confirm', 'unsure_posting', 'Lucerne Publishing', 'Junior Developer', true],
      ['update_to_assign', 'matches_several', 'Relecloud', 'Cloud Support Associate', true],
      ['email_to_track', 'no_application', 'Alpine Ski House', 'Operations Analyst', true],
      ['email_to_track', 'no_application', 'Graphic Design Institute', 'Program Coordinator', true],
    ]);
    expect(page.from_history[1]!.candidates.map(candidate => candidate.title)).toEqual(['Junior Developer', 'Junior Developer, Digital']);

    // JDs only for the ones still open, looked up only once the pass was done.
    const jd = (company: string, status?: string) => page.rows.find(row => row.company === company && (!status || row.status === status))!.jd.state;
    expect(['Wingtip Toys', 'Coho Winery'].map(company => jd(company))).toEqual(['none', 'none']);
    expect(jd('Fourth Coffee', 'rejected')).toBe('none');
    expect(jd('Proseware')).toBe('found');
    expect(jd('Lucerne Publishing')).toBe('candidates');
    expect(['Trey Research', 'Blue Yonder Airlines', 'Tailspin Toys', 'City Power & Light'].map(company => jd(company))).toEqual(Array(4).fill('not_found'));
    expect(jd('Fourth Coffee', 'in_process')).toBe('not_found');
    const closed = apps.filter(row => row.status === 'rejected').map(row => `jobs_jd:${row.id}`);
    const looked = s.lookupJobs();
    expect(looked.map(job => job.key).sort()).toEqual(apps.filter(row => row.status !== 'rejected').map(row => `jobs_jd:${row.id}`).sort());
    expect(looked.some(job => closed.includes(job.key))).toBe(false);
    expect(looked.every(job => job.createdAt >= page.history.finished_at!)).toBe(true);

    // Each email read once, through J2's reader; never the mail Jobs mustn't read.
    expect(s.answered.sort()).toEqual(READ.map(email => email.subject).sort());
    expect(s.ledger('jobs_emails')).toHaveLength(READ.length);
    for (const key of NEVER_READ) expect(s.read(key)).toBeUndefined();
    expect(s.read('school-rejected')).toMatchObject({outcome: 'event', event: 'rejection'});
    expect(s.read('graphic-interview')).toMatchObject({outcome: 'needs_you', event: 'interview'});
    // The backfill's newsletter, and live Business mail typed a confirmation but not Career, stay unread.
    expect(NEVER_READ).toEqual(['business-order', 'nod-digest', 'margies-booking', 'personal-applied']);
    expect(s.read('contoso-recruiter')).toMatchObject({outcome: 'ignored'});

    // A JD to confirm the history pass's lookup made is From history's; Look it up by hand makes today's.
    const lucerne = apps.at(-1)!.id;
    expect(requestLookup(s.store, lucerne)).toBe('looking');
    await s.drain();
    const after = await s.page();
    expect(after.needs_you.map(item => [item.kind, item.company, item.from_history])).toEqual([['jd_to_confirm', 'Lucerne Publishing', false]]);
    expect(after.from_history.map(item => item.company)).toEqual(['Proseware', 'Relecloud', 'Alpine Ski House', 'Graphic Design Institute']);
  });

  test('a second turn-on reads nothing, and off then on again leaves the pass as it was', async () => {
    const s = await setup();
    await runPass(s);
    const done = (await s.page()).history;
    const asked = s.models.requests.length;

    s.w.advance(60 * 60_000);
    expect((await s.turn(true)).history).toEqual(done);
    expect((await s.turn(false)).enabled).toBe(false);
    s.w.advance(60 * 60_000);
    const on = await s.turn(true);
    expect(on).toMatchObject({enabled: true, history: done});
    await s.drain();
    expect(s.models.requests).toHaveLength(asked);
    expect(s.ledger('jobs_emails')).toHaveLength(READ.length);
    expect(s.store.db.select().from(t.jobs).where(eq(t.jobs.key, HISTORY_KEY)).all().filter(job => job.state !== 'done')).toEqual([]);
  });
});


describe('durable, with its progress (Done when)', () => {
  test('a pass stopped halfway goes on from there after a restart, reading and charging nothing twice; its counts are right throughout', async () => {
    const s = await setup();
    const progress = () => liveEvents(s.w).flatMap(event => (event.type === 'jobs' && event.history ? [event.history] : []));
    // The AI goes down after ten emails.
    let calls = 0;
    s.models.answer(request => {
      if (toolOf(request) !== 'submit_job_email') return lookupAnswer(request);
      calls += 1;
      // A second on, so the failure is after the last success.
      s.w.advance(1000);
      if (calls > 10) return 'overloaded';
      s.answered.push(subjectOf(request));
      return emailAnswer(BY_SUBJECT.get(subjectOf(request)));
    });
    await s.turn(true, {accounts: s.reads});
    expect(progress()[0]).toEqual({state: 'running', read: 0, total: READ.length, started_at: TURNED_ON, finished_at: null});
    await s.drain();

    // Ten read, waiting while the AI is down, as the page's reading line says.
    let page = await s.page();
    expect(page.history).toEqual({state: 'waiting', read: 10, total: READ.length, started_at: TURNED_ON, finished_at: null});
    expect(page.reading).toMatchObject({state: 'down', reason: 'Anthropic: Overloaded (529)', retrying: true, waiting: 0});
    // Each email read moved it on; the AI going down said so.
    expect(progress().map(each => each.read)).toEqual([0, ...Array.from({length: 10}, (_, index) => index + 1), 10]);
    expect(progress().at(-1)!.state).toBe('waiting');
    expect(s.ledger('jobs_emails')).toHaveLength(10);
    // The oldest ten, in order.
    expect(s.answered).toEqual(READ.slice(0, 10).map(email => email.subject));
    // No JD is looked up while the pass runs.
    expect(s.lookupJobs()).toEqual([]);

    // Mail arriving meanwhile is the live reader's: the total stays as it was.
    const arrival: HistoryEmail = {
      key: 'woodgrove-applied', account: 'Jobs', at: '2026-10-08T00:30:00.000Z', from: ['Woodgrove Bank Careers', 'careers@woodgrovebank.example'],
      subject: 'Application received: Junior Developer', body: 'Thank you for applying to Junior Developer at Woodgrove Bank.',
      triage: {lane: 'fyi', kind: 'career', type: 'confirmation', organisation: 'Woodgrove Bank', via: 'Workday', summary: 'Junior Developer application received'},
      jobs: {event: 'confirmation', company: 'Woodgrove Bank', title: 'Junior Developer', requisition_id: null, line: null},
    };
    s.extra.set(arrival.subject, arrival);
    s.w.at('2026-10-08T00:31:00.000Z');
    s.store1(arrival);
    expect((await s.page()).history).toMatchObject({read: 10, total: READ.length});

    // The process dies while the pass's job is running; a new one takes it up once its lease runs out.
    s.store.db.update(t.jobs).set({state: 'running', leaseUntil: new Date(s.store.now().getTime() + LEASE_MS).toISOString()})
      .where(eq(t.jobs.key, HISTORY_KEY)).run();
    s.models.answer(request => {
      if (toolOf(request) !== 'submit_job_email') return lookupAnswer(request);
      const subject = subjectOf(request);
      s.answered.push(subject);
      return emailAnswer(BY_SUBJECT.get(subject) ?? s.extra.get(subject));
    });
    s.restart();
    s.w.advance(LEASE_MS + 60_000);
    await s.drain();

    page = await s.page();
    expect(page.history).toEqual({state: 'done', read: READ.length, total: READ.length, started_at: TURNED_ON, finished_at: s.store.now().toISOString()});
    expect(page.reading).toMatchObject({state: 'healthy', waiting: 0});
    // Every email asked about once, and charged for once, the arrival included.
    expect(s.answered.sort()).toEqual([...READ.map(email => email.subject), arrival.subject].sort());
    expect(s.ledger('jobs_emails')).toHaveLength(READ.length + 1);
    expect(page.counts.all).toBe(14);
    // The arrival is today's: looked up as it came, with nothing of it in From history.
    expect(s.read('woodgrove-applied')).toMatchObject({outcome: 'application'});
    expect(page.rows.find(row => row.company === 'Woodgrove Bank')!.jd.state).toBe('not_found');
    expect(progress().at(-1)).toMatchObject({state: 'done', read: READ.length});
  });

  test('an email triage hasn\'t sorted holds the pass open until it has', async () => {
    const s = await setup();
    const late: HistoryEmail = {
      key: 'margies-applied', account: 'Jobs', at: '2026-10-07T23:00:00.000Z', from: ['Margie\'s Travel', 'careers@margiestravel.example'],
      subject: 'Application received: Associate Developer', body: 'We received your application for Associate Developer.',
      triage: {lane: 'fyi', kind: 'career', type: 'confirmation', organisation: 'Margie\'s Travel', via: 'Greenhouse', summary: 'Associate Developer application received'},
      jobs: {event: 'confirmation', company: 'Margie\'s Travel', title: 'Associate Developer', requisition_id: null, line: null},
    };
    s.extra.set(late.subject, late);
    const id = s.store1(late, true);
    const settings = await s.turn(true, {accounts: s.reads});
    expect(settings.history).toMatchObject({state: 'running', total: READ.length + 1});
    await s.drain();
    expect((await s.page()).history).toMatchObject({state: 'running', read: READ.length, total: READ.length + 1});
    expect(s.lookupJobs()).toEqual([]);

    // Triage sorts it and tells Jobs.
    s.store.db.update(t.messages).set({...late.triage!, kind: 'career', type: 'confirmation', triageSource: 'cheap_model', triagedAt: TURNED_ON}).where(eq(t.messages.id, id)).run();
    s.reader.nudge();
    await s.drain();
    const page = await s.page();
    expect(page.history).toMatchObject({state: 'done', read: READ.length + 1});
    expect(page.rows.find(row => row.company === 'Margie\'s Travel')).toMatchObject({status: 'applied'});
    expect(s.lookupJobs().length).toBeGreaterThan(0);
  });
});

describe('turning Jobs on and off (Settings › Jobs)', () => {
  test('off stops the pass where it is; on again reads what\'s left and what came while it was off, as history, never again what it read', async () => {
    const s = await setup();
    let calls = 0;
    s.models.answer(request => {
      if (toolOf(request) !== 'submit_job_email') return lookupAnswer(request);
      calls += 1;
      s.w.advance(1000);
      if (calls > 5) return 'overloaded';
      s.answered.push(subjectOf(request));
      return emailAnswer(BY_SUBJECT.get(subjectOf(request)) ?? s.extra.get(subjectOf(request)));
    });
    await s.turn(true, {accounts: s.reads});
    await s.drain();
    expect((await s.page()).history).toMatchObject({state: 'waiting', read: 5});

    expect(await s.turn(false)).toMatchObject({enabled: false});
    s.models.answer(request => {
      if (toolOf(request) !== 'submit_job_email') return lookupAnswer(request);
      s.answered.push(subjectOf(request));
      return emailAnswer(BY_SUBJECT.get(subjectOf(request)) ?? s.extra.get(subjectOf(request)));
    });
    s.w.advance(60 * 60_000);
    await s.drain();
    // Off: nothing read, nothing looked up.
    expect(s.answered).toHaveLength(5);
    expect(s.lookupJobs()).toEqual([]);

    // Mail while it's off.
    const whileOff: HistoryEmail = {
      key: 'wideworld-applied', account: 'Jobs', at: '2026-10-09T16:00:00.000Z', from: ['Wide World Importers', 'careers@wideworldimporters.example'],
      subject: 'Thanks for applying: Logistics Analyst', body: 'Thanks for applying for Logistics Analyst.',
      triage: {lane: 'fyi', kind: 'career', type: 'confirmation', organisation: 'Wide World Importers', via: null, summary: 'Logistics Analyst application received'},
      jobs: {event: 'confirmation', company: 'Wide World Importers', title: 'Logistics Analyst', requisition_id: null, line: null},
    };
    s.extra.set(whileOff.subject, whileOff);
    s.w.at('2026-10-09T16:01:00.000Z');
    s.store1(whileOff);
    s.w.at('2026-10-10T16:00:00.000Z');
    const on = await s.turn(true);
    // Still waiting: the AI hasn't answered since it went down.
    expect(on.history).toEqual({state: 'waiting', read: 0, total: READ.length - 5 + 1, started_at: '2026-10-10T16:00:00.000Z', finished_at: null});
    await s.drain();
    expect((await s.page()).history).toMatchObject({state: 'done', read: READ.length - 5 + 1, total: READ.length - 5 + 1});
    expect(s.answered.sort()).toEqual([...READ.map(email => email.subject), whileOff.subject].sort());
    expect(s.ledger('jobs_emails')).toHaveLength(READ.length + 1);
    // Mail while it was off was read as history: its application waited for the pass's end for its JD.
    expect(s.applications().find(row => row.company === 'Wide World Importers')).toMatchObject({jdLookupFromHistory: true});
  });

  test('an account added while it\'s on has its history read; a fresh install turned on with nothing to read is done at 0', async () => {
    const s = await setup();
    const empty = await s.turn(true);
    expect(empty).toMatchObject({enabled: true, accounts: [], history: {state: 'done', read: 0, total: 0}});
    s.models.answer(request => {
      if (toolOf(request) !== 'submit_job_email') return lookupAnswer(request);
      const subject = subjectOf(request);
      s.answered.push(subject);
      // Personal's confirmation, read now its account is listed.
      return subject === 'Application received: Video Editor'
        ? {tool: {event: 'confirmation', company: 'Southridge Video', title: 'Video Editor', requisition_id: null, line: null}}
        : emailAnswer(BY_SUBJECT.get(subject));
    });
    const personal = await s.turn(true, {accounts: [{account_id: s.accounts.get('Personal')!, reads: 'career'}]});
    expect(personal.history).toMatchObject({state: 'running', read: 0, total: 1});
    await s.drain();
    expect(s.answered).toEqual(['Application received: Video Editor']);
    expect(s.applications().map(row => row.company)).toEqual(['Southridge Video']);
  });

  test('the settings answer only behind the session, and refuse an account mail doesn\'t have or one listed twice', async () => {
    const s = await setup();
    expect((await client(s.w, {routes: [jobsApi(s.store)]}).send('PATCH', '/api/jobs/settings', {body: {enabled: true}})).status).toBe(401);
    const missing = await s.c.send('PATCH', '/api/jobs/settings', {body: {accounts: [{account_id: 999, reads: 'every'}]}});
    expect(missing).toMatchObject({status: 400, body: {error: {code: 'invalid_input', details: {accounts: [999]}}}});
    const twice = await s.c.send('PATCH', '/api/jobs/settings', {body: {accounts: [...s.reads, s.reads[0]]}});
    expect(twice.status).toBe(400);
    expect((await s.c.send('GET', '/api/jobs/settings')).body).toEqual({
      enabled: false, accounts: [], history: {state: 'not_started', read: 0, total: 0, started_at: null, finished_at: null}, from_history: 0, applications: 0,
    });
    expect(s.models.requests).toEqual([]);
  });
});

describe('Dismiss all and its Undo (D324)', () => {
  test('clears From history, the same as ignoring each item, and Undo brings back what it dismissed', async () => {
    const s = await setup();
    await runPass(s);
    const before = await s.page();
    const reads = s.db.select().from(j.jobsEmailsRead).orderBy(asc(j.jobsEmailsRead.messageId)).all();
    const events = liveEvents(s.w).length;

    const dismissed = await s.c.send('POST', '/api/jobs/from-history/dismiss');
    expect(dismissed.status).toBe(200);
    const {needs_you: ids} = jobsDismissedSchema.parse(dismissed.body);
    expect(ids.sort()).toEqual(before.from_history.map(item => item.id).sort());
    let page = await s.page();
    expect(page.from_history).toEqual([]);
    // Those emails make nothing: no application, event or read changes, and today's is untouched.
    expect(page.rows).toEqual(before.rows);
    expect(page.needs_you).toEqual(before.needs_you);
    expect(s.db.select().from(j.jobsEmailsRead).orderBy(asc(j.jobsEmailsRead.messageId)).all()).toEqual(reads);
    expect(s.db.select().from(j.jobsNeedsYou).where(isNull(j.jobsNeedsYou.resolvedAt)).all()).toEqual([]);
    expect(liveEvents(s.w).slice(events)).toEqual([{type: 'jobs', applications: [], needs_you: ids}]);
    expect(jobsSettingsSchema.parse((await s.c.send('GET', '/api/jobs/settings')).body).from_history).toBe(0);
    // Again, nothing's left to dismiss.
    expect((await s.c.send('POST', '/api/jobs/from-history/dismiss')).body).toEqual({needs_you: []});

    const undone = await s.c.send('POST', '/api/jobs/from-history/undo', {body: {needs_you: ids}});
    expect(undone.status).toBe(200);
    expect(jobsDismissedSchema.parse(undone.body).needs_you.sort()).toEqual(ids);
    page = await s.page();
    expect(page.from_history).toEqual(before.from_history);
    // Only what Dismiss all dismissed comes back, once.
    expect((await s.c.send('POST', '/api/jobs/from-history/undo', {body: {needs_you: ids}})).body).toEqual({needs_you: []});
    expect((await s.c.send('POST', '/api/jobs/from-history/undo', {body: {needs_you: []}})).status).toBe(400);
  });

  test('on the seed: six dismissed, today\'s three stay, and Undo brings the six back', async () => {
    const w = world({seed: true});
    const c = await signedIn(w, {routes: [jobsApi(w.store)]});
    const {needs_you: ids} = jobsDismissedSchema.parse((await c.send('POST', '/api/jobs/from-history/dismiss')).body);
    expect(ids).toHaveLength(6);
    expect(jobsPage(w.store)).toMatchObject({from_history: [], needs_you: [{}, {}, {}], counts: {all: 62}});
    await c.send('POST', '/api/jobs/from-history/undo', {body: {needs_you: ids}});
    expect(jobsPage(w.store).from_history).toHaveLength(6);
    expect((await client(w, {routes: [jobsApi(w.store)]}).send('POST', '/api/jobs/from-history/dismiss')).status).toBe(401);
  });
});

test('the live event carries the pass\'s progress, and two in one transaction merge to the later', () => {
  const w = world();
  migrateJobs(w.store.sqlite);
  const progress = (read: number): JobsHistoryOut => ({state: 'running', read, total: 330, started_at: TURNED_ON, finished_at: null});
  w.store.sqlite.transaction(() => {
    w.store.live!.note({type: 'jobs', applications: [1], needs_you: [], history: progress(139)});
    w.store.live!.note({type: 'jobs', applications: [2], needs_you: [5], history: progress(140)});
    w.store.live!.note({type: 'jobs', applications: [], needs_you: []});
  })();
  w.store.live!.flush();
  expect(liveEvents(w)).toEqual([{type: 'jobs', applications: [1, 2], needs_you: [5], history: progress(140)}]);
});
