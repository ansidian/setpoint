// Jobs's store against an ephemeral database (J1): its own migrations beside the app's, an
// application with its events and posting round-tripping to the detail, an event outliving its
// email (decision 63), the routes behind the session, and the `jobs` live event.
import {applicationSchema} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {expect, test} from 'vitest';
import {client, liveEvents, signedIn, world} from '../../../tests/helpers.ts';
import * as t from '../../db/schema.ts';
import {noteLive, transaction} from '../../store.ts';
import {jobsApi} from '../api.ts';
import {jobsDb, migrateJobs} from '../db.ts';
import {applicationDetail, jobsEnabled, jobsPage} from '../queries.ts';
import * as j from '../schema.ts';

const tables = (w: ReturnType<typeof world>) =>
  (w.store.sqlite.prepare('SELECT name FROM sqlite_master WHERE type = \'table\' ORDER BY name').all() as {name: string}[]).map(row => row.name);

test('Jobs\'s tables come from its own migrations, in its own migrations table, and again changes nothing', () => {
  const w = world();
  expect(tables(w).filter(name => name.startsWith('jobs_'))).toEqual([]);
  migrateJobs(w.store.sqlite);
  migrateJobs(w.store.sqlite);
  expect(tables(w).filter(name => name.startsWith('jobs_'))).toEqual([
    'jobs_aliases', 'jobs_applications', 'jobs_blocked_emails', 'jobs_emails_read', 'jobs_events', 'jobs_hand_set', 'jobs_history', 'jobs_jd_candidates',
    'jobs_migrations', 'jobs_needs_you', 'jobs_postings', 'jobs_reader', 'jobs_rejected_postings', 'jobs_settings', 'jobs_undo',
  ]);
  expect(w.store.sqlite.prepare('SELECT count(*) AS n FROM jobs_migrations').get()).toEqual({n: 5});
  const appMigrations = w.store.sqlite.prepare('SELECT count(*) AS n FROM __drizzle_migrations').get() as {n: number};
  expect(appMigrations.n).toBeGreaterThan(1);
  // Off until the user turns it on, reading nothing, with nothing to show.
  expect(jobsEnabled(w.store)).toBe(false);
  expect(jobsPage(w.store)).toMatchObject({enabled: false, reading: {waiting: 0, state: 'healthy'}, counts: {all: 0}, needs_you: [], from_history: [], rows: [],
    history: {state: 'not_started', read: 0, total: 0, started_at: null, finished_at: null}});
});

test('an application with its events and posting round-trips to its detail', () => {
  const w = world();
  migrateJobs(w.store.sqlite);
  const db = jobsDb(w.store.sqlite);
  const appliedAt = '2026-10-01T18:26:00.000Z';
  const {id} = db.insert(j.jobsApplications).values({
    company: 'Northwind Talent', title: 'Software Engineer I', titleKey: 'software engineer i', requisitionId: 'R-2026-118', platform: 'Greenhouse',
    accountId: 4, appliedAt, status: 'in_process', statusSetBy: 'email', statusSetAt: '2026-10-07T14:12:00.000Z', step: 'Pick a 30-minute interview slot this week',
    stepAt: '2026-10-07T14:12:00.000Z', createdAt: appliedAt, updatedAt: appliedAt,
  }).returning({id: j.jobsApplications.id}).get();
  db.insert(j.jobsEvents).values([
    {applicationId: id, at: appliedAt, kind: 'applied', sender: 'Northwind Recruiting', subject: 'Thanks for applying', createdAt: appliedAt},
    {applicationId: id, at: '2026-10-01T18:31:00.000Z', kind: 'verification', sender: 'Greenhouse', subject: 'Verify your email', createdAt: appliedAt},
    {applicationId: id, at: '2026-10-07T14:12:00.000Z', kind: 'interview', sender: 'Priya Raman', subject: 'Interview availability', line: 'Pick a slot', createdAt: appliedAt},
  ]).run();
  db.insert(j.jobsPostings).values({
    applicationId: id, fullText: '## About the team\n\nHiring software.', summary: 'A new-grad engineer.', location: 'Irvine, CA', workplace: 'hybrid',
    workplaceDetail: '3 days', salary: '$95,000–$115,000', mustHaves: ['TypeScript and React', 'SQL'], niceToHaves: ['Tests in CI'],
    link: 'https://greenhouse.example/northwindtalent/jobs/4471029', source: 'platform', platform: 'Greenhouse', foundAt: '2026-10-01T17:41:00.000Z',
  }).run();

  const detail = applicationSchema.parse(applicationDetail(w.store, id));
  expect(detail).toMatchObject({
    company: 'Northwind Talent', status: 'in_process', step: 'Pick a 30-minute interview slot this week', ghosted: false,
    jd: {state: 'found', source: 'platform', platform: 'Greenhouse', found_at: '2026-10-01T17:41:00.000Z'},
    posting: {summary: 'A new-grad engineer.', must_haves: ['TypeScript and React', 'SQL'], nice_to_haves: ['Tests in CI'], workplace_detail: '3 days'},
  });
  expect(detail.timeline.map(event => [event.kind, event.quiet, event.subject])).toEqual([
    ['applied', false, 'Thanks for applying'], ['verification', true, 'Verify your email'], ['interview', false, 'Interview availability'],
  ]);
  expect(() => applicationDetail(w.store, id + 1)).toThrow('No such application.');
});

test('an event keeps its copy after its email is gone, and only loses the link (decision 63)', () => {
  const w = world({seed: true});
  const db = jobsDb(w.store.sqlite);
  const event = db.select().from(j.jobsEvents).where(eq(j.jobsEvents.subject, 'Interview availability for Software Engineer I')).get()!;
  expect(event.messageId).not.toBeNull();
  const before = applicationDetail(w.store, event.applicationId).timeline.find(each => each.id === event.id)!;
  expect(before.message_id).toBe(event.messageId);

  // Gmail purges it, and mail forgets it.
  w.store.db.delete(t.messages).where(eq(t.messages.id, event.messageId!)).run();
  const after = applicationDetail(w.store, event.applicationId).timeline.find(each => each.id === event.id)!;
  expect(after).toEqual({...before, message_id: null});
  expect(after).toMatchObject({kind: 'interview', sender: 'Priya Raman', line: 'Pick a 30-minute interview slot this week'});
});

test('the routes are behind the session', async () => {
  const w = world({seed: true});
  const anonymous = client(w, {routes: [jobsApi(w.store)]});
  expect((await anonymous.send('GET', '/api/jobs')).status).toBe(401);
  const c = await signedIn(w, {routes: [jobsApi(w.store)]});
  expect((await c.send('GET', '/api/jobs')).status).toBe(200);
  expect((await c.send('GET', '/api/jobs/applications/9999')).body).toMatchObject({error: {code: 'not_found'}});
  expect((await c.send('GET', '/api/jobs/applications/nope')).status).toBe(400);
  // Without the module's routes, the app has none.
  const without = await signedIn(world());
  expect((await without.send('GET', '/api/jobs')).status).toBe(404);
});

test('`jobs` events in one transaction go out as one, naming everything they changed', () => {
  const w = world();
  transaction(w.store, () => {
    noteLive(w.store, {type: 'jobs', applications: [3], needs_you: []});
    noteLive(w.store, {type: 'jobs', applications: [1, 3], needs_you: [2]});
  });
  expect(liveEvents(w)).toEqual([{type: 'jobs', applications: [1, 3], needs_you: [2]}]);
});
