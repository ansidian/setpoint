// The JD lookup as it runs (J3), against an ephemeral database holding the seed's mail, with the
// hiring platforms and posting pages (./fakeWeb.ts) and Anthropic (Haiku's check and reading, Sonnet
// with its web search, in the tool's real response shape) faked at the HTTP boundary. Jobs's own
// sample is cleared, so each test makes the applications it looks up, with their emails, as J2
// leaves them. The Done-when list: confident, unsure (three at most), not found and failed, a failed
// lookup retrying while a not-found one doesn't, a saved JD never overwritten, Look it up by hand on a
// closed application, and the seed loading with its numbers and triggering nothing.
import {jobsPageSchema, SEED_NOW} from '@setpoint/shared';
import {and, asc, eq, like, lte} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import {FAKE_KEYS, fakeModels} from '../../../tests/fakeModels.ts';
import type {FakeAnswer, FakeRequest} from '../../../tests/fakeModels.ts';
import {liveEvents, signedIn, world} from '../../../tests/helpers.ts';
import * as t from '../../db/schema.ts';
import {costMicros} from '../../domain/aiCost.ts';
import {setSecret} from '../../secrets/store.ts';
import {SyncEngine} from '../../sync/engine.ts';
import {upsertMessages} from '../../sync/mailMirror.ts';
import {Adapters} from '../../sync/registry.ts';
import {jobsApi} from '../api.ts';
import {jobsDb} from '../db.ts';
import {LOOKUP_COOL_OFF_MS, lookUpJd, lookupKey, queueDueLookups, requestLookup} from '../lookup.ts';
import {NO_JOBS_KEY} from '../models.ts';
import {applicationDetail, jobsPage} from '../queries.ts';
import {JobsReader} from '../reader.ts';
import * as j from '../schema.ts';
import {fakeWeb, fixture, htmlPage, serveFixtures, TEST_APIS} from './fakeWeb.ts';

// Real HTTP round trips to the fakes, a few dozen per test.
vi.setConfig({testTimeout: 30_000});

type Tool = 'submit_posting_check' | 'submit_posting_reading' | 'submit_posting_search' | 'submit_job_email';
const toolOf = (request: FakeRequest): Tool => request.body.tools.map((tool: {name: string}) => tool.name).find((name: string) => name.startsWith('submit_'));

const LUCERNE_READING = {
  summary: 'A junior developer on the digital team, building reading apps in TypeScript and React.\nYou ship features with a senior engineer beside you and test what you ship.\nThey want someone eager to learn who has built something real.',
  location: 'New York, NY', workplace: 'hybrid', workplace_detail: '3 days', salary: '$80,000–$95,000',
  must_haves: ['JavaScript or TypeScript', 'Git and code review', 'A CS degree or equivalent experience'], nice_to_haves: ['React Native', 'Accessibility work'],
};

/** Sonnet's answer with its web search, in the tool's real shape: the query, the results, then its answer's tool. */
function searched(candidates: unknown[], searches = 2): FakeAnswer {
  return {status: 200, body: {
    id: 'msg_search', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null,
    content: [
      {type: 'text', text: 'I\'ll look for the posting on the employer\'s careers site.'},
      {type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: {query: 'Fabrikam Data Analyst Atlanta careers'}},
      {type: 'web_search_tool_result', tool_use_id: 'srvtoolu_01', content: [
        {type: 'web_search_result', url: 'https://fabrikam.example/careers/data-analyst-2291', title: 'Data Analyst | Careers at Fabrikam', encrypted_content: 'EqgfCioIARgBIiQ3YTAw', page_age: 'September 29, 2026'},
      ]},
      {type: 'text', text: 'This is the posting.', citations: [{type: 'web_search_result_location', url: 'https://fabrikam.example/careers/data-analyst-2291', title: 'Data Analyst | Careers at Fabrikam', encrypted_index: 'Eo8BCioIAhgB', cited_text: 'Data Analyst, Atlanta, GA'}]},
      {type: 'tool_use', id: 'toolu_search', name: 'submit_posting_search', input: {candidates}},
    ],
    usage: {input_tokens: 5200, output_tokens: 310, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: {web_search_requests: searches}},
  }};
}

interface EmailCopy {
  kind: 'applied' | 'match' | 'duplicate';
  from: [string, string];
  subject: string;
  body: string;
  html?: string;
}

interface Made {
  company: string;
  title: string;
  platform: string | null;
  appliedAt?: string;
  requisitionId?: string | null;
  status?: 'applied' | 'in_process' | 'offer' | 'rejected' | 'withdrawn';
  jdLookup?: 'none' | 'looking' | 'candidates' | 'not_found';
  emails?: EmailCopy[];
}

