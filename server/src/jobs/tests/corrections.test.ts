// Needs you's answers and the corrections (J6; BRIEF.md › Jobs › Corrections; decisions 58, 67, 68, 69;
// D322, D364–D367), against an ephemeral database holding the seed, through Jobs's routes, with
// Anthropic and the hiring platforms faked at the HTTP boundary (./fakeWeb.ts). The Done-when list:
// each correction, then a new email, a history re-run and a lookup, and the correction stands; Undo
// restores exactly what was there; D322's exception (an email that sets a status replaces one set by
// hand, a quiet one doesn't); Let emails decide recomputes the status from the emails.
import {jobsChangeSchema, jobsUndoneSchema, SEED_NOW} from '@setpoint/shared';
import type {JobsChangeOut, JobStatus} from '@setpoint/shared';
import {and, asc, eq, lte} from 'drizzle-orm';
import {describe, expect, test, vi} from 'vitest';
import {FAKE_KEYS, fakeModels} from '../../../tests/fakeModels.ts';
import type {FakeAnswer, FakeRequest} from '../../../tests/fakeModels.ts';
import {signedIn, world} from '../../../tests/helpers.ts';
import * as t from '../../db/schema.ts';
import {setSecret} from '../../secrets/store.ts';
import {SyncEngine} from '../../sync/engine.ts';
import {upsertMessages} from '../../sync/mailMirror.ts';
import {Adapters} from '../../sync/registry.ts';
import {jobsApi} from '../api.ts';
import {jobsDb} from '../db.ts';
import {startHistory} from '../history.ts';
import {applicationDetail, jobsPage} from '../queries.ts';
import {JobsReader} from '../reader.ts';
import * as j from '../schema.ts';
import {fakeWeb, serveFixtures} from './fakeWeb.ts';

// Real HTTP round trips to the fakes, a few dozen per test.
vi.setConfig({testTimeout: 30_000});

/** What Haiku reads in an email: its event, the company and role it names, and its line. */
interface Reading {
  event: string;
  company: string | null;
  title?: string | null;
  requisition_id?: string | null;
  line?: string | null;
}

const toolOf = (request: FakeRequest): string => request.body.tools?.map((tool: {name: string}) => tool.name).find((name: string) => name.startsWith('submit_')) ?? '';
const subjectOf = (request: FakeRequest) => /^Subject: (.*)$/m.exec(request.input)?.[1] ?? '';

const POSTING_READING = {
  summary: 'An analyst for the reporting team.\nDashboards and the pipelines behind them.\nThey want SQL and clear writing.',
  location: 'Atlanta, GA', workplace: 'hybrid', workplace_detail: null, salary: null, must_haves: ['SQL'], nice_to_haves: ['Python'],
};

/** Sonnet's answer with its web search, in the tool's real shape: a search, its results, then its answer's tool. */
function searched(candidates: unknown[]): FakeAnswer {
  return {status: 200, body: {
    id: 'msg_search', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: 'tool_use', stop_sequence: null,
    content: [
      {type: 'server_tool_use', id: 'srvtoolu_01', name: 'web_search', input: {query: 'careers posting'}},
      {type: 'web_search_tool_result', tool_use_id: 'srvtoolu_01', content: []},
      {type: 'tool_use', id: 'toolu_search', name: 'submit_posting_search', input: {candidates}},
    ],
    usage: {input_tokens: 5200, output_tokens: 310, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, server_tool_use: {web_search_requests: 1}},
  }};
}

// After the seed's now, as new mail comes; and before Jobs was turned on, for the history pass.
const LATER = '2026-10-07T18:00:00.000Z';
const EARLIER = '2026-09-20T17:00:00.000Z';

/**
 * The seed, Jobs turned on at the seed's now with all its mail already read, so a new email is the
 * only one the reader reads and an older one stored now the only one a history re-run reads. Haiku
 * answers each email as `readings` says (anything else isn't about a job), every posting check is
 * no, Sonnet's search finds what `search` holds, and the platforms and pages are the fixtures.
 */
