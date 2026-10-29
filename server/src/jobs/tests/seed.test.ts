// The seed's Jobs (BRIEF.md › Sample data › Jobs, round 4) through the API: the numbers, Needs you
// and From history, the rows the table gives, Northwind's detail, and that mail's Inbox is as it was.
import {SEED_NOW} from '@setpoint/shared';
import type {ApplicationOut, ApplicationRowOut} from '@setpoint/shared';
import {applicationSchema, jobsPageSchema} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {signedIn, world} from '../../../tests/helpers.ts';
import * as t from '../../db/schema.ts';
import {mailCounts} from '../../queries/mail.ts';
import {jobsApi} from '../api.ts';
import {jobsDb} from '../db.ts';
import * as j from '../schema.ts';

/** The seed, signed in, with Jobs's routes: its page, and each application's detail. */
async function seeded() {
  const w = world({seed: true});
  const c = await signedIn(w, {routes: [jobsApi(w.store)]});
  const response = await c.send('GET', '/api/jobs');
  expect(response.status).toBe(200);
  const page = jobsPageSchema.parse(response.body);
  const detail = new Map<number, ApplicationOut>();
  for (const each of page.rows) {
    const answer = await c.send('GET', `/api/jobs/applications/${each.id}`);
    expect(answer.status).toBe(200);
    detail.set(each.id, applicationSchema.parse(answer.body));
  }
  const row = (company: string, title: string): ApplicationRowOut => {
    const found = page.rows.find(candidate => candidate.company === company && candidate.title === title);
    if (!found) throw new Error(`No row for ${company} · ${title}`);
    return found;
  };
  return {w, page, detail, row};
}

describe('the two numbers (D314)', () => {
  test('counts by status: All 62, Applied 31 with 18 Ghosted, In process 3, Offer 1, Rejected 25, Withdrawn 2', async () => {
    const {page} = await seeded();
    expect(page.enabled).toBe(true);
    expect(page.counts).toEqual({all: 62, ghosted: 18, by_status: {applied: 31, in_process: 3, offer: 1, rejected: 25, withdrawn: 2}});
  });

  test('per week, oldest first: 3 5 4 6 2 4 7 5 3 6 8, and 3 so far this week (D318)', async () => {
    const {page} = await seeded();
    expect(page.weeks.map(week => week.count)).toEqual([3, 5, 4, 6, 2, 4, 7, 5, 3, 6, 8, 3]);
    expect(page.weeks.map(week => week.current)).toEqual([...Array(11).fill(false), true]);
    expect(page.weeks.at(-2)).toMatchObject({start: '2026-09-27', end: '2026-10-03', count: 8});
    expect(page.rows.filter(each => each.applied_on >= '2026-10-04').map(each => each.company)).toEqual(['Fabrikam', 'Relecloud', 'Lucerne Publishing']);
  });
});

describe('Needs you and From history (34a, 34b)', () => {
  test('three items, as they came', async () => {
    const {page, row} = await seeded();
    expect(page.needs_you.map(item => [item.kind, item.company, item.subject ?? item.title])).toEqual([
      ['jd_to_confirm', 'Lucerne Publishing', 'Junior Developer'],
      ['update_to_assign', 'Humongous Insurance', 'Thank you for your interest in the Software Engineer II role'],
      ['email_to_track', 'Wide World Importers', 'Can we set up a call this week?'],
    ]);
    const [lucerne, humongous, wideWorld] = page.needs_you;
    expect(lucerne!.candidates.map(candidate => `${candidate.title} · ${candidate.location} · ${candidate.platform}`))
      .toEqual(['Junior Developer · New York, NY · Greenhouse', 'Junior Developer, Digital · Remote · LinkedIn']);
    expect(lucerne!.at).toBe(row('Lucerne Publishing', 'Junior Developer').applied_at);
    expect(humongous).toMatchObject({sender: 'Humongous Insurance', platform: 'iCIMS', event_kind: 'rejection', reason: 'matches_several', message_id: null});
    expect(wideWorld).toMatchObject({event_kind: 'interview', reason: 'no_application'});
    // "1h": the email came at 8:12 AM.
    expect(Date.parse(SEED_NOW) - Date.parse(wideWorld!.at)).toBe(60 * 60_000);
  });

  test('From history holds six, newest first', async () => {
    const {page} = await seeded();
    expect(page.from_history.map(item => [item.kind, item.company])).toEqual([
      ['update_to_assign', 'Relecloud'], ['update_to_assign', 'Wingtip Toys'], ['jd_to_confirm', 'Adventure Works'],
      ['email_to_track', 'Graphic Design Institute'], ['email_to_track', 'Bellows College'], ['jd_to_confirm', 'Margie\'s Travel'],
    ]);
    expect(page.from_history.every(item => item.from_history)).toBe(true);
    expect(page.from_history.find(item => item.company === 'Margie\'s Travel')!.candidates).toHaveLength(3);
  });
});