/** The seed's mail and Jobs's worker with the fake web, Jobs's own sample cleared, on as the seed has it. */
async function setup({key = true}: {key?: boolean} = {}) {
  const models = await fakeModels();
  const web = await fakeWeb();
  serveFixtures(web);
  const w = world({seed: true});
  const store = w.store;
  const db = jobsDb(store.sqlite);
  for (const table of [j.jobsEvents, j.jobsNeedsYou, j.jobsPostings, j.jobsJdCandidates, j.jobsHandSet, j.jobsEmailsRead, j.jobsBlockedEmails, j.jobsApplications]) db.delete(table).run();
  // Turned on now, so the seed's mail (its record of what was read just cleared) isn't read again.
  db.update(j.jobsSettings).set({enabledAt: SEED_NOW}).run();
  if (key) setSecret(store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  const accountId = store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Jobs')).get()!.id;
  const reader = new JobsReader({store, endpoints: models.endpoints, timeoutMs: 2000, web: web.web});
  const engine = new SyncEngine({store, adapters: new Adapters(), workers: [reader]});
  const due = () => store.db.select({id: t.jobs.id}).from(t.jobs)
    .where(and(eq(t.jobs.kind, 'jobs_read'), eq(t.jobs.state, 'queued'), lte(t.jobs.runAt, store.now().toISOString()))).all().length;
  const drain = async () => {
    for (let round = 0; round < 30; round += 1) {
      await engine.tick();
      await engine.settled();
      if (!due()) return;
    }
    throw new Error('Jobs kept coming');
  };
  let emails = 0;
  /** An application as J2's confirmation leaves it: `looking` for its JD, its emails in the Jobs account. */
  const make = ({company, title, platform, appliedAt = '2026-10-05T17:20:00.000Z', requisitionId = null, status = 'applied', jdLookup = 'looking', emails: copies = []}: Made) => {
    const {id} = db.insert(j.jobsApplications).values({
      company, title, titleKey: title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), requisitionId, platform, accountId, appliedAt, status, statusSetBy: 'email',
      statusSetAt: appliedAt, jdLookup, jdLookupAt: jdLookup === 'none' ? null : appliedAt, createdAt: appliedAt, updatedAt: appliedAt,
    }).returning({id: j.jobsApplications.id}).get();
    copies.forEach((copy, index) => {
      emails += 1;
      const at = new Date(Date.parse(appliedAt) + index * 60_000).toISOString();
      const [messageId] = upsertMessages(store, accountId, [{
        providerId: `lookup-${emails}`, threadId: `lookup-thread-${emails}`, rfc822Id: null, fromName: copy.from[0], fromAddress: copy.from[1], subject: copy.subject,
        snippet: copy.body.slice(0, 120), bodyText: copy.body, bodyHtml: copy.html ?? null, receivedAt: at, senderAuth: null, attachments: [],
        unread: false, trashed: false, archived: false,
      }]).inserted;
      db.insert(j.jobsEvents).values({applicationId: id, at, kind: copy.kind, sender: copy.from[0], subject: copy.subject, messageId: messageId!, createdAt: at}).run();
      // J2 read it already.
      db.insert(j.jobsEmailsRead).values({messageId: messageId!, readAt: at, outcome: index === 0 ? 'application' : 'event', at, applicationId: id}).run();
    });
    return id;
  };
  const answers = (by: Partial<Record<Tool, (request: FakeRequest) => FakeAnswer>>) => models.answer(request => {
    const answer = by[toolOf(request)];
    return answer ? answer(request) : {status: 400, body: {type: 'error', error: {type: 'invalid_request_error', message: `Nothing should ask ${toolOf(request)}`}}};
  });
  const asked = () => models.requests.map(toolOf);
  const posting = (id: number) => db.select().from(j.jobsPostings).where(eq(j.jobsPostings.applicationId, id)).get();
  const application = (id: number) => db.select().from(j.jobsApplications).where(eq(j.jobsApplications.id, id)).get()!;
  const lookupJobs = (id: number) => store.db.select().from(t.jobs).where(eq(t.jobs.key, lookupKey(id))).orderBy(asc(t.jobs.id)).all();
  const ledger = () => store.db.select().from(t.aiUsage).orderBy(asc(t.aiUsage.id)).all();
  const options = {web: web.web, endpoints: models.endpoints, timeoutMs: 2000, signal: new AbortController().signal};
  return {w, store, db, models, web, reader, engine, drain, make, answers, asked, posting, application, lookupJobs, ledger, options};
}

const LUCERNE: Made = {
  company: 'Lucerne Publishing', title: 'Junior Developer', platform: 'Greenhouse',
  emails: [{kind: 'applied', from: ['Lucerne Publishing', 'no-reply@us.greenhouse-mail.example'], subject: 'Thank you for your application to Lucerne Publishing', body: 'Hi, thank you for applying to Junior Developer at Lucerne Publishing in New York. Our team will review it.'}],
};
const match = (verdicts: string[]) => () => ({tool: {verdicts: verdicts.map((verdict, index) => ({candidate: index + 1, verdict}))}, usage: {input: 2400, output: 40}});
const reading = (tool: Record<string, unknown>) => () => ({tool, usage: {input: 1800, output: 260}});