async function setup() {
  const models = await fakeModels();
  const web = await fakeWeb();
  serveFixtures(web);
  const w = world({seed: true});
  const store = w.store;
  const db = jobsDb(store.sqlite);
  setSecret(store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  db.update(j.jobsSettings).set({enabledAt: SEED_NOW}).run();
  const read = new Set(db.select({id: j.jobsEmailsRead.messageId}).from(j.jobsEmailsRead).all().map(row => row.id));
  for (const message of store.db.select({id: t.messages.id}).from(t.messages).all()) {
    if (!read.has(message.id)) db.insert(j.jobsEmailsRead).values({messageId: message.id, readAt: SEED_NOW, outcome: 'ignored'}).run();
  }
  const jobsAccount = store.db.select().from(t.accounts).where(eq(t.accounts.label, 'Jobs')).get()!.id;

  const readings = new Map<string, Reading>();
  let search: {url: string; title: string; location: string; site: string; verdict: 'match' | 'maybe'}[] = [];
  models.answer((request): FakeAnswer => {
    const tool = toolOf(request);
    if (tool === 'submit_job_email') {
      const reading = readings.get(subjectOf(request)) ?? {event: 'unrelated', company: null};
      return {tool: {title: null, requisition_id: null, line: null, ...reading}, usage: {input: 700, output: 60}};
    }
    if (tool === 'submit_posting_check') {
      const candidates = request.input.match(/^Candidate \d+, on /gm)?.length ?? 1;
      return {tool: {verdicts: Array.from({length: candidates}, (_, index) => ({candidate: index + 1, verdict: 'no'}))}, usage: {input: 2400, output: 40}};
    }
    if (tool === 'submit_posting_reading') return {tool: POSTING_READING, usage: {input: 3000, output: 200}};
    if (tool === 'submit_posting_search') return searched(search);
    return {status: 400, body: {type: 'error', error: {type: 'invalid_request_error', message: `Nothing should ask ${tool}`}}};
  });

  const c = await signedIn(w, {routes: [jobsApi(store)]});
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

  let stored = 0;
  /** An email in the Jobs account, sorted by triage, read by Jobs as `reading` says. */
  const store1 = (subject: string, at: string, reading: Reading, from: [string, string] = [reading.company ?? 'Recruiting', 'recruiting@careers.example']) => {
    stored += 1;
    readings.set(subject, reading);
    const [id] = upsertMessages(store, jobsAccount, [{
      providerId: `correction-${stored}`, threadId: `correction-thread-${stored}`, rfc822Id: null, fromName: from[0], fromAddress: from[1], subject,
      snippet: subject, bodyText: subject, bodyHtml: null, receivedAt: at, senderAuth: null, attachments: [], unread: true, trashed: false, archived: false,
    }]).inserted;
    store.db.update(t.messages).set({lane: 'fyi', kind: 'career', type: null, organisation: reading.company, triageSource: 'cheap_model', triagedAt: at})
      .where(eq(t.messages.id, id!)).run();
    store.db.update(t.jobs).set({state: 'done', finishedAt: at}).where(eq(t.jobs.kind, 'triage')).run();
    return id!;
  };
  /** A new email, arriving now, read by the live reader. */
  const newEmail = async (subject: string, reading: Reading) => {
    w.at(LATER);
    const id = store1(subject, LATER, reading);
    w.advance(60_000);
    reader.nudge();
    await drain();
    return id;
  };
  /** A history re-run: an older email Jobs hadn't read, read by a new history pass. */
  const history = async (subject: string, reading: Reading) => {
    const id = store1(subject, EARLIER, reading);
    expect(startHistory(store)).toBe(true);
    await drain();
    return id;
  };
  /** A lookup of the application's JD, by hand, run to its end. Null when a saved JD refuses it. */
  const lookUp = async (id: number) => {
    const response = await c.send('POST', `/api/jobs/applications/${id}/lookup`);
    if (response.status === 409) return null;
    expect(response.status).toBe(202);
    await drain();
    return applicationDetail(store, id);
  };
  const send = async (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<JobsChangeOut> => {
    const response = await c.send(method, `/api/jobs${path}`, body === undefined ? {} : {body});
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return jobsChangeSchema.parse(response.body);
  };
  const undo = async (change: JobsChangeOut) => {
    const response = await c.send('POST', `/api/jobs/undo/${change.undo}`);
    expect(response.status).toBe(200);
    return jobsUndoneSchema.parse(response.body);
  };
  const id = (company: string, title: string) => {
    const found = db.select().from(j.jobsApplications).where(and(eq(j.jobsApplications.company, company), eq(j.jobsApplications.title, title))).get();
    if (!found) throw new Error(`No application ${company} · ${title}`);
    return found.id;
  };
  const application = (applicationId: number) => db.select().from(j.jobsApplications).where(eq(j.jobsApplications.id, applicationId)).get();
  const eventsOf = (applicationId: number) =>
    db.select().from(j.jobsEvents).where(eq(j.jobsEvents.applicationId, applicationId)).orderBy(asc(j.jobsEvents.at), asc(j.jobsEvents.id)).all();
  const item = (company: string) => jobsPage(store).needs_you.concat(jobsPage(store).from_history).find(each => each.company === company)!;
  const readOf = (messageId: number) => db.select().from(j.jobsEmailsRead).where(eq(j.jobsEmailsRead.messageId, messageId)).get();
  /** Every jobs_ table's rows (but Undo's own), to compare before and after. */
  const dump = () => Object.fromEntries((store.sqlite.prepare('SELECT name FROM sqlite_master WHERE type = \'table\' AND name LIKE \'jobs_%\' AND name NOT IN (\'jobs_undo\', \'jobs_migrations\') ORDER BY name').all() as {name: string}[])
    .map(({name}) => [name, store.sqlite.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]));
  return {
    w, store, db, c, web, models, drain, newEmail, history, lookUp, send, undo, id, application, eventsOf, item, readOf, dump,
    setSearch: (found: typeof search) => (search = found),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

interface Case {
  name: string;
  // The correction, through its route.
  correct: (s: Setup) => Promise<JobsChangeOut>;
  // After it, a new email, an older one a history re-run reads, and a lookup.
  email: (s: Setup) => [subject: string, reading: Reading];
  history: (s: Setup) => [subject: string, reading: Reading];
  lookup: (s: Setup) => number;
  // The correction stands.
  stands: (s: Setup) => void;
}

const CASES: Case[] = [
  {
    name: 'the title edited in place: kept, and the emails naming the old title or the new one still find it',
    correct: s => s.send('PATCH', `/applications/${s.id('Trey Research', 'Data Engineer I')}`, {title: 'Data Engineer, Platform'}),
    email: () => ['Interview for Data Engineer I', {event: 'interview', company: 'Trey Research', title: 'Data Engineer I', line: 'Interview Fri Oct 9, 10:00 AM'}],
    history: () => ['Your Trey Research candidate account', {event: 'account', company: 'Trey Research', title: 'Data Engineer, Platform'}],
    lookup: s => s.id('Trey Research', 'Data Engineer, Platform'),
    stands: s => {
      const trey = s.id('Trey Research', 'Data Engineer, Platform');
      expect(s.application(trey)).toMatchObject({title: 'Data Engineer, Platform', status: 'in_process', step: 'Interview Fri Oct 9, 10:00 AM'});
      expect(s.eventsOf(trey).map(event => event.subject)).toContain('Interview for Data Engineer I');
      expect(s.eventsOf(trey).map(event => event.subject)).toContain('Your Trey Research candidate account');
      expect(applicationDetail(s.store, trey).hand_set.map(each => each.field)).toEqual(['title']);
    },
  },
  {
    name: 'the company edited from More: kept, and an email naming the old company still finds it',
    correct: s => s.send('PATCH', `/applications/${s.id('Trey Research', 'Data Engineer I')}`, {company: 'Contoso'}),
    email: () => ['Next step for Data Engineer I', {event: 'assessment', company: 'Trey Research', title: 'Data Engineer I', line: 'Case study due Oct 14'}],
    history: () => ['Contoso: confirm your email', {event: 'verification', company: 'Contoso', title: 'Data Engineer I'}],
    lookup: s => s.id('Contoso', 'Data Engineer I'),
    stands: s => {
      const trey = s.id('Contoso', 'Data Engineer I');
      expect(s.application(trey)).toMatchObject({company: 'Contoso', status: 'in_process', step: 'Case study due Oct 14'});
      expect(s.eventsOf(trey)).toHaveLength(4);
      expect(jobsPage(s.store).rows.filter(row => row.company.startsWith('Trey'))).toEqual([]);
    },
  },
  {
    name: 'a status set by hand: a quiet email and an older status email from history leave it, and so does a lookup',
    correct: s => s.send('POST', `/applications/${s.id('Litware', 'QA Engineer')}/status`, {status: 'withdrawn'}),
    email: () => ['Litware: one final step', {event: 'next_step', company: 'Litware', title: 'QA Engineer'}],
    history: () => ['Litware interview, QA Engineer', {event: 'interview', company: 'Litware', title: 'QA Engineer', line: 'Interview Sep 22'}],
    lookup: s => s.id('Litware', 'QA Engineer'),
    stands: s => {
      expect(s.application(s.id('Litware', 'QA Engineer'))).toMatchObject({status: 'withdrawn', statusSetBy: 'user'});
      expect(applicationDetail(s.store, s.id('Litware', 'QA Engineer')).hand_set.map(each => each.field)).toEqual(['status']);
    },
  },
  {
    name: 'Merge with…: one application with all their emails, and the other\'s role finds it after',
    correct: s => s.send('POST', `/applications/${s.id('Humongous Insurance', 'Software Engineer II, Claims')}/merge`, {other: s.id('Humongous Insurance', 'Software Engineer II (Java)')}),
    email: () => ['Thank you for applying', {event: 'confirmation', company: 'Humongous Insurance', title: 'Software Engineer II (Java)'}],
    history: () => ['Software Engineer II (Java): verify your email', {event: 'verification', company: 'Humongous Insurance', title: 'Software Engineer II (Java)'}],
    lookup: s => s.id('Humongous Insurance', 'Software Engineer II, Claims'),
    stands: s => {
      const rows = jobsPage(s.store).rows.filter(row => row.company === 'Humongous Insurance');
      expect(rows.map(row => row.title)).toEqual(['Software Engineer II, Claims']);
      // The second confirmation is a duplicate on it, not a new application.
      expect(s.eventsOf(rows[0]!.id).map(event => event.kind)).toEqual(['verification', 'applied', 'applied', 'account', 'duplicate']);
    },
  },
  {
    name: 'Move to…: the event stays where it was moved, and a later email naming its role follows it',
    correct: s => {
      const claims = s.id('Humongous Insurance', 'Software Engineer II, Claims');
      const account = s.eventsOf(claims).find(event => event.kind === 'account')!;
      return s.send('POST', `/events/${account.id}/move`, {application: s.id('Humongous Insurance', 'Software Engineer II (Java)')});
    },
    email: () => ['Your Humongous Insurance interview', {event: 'interview', company: 'Humongous Insurance', title: 'Software Engineer II (Java)', line: 'Interview Mon Oct 12'}],
    history: () => ['Humongous Insurance: screening form', {event: 'form', company: 'Humongous Insurance', title: 'Software Engineer II (Java)'}],
    lookup: s => s.id('Humongous Insurance', 'Software Engineer II (Java)'),
    stands: s => {
      const java = s.id('Humongous Insurance', 'Software Engineer II (Java)');
      expect(s.eventsOf(java).map(event => event.subject)).toEqual([
        'Humongous Insurance: screening form', 'Thank you for applying', 'Your candidate account is ready', 'Your Humongous Insurance interview',
      ]);
      expect(s.eventsOf(s.id('Humongous Insurance', 'Software Engineer II, Claims')).map(event => event.kind)).toEqual(['applied']);
      expect(s.application(java)).toMatchObject({status: 'in_process'});
    },
  },
  {
    name: 'Not about this: the event goes back to Needs you and stays off the application',
    correct: async s => {
      const northwind = s.id('Northwind Talent', 'Software Engineer I');
      const interview = s.eventsOf(northwind).find(event => event.kind === 'interview')!;
      return s.send('POST', `/events/${interview.id}/not-about-this`);
    },
    email: () => ['Northwind Talent: verify your email', {event: 'verification', company: 'Northwind Talent', title: 'Software Engineer I'}],
    history: () => ['Northwind Talent account created', {event: 'account', company: 'Northwind Talent', title: 'Software Engineer I'}],
    lookup: s => s.id('Northwind Talent', 'Software Engineer I'),
    stands: s => {
      const northwind = s.id('Northwind Talent', 'Software Engineer I');
      expect(s.eventsOf(northwind).map(event => event.kind)).not.toContain('interview');
      // Its status is what the emails left it: no interview, so Applied again.
      expect(s.application(northwind)).toMatchObject({status: 'applied', step: null});
      const item = jobsPage(s.store).needs_you.find(each => each.subject === 'Interview availability for Software Engineer I')!;
      expect(item).toMatchObject({kind: 'update_to_assign', reason: 'taken_off', event_kind: 'interview'});
    },
  },
  {
    name: 'Not an application: gone, and no email naming it makes it again',
    correct: s => s.send('POST', `/applications/${s.id('Trey Research', 'Data Engineer I')}/not-an-application`),
    email: () => ['Thanks for applying to Trey Research', {event: 'confirmation', company: 'Trey Research', title: 'Data Engineer I'}],
    history: () => ['Trey Research: application received', {event: 'confirmation', company: 'Trey Research', title: 'Data Engineer I'}],
    lookup: s => s.id('Fabrikam', 'Data Analyst'),
    stands: s => {
      expect(jobsPage(s.store).rows.filter(row => row.company === 'Trey Research')).toEqual([]);
    },
  },
  {
    name: 'Delete: forgotten, so a later email makes it again',
    correct: s => s.send('DELETE', `/applications/${s.id('Trey Research', 'Data Engineer I')}`),
    email: () => ['Thanks for applying to Trey Research', {event: 'confirmation', company: 'Trey Research', title: 'Data Engineer I'}],
    history: () => ['Trey Research: confirm your email', {event: 'verification', company: 'Trey Research', title: 'Data Engineer I'}],
    lookup: s => s.id('Fabrikam', 'Data Analyst'),
    stands: s => {
      // Made again by the new confirmation, as a new application with that one email (and the history's quiet one).
      const again = jobsPage(s.store).rows.filter(row => row.company === 'Trey Research');
      expect(again).toHaveLength(1);
      expect(s.eventsOf(again[0]!.id).map(event => event.kind)).toEqual(['verification', 'applied']);
    },
  },
  {
    name: 'Not this posting: the JD goes and no lookup saves it again',
    correct: s => s.send('POST', `/applications/${s.id('Fabrikam', 'Data Analyst')}/not-this-posting`),
    email: () => ['Fabrikam: confirm your email', {event: 'verification', company: 'Fabrikam', title: 'Data Analyst'}],
    history: () => ['Fabrikam: screening questions', {event: 'form', company: 'Fabrikam', title: 'Data Analyst'}],
    lookup: s => {
      // Search finds the posting turned down, sure of it; the page is there to read.
      s.setSearch([{url: 'https://fabrikam.example/careers/data-analyst-2291', title: 'Data Analyst', location: 'Atlanta, GA', site: 'Fabrikam Careers', verdict: 'match'}]);
      return s.id('Fabrikam', 'Data Analyst');
    },
    stands: s => {
      const detail = applicationDetail(s.store, s.id('Fabrikam', 'Data Analyst'));
      expect(detail.posting).toBeNull();
      expect(detail.jd.state).toBe('not_found');
    },
  },
  {
    name: 'None of these: the candidates are turned down, and a lookup never offers them again',
    correct: s => s.send('POST', `/applications/${s.id('Lucerne Publishing', 'Junior Developer')}/jd/none`),
    email: () => ['Lucerne Publishing: verify your email', {event: 'verification', company: 'Lucerne Publishing', title: 'Junior Developer'}],
    history: () => ['Lucerne Publishing account created', {event: 'account', company: 'Lucerne Publishing', title: 'Junior Developer'}],
    lookup: s => {
      s.setSearch([{url: 'https://linkedin.example/jobs/view/3981204417', title: 'Junior Developer, Digital', location: 'Remote', site: 'LinkedIn', verdict: 'maybe'}]);
      return s.id('Lucerne Publishing', 'Junior Developer');
    },
    stands: s => {
      const lucerne = s.id('Lucerne Publishing', 'Junior Developer');
      // Greenhouse's board offered both again and the check said no; search's one is turned down: nothing waits.
      expect(applicationDetail(s.store, lucerne)).toMatchObject({candidates: [], posting: null, jd: {state: 'not_found'}});
      expect(jobsPage(s.store).needs_you.filter(each => each.company === 'Lucerne Publishing')).toEqual([]);
    },
  },
  {
    name: 'Assign to…: the update is the application\'s, and the role it named finds it after',
    correct: s => s.send('POST', `/needs-you/${s.item('Humongous Insurance').id}/assign`, {application: s.id('Humongous Insurance', 'Software Engineer II (Java)')}),
    email: () => ['Software Engineer II: next steps', {event: 'interview', company: 'Humongous Insurance', title: 'Software Engineer II', line: 'Interview Tue Oct 13'}],
    history: () => ['Software Engineer II screening form', {event: 'form', company: 'Humongous Insurance', title: 'Software Engineer II'}],
    lookup: s => s.id('Humongous Insurance', 'Software Engineer II (Java)'),
    stands: s => {
      const java = s.id('Humongous Insurance', 'Software Engineer II (Java)');
      expect(s.eventsOf(java).map(event => event.subject)).toEqual([
        'Software Engineer II screening form', 'Thank you for applying', 'Thank you for your interest in the Software Engineer II role', 'Software Engineer II: next steps',
      ]);
      expect(s.application(java)).toMatchObject({status: 'in_process', step: 'Interview Tue Oct 13'});
      expect(jobsPage(s.store).needs_you.filter(each => each.company === 'Humongous Insurance')).toEqual([]);
    },
  },
  {
    name: 'Track this: Applied on its email\'s date, First seen, In process, looked up; later emails join it',
    correct: s => s.send('POST', `/needs-you/${s.item('Wide World Importers').id}/track`),
    email: () => ['Wide World Importers: your interview', {event: 'interview', company: 'Wide World Importers', title: 'Junior Software Engineer', line: 'Interview Thu Oct 15'}],
    history: () => ['Wide World Importers account', {event: 'account', company: 'Wide World Importers', title: 'Junior Software Engineer'}],
    lookup: s => s.id('Wide World Importers', 'Junior Software Engineer'),
    stands: s => {
      const wide = s.id('Wide World Importers', 'Junior Software Engineer');
      expect(s.application(wide)).toMatchObject({firstSeenInEmail: true, appliedAt: '2026-10-07T15:12:00.000Z', status: 'in_process', step: 'Interview Thu Oct 15'});
      expect(s.eventsOf(wide).map(event => [event.kind, event.firstSeen])).toEqual([['account', false], ['interview', true], ['interview', false]]);
    },
  },
  {
    name: 'Not about a job: the email makes nothing, now or later',
    correct: s => s.send('POST', `/needs-you/${s.item('Wide World Importers').id}/not-a-job`),
    email: () => ['Wide World Importers newsletter', {event: 'other', company: 'Wide World Importers'}],
    history: () => ['Wide World Importers: a call', {event: 'other', company: 'Wide World Importers'}],
    lookup: s => s.id('Fabrikam', 'Data Analyst'),
    stands: s => {
      expect(jobsPage(s.store).rows.filter(row => row.company === 'Wide World Importers')).toEqual([]);
      expect(jobsPage(s.store).needs_you.filter(each => each.company === 'Wide World Importers')).toEqual([]);
    },
  },
];

describe('every correction sticks (decision 58): a new email, a history re-run and a lookup leave it', () => {
  test.each(CASES)('$name', async ({correct, email, history, lookup, stands}) => {
    const s = await setup();
    await correct(s);
    await s.newEmail(...email(s));
    await s.history(...history(s));
    await s.lookUp(lookup(s));
    stands(s);
  });
});

describe('Undo restores exactly what was there', () => {
  test.each(CASES)('$name', async ({correct}) => {
    const s = await setup();
    const before = s.dump();
    const change = await correct(s);
    expect(s.dump()).not.toEqual(before);
    await s.undo(change);
    expect(s.dump()).toEqual(before);
    // Once.
    expect((await s.c.send('POST', `/api/jobs/undo/${change.undo}`)).status).toBe(404);
  });

  test('a pick: the candidate read and saved by its job; Undo puts the JD to confirm back as it was, and a lookup that comes late saves nothing', async () => {
    const s = await setup();
    const lucerne = s.id('Lucerne Publishing', 'Junior Developer');
    const before = s.dump();
    const detail = applicationDetail(s.store, lucerne);
    const change = await s.send('POST', `/applications/${lucerne}/jd/pick`, {candidate: detail.candidates[0]!.id});
    expect(applicationDetail(s.store, lucerne).jd.state).toBe('looking');
    expect(jobsPage(s.store).needs_you.map(each => each.company)).not.toContain('Lucerne Publishing');
    await s.undo(change);
    expect(s.dump()).toEqual(before);
    // Its job, queued before Undo, finds nothing to look for.
    await s.drain();
    expect(s.dump()).toEqual(before);

    // Picked again and left: its posting is read from Greenhouse and saved as found there, the other candidate kept for Not this posting.
    await s.send('POST', `/applications/${lucerne}/jd/pick`, {candidate: detail.candidates[0]!.id});
    await s.drain();
    const saved = applicationDetail(s.store, lucerne);
    expect(saved.posting).toMatchObject({link: 'https://greenhouse.example/lucernepublishing/jobs/5520391', source: 'platform', summary: POSTING_READING.summary});
    expect(saved.candidates.map(each => each.title)).toEqual(['Junior Developer', 'Junior Developer, Digital']);
    // Not this posting offers the other again, as a JD to confirm.
    await s.send('POST', `/applications/${lucerne}/not-this-posting`);
    expect(applicationDetail(s.store, lucerne)).toMatchObject({posting: null, jd: {state: 'candidates', candidates: 1}});
    expect(jobsPage(s.store).needs_you.find(each => each.company === 'Lucerne Publishing')!.candidates.map(each => each.title)).toEqual(['Junior Developer, Digital']);
  });

  test('Dismiss all and its Undo (D324)', async () => {
    const s = await setup();
    const before = s.dump();
    const dismissed = await s.c.send('POST', '/api/jobs/from-history/dismiss');
    expect(jobsPage(s.store).from_history).toEqual([]);
    await s.c.send('POST', '/api/jobs/from-history/undo', {body: dismissed.body});
    expect(s.dump()).toEqual(before);
  });
});

describe('a status set by hand (D322, D365)', () => {
  const litware = (s: Setup) => s.id('Litware', 'QA Engineer');

  test.each<[string, Reading, JobStatus, 'user' | 'email']>([
    ['a quiet email leaves it', {event: 'form', company: 'Litware', title: 'QA Engineer'}, 'withdrawn', 'user'],
    ['an interview replaces it', {event: 'interview', company: 'Litware', title: 'QA Engineer', line: 'Interview Wed Oct 14'}, 'in_process', 'email'],
    ['a rejection replaces it', {event: 'rejection', company: 'Litware', title: 'QA Engineer'}, 'rejected', 'email'],
    ['an offer replaces it', {event: 'offer', company: 'Litware', title: 'QA Engineer'}, 'offer', 'email'],
  ])('%s', async (_, reading, status, by) => {
    const s = await setup();
    await s.send('POST', `/applications/${litware(s)}/status`, {status: 'withdrawn'});
    await s.newEmail('Litware QA Engineer', reading);
    expect(s.application(litware(s))).toMatchObject({status, statusSetBy: by});
    expect(applicationDetail(s.store, litware(s)).hand_set.map(each => each.field)).toEqual(by === 'user' ? ['status'] : []);
  });

  test('Let emails decide hands it back: the status the emails make, and nothing set by hand', async () => {
    const s = await setup();
    const id = litware(s);
    const was = s.application(id)!;
    expect(was).toMatchObject({status: 'in_process', step: 'Case study due Oct 12'});
    await s.send('POST', `/applications/${id}/status`, {status: 'rejected'});
    expect(s.application(id)).toMatchObject({status: 'rejected', statusSetBy: 'user', step: null});
    const back = await s.send('POST', `/applications/${id}/status`, {status: null});
    expect(s.application(id)).toMatchObject({status: 'in_process', statusSetBy: 'email', statusSetAt: was.statusSetAt, step: 'Case study due Oct 12'});
    expect(applicationDetail(s.store, id).hand_set).toEqual([]);
    // Alpine Ski House's Withdrawn, set by hand with only its confirmation: Applied again.
    const alpine = s.id('Alpine Ski House', 'Web Developer');
    await s.send('POST', `/applications/${alpine}/status`, {status: null});
    expect(s.application(alpine)).toMatchObject({status: 'applied', statusSetBy: 'email', statusSetAt: s.application(alpine)!.appliedAt});
    // And its Undo, the hand-set status back.
    await s.undo(back);
    expect(s.application(id)).toMatchObject({status: 'rejected', statusSetBy: 'user'});
  });
});

describe('the routes refuse what doesn\'t fit', () => {
  test.each<[string, (s: Setup) => [method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown], number]>([
    ['an application that isn\'t there', () => ['PATCH', '/applications/9999', {title: 'X'}], 404],
    ['an edit naming nothing', s => ['PATCH', `/applications/${s.id('Fabrikam', 'Data Analyst')}`, {}], 400],
    ['an empty title', s => ['PATCH', `/applications/${s.id('Fabrikam', 'Data Analyst')}`, {title: '  '}], 400],
    ['Ghosted as a status', s => ['POST', `/applications/${s.id('Fabrikam', 'Data Analyst')}/status`, {status: 'ghosted'}], 400],
    ['a merge with itself', s => ['POST', `/applications/${s.id('Fabrikam', 'Data Analyst')}/merge`, {other: s.id('Fabrikam', 'Data Analyst')}], 400],
    ['Not this posting with no JD', s => ['POST', `/applications/${s.id('Trey Research', 'Data Engineer I')}/not-this-posting`], 409],
    ['a pick of another application\'s candidate', s => ['POST', `/applications/${s.id('Fabrikam', 'Data Analyst')}/jd/pick`, {candidate: applicationDetail(s.store, s.id('Lucerne Publishing', 'Junior Developer')).candidates[0]!.id}], 404],
    ['Track this on an update to assign', s => ['POST', `/needs-you/${s.item('Humongous Insurance').id}/track`], 400],
    ['Undo of nothing', () => ['POST', '/undo/9999'], 404],
  ])('%s', async (_, request, status) => {
    const s = await setup();
    const [method, path, body] = request(s);
    expect((await s.c.send(method, `/api/jobs${path}`, body === undefined ? {} : {body})).status).toBe(status);
  });

  test('an item answered already', async () => {
    const s = await setup();
    const wide = s.item('Wide World Importers').id;
    await s.send('POST', `/needs-you/${wide}/not-a-job`);
    expect((await s.c.send('POST', `/api/jobs/needs-you/${wide}/track`)).status).toBe(409);
  });
});