describe('the table (BRIEF.md › Sample data › Jobs)', () => {
  test('its 17 rows, in the order the table gives them among the 62', async () => {
    const {page} = await seeded();
    const table: [string, string, string, string, string][] = [
      ['Fabrikam', 'Data Analyst', 'Workday', '2026-10-07', 'applied'],
      ['Relecloud', 'Support Engineer', 'Greenhouse', '2026-10-06', 'applied'],
      ['Lucerne Publishing', 'Junior Developer', 'Greenhouse', '2026-10-05', 'applied'],
      ['Tailspin Toys', 'Full Stack Developer', 'Indeed', '2026-10-02', 'applied'],
      ['Trey Research', 'Data Engineer I', 'Breezy', '2026-10-01', 'applied'],
      ['Northwind Talent', 'Software Engineer I', 'Greenhouse', '2026-10-01', 'in_process'],
      ['Humongous Insurance', 'Software Engineer II, Claims', 'iCIMS', '2026-09-30', 'applied'],
      ['Humongous Insurance', 'Software Engineer II (Java)', 'iCIMS', '2026-09-28', 'applied'],
      ['Litware', 'QA Engineer', 'Ashby', '2026-09-21', 'in_process'],
      ['Contoso Pharmaceuticals', 'Associate Software Engineer', 'iCIMS', '2026-09-16', 'rejected'],
      ['City Power & Light', 'IT Technician II', 'GovernmentJobs', '2026-09-14', 'in_process'],
      ['Woodgrove Bank', 'Application Developer', 'Workday', '2026-08-31', 'offer'],
      ['Alpine Ski House', 'Web Developer', 'Workable', '2026-08-27', 'withdrawn'],
      ['Proseware', 'Software Engineer, Platform', 'Lever', '2026-08-20', 'applied'],
      ['Relecloud', 'Support Engineer', 'Greenhouse', '2026-07-22', 'rejected'],
      ['Fourth Coffee', 'Software Developer', 'SuccessFactors', '2026-07-08', 'rejected'],
      ['Northwind Talent', 'Junior Developer', 'Greenhouse', '2026-02-09', 'rejected'],
    ];
    const tableRows = page.rows.filter(each => table.some(([company, title, , on]) => each.company === company && each.title === title && each.applied_on === on));
    expect(tableRows.map(each => [each.company, each.title, each.platform, each.applied_on, each.status])).toEqual(table);
    // Board 32's first eight rows are the table's.
    expect(page.rows.slice(0, 8).map(each => each.company)).toEqual(table.slice(0, 8).map(([company]) => company));
    expect(page.rows.map(each => each.applied_at)).toEqual(page.rows.map(each => each.applied_at).sort().reverse());
  });

  test('statuses, steps and dates as the table words them', async () => {
    const {row} = await seeded();
    const step = (each: ApplicationRowOut) => [each.status, each.step, each.status_on, each.ghosted];
    expect(step(row('Northwind Talent', 'Software Engineer I'))).toEqual(['in_process', 'Pick a 30-minute interview slot this week', '2026-10-07', false]);
    expect(Date.parse(SEED_NOW) - Date.parse(row('Northwind Talent', 'Software Engineer I').step_at!)).toBe(2 * 60 * 60_000);
    expect(step(row('Litware', 'QA Engineer'))).toEqual(['in_process', 'Case study due Oct 12', '2026-10-02', false]);
    expect(step(row('City Power & Light', 'IT Technician II'))).toEqual(['in_process', 'Interview Tue Oct 13, 2:00 PM', '2026-10-05', false]);
    expect(step(row('Contoso Pharmaceuticals', 'Associate Software Engineer'))).toEqual(['rejected', null, '2026-10-05', false]);
    expect(step(row('Woodgrove Bank', 'Application Developer'))).toEqual(['offer', null, '2026-10-06', false]);
    expect(row('City Power & Light', 'IT Technician II').account_id).not.toBe(row('Litware', 'QA Engineer').account_id);
  });

  test('Proseware is Ghosted, 48 days without an email', async () => {
    const {row} = await seeded();
    expect(row('Proseware', 'Software Engineer, Platform')).toMatchObject({status: 'applied', ghosted: true, days_without_email: 48});
  });

  test('Alpine Ski House is Withdrawn, set by hand on Sep 10', async () => {
    const {detail, row} = await seeded();
    const alpine = row('Alpine Ski House', 'Web Developer');
    expect(alpine).toMatchObject({status: 'withdrawn', status_set_by: 'user', status_on: '2026-09-10', ghosted: false});
    expect(detail.get(alpine.id)!.hand_set).toEqual([{field: 'status', set_at: alpine.status_set_at}]);
  });

  test('Relecloud\'s re-application links to its Jul 22 application, rejected Sep 2', async () => {
    const {page, detail} = await seeded();
    const [again, first] = page.rows.filter(each => each.company === 'Relecloud');
    expect(again!.reapplied_from).toEqual({id: first!.id, company: 'Relecloud', title: 'Support Engineer', applied_on: '2026-07-22', status: 'rejected', status_on: '2026-09-02'});
    expect(detail.get(again!.id)!.applied_before.map(each => each.id)).toEqual([first!.id]);
  });

  test('the JDs as the table gives them', async () => {
    const {page, detail, row} = await seeded();
    const jd = (company: string, title: string) => {
      const {state, source, platform} = row(company, title).jd;
      return [state, source, platform];
    };
    expect(jd('Northwind Talent', 'Software Engineer I')).toEqual(['found', 'platform', 'Greenhouse']);
    expect(jd('Fabrikam', 'Data Analyst')).toEqual(['found', 'search', null]);
    expect(Date.parse(SEED_NOW) - Date.parse(row('Fabrikam', 'Data Analyst').jd.found_at!)).toBeLessThan(7 * 60 * 60_000);
    expect(jd('Relecloud', 'Support Engineer')).toEqual(['found', 'platform', 'Greenhouse']);
    expect(row('Lucerne Publishing', 'Junior Developer').jd).toMatchObject({state: 'candidates', candidates: 2});
    expect(jd('Tailspin Toys', 'Full Stack Developer')).toEqual(['found', 'email_link', 'Indeed']);
    expect(detail.get(row('Tailspin Toys', 'Full Stack Developer').id)!.posting).toMatchObject({salary: '$85,000–$105,000', workplace: 'hybrid'});
    expect(row('Trey Research', 'Data Engineer I').jd).toMatchObject({state: 'not_found', looked_at: expect.stringMatching(/^2026-10-01/)});
    expect(jd('Humongous Insurance', 'Software Engineer II, Claims')).toEqual(['found', 'search', null]);
    expect(jd('Litware', 'QA Engineer')).toEqual(['found', 'platform', 'Ashby']);
    expect(jd('Proseware', 'Software Engineer, Platform')).toEqual(['found', 'platform', 'Lever']);
    for (const [company, title] of [['Relecloud', 'Support Engineer'], ['Fourth Coffee', 'Software Developer'], ['Northwind Talent', 'Junior Developer']]) {
      const closed = page.rows.find(each => each.company === company && each.title === title && each.status === 'rejected')!;
      expect(closed.jd.state).toBe('none');
    }
  });

  test('only Woodgrove Bank\'s JD mentions Kubernetes', async () => {
    const {detail, row} = await seeded();
    const mentions = [...detail.values()].filter(each => /kubernetes/i.test(each.posting?.full_text ?? '')).map(each => each.company);
    expect(mentions).toEqual(['Woodgrove Bank']);
    expect(detail.get(row('Woodgrove Bank', 'Application Developer').id)!.posting!.full_text)
      .toContain('our services run on Kubernetes across two regions, so you’ll pick it up from day one');
  });

  test('only the two Humongous Insurance applications are at a Humongous company', async () => {
    const {page} = await seeded();
    expect(page.rows.filter(each => /humongous/i.test(each.company)).map(each => each.title)).toEqual(['Software Engineer II, Claims', 'Software Engineer II (Java)']);
  });
});