describe('confident (decision 54)', () => {
  test('a platform\'s posting the check is sure of is saved silently, with what Haiku read in it', async () => {
    const s = await setup();
    const id = s.make(LUCERNE);
    s.answers({submit_posting_check: match(['match', 'no']), submit_posting_reading: reading(LUCERNE_READING)});
    await s.drain();

    // Greenhouse alone (triage named it), the board by the company's name; then Haiku twice, never Sonnet.
    expect(s.web.asked()).toEqual(['api.greenhouse.example/v1/boards/lucernepublishing/jobs']);
    expect(s.asked()).toEqual(['submit_posting_check', 'submit_posting_reading']);
    const check = s.models.requests[0]!;
    expect(check.model).toBe('claude-haiku-5-5');
    expect(check.input).toContain('Company: Lucerne Publishing\nRole: Junior Developer\nApplied: 2026-10-05\nApplied through: Greenhouse');
    expect(check.input).toContain('thank you for applying to Junior Developer at Lucerne Publishing in New York');
    // Both titles that could be it, the exact one first; never the Senior Editor.
    expect(check.input).toContain('Candidate 1, on Greenhouse: https://greenhouse.example/lucernepublishing/jobs/5520391\nTitle: Junior Developer\nLocation: New York, NY\nPosted: 2026-09-28\nRequisition ID: LP-0412');
    expect(check.input).toContain('Candidate 2, on Greenhouse: https://greenhouse.example/lucernepublishing/jobs/5520412\nTitle: Junior Developer, Digital');
    expect(check.input).not.toContain('Senior Editor');
    expect(s.models.requests[1]!.input).toMatch(/^Employer: Lucerne Publishing\nPosting: Junior Developer\nLocation given: New York, NY\n\n## About Lucerne Publishing/);

    const detail = applicationDetail(s.store, id);
    expect(detail.jd).toEqual({state: 'found', source: 'platform', platform: 'Greenhouse', found_at: SEED_NOW, candidates: 0, looked_at: SEED_NOW, link: expect.any(String)});
    expect(detail.posting).toMatchObject({
      summary: LUCERNE_READING.summary, location: 'New York, NY', workplace: 'hybrid', workplace_detail: '3 days', salary: '$80,000–$95,000',
      must_haves: LUCERNE_READING.must_haves, nice_to_haves: LUCERNE_READING.nice_to_haves,
      link: 'https://greenhouse.example/lucernepublishing/jobs/5520391', source: 'platform', platform: 'Greenhouse', found_at: SEED_NOW,
    });
    expect(detail.posting!.full_text).toMatch(/^## About Lucerne Publishing\n\nLucerne Publishing makes reading apps/);
    // Silently: nothing in Needs you, the job done, one `jobs` event naming the application.
    expect(jobsPage(s.store).needs_you).toEqual([]);
    expect(s.lookupJobs(id).map(job => job.state)).toEqual(['done']);
    expect(liveEvents(s.w).filter(event => event.type === 'jobs')).toEqual([{type: 'jobs', applications: [id], needs_you: []}]);
    // The check and the reading are Jobs's "reading JDs", at Haiku's price.
    expect(s.ledger().map(row => [row.purpose, row.model, row.costMicros])).toEqual([
      ['jobs_reading_jds', 'claude-haiku-5-5', costMicros('anthropic', 'claude-haiku-5-5', {inputTokens: 2400, outputTokens: 40, cachedTokens: 0, cacheWriteTokens: 0})],
      ['jobs_reading_jds', 'claude-haiku-5-5', costMicros('anthropic', 'claude-haiku-5-5', {inputTokens: 1800, outputTokens: 260, cachedTokens: 0, cacheWriteTokens: 0})],
    ]);
  });

  test('a saved JD is never overwritten by a second lookup (decision 53)', async () => {
    const s = await setup();
    const id = s.make(LUCERNE);
    s.answers({submit_posting_check: match(['match', 'no']), submit_posting_reading: reading(LUCERNE_READING)});
    await s.drain();
    const saved = s.posting(id)!;
    const requests = s.models.requests.length;
    const fetches = s.web.asked().length;

    // By hand: refused, with nothing queued.
    const c = await signedIn(s.w, {routes: [jobsApi(s.store)]});
    const refused = await c.send('POST', `/api/jobs/applications/${id}/lookup`);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({error: {code: 'jd_saved', message: 'This application has its JD already, Not this posting takes it away first.'}});
    expect(requestLookup(s.store, id)).toBe('saved');
    expect(s.lookupJobs(id)).toHaveLength(1);
    // A lookup that runs anyway (one queued before the JD was saved) keeps the JD as it was.
    expect(await lookUpJd(s.store, id, s.options)).toBe('already');
    // The rescan, and a later application at the company, change nothing either.
    s.w.advance(10 * 60_000);
    await s.drain();
    expect(s.posting(id)).toEqual(saved);
    expect(s.models.requests).toHaveLength(requests);
    expect(s.web.asked()).toHaveLength(fetches);
  });

  test('the email\'s own link: Indeed\'s view-job link on its match email, before any platform', async () => {
    const s = await setup();
    const id = s.make({
      company: 'Tailspin Toys', title: 'Full Stack Developer', platform: 'Indeed', emails: [
        {kind: 'applied', from: ['Indeed', 'indeedapply@indeed.example'], subject: 'Indeed Application: Full Stack Developer', body: 'Your application has been submitted. Good luck!'},
        {kind: 'match', from: ['Indeed', 'alert@indeed.example'], subject: 'Full Stack Developer @ Tailspin Toys', body: 'Full Stack Developer\nTailspin Toys - Denver, CO\n$85,000 - $105,000 a year',
          html: '<a href="https://indeed.example/viewjob?jk=7c1e9a24f0b3&amp;from=jobmatch">Full Stack Developer</a> <a href="https://indeed.example/account/unsubscribe?t=9">Unsubscribe</a>'},
      ],
    });
    s.answers({
      submit_posting_check: match(['match']),
      submit_posting_reading: reading({summary: 'Storefront and checkout work before the holidays.', location: 'Denver, CO', workplace: 'hybrid', workplace_detail: null, salary: '$85,000–$105,000', must_haves: ['React and a server-side language', 'SQL'], nice_to_haves: []}),
    });
    await s.drain();
    expect(s.web.asked()).toEqual(['indeed.example/viewjob']);
    expect(s.models.requests[0]!.input).toContain('Candidate 1, on Indeed: https://indeed.example/viewjob?jk=7c1e9a24f0b3&from=jobmatch');
    expect(applicationDetail(s.store, id).posting).toMatchObject({
      source: 'email_link', platform: 'Indeed', link: 'https://indeed.example/viewjob?jk=7c1e9a24f0b3&from=jobmatch', location: 'Denver, CO',
      salary: '$85,000–$105,000', workplace_detail: null,
    });
    expect(s.posting(id)!.fullText).toContain('## Requirements\n\n- React and a server-side language');
  });

  test('Sonnet\'s web search finds and judges its own, the page read for its text and the searches charged', async () => {
    const s = await setup();
    const id = s.make({
      company: 'Fabrikam', title: 'Data Analyst', platform: 'Workday', appliedAt: '2026-10-06T21:00:00.000Z',
      emails: [{kind: 'applied', from: ['Fabrikam Talent', 'fabrikam@myworkday.example'], subject: 'Thank you for applying to Data Analyst', body: 'We received your application for Data Analyst (FAB-2291) in Atlanta, GA.'}],
    });
    s.answers({
      submit_posting_search: () => searched([
        {url: 'https://fabrikam.example/careers/data-analyst-2291', title: 'Data Analyst', location: 'Atlanta, GA', site: 'Fabrikam Careers', verdict: 'match'},
        {url: 'https://linkedin.example/jobs/view/3981200001', title: 'Data Analyst, Supply Chain', location: 'Atlanta, GA', site: 'LinkedIn', verdict: 'maybe'},
      ]),
      submit_posting_reading: reading({summary: 'Weekly operations reporting.', location: 'Atlanta, GA', workplace: 'hybrid', workplace_detail: '2 days', salary: '$70,000–$82,000', must_haves: ['SQL'], nice_to_haves: ['Python or R']}),
    });
    await s.drain();

    // Workday: no platform to ask, so search; Sonnet's own verdict, so no check.
    expect(s.asked()).toEqual(['submit_posting_search', 'submit_posting_reading']);
    const search = s.models.requests[0]!;
    expect(search.model).toBe('claude-sonnet-5-5');
    expect(search.body).toMatchObject({tools: [{type: 'web_search_20260209', name: 'web_search', max_uses: 5}, {name: 'submit_posting_search'}], tool_choice: {type: 'auto'}});
    expect(search.input).toContain('Company: Fabrikam\nRole: Data Analyst\nApplied: 2026-10-06\nApplied through: Workday');
    expect(s.web.asked()).toEqual(['fabrikam.example/careers/data-analyst-2291']);
    expect(applicationDetail(s.store, id).posting).toMatchObject({source: 'search', platform: null, link: 'https://fabrikam.example/careers/data-analyst-2291', workplace_detail: '2 days'});
    expect(s.posting(id)!.fullText).toMatch(/^## The role\n\nFabrikam's analytics team/);
    // Finding JDs: Sonnet's tokens and its two searches at $10 per 1,000.
    expect(s.ledger().map(row => [row.purpose, row.model, row.costMicros])).toEqual([
      ['jobs_finding_jds', 'claude-sonnet-5-5', 5200 * 2 + 310 * 10 + 2 * 10_000],
      ['jobs_reading_jds', 'claude-haiku-5-5', costMicros('anthropic', 'claude-haiku-5-5', {inputTokens: 1800, outputTokens: 260, cachedTokens: 0, cacheWriteTokens: 0})],
    ]);
  });

  test('an application\'s own page in the email is never read or checked: the lookup carries on to search (SV-130)', async () => {
    const s = await setup();
    const page = 'https://fabrikam.tracker.example/jobs/6120884/candidates/8f2c1d9e';
    s.web.serve(page, htmlPage(fixture('posting-page.html')));
    const id = s.make({
      company: 'Fabrikam', title: 'Data Analyst', platform: 'Workable', appliedAt: '2026-10-06T21:00:00.000Z',
      emails: [{kind: 'applied', from: ['Fabrikam', 'noreply@tracker.example'], subject: 'Thanks for applying to Fabrikam', body: 'Your application for Data Analyst was received.', html: `<a href="${page}">View your application</a>`}],
    });
    s.answers({
      submit_posting_search: () => searched([{url: 'https://fabrikam.example/careers/data-analyst-2291', title: 'Data Analyst', location: 'Atlanta, GA', site: 'Fabrikam Careers', verdict: 'match'}]),
      submit_posting_reading: reading({summary: 'Weekly operations reporting.', location: 'Atlanta, GA', workplace: 'hybrid', workplace_detail: null, salary: null, must_haves: [], nice_to_haves: []}),
    });
    await s.drain();
    expect(s.web.asked()).toEqual(['fabrikam.example/careers/data-analyst-2291']);
    expect(s.asked()).toEqual(['submit_posting_search', 'submit_posting_reading']);
    expect(applicationDetail(s.store, id).posting).toMatchObject({source: 'search', link: 'https://fabrikam.example/careers/data-analyst-2291'});
  });

  test('a board found through a Lever link in the email, and its platform, though triage named none', async () => {
    const s = await setup();
    const id = s.make({
      company: 'Proseware', title: 'Software Engineer, Platform', platform: null, appliedAt: '2026-10-02T16:00:00.000Z',
      emails: [{kind: 'applied', from: ['Proseware', 'no-reply@hire.lever.example'], subject: 'Thanks for applying to Proseware', body: 'You can view the role at https://lever.example/proseware any time.'}],
    });
    s.answers({submit_posting_check: match(['match']), submit_posting_reading: reading({summary: 'Platform work.', location: 'Remote, US', workplace: 'remote', workplace_detail: null, salary: '$105,000–$125,000', must_haves: [], nice_to_haves: []})});
    await s.drain();
    expect(s.web.asked()).toEqual(['api.lever.example/v0/postings/proseware']);
    expect(s.models.requests[0]!.input).toContain('Text:\nProseware builds project tools');
    expect(applicationDetail(s.store, id).posting).toMatchObject({source: 'platform', platform: 'Lever', link: 'https://lever.example/proseware/9a41c7e2-5d0b-4f1e-8c3a-2b7d90e1f4a6'});
  });
});

describe('unsure (decision 54)', () => {
  test('nothing is saved; the candidates wait in Needs you as a JD to confirm, and search doesn\'t run', async () => {
    const s = await setup();
    const id = s.make(LUCERNE);
    s.answers({submit_posting_check: match(['maybe', 'maybe'])});
    await s.drain();
    expect(s.asked()).toEqual(['submit_posting_check']);
    expect(s.posting(id)).toBeUndefined();
    const page = jobsPageSchema.parse(jobsPage(s.store));
    expect(page.rows.find(row => row.id === id)!.jd).toEqual({state: 'candidates', source: null, platform: null, found_at: null, candidates: 2, looked_at: SEED_NOW, link: null});
    expect(page.needs_you).toEqual([expect.objectContaining({
      kind: 'jd_to_confirm', reason: 'unsure_posting', company: 'Lucerne Publishing', title: 'Junior Developer', platform: 'Greenhouse', application_id: id,
      at: '2026-10-05T17:20:00.000Z', subject: null, event_kind: null, from_history: false,
      candidates: [
        {id: expect.any(Number), title: 'Junior Developer', location: 'New York, NY', platform: 'Greenhouse', link: 'https://greenhouse.example/lucernepublishing/jobs/5520391'},
        {id: expect.any(Number), title: 'Junior Developer, Digital', location: 'Remote', platform: 'Greenhouse', link: 'https://greenhouse.example/lucernepublishing/jobs/5520412'},
      ],
    })]);
    const event = liveEvents(s.w).filter(each => each.type === 'jobs').at(-1)!;
    expect(event).toEqual({type: 'jobs', applications: [id], needs_you: [page.needs_you[0]!.id]});
  });

  test('three candidates at most, from a search that was unsure of four', async () => {
    const s = await setup();
    const id = s.make({company: 'Wide World Importers', title: 'Software Developer', platform: 'iCIMS'});
    s.answers({submit_posting_search: () => searched([1, 2, 3, 4].map(n => ({url: `https://wideworldimporters.example/careers/jobs/${n}`, title: `Software Developer ${n}`, location: 'Remote', site: 'Wide World Importers', verdict: 'maybe'})))});
    await s.drain();
    expect(applicationDetail(s.store, id).candidates.map(candidate => candidate.link)).toEqual([1, 2, 3].map(n => `https://wideworldimporters.example/careers/jobs/${n}`));
    // Unsure pages aren't read until one is picked (J6).
    expect(s.web.asked()).toEqual([]);
  });

  test('a confident search result whose page can\'t be read is offered instead', async () => {
    const s = await setup();
    s.web.serve('https://fabrikam.example/careers/data-analyst-2291', {status: 404, body: 'Not Found', headers: {'content-type': 'text/html'}});
    const id = s.make({company: 'Fabrikam', title: 'Data Analyst', platform: 'Workday'});
    s.answers({submit_posting_search: () => searched([{url: 'https://fabrikam.example/careers/data-analyst-2291', title: 'Data Analyst', location: 'Atlanta, GA', site: 'Fabrikam Careers', verdict: 'match'}])});
    await s.drain();
    expect(s.posting(id)).toBeUndefined();
    expect(applicationDetail(s.store, id)).toMatchObject({jd: {state: 'candidates', candidates: 1}, candidates: [{title: 'Data Analyst', platform: 'Fabrikam Careers'}]});
  });
});

describe('not found (D320)', () => {
  test('a pick Jobs can\'t read keeps its link and asks nothing more, and Look it up searches again', async () => {
    const s = await setup();
    const link = 'https://www.glassdoor.example/job-listing/data-analyst-2291';
    s.web.serve(link, {status: 403, body: 'Forbidden', headers: {'content-type': 'text/html'}});
    const id = s.make({company: 'Fabrikam', title: 'Data Analyst', platform: null});
    s.answers({submit_posting_search: () => searched([{url: link, title: 'Data Analyst', location: 'Atlanta, GA', site: 'Glassdoor', verdict: 'maybe'}])});
    await s.drain();
    const c = await signedIn(s.w, {routes: [jobsApi(s.store)]});
    const [candidate] = applicationDetail(s.store, id).candidates;
    expect((await c.send('POST', `/api/jobs/applications/${id}/jd/pick`, {body: {candidate: candidate!.id}})).status).toBe(200);
    await s.drain();
    expect(s.posting(id)).toBeUndefined();
    expect(applicationDetail(s.store, id).jd).toMatchObject({state: 'not_found', link});
    expect(s.lookupJobs(id).at(-1)!.state).toBe('done');

    s.answers({submit_posting_search: () => searched([], 3)});
    await c.send('POST', `/api/jobs/applications/${id}/lookup`);
    await s.drain();
    expect(applicationDetail(s.store, id).jd).toMatchObject({state: 'not_found', link: null});
  });

  test('"No JD found" after the platforms and a search missed, never retried on its own; Look it up tries again', async () => {
    const s = await setup();
    const id = s.make({company: 'Trey Research', title: 'Data Engineer I', platform: null});
    s.answers({submit_posting_search: () => searched([], 3)});
    await s.drain();
    // All three platforms by the company's name (dashed too), then the search.
    expect(s.web.asked()).toEqual([
      'api.greenhouse.example/v1/boards/treyresearch/jobs', 'api.greenhouse.example/v1/boards/trey-research/jobs',
      'api.lever.example/v0/postings/treyresearch', 'api.lever.example/v0/postings/trey-research',
      'api.ashby.example/posting-api/job-board/treyresearch', 'api.ashby.example/posting-api/job-board/trey-research',
    ]);
    expect(s.asked()).toEqual(['submit_posting_search']);
    expect(applicationDetail(s.store, id).jd).toEqual({state: 'not_found', source: null, platform: null, found_at: null, candidates: 0, looked_at: SEED_NOW, link: null});
    expect(s.lookupJobs(id).map(job => job.state)).toEqual(['done']);

    // Hours of rescans later, nothing more.
    for (let hour = 0; hour < 6; hour += 1) {
      s.w.advance(60 * 60_000);
      await s.drain();
    }
    expect(queueDueLookups(s.store)).toEqual([]);
    expect(s.lookupJobs(id)).toHaveLength(1);
    expect(s.asked()).toEqual(['submit_posting_search']);

    // Look it up, by hand.
    const c = await signedIn(s.w, {routes: [jobsApi(s.store)]});
    const started = await c.send('POST', `/api/jobs/applications/${id}/lookup`);
    expect(started.status).toBe(202);
    expect(started.body.jd).toMatchObject({state: 'looking', looked_at: s.w.store.now().toISOString()});
    await s.drain();
    expect(s.asked()).toEqual(['submit_posting_search', 'submit_posting_search']);
    expect(applicationDetail(s.store, id).jd.state).toBe('not_found');
  });
});

describe('failed: retried with backoff, never "No JD found"', () => {
  test('a platform answering 503 fails the lookup: it waits out the backoff, looking, then finds the JD', async () => {
    const s = await setup();
    const id = s.make(LUCERNE);
    s.answers({submit_posting_check: match(['match', 'no']), submit_posting_reading: reading(LUCERNE_READING)});
    s.web.server.fault({path: /greenhouse/, response: {status: 503, body: 'Service Unavailable'}});
    await s.drain();
    // No search after a failure, and no check with nothing found.
    expect(s.asked()).toEqual([]);
    const [job] = s.lookupJobs(id);
    expect(job).toMatchObject({state: 'queued', attempts: 1, lastError: '503 Service Unavailable'});
    expect(Date.parse(job!.runAt) - s.store.now().getTime()).toBe(30_000);
    expect(applicationDetail(s.store, id).jd.state).toBe('looking');
    s.w.advance(30_000);
    await s.drain();
    expect(applicationDetail(s.store, id).jd).toMatchObject({state: 'found', source: 'platform'});
  });

  test('a 429 waits for its Retry-After', async () => {
    const s = await setup();
    const id = s.make(LUCERNE);
    s.web.server.fault({path: /greenhouse/, response: {status: 429, body: {}, headers: {'retry-after': '300'}}});
    await s.drain();
    const [job] = s.lookupJobs(id);
    expect(job).toMatchObject({state: 'queued', lastError: '429 Too Many Requests'});
    expect(Date.parse(job!.runAt) - s.store.now().getTime()).toBe(300_000);
    expect(applicationDetail(s.store, id).jd.state).toBe('looking');
  });

  test('the AI down fails it the same way, and the search isn\'t charged twice for a failure before it', async () => {
    const s = await setup();
    const id = s.make({company: 'Trey Research', title: 'Data Engineer I', platform: 'Breezy'});
    s.answers({submit_posting_search: () => 'overloaded'});
    await s.drain();
    expect(s.lookupJobs(id)[0]).toMatchObject({state: 'queued', lastError: 'Anthropic: Overloaded (529)'});
    expect(applicationDetail(s.store, id).jd.state).toBe('looking');
    s.answers({submit_posting_search: () => searched([])});
    s.w.advance(30_000);
    await s.drain();
    expect(applicationDetail(s.store, id).jd.state).toBe('not_found');
  });

  test('six failures end the job, and the rescan tries again after the cool-off: still looking, never not found', async () => {
    const s = await setup();
    const id = s.make(LUCERNE);
    s.web.server.fault({path: /greenhouse/, response: {status: 502, body: 'Bad Gateway'}, times: Infinity});
    await s.drain();
    for (let attempt = 0; attempt < 6; attempt += 1) {
      s.w.advance(31 * 60_000);
      await s.drain();
      if (s.lookupJobs(id).at(-1)!.state === 'failed') break;
    }
    expect(s.lookupJobs(id).map(job => [job.state, job.attempts])).toEqual([['failed', 6]]);
    expect(applicationDetail(s.store, id).jd.state).toBe('looking');
    s.w.advance(LOOKUP_COOL_OFF_MS - 60_000);
    await s.drain();
    expect(s.lookupJobs(id)).toHaveLength(1);
    s.w.advance(10 * 60_000);
    s.web.server.clearFaults();
    s.answers({submit_posting_check: match(['match', 'no']), submit_posting_reading: reading(LUCERNE_READING)});
    await s.drain();
    expect(s.lookupJobs(id).map(job => job.state)).toEqual(['failed', 'done']);
    expect(applicationDetail(s.store, id).jd.state).toBe('found');
  });

  test('with no Anthropic key it waits for one, looking', async () => {
    const s = await setup({key: false});
    const id = s.make(LUCERNE);
    await s.drain();
    expect(s.lookupJobs(id)).toEqual([expect.objectContaining({state: 'failed', lastError: NO_JOBS_KEY})]);
    expect(s.web.asked()).toEqual([]);
    expect(applicationDetail(s.store, id).jd.state).toBe('looking');
  });
});

describe('when it runs', () => {
  test('a confirmation J2 reads is looked up straight after, while the posting is up', async () => {
    const s = await setup();
    const accountId = s.store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Jobs')).get()!.id;
    const [messageId] = upsertMessages(s.store, accountId, [{
      providerId: 'lookup-confirmation', threadId: 'lookup-confirmation', rfc822Id: null, fromName: 'Lucerne Publishing', fromAddress: 'no-reply@us.greenhouse-mail.example',
      subject: 'Thank you for your application to Lucerne Publishing', snippet: 'Thank you for applying to Junior Developer', bodyText: 'Thank you for applying to Junior Developer at Lucerne Publishing.',
      bodyHtml: null, receivedAt: '2026-10-07T16:13:00.000Z', senderAuth: null, attachments: [], unread: true, trashed: false, archived: false,
    }]).inserted;
    // As triage leaves it.
    s.store.db.update(t.messages).set({lane: 'fyi', kind: 'career', type: 'confirmation', organisation: 'Lucerne Publishing', via: 'Greenhouse', summary: 'Application received'})
      .where(eq(t.messages.id, messageId!)).run();
    s.answers({
      submit_job_email: () => ({tool: {event: 'confirmation', company: 'Lucerne Publishing', title: 'Junior Developer', requisition_id: null, line: null}}),
      submit_posting_check: match(['match', 'no']), submit_posting_reading: reading(LUCERNE_READING),
    });
    s.w.at('2026-10-07T16:14:00.000Z');
    s.reader.nudge();
    await s.drain();
    expect(s.asked()).toEqual(['submit_job_email', 'submit_posting_check', 'submit_posting_reading']);
    const [made] = s.db.select().from(j.jobsApplications).all();
    expect(applicationDetail(s.store, made!.id).jd).toMatchObject({state: 'found', source: 'platform', platform: 'Greenhouse'});
  });

  test('one closed before its lookup started isn\'t looked up (decision 57); one already queued or running is left to it', async () => {
    const s = await setup();
    const closed = s.make({...LUCERNE, status: 'rejected'});
    const open = s.make({company: 'Relecloud', title: 'Support Engineer', platform: 'Greenhouse'});
    requestLookup(s.store, open);
    expect(queueDueLookups(s.store)).toEqual([]);
    expect(s.application(closed).jdLookup).toBe('none');
    expect(s.lookupJobs(closed)).toEqual([]);
    expect(s.lookupJobs(open)).toHaveLength(1);
  });

  test('Look it up works on a closed application, and replaces the candidates waiting', async () => {
    const s = await setup();
    const id = s.make({...LUCERNE, status: 'rejected', jdLookup: 'none'});
    const c = await signedIn(s.w, {routes: [jobsApi(s.store)]});
    expect((await c.send('POST', '/api/jobs/applications/9999/lookup')).status).toBe(404);

    s.answers({submit_posting_check: match(['maybe', 'maybe'])});
    const started = await c.send('POST', `/api/jobs/applications/${id}/lookup`);
    expect(started.status).toBe(202);
    expect(started.body).toMatchObject({id, status: 'rejected', jd: {state: 'looking'}, posting: null});
    await s.drain();
    const first = jobsPage(s.store).needs_you;
    expect(first).toHaveLength(1);

    // Again: the waiting item is answered, and the check now finds it.
    s.answers({submit_posting_check: match(['match', 'no']), submit_posting_reading: reading(LUCERNE_READING)});
    s.w.advance(60_000);
    expect((await c.send('POST', `/api/jobs/applications/${id}/lookup`)).status).toBe(202);
    expect(jobsPage(s.store).needs_you).toEqual([]);
    expect(s.db.select().from(j.jobsNeedsYou).where(eq(j.jobsNeedsYou.id, first[0]!.id)).get()).toMatchObject({resolution: 'looked_up_again'});
    await s.drain();
    expect(applicationDetail(s.store, id)).toMatchObject({status: 'rejected', jd: {state: 'found'}, candidates: []});
  });

  test('a dev run has no web: nothing is looked up and no host is reached', async () => {
    const s = await setup();
    const reader = new JobsReader({store: s.store, endpoints: s.models.endpoints, timeoutMs: 2000});
    const engine = new SyncEngine({store: s.store, adapters: new Adapters(), workers: [reader]});
    const id = s.make(LUCERNE);
    await engine.tick();
    await engine.settled();
    expect(s.lookupJobs(id)).toEqual([]);
    requestLookup(s.store, id);
    await engine.tick();
    await engine.settled();
    expect(s.lookupJobs(id).map(job => job.state)).toEqual(['done']);
    expect(applicationDetail(s.store, id).jd.state).toBe('looking');
    expect(s.web.asked()).toEqual([]);
    expect(s.models.requests).toEqual([]);
  });
});

test('the seed loads with its numbers, and nothing on it triggers a lookup', async () => {
  const models = await fakeModels();
  const web = await fakeWeb();
  const w = world({seed: true});
  setSecret(w.store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  const reader = new JobsReader({store: w.store, endpoints: models.endpoints, timeoutMs: 2000, web: web.web});
  const engine = new SyncEngine({store: w.store, adapters: new Adapters(), workers: [reader]});
  for (let tick = 0; tick < 3; tick += 1) {
    await engine.tick();
    await engine.settled();
    w.advance(6 * 60_000);
  }
  const page = jobsPageSchema.parse(jobsPage(w.store));
  expect(page.counts).toEqual({all: 62, ghosted: 18, by_status: {applied: 31, in_process: 3, offer: 1, rejected: 25, withdrawn: 2}});
  expect([page.needs_you.length, page.from_history.length]).toEqual([3, 6]);
  expect(w.store.db.select().from(t.jobs).where(like(t.jobs.key, 'jobs_jd:%')).all()).toEqual([]);
  expect(web.asked()).toEqual([]);
  expect(models.requests).toEqual([]);
  expect(TEST_APIS.greenhouse).toMatch(/\.example$/);
});
