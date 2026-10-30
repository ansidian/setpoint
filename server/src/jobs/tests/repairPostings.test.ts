// Taking away the application pages saved as JDs (SV-130), against an ephemeral database with the web
// and Anthropic faked at the HTTP boundary: which saved JDs it finds, that each goes as Not this
// posting takes one and a new lookup starts, that its link can't come back, that a JD the user picked
// or one found another way stays, and that it can run again.
import {SEED_NOW} from '@setpoint/shared';
import type {JdSource} from '@setpoint/shared';
import {and, asc, eq, lte} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import {FAKE_KEYS, fakeModels} from '../../../tests/fakeModels.ts';
import type {FakeAnswer, FakeRequest} from '../../../tests/fakeModels.ts';
import {world} from '../../../tests/helpers.ts';
import * as t from '../../db/schema.ts';
import {setSecret} from '../../secrets/store.ts';
import {SyncEngine} from '../../sync/engine.ts';
import {upsertMessages} from '../../sync/mailMirror.ts';
import {Adapters} from '../../sync/registry.ts';
import {jobsDb} from '../db.ts';
import {lookupKey, requestLookup} from '../lookup.ts';
import {pickCandidate} from '../needsYou.ts';
import {applicationDetail} from '../queries.ts';
import {JobsReader} from '../reader.ts';
import {repairPostings, repairPostingsPlan} from '../repairPostings.ts';
import * as j from '../schema.ts';
import {rejectedLinks} from '../stick.ts';
import {fakeWeb, fixture, htmlPage, serveFixtures, TEST_HOSTS} from './fakeWeb.ts';

// Real HTTP round trips to the fakes.
vi.setConfig({testTimeout: 30_000});

const PAGE = 'https://fabrikam.tracker.example/jobs/6120884/candidates/8f2c1d9e';
const POSTING = 'https://fabrikam.example/careers/data-analyst-2291';
const SAVED_TEXT = 'Your application was received.\n\nMegan Bowen, megan@example.com, resume attached.';

const toolOf = (request: FakeRequest): string => request.body.tools.map((tool: {name: string}) => tool.name).find((name: string) => name.startsWith('submit_'));

/** Sonnet's answer from its web search, in the tool's real shape: it's sure of this link. */
const searched = (url: string): FakeAnswer => ({status: 200, body: {
  id: 'msg_search', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null,
  content: [{type: 'tool_use', id: 'toolu_search', name: 'submit_posting_search', input: {candidates: [{url, title: 'Data Analyst', location: 'Atlanta, GA', site: 'Fabrikam', verdict: 'match'}]}}],
  usage: {input_tokens: 5200, output_tokens: 310, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: {web_search_requests: 1}},
}});
const READING: FakeAnswer = {
  tool: {summary: 'Weekly operations reporting.', location: 'Atlanta, GA', workplace: 'hybrid', workplace_detail: null, salary: null, must_haves: ['SQL'], nice_to_haves: []}, usage: {input: 1800, output: 260},
};