describe('Northwind\'s detail (32, 33)', () => {
  test('its JD, found on Greenhouse Oct 1 at 10:41 AM', async () => {
    const {detail, row} = await seeded();
    const northwind = detail.get(row('Northwind Talent', 'Software Engineer I').id)!;
    expect(northwind.posting).toMatchObject({
      summary: 'A new-grad engineer for the hiring-platform team, shipping TypeScript features end to end. Most of the work is the candidate-facing web app and its API. Shipped side projects count for more than coursework.',
      location: 'Irvine, CA', workplace: 'hybrid', workplace_detail: '3 days', salary: '$95,000–$115,000',
      must_haves: ['TypeScript and React', 'An API you built', 'SQL', 'A CS degree or equivalent experience'],
      nice_to_haves: ['Node.js on the server', 'Tests in CI', 'Hiring or HR software'],
      link: 'https://greenhouse.example/northwindtalent/jobs/4471029', source: 'platform', platform: 'Greenhouse', found_at: '2026-10-01T17:41:00.000Z',
    });
    expect(northwind.posting!.full_text).toMatch(/^## About the team/);
  });

  test('its timeline, oldest first, linking the Inbox\'s own emails', async () => {
    const {detail, row} = await seeded();
    const northwind = detail.get(row('Northwind Talent', 'Software Engineer I').id)!;
    expect(northwind.timeline.map(event => [event.at.slice(0, 10), event.kind, event.quiet, event.subject, event.message_id !== null])).toEqual([
      ['2026-10-01', 'applied', false, 'Thank you for applying to Northwind Talent', true],
      ['2026-10-01', 'verification', true, 'Verify your email', false],
      ['2026-10-07', 'interview', false, 'Interview availability for Software Engineer I', true],
    ]);
    expect(northwind.applied_before.map(each => [each.title, each.applied_on, each.status, each.status_on])).toEqual([['Junior Developer', '2026-02-09', 'rejected', '2026-03-14']]);
    expect(northwind.also_at).toEqual([]);
  });

  test('Humongous Insurance\'s Claims application has its JD, and the other is Also at', async () => {
    const {detail, row} = await seeded();
    const claims = detail.get(row('Humongous Insurance', 'Software Engineer II, Claims').id)!;
    expect(claims.posting).toMatchObject({location: 'United States', workplace: 'remote', salary: null, link: 'https://humongous.example/careers/jobs/2026-0917'});
    expect(claims.also_at.map(each => each.title)).toEqual(['Software Engineer II (Java)']);
    expect(claims.timeline.map(event => event.subject)).toEqual(['Thank you for applying', 'Your candidate account is ready']);
  });
});

describe('mail, as it was', () => {
  test('the Inbox\'s counts don\'t change, and the Indeed match email is read, in All only', async () => {
    const {w} = await seeded();
    expect(mailCounts(w.store)).toMatchObject({attention: 3, unread: 19, unread_fyi: 11});
    const indeed = w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Associate Software Engineer @ Contoso Pharmaceuticals')).get()!;
    expect(indeed).toMatchObject({unread: false, lane: 'noise', fromName: 'Indeed'});
    // Jobs read it once and made nothing of it.
    expect(jobsDb(w.store.sqlite).select().from(j.jobsEmailsRead).where(eq(j.jobsEmailsRead.messageId, indeed.id)).get()).toMatchObject({outcome: 'ignored'});
  });
});
