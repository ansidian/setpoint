// Reading again the salaries and locations a reading cut (SV-129): which ones were cut, as a table,
// then against an ephemeral database with Anthropic faked at the HTTP boundary: only the field that
// was cut changes, only to what the reading found, the saved JD and the application stay as they
// were, the call goes on the ledger, and it can run again.
import {SEED_NOW} from '@setpoint/shared';
import {asc, eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {FAKE_KEYS, fakeModels} from '../../../tests/fakeModels.ts';
import type {FakeAnswer} from '../../../tests/fakeModels.ts';
import {world} from '../../../tests/helpers.ts';
import * as t from '../../db/schema.ts';
import {deleteSecret, setSecret} from '../../secrets/store.ts';
import {jobsDb} from '../db.ts';
import {repairFactsPlan, repairFactsWithHaiku, wasCut} from '../repairFacts.ts';
import * as j from '../schema.ts';

const FULL_PAY = '$3,900.00 - $6,500.00 per month (grades A, B, C, D, E, F; varies by grade, by office and by bargaining unit)';
const CUT_PAY = `${FULL_PAY.slice(0, 79).trimEnd()}…`;
const FULL_PLACES = 'Fresno, Sacramento, Oakland, Riverside, San Diego, Santa Rosa, Redding, Bakersfield, Stockton, Modesto, Visalia, San Bernardino, Eureka and Salinas, CA';
const CUT_PLACES = `${FULL_PLACES.slice(0, 119).trimEnd()}…`;
const TEXT = `## The role\n\nA data analyst for the state's benefits team.\n\nPay: ${FULL_PAY}\n\nWhere: ${FULL_PLACES}`;

describe('what was cut', () => {
  test.each<[string, string | null, number, boolean]>([
    ['nothing', null, 80, false],
    ['a short value', '$95,000–$115,000', 80, false],
    ['a short value ending in …', '$95,000 and up…', 80, false],
    ['a cut value', `${'x'.repeat(79)}…`, 80, true],
    ['a cut value that lost the space before its …', `${'x'.repeat(78)}…`, 80, true],
    ['one shorter still', `${'x'.repeat(77)}…`, 80, false],
    ['that long, with no …', 'x'.repeat(80), 80, false],
    ['longer than the old limit could keep', `${'x'.repeat(80)}…`, 80, false],
    ['a location cut at its own limit', `${'x'.repeat(119)}…`, 120, true],
  ])('%s', (_, value, limit, cut) => {
    expect(wasCut(value, limit)).toBe(cut);
  });
});

const usage = {input: 1800, output: 260};
const reading = (found: {salary?: string | null; location?: string | null}): FakeAnswer => ({
  tool: {summary: 'Another summary.', location: null, workplace: 'remote', workplace_detail: null, salary: null, must_haves: ['Something else'], nice_to_haves: [], ...found}, usage,
});

async function setup() {
  const models = await fakeModels();
  const {store} = world({seed: true});
  const db = jobsDb(store.sqlite);
  for (const table of [j.jobsEvents, j.jobsNeedsYou, j.jobsPostings, j.jobsJdCandidates, j.jobsHandSet, j.jobsEmailsRead, j.jobsBlockedEmails, j.jobsApplications]) db.delete(table).run();
  setSecret(store, 'anthropic_api_key', FAKE_KEYS.anthropic);
  const make = (company: string, title: string, posting: {salary?: string | null; location?: string | null; link?: string | null}) => {
    const {id} = db.insert(j.jobsApplications).values({
      company, title, titleKey: title.toLowerCase(), appliedAt: SEED_NOW, status: 'applied', statusSetBy: 'email', statusSetAt: SEED_NOW, createdAt: SEED_NOW, updatedAt: SEED_NOW,
    }).returning({id: j.jobsApplications.id}).get();
    db.insert(j.jobsPostings).values({
      applicationId: id, fullText: TEXT, summary: 'A data analyst.', location: posting.location ?? null, workplace: 'hybrid', workplaceDetail: '2 days', salary: posting.salary ?? null,
      mustHaves: ['SQL'], niceToHaves: ['Tableau'], link: 'https://example.com/posting', source: 'platform', platform: 'Greenhouse', foundAt: SEED_NOW,
    }).run();
    return id;
  };
  const posting = (id: number) => db.select().from(j.jobsPostings).where(eq(j.jobsPostings.applicationId, id)).get()!;
  const application = (id: number) => db.select().from(j.jobsApplications).where(eq(j.jobsApplications.id, id)).get()!;
  const ledger = () => store.db.select().from(t.aiUsage).orderBy(asc(t.aiUsage.id)).all();
  const repair = () => repairFactsWithHaiku(store, models.endpoints);
  return {store, db, models, make, posting, application, ledger, repair};
}

describe('jobs-repair-facts', () => {
  test('it lists the postings with something cut and what, changing nothing and asking nothing', async () => {
    const s = await setup();
    const pay = s.make('Contoso', 'Data Analyst', {salary: CUT_PAY, location: 'Irvine, CA'});
    const places = s.make('Fabrikam', 'Analyst', {salary: '$95,000–$115,000', location: CUT_PLACES});
    const both = s.make('Northwind', 'Data Engineer', {salary: CUT_PAY, location: CUT_PLACES});
    s.make('Lucerne Publishing', 'Junior Developer', {salary: FULL_PAY, location: 'New York, NY'});
    s.make('Trey Research', 'Researcher', {});
    expect(repairFactsPlan(s.store)).toEqual([
      {applicationId: pay, company: 'Contoso', title: 'Data Analyst', cut: ['salary']},
      {applicationId: places, company: 'Fabrikam', title: 'Analyst', cut: ['location']},
      {applicationId: both, company: 'Northwind', title: 'Data Engineer', cut: ['salary', 'location']},
    ]);
    expect(s.posting(pay).salary).toBe(CUT_PAY);
    expect(s.models.requests).toEqual([]);
  });

  test('applying reads the saved text, not the cut value, and writes only what was cut; the JD and the application stay', async () => {
    const s = await setup();
    const pay = s.make('Contoso', 'Data Analyst', {salary: CUT_PAY, location: 'Irvine, CA'});
    const places = s.make('Fabrikam', 'Analyst', {salary: '$95,000–$115,000', location: CUT_PLACES});
    s.db.insert(j.jobsHandSet).values({applicationId: pay, field: 'title', setAt: SEED_NOW}).run();
    const before = {pay: s.posting(pay), places: s.posting(places), application: s.application(pay)};
    s.models.answer(() => reading({salary: FULL_PAY, location: FULL_PLACES}));

    expect(await s.repair()).toMatchObject({cut: [{applicationId: pay}, {applicationId: places}], repaired: 2});

    expect(s.posting(pay)).toEqual({...before.pay, salary: FULL_PAY});
    expect(s.posting(places)).toEqual({...before.places, location: FULL_PLACES});
    expect(s.application(pay)).toEqual(before.application);
    const asked = s.models.requests[0]!;
    expect(asked.model).toBe('claude-haiku-5-5');
    expect(asked.input).toContain('Employer: Contoso\nPosting: Data Analyst\n\n## The role');
    expect(asked.input).toContain(`Pay: ${FULL_PAY}`);
    expect(asked.input).not.toContain(CUT_PAY);
    expect(s.ledger().map(row => [row.purpose, row.model, row.messageId])).toEqual([
      ['jobs_reading_jds', 'claude-haiku-5-5', null], ['jobs_reading_jds', 'claude-haiku-5-5', null],
    ]);
  });

  test.each<[string, FakeAnswer]>([
    ['finds nothing', reading({})],
    ['gives no usable answer', 'no_tool'],
  ])('a reading that %s leaves the row as it was', async (_, answer) => {
    const s = await setup();
    const id = s.make('Contoso', 'Data Analyst', {salary: CUT_PAY, location: CUT_PLACES});
    const before = s.posting(id);
    s.models.answer(() => answer);
    expect(await s.repair()).toMatchObject({repaired: 0});
    expect(s.posting(id)).toEqual(before);
    expect(repairFactsPlan(s.store)).toHaveLength(1);
  });

  test('of two cut fields, the one it found is written and the other waits', async () => {
    const s = await setup();
    const id = s.make('Contoso', 'Data Analyst', {salary: CUT_PAY, location: CUT_PLACES});
    s.models.answer(() => reading({salary: FULL_PAY}));
    await s.repair();
    expect(s.posting(id)).toMatchObject({salary: FULL_PAY, location: CUT_PLACES});
    expect(repairFactsPlan(s.store)).toMatchObject([{applicationId: id, cut: ['location']}]);
  });

  test('it\'s safe to run again: nothing is left to read, and a stop partway keeps what was done', async () => {
    const s = await setup();
    const first = s.make('Contoso', 'Data Analyst', {salary: CUT_PAY});
    const second = s.make('Fabrikam', 'Analyst', {salary: CUT_PAY});
    let asked = 0;
    s.models.answer(() => {
      asked += 1;
      return asked === 2 ? {status: 400, body: {type: 'error', error: {type: 'invalid_request_error', message: 'Refused'}}} : reading({salary: FULL_PAY});
    });
    await expect(s.repair()).rejects.toThrow();
    expect(s.posting(first).salary).toBe(FULL_PAY);
    expect(s.posting(second).salary).toBe(CUT_PAY);

    s.models.answer(() => reading({salary: FULL_PAY}));
    expect(await s.repair()).toMatchObject({repaired: 1});
    const requests = s.models.requests.length;
    expect(repairFactsPlan(s.store)).toEqual([]);
    expect(await s.repair()).toEqual({cut: [], repaired: 0});
    expect(s.models.requests).toHaveLength(requests);
  });

  test('with no Anthropic key it says so and changes nothing', async () => {
    const s = await setup();
    const id = s.make('Contoso', 'Data Analyst', {salary: CUT_PAY});
    deleteSecret(s.store, 'anthropic_api_key');
    await expect(s.repair()).rejects.toThrow('Jobs needs an Anthropic key');
    expect(s.posting(id).salary).toBe(CUT_PAY);
  });
});
