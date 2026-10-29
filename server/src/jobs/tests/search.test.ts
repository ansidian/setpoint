// Jobs's search (J5, D316) as tables: loose company matching, the ranking of company or role
// matches, the line a JD's text matched; then the route against the seed (36a, 36b), and the shell's
// item (GET /api/jobs/nav).
import {jobsNavSchema, jobsSearchSchema} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {signedIn, world} from '../../../tests/helpers.ts';
import {jobsApi} from '../api.ts';
import {matchedLine, nameRank, searchApplications, searchWords, startsName} from '../search.ts';
import type {Searchable} from '../search.ts';

describe('loose company matching (decision 62)', () => {
  test.each<[string, string, boolean]>([
    ['wide world', 'Wide World Importers', true],
    ['wide wor', 'Wide World Importers', true],
    ['WIDE  WORLD', 'Wide World Importers', true],
    ['humongous', 'Humongous Insurance', true],
    ['hum', 'Humongous Insurance', true],
    ['city power &', 'City Power & Light', true],
    ['city power light', 'City Power & Light', true],
    ['margie', 'Margie\'s Travel', true],
    ['a datum', 'A. Datum Corporation', true],
    // In order, from the start: a later word alone is a weaker match (nameRank), not this one.
    ['world wide', 'Wide World Importers', false],
    ['importers', 'Wide World Importers', false],
    ['wide world importers inc', 'Wide World Importers', false],
    ['northwind traders', 'Northwind Talent', false],
    ['', 'Fabrikam', false],
  ])('"%s" starts %s: %s', (query, company, starts) => {
    expect(startsName(searchWords(company), searchWords(query))).toBe(starts);
  });
});

describe('company or role, best first (D316)', () => {
  test.each<[string, string, number | null]>([
    ['the company starts with it', 'humongous ins', 0],
    ['its words start the company\'s', 'insurance', 1],
    ['the role\'s', 'eng claims', 2],
    ['the company\'s and the role\'s together', 'humongous claims', 3],
    ['nothing', 'kubernetes', null],
  ])('%s: "%s" ranks %s', (_, query, rank) => {
    expect(nameRank('Humongous Insurance', 'Software Engineer II, Claims', searchWords(query))).toBe(rank);
  });

  const apps: Searchable[] = [
    {id: 1, company: 'Humongous Insurance', title: 'Software Engineer II (Java)', appliedAt: '2026-09-28T16:50:00.000Z', fullText: null},
    {id: 2, company: 'Humongous Insurance', title: 'Software Engineer II, Claims', appliedAt: '2026-09-30T21:12:00.000Z', fullText: null},
    {id: 3, company: 'Fabrikam', title: 'Data Analyst', appliedAt: '2026-10-07T14:00:00.000Z', fullText: 'Our dashboards run on Humongous data.'},
    {id: 4, company: 'Litware', title: 'Insurance Claims QA', appliedAt: '2026-09-21T16:00:00.000Z', fullText: null},
    {id: 5, company: 'Woodgrove Bank', title: 'Application Developer', appliedAt: '2026-08-31T16:00:00.000Z',
      fullText: '## Nice to have\n\n- Containers: our services run on Kubernetes across two regions, so you’ll pick it up from day one, and we\'ll teach you the rest.'},
  ];

  test.each<[string, number[], number[]]>([
    // 36a: both Humongous applications, newest first; a JD mentioning it comes after.
    ['humongous', [2, 1], [3]],
    // The company before a role that only names it.
    ['insurance', [2, 1, 4], []],
    ['claims', [2, 4], []],
    // 36b: no company or role, one JD.
    ['kubernetes', [], [5]],
    ['kube', [], [5]],
    ['nothing at all', [], []],
  ])('"%s": company or role %j, then in a JD %j', (q, companyOrRole, inJd) => {
    const found = searchApplications(apps, q);
    expect(found.companyOrRole).toEqual(companyOrRole);
    expect(found.inJd.map(each => each.id)).toEqual(inJd);
  });
});

describe('the line a JD matched (36b)', () => {
  const woodgrove = '## Nice to have\n\n- Containers: our services run on Kubernetes across two regions, so you’ll pick it up from day one, and we\'ll teach you the rest.\n- Payments';
  test.each<[string, string, string, string | null]>([
    ['from a clause\'s start, up to eleven words on', woodgrove, 'kubernetes', '…our services run on Kubernetes across two regions, so you’ll pick it up from day one…'],
    ['a word\'s start, any case', woodgrove, 'KUBER', '…our services run on Kubernetes across two regions, so you’ll pick it up from day one…'],
    ['the first word places it; the rest must be in the text', woodgrove, 'payments containers', '…Payments…'],
    ['a word missing from the text is no match', woodgrove, 'kubernetes rust', null],
    ['inside a word is no match', woodgrove, 'ubernetes', null],
    ['six words back at most, and a sentence ends it',
      'We build tools that help small teams ship their work with Docker every day. Then we rest.', 'docker',
      '…small teams ship their work with Docker every day…'],
    ['a heading\'s marks and a link\'s target go', '### Working with [Terraform](https://terraform.example) daily', 'terraform', '…Working with Terraform daily…'],
  ])('%s', (_, text, q, line) => {
    expect(matchedLine(text, searchWords(q))).toBe(line);
  });
});

describe('the route, against the seed', () => {
  async function seeded() {
    const w = world({seed: true});
    return signedIn(w, {routes: [jobsApi(w.store)]});
  }

  test('humongous: both Humongous applications, newest first (36a)', async () => {
    const c = await seeded();
    const response = await c.send('GET', '/api/jobs/search?q=humongous');
    expect(response.status).toBe(200);
    const out = jobsSearchSchema.parse(response.body);
    expect(out.company_or_role.map(row => `${row.company} · ${row.title}`)).toEqual(['Humongous Insurance · Software Engineer II, Claims', 'Humongous Insurance · Software Engineer II (Java)']);
  });

  test('kubernetes: nothing by company or role, Woodgrove by its JD, with the line (36b)', async () => {
    const c = await seeded();
    const out = jobsSearchSchema.parse((await c.send('GET', '/api/jobs/search?q=kubernetes')).body);
    expect(out.company_or_role).toEqual([]);
    expect(out.in_jd.map(each => [each.row.company, each.line])).toEqual([
      ['Woodgrove Bank', '…our services run on Kubernetes across two regions, so you’ll pick it up from day one…'],
    ]);
  });

  test('an empty query is refused', async () => {
    const c = await seeded();
    expect((await c.send('GET', '/api/jobs/search?q=%20')).status).toBe(400);
  });

  test('the shell\'s item: Jobs on, today\'s Needs you 3 (From history\'s 6 aside)', async () => {
    const c = await seeded();
    expect(jobsNavSchema.parse((await c.send('GET', '/api/jobs/nav')).body)).toEqual({enabled: true, needs_you: 3});
  });
});