async function setup() {
  const models = await fakeModels();
  const web = await fakeWeb();
  serveFixtures(web);
  web.serve(PAGE, htmlPage(fixture('posting-page.html')));
  const {store} = world({seed: true});
  const db = jobsDb(store.sqlite);
  for (const table of [j.jobsEvents, j.jobsNeedsYou, j.jobsPostings, j.jobsJdCandidates, j.jobsHandSet, j.jobsEmailsRead, j.jobsBlockedEmails, j.jobsApplications]) db.delete(table).run();
  db.update(j.jobsSettings).set({enabledAt: SEED_NOW}).run();
  setSecret(store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  const accountId = store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Jobs')).get()!.id;
  const engine = new SyncEngine({store, adapters: new Adapters(), workers: [new JobsReader({store, endpoints: models.endpoints, timeoutMs: 2000, web: web.web})]});
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

  let made = 0;
  /** An application with a confirmation that carries the link, and no JD. */
  const make = (company: string, title: string, {status = 'applied', link = PAGE}: {status?: 'applied' | 'rejected'; link?: string} = {}) => {
    made += 1;
    const {id} = db.insert(j.jobsApplications).values({
      company, title, titleKey: title.toLowerCase(), platform: 'Workable', accountId, appliedAt: SEED_NOW, status, statusSetBy: 'email', statusSetAt: SEED_NOW, createdAt: SEED_NOW, updatedAt: SEED_NOW,
    }).returning({id: j.jobsApplications.id}).get();
    const [messageId] = upsertMessages(store, accountId, [{
      providerId: `repair-${made}`, threadId: `repair-thread-${made}`, rfc822Id: null, fromName: company, fromAddress: 'noreply@tracker.example', subject: 'Thanks for applying',
      snippet: 'Your application was received.', bodyText: `Your application was received. ${link}`, bodyHtml: null, receivedAt: SEED_NOW, senderAuth: null, attachments: [],
      unread: false, trashed: false, archived: false,
    }]).inserted;
    db.insert(j.jobsEvents).values({applicationId: id, at: SEED_NOW, kind: 'applied', sender: company, subject: 'Thanks for applying', messageId: messageId!, createdAt: SEED_NOW}).run();
    return id;
  };
  /** A JD as a lookup saved it. */
  const save = (id: number, link: string | null, source: JdSource = 'email_link') => db.insert(j.jobsPostings).values({
    applicationId: id, fullText: SAVED_TEXT, summary: 'A confirmation.', mustHaves: [], niceToHaves: [], link, source, platform: 'fabrikam.tracker.example', foundAt: SEED_NOW,
  }).run();
  const saved = (company: string, title: string, link: string | null = PAGE, source: JdSource = 'email_link') => {
    const id = make(company, title);
    save(id, link, source);
    return id;
  };
  const answers = (by: Record<string, () => FakeAnswer>) => models.answer(request => by[toolOf(request)]?.() ?? {status: 400, body: {type: 'error', error: {type: 'invalid_request_error', message: `Nothing should ask ${toolOf(request)}`}}});
  const posting = (id: number) => db.select().from(j.jobsPostings).where(eq(j.jobsPostings.applicationId, id)).get();
  const application = (id: number) => db.select().from(j.jobsApplications).where(eq(j.jobsApplications.id, id)).get()!;
  const lookups = (id: number) => store.db.select().from(t.jobs).where(eq(t.jobs.key, lookupKey(id))).orderBy(asc(t.jobs.id)).all();
  const plan = () => repairPostingsPlan(store, TEST_HOSTS);
  const repair = () => repairPostings(store, TEST_HOSTS);
  return {store, db, models, web, drain, make, save, saved, answers, posting, application, lookups, plan, repair};
}

describe('jobs-repair-postings', () => {
  test('it lists only the application pages the email\'s link saved, by application, company and title, changing nothing and asking nothing', async () => {
    const s = await setup();
    const page = s.saved('Fabrikam', 'Data Analyst');
    const status = s.saved('Contoso', 'Analyst', 'https://contoso.example/careers/applications/4471');
    s.saved('Tailspin Toys', 'Developer', 'https://indeed.example/viewjob?jk=7c1e9a24f0b3');
    s.saved('Proseware', 'Engineer', 'https://lever.example/proseware/9a41c7e2-5d0b-4f1e-8c3a-2b7d90e1f4a6/apply');
    s.saved('Northwind', 'Application Developer', 'https://northwind.example/jobs/application-developer-4412');
    s.saved('Relecloud', 'Analyst', null);
    s.saved('Litware', 'Analyst', PAGE, 'search');
    s.saved('Trey Research', 'Analyst', PAGE, 'platform');

    expect(s.plan()).toEqual([
      {applicationId: page, company: 'Fabrikam', title: 'Data Analyst'},
      {applicationId: status, company: 'Contoso', title: 'Analyst'},
    ]);
    expect(s.posting(page)!.fullText).toBe(SAVED_TEXT);
    expect(s.application(page).jdLookup).toBe('none');
    expect(s.lookups(page)).toEqual([]);
    expect(s.models.requests).toEqual([]);
    expect(s.web.asked()).toEqual([]);
  });

  test('applying takes each away as Not this posting does and starts a new lookup, closed or open; the others stay', async () => {
    const s = await setup();
    const open = s.saved('Fabrikam', 'Data Analyst');
    const closed = s.make('Contoso', 'Analyst', {status: 'rejected'});
    s.save(closed, PAGE);
    const other = s.saved('Litware', 'Analyst', PAGE, 'search');
    const before = s.posting(other);

    expect(s.repair()).toEqual([
      {applicationId: open, company: 'Fabrikam', title: 'Data Analyst'},
      {applicationId: closed, company: 'Contoso', title: 'Analyst'},
    ]);

    for (const id of [open, closed]) {
      expect(s.posting(id)).toBeUndefined();
      expect(rejectedLinks(s.store, id)).toEqual(new Set([PAGE]));
      expect(s.application(id).jdLookup).toBe('looking');
      expect(s.lookups(id).map(job => job.state)).toEqual(['queued']);
    }
    expect(s.posting(other)).toEqual(before);
    expect(rejectedLinks(s.store, other)).toEqual(new Set());
    expect(s.lookups(other)).toEqual([]);
  });

  test('the new lookup never reads the page, its link can\'t come back from a search, and it can find the posting', async () => {
    const s = await setup();
    const id = s.saved('Fabrikam', 'Data Analyst');
    s.repair();
    s.answers({submit_posting_search: () => searched(PAGE)});
    await s.drain();
    expect(s.models.requests.map(toolOf)).toEqual(['submit_posting_search']);
    expect(s.web.asked()).toEqual([]);
    expect(s.posting(id)).toBeUndefined();
    expect(s.application(id).jdLookup).toBe('not_found');

    // Looked up again by hand, a search finding the real posting saves that.
    expect(requestLookup(s.store, id)).toBe('looking');
    s.answers({submit_posting_search: () => searched(POSTING), submit_posting_reading: () => READING});
    await s.drain();
    expect(s.web.asked()).toEqual(['fabrikam.example/careers/data-analyst-2291']);
    expect(s.posting(id)).toMatchObject({source: 'search', link: POSTING});
    expect(s.posting(id)!.fullText).not.toBe(SAVED_TEXT);
  });

  test('a JD the user picked stays, though the email\'s link found it and its link is an application\'s page', async () => {
    const s = await setup();
    const id = s.make('Fabrikam', 'Data Analyst');
    const candidate = s.db.insert(j.jobsJdCandidates).values({
      applicationId: id, title: 'Data Analyst', platform: 'fabrikam.tracker.example', link: PAGE, position: 0, foundAt: SEED_NOW, source: 'email_link',
    }).returning({id: j.jobsJdCandidates.id}).get();
    s.answers({submit_posting_reading: () => READING});
    pickCandidate(s.store, id, candidate.id);
    await s.drain();
    expect(applicationDetail(s.store, id).posting).toMatchObject({source: 'email_link', link: PAGE});
    const before = s.posting(id);

    expect(s.plan()).toEqual([]);
    expect(s.repair()).toEqual([]);
    expect(s.posting(id)).toEqual(before);
    expect(rejectedLinks(s.store, id)).toEqual(new Set());
  });

  test('it\'s safe to run again: nothing is left, and nothing more is turned down or queued', async () => {
    const s = await setup();
    const id = s.saved('Fabrikam', 'Data Analyst');
    s.repair();
    const undos = s.db.select().from(j.jobsUndo).all().length;
    expect(s.plan()).toEqual([]);
    expect(s.repair()).toEqual([]);
    expect(s.lookups(id)).toHaveLength(1);
    expect(s.db.select().from(j.jobsUndo).all()).toHaveLength(undos);
    expect(s.db.select().from(j.jobsRejectedPostings).where(eq(j.jobsRejectedPostings.applicationId, id)).all()).toHaveLength(1);
  });
});
