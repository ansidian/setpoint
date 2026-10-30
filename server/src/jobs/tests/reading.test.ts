// Jobs reading mail (J2): the rules as tables, with prod's shapes invented over (decisions 50, 51, 55,
// 56, 67, 68): loose company names, normalised titles and requisition IDs, a confident match, what
// each email does (Indeed's pairs, a re-application after a rejection, a confirmation twice, the
// same title under two IDs, a rejection with no confirmation, a Business email that isn't Career),
// a status set by hand, blocked emails, and the model's answer read leniently.
import type {JobReadMode, JobStatus, Kind} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {emailReadingOf, jobsPromptInput} from '../prompt.ts';
import type {JobEmailEvent} from '../prompt.ts';
import {isBlocked, matchApplication, planEmail, readsEmail, requisitionKey, sameCompany, statusAfter, statusFromEvents, titleKey} from '../rules.ts';
import type {BlockedEmail, KnownApplication, Plan, ReadMatchEmail, StatusEvent} from '../rules.ts';

describe('companies match loosely (decision 51)', () => {
  test.each<[string, string, boolean]>([
    ['Fabrikam Labs', 'Fabrikam', true],
    ['wide world', 'Wide World Importers', true],
    ['Wide World Importers', 'WIDE WORLD IMPORTERS', true],
    ['Contoso, Inc.', 'Contoso', true],
    ['The Phone Company', 'Phone Company LLC', true],
    ['City Power & Light', 'City Power and Light', false],
    ['Northwind Talent', 'Northwind Traders', false],
    ['Fabrikam', 'Fabrikamco', false],
    ['Humongous Insurance', 'Insurance', false],
    ['Inc.', 'Inc.', false],
  ])('%j and %j: %s', (a, b, same) => {
    expect(sameCompany(a, b)).toBe(same);
    expect(sameCompany(b, a)).toBe(same);
  });
});

test.each([
  ['Software Engineer II (Java) (2026-1042)', 'software engineer ii'],
  ['Software Engineer II - Remote', 'software engineer ii'],
  ['Remote Software Engineer II', 'software engineer ii'],
  ['SOFTWARE ENGINEER II [Hybrid]', 'software engineer ii'],
  ['(2026-1042)', ''],
])('the title %j is the role %j', (title, key) => {
  expect(titleKey(title)).toBe(key);
});

test.each([['R-2026-118', 'r2026118'], ['r 2026 118', 'r2026118'], ['JR104', 'jr104']])('the requisition ID %j compares as %j', (id, key) => {
  expect(requisitionKey(id)).toBe(key);
});

describe('which mail Jobs reads (decision 56)', () => {
  test.each<[string, JobReadMode | null, Kind | null, boolean]>([
    ['Jobs reads every email, Career', 'every', 'career', true],
    ['Jobs reads every email, Other (confirmations typed Other)', 'every', 'other', true],
    ['Jobs reads every email, Noise (a job board\'s match)', 'every', null, true],
    ['Business reads Career', 'career', 'career', true],
    ['Business doesn\'t read a delivery', 'career', 'deliveries', false],
    ['Business doesn\'t read Other', 'career', 'other', false],
    ['an account Jobs doesn\'t list', null, 'career', false],
  ])('%s', (_, mode, kind, read) => {
    expect(readsEmail(mode, kind)).toBe(read);
  });
});

let ids = 0;
const app = (company: string, title: string | null, status: JobStatus = 'applied', more: Partial<KnownApplication> = {}): KnownApplication => ({
  id: ++ids, company, titleKey: title ? titleKey(title) : null, requisitionId: null, status, statusSetAt: '2026-10-01T16:00:00.000Z',
  appliedAt: '2026-10-01T16:00:00.000Z', companyUnknown: false, ...more,
});

describe('a confident match (decision 51)', () => {
  const fabrikam = app('Fabrikam', 'Software Engineer II');
  const humongousA = app('Humongous Insurance', 'Data Analyst', 'applied', {requisitionId: 'R-100'});
  const humongousB = app('Humongous Insurance', 'Data Analyst', 'applied', {requisitionId: 'R-200'});
  const woodgroveOld = app('Woodgrove Bank', 'Junior Developer', 'rejected', {appliedAt: '2026-08-01T16:00:00.000Z'});
  const woodgroveNew = app('Woodgrove Bank', 'Junior Developer', 'applied');
  const alpine = app('Alpine Ski House', 'Support Engineer', 'withdrawn');
  const all = [fabrikam, humongousA, humongousB, woodgroveOld, woodgroveNew, alpine];

  test.each<[string, string, string | null, string | null, number | string]>([
    ['the title, loose on the company', 'Fabrikam Labs', 'Software Engineer II (Java) (2026-1042)', null, fabrikam.id],
    ['no role, the company\'s only open application', 'Fabrikam', null, null, fabrikam.id],
    ['the requisition ID tells two of one title apart', 'Humongous Insurance', 'Data Analyst', 'r-200', humongousB.id],
    ['the title alone matches both', 'Humongous Insurance', 'Data Analyst', null, 'several:matches_several'],
    ['no role, two open', 'Humongous', null, null, 'several:names_no_role'],
    ['a role the company has no application for', 'Fabrikam', 'Product Manager', null, 'none:names_other_role'],
    ['a requisition ID neither has', 'Humongous Insurance', 'Data Analyst', 'R-300', 'none:names_other_role'],
    ['a re-application: the open one of the two', 'Woodgrove Bank', 'Junior Developer', null, woodgroveNew.id],
    ['a closed one is matched by its role', 'Alpine Ski House', 'Support Engineer', null, alpine.id],
    ['no role, nothing open', 'Alpine Ski House', null, null, 'none:no_role'],
    ['no application at the company', 'Lucerne Publishing', 'Editor', null, 'none:no_company'],
  ])('%s', (_, company, title, requisitionId, expected) => {
    const found = matchApplication(all, company, {titleKey: title ? titleKey(title) : null, requisitionId});
    const got = 'match' in found ? found.match.id : 'several' in found ? `several:${found.several}` : `none:${found.none}`;
    expect(got).toBe(expected);
  });
});

describe('statuses (decisions 55, 68)', () => {
  const at = (day: string) => `2026-10-${day}T16:00:00.000Z`;
  test.each<[string, string, Parameters<typeof statusAfter>[1], string, JobStatus | null]>([
    ['an interview moves it to In process', at('01'), 'interview', at('05'), 'in_process'],
    ['an assessment too', at('01'), 'assessment', at('05'), 'in_process'],
    ['an offer', at('01'), 'offer', at('05'), 'offer'],
    ['a rejection', at('01'), 'rejection', at('05'), 'rejected'],
    ['a later email that sets a status wins over one set by hand', at('10'), 'rejection', at('12'), 'rejected'],
    ['an email older than the status, read late, doesn\'t undo it', at('10'), 'interview', at('08'), null],
    ['a quiet email never moves it: a form', at('01'), 'form', at('05'), null],
    ['nor a duplicate confirmation', at('01'), 'duplicate', at('05'), null],
    ['nor a verification code', at('01'), 'verification', at('05'), null],
  ])('%s', (_, statusSetAt, kind, emailAt, status) => {
    expect(statusAfter({statusSetAt}, kind, emailAt)).toBe(status);
  });
});

describe('what corrections give an application to answer to (decision 58, J6)', () => {
  // Merged with Fabrikam's Data Analyst; given the Software Engineer II email by Assign to…; retitled by hand.
  const merged = app('Contoso', 'Software Engineer I', 'applied', {aliases: [
    {company: 'Fabrikam', titleKey: titleKey('Data Analyst'), requisitionId: null},
    {company: 'Contoso', titleKey: titleKey('Software Engineer II'), requisitionId: null},
    {company: null, titleKey: titleKey('Platform Engineer'), requisitionId: null},
  ]});
  const other = app('Contoso', 'Designer');
  const all = [merged, other];

  test.each<[string, string, string | null, number | string]>([
    ['its own role', 'Contoso', 'Software Engineer I', merged.id],
    ['the merged one\'s company and role', 'Fabrikam Labs', 'Data Analyst', merged.id],
    ['the role an assigned email named', 'Contoso', 'Software Engineer II (Java)', merged.id],
    ['the title it was given by hand, at its own company', 'Contoso', 'Platform Engineer', merged.id],
    ['the merged one\'s company with another role', 'Fabrikam', 'Product Manager', 'none:names_other_role'],
    ['the merged one\'s company, no role: its only open application there', 'Fabrikam', null, merged.id],
    ['another company with an alias\'s role is still another company', 'Northwind Talent', 'Data Analyst', 'none:no_company'],
    ['the other application at the company keeps its own', 'Contoso', 'Designer', other.id],
  ])('%s', (_, company, title, expected) => {
    const found = matchApplication(all, company, {titleKey: title ? titleKey(title) : null, requisitionId: null});
    const got = 'match' in found ? found.match.id : 'several' in found ? `several:${found.several}` : `none:${found.none}`;
    expect(got).toBe(expected);
  });
});

describe('the status the emails make it (Let emails decide, D365)', () => {
  const at = (day: string) => `2026-10-${day}T16:00:00.000Z`;
  const event = (day: string, kind: StatusEvent['kind'], line: string | null = null): StatusEvent => ({at: at(day), kind, line, subject: `${kind} email`});
  test.each<[string, StatusEvent[], ReturnType<typeof statusFromEvents>]>([
    ['only a confirmation: Applied as of it', [event('01', 'applied')], {status: 'applied', statusSetAt: at('01'), step: null, stepAt: null}],
    ['an interview: In process with its line', [event('01', 'applied'), event('05', 'interview', 'Interview Tue')], {status: 'in_process', statusSetAt: at('05'), step: 'Interview Tue', stepAt: at('05')}],
    ['quiet emails after it don\'t count', [event('01', 'applied'), event('05', 'assessment'), event('07', 'form')], {status: 'in_process', statusSetAt: at('05'), step: 'assessment email', stepAt: at('05')}],
    ['the latest by date, whatever the order', [event('09', 'rejection'), event('01', 'applied'), event('05', 'interview')], {status: 'rejected', statusSetAt: at('09'), step: null, stepAt: null}],
    ['an offer', [event('01', 'applied'), event('06', 'offer')], {status: 'offer', statusSetAt: at('06'), step: null, stepAt: null}],
    ['no emails that set one: Applied as of its Applied date', [event('03', 'verification')], {status: 'applied', statusSetAt: at('01'), step: null, stepAt: null}],
  ])('%s', (_, events, expected) => {
    expect(statusFromEvents(at('01'), events)).toEqual(expected);
  });
});

describe('blocked by Not an application (decision 67, D321)', () => {
  const blocked: BlockedEmail[] = [{messageId: 40, company: 'Litware', titleKey: 'sales engineer', requisitionId: null}];
  test.each<[string, number, string, string | null, boolean]>([
    ['the blocked email itself', 40, 'Litware', null, true],
    ['the same company and role, later', 41, 'Litware, Inc.', 'Sales Engineer (Remote)', true],
    ['the same company, another role', 42, 'Litware', 'Support Engineer', false],
    ['the same company, naming no role', 43, 'Litware', null, false],
    ['another company, the same role', 44, 'Fabrikam', 'Sales Engineer', false],
  ])('%s', (_, messageId, company, title, expected) => {
    expect(isBlocked(blocked, messageId, company, {titleKey: title ? titleKey(title) : null, requisitionId: null})).toBe(expected);
  });
});

describe('what each email does (decision 50)', () => {
  const fabrikam = app('Fabrikam', 'Software Engineer II', 'applied', {id: 1});
  const humongousA = app('Humongous Insurance', 'Data Analyst', 'applied', {id: 2, requisitionId: 'R-100'});
  const humongousB = app('Humongous Insurance', 'Data Analyst', 'in_process', {id: 3, requisitionId: 'R-200'});
  const northwind = app('Northwind Talent', 'Junior Developer', 'rejected', {id: 4});
  const alpine = app('Alpine Ski House', 'Support Engineer', 'withdrawn', {id: 5, statusSetAt: '2026-10-03T16:00:00.000Z'});
  const indeedWaiting = app('Indeed', 'Help Desk Analyst', 'applied', {id: 6, companyUnknown: true, appliedAt: '2026-10-05T16:00:00.000Z'});
  const relecloud = app('Relecloud', 'Cloud Support Associate', 'applied', {id: 7});
  const applications = [fabrikam, humongousA, humongousB, northwind, alpine, indeedWaiting, relecloud];
  const blocked: BlockedEmail[] = [{messageId: 90, company: 'Litware', titleKey: 'sales engineer', requisitionId: null}];
  const matches: ReadMatchEmail[] = [
    {messageId: 80, at: '2026-10-06T13:05:00.000Z', company: 'Tailspin Toys', titleKey: 'full stack developer', applicationId: null},
    {messageId: 81, at: '2026-08-01T13:05:00.000Z', company: 'Trey Research', titleKey: 'data engineer', applicationId: null},
    {messageId: 82, at: '2026-10-06T13:05:00.000Z', company: 'Coho Winery', titleKey: 'it technician', applicationId: 12},
  ];

  type Row = [string, JobEmailEvent, string | null, string | null, string | null, Plan];
  test.each<Row>([
    // name, event, the company the email names (null: none), title, requisition ID, plan
    ['a confirmation matching nothing makes an application', 'confirmation', 'Lucerne Publishing', 'Editor', null,
      {do: 'create', company: 'Lucerne Publishing', companyUnknown: false, reappliedFrom: null, pairedWith: null}],
    ['a confirmation twice: a duplicate while it\'s open', 'confirmation', 'Fabrikam Labs', 'Software Engineer II (Java)', null,
      {do: 'event', applicationId: 1, kind: 'duplicate', status: null}],
    ['a re-application after a rejection, linked', 'confirmation', 'Northwind Talent', 'Junior Developer', null,
      {do: 'create', company: 'Northwind Talent', companyUnknown: false, reappliedFrom: 4, pairedWith: null}],
    ['a re-application after withdrawing', 'confirmation', 'Alpine Ski House', 'Support Engineer', null,
      {do: 'create', company: 'Alpine Ski House', companyUnknown: false, reappliedFrom: 5, pairedWith: null}],
    ['the same title under a second requisition ID: two applications', 'confirmation', 'Humongous Insurance', 'Data Analyst', 'R-300',
      {do: 'create', company: 'Humongous Insurance', companyUnknown: false, reappliedFrom: null, pairedWith: null}],
    ['a confirmation naming no role, two open there: a new one', 'confirmation', 'Humongous Insurance', null, null,
      {do: 'create', company: 'Humongous Insurance', companyUnknown: false, reappliedFrom: null, pairedWith: null}],
    ['Indeed: a confirmation naming no company takes its match email\'s', 'confirmation', null, 'Full Stack Developer', null,
      {do: 'create', company: 'Tailspin Toys', companyUnknown: false, reappliedFrom: null, pairedWith: matches[0]!}],
    ['Indeed: no match email yet, so the company waits for one', 'confirmation', null, 'Junior Web Developer', null,
      {do: 'create', company: 'Indeed', companyUnknown: true, reappliedFrom: null, pairedWith: null}],
    ['Indeed: a match email over 30 days before doesn\'t pair', 'confirmation', null, 'Data Engineer', null,
      {do: 'create', company: 'Indeed', companyUnknown: true, reappliedFrom: null, pairedWith: null}],
    ['Indeed: a match email already paired doesn\'t pair again', 'confirmation', null, 'IT Technician', null,
      {do: 'create', company: 'Indeed', companyUnknown: true, reappliedFrom: null, pairedWith: null}],
    ['Indeed: a match email names the company an application waits for', 'match', 'Wide World Importers', 'Help Desk Analyst', null,
      {do: 'pair', applicationId: 6, company: 'Wide World Importers'}],
    ['a job board\'s match otherwise makes nothing, even at a company applied to', 'match', 'Fabrikam', 'Software Engineer II', null,
      {do: 'ignore', why: 'match_email'}],
    ['an interview confidently matching moves the status', 'interview', 'Fabrikam', 'Software Engineer II', null,
      {do: 'event', applicationId: 1, kind: 'interview', status: 'in_process'}],
    ['an update naming no role, the company\'s only open application', 'rejection', 'Relecloud', null, null,
      {do: 'event', applicationId: 7, kind: 'rejection', status: 'rejected'}],
    ['by requisition ID among two of one title', 'offer', 'Humongous Insurance', 'Data Analyst', 'R-200',
      {do: 'event', applicationId: 3, kind: 'offer', status: 'offer'}],
    ['a later rejection overrides Withdrawn set by hand', 'rejection', 'Alpine Ski House', 'Support Engineer', null,
      {do: 'event', applicationId: 5, kind: 'rejection', status: 'rejected'}],
    ['might match: either of two', 'rejection', 'Humongous Insurance', 'Data Analyst', null,
      {do: 'needs_you', kind: 'update_to_assign', reason: 'matches_several'}],
    ['might match: names no role, and there are two', 'assessment', 'Humongous', null, null,
      {do: 'needs_you', kind: 'update_to_assign', reason: 'names_no_role'}],
    ['might match: a role the company\'s applications don\'t have', 'interview', 'Fabrikam', 'Product Manager', null,
      {do: 'needs_you', kind: 'update_to_assign', reason: 'names_other_role'}],
    ['a rejection with no confirmation is ignored', 'rejection', 'Lucerne Publishing', 'Editor', null,
      {do: 'ignore', why: 'rejection_matches_nothing'}],
    ['an interview matching nothing waits as Track this', 'interview', 'Proseware', 'Junior Developer', null,
      {do: 'needs_you', kind: 'email_to_track', reason: 'no_application'}],
    ['an assessment matching nothing too', 'assessment', 'Graphic Design Institute', null, null,
      {do: 'needs_you', kind: 'email_to_track', reason: 'no_application'}],
    ['an offer matching nothing too', 'offer', 'Bellows College', 'Web Developer', null,
      {do: 'needs_you', kind: 'email_to_track', reason: 'no_application'}],
    ['an interview naming no role where nothing is open: Track this', 'interview', 'Northwind Talent', null, null,
      {do: 'needs_you', kind: 'email_to_track', reason: 'no_application'}],
    ['a quiet email that matches becomes a quiet event: a form', 'form', 'Fabrikam', null, null,
      {do: 'event', applicationId: 1, kind: 'form', status: null}],
    ['a verification code', 'verification', 'Relecloud', 'Cloud Support Associate', null,
      {do: 'event', applicationId: 7, kind: 'verification', status: null}],
    ['quiet mail matching nothing is ignored', 'account', 'Lucerne Publishing', null, null,
      {do: 'ignore', why: 'quiet_matches_nothing'}],
    ['quiet mail that might match is ignored, not assigned', 'next_step', 'Humongous Insurance', null, null,
      {do: 'ignore', why: 'quiet_matches_nothing'}],
    ['a recruiter\'s cold email is out, even at a company applied to', 'recruiter', 'Fabrikam', 'Senior Engineer', null,
      {do: 'ignore', why: 'out'}],
    ['mail that isn\'t about an application is out', 'unrelated', 'Fabrikam', null, null,
      {do: 'ignore', why: 'out'}],
    ['a confirmation blocked by Not an application makes nothing', 'confirmation', 'Litware', 'Sales Engineer', null,
      {do: 'ignore', why: 'blocked'}],
  ])('%s', (_, event, named, title, requisitionId, plan) => {
    const email = {
      messageId: 100, at: '2026-10-07T16:00:00.000Z', event, company: named ?? 'Indeed', companyNamed: named !== null,
      role: {titleKey: title ? titleKey(title) : null, requisitionId},
    };
    expect(planEmail(email, applications, blocked, matches)).toEqual(plan);
  });

  test('an email Not an application blocked is ignored however it reads', () => {
    const email = {messageId: 90, at: '2026-10-07T16:00:00.000Z', event: 'interview' as const, company: 'Litware', companyNamed: true, role: {titleKey: null, requisitionId: null}};
    expect(planEmail(email, applications, blocked, matches)).toEqual({do: 'ignore', why: 'blocked'});
  });
});

describe('the model\'s answer, read leniently', () => {
  test.each<[string, Record<string, unknown> | null, ReturnType<typeof emailReadingOf>]>([
    ['a confirmation', {event: 'confirmation', company: 'Fabrikam', title: 'Software Engineer II', requisition_id: '2026-1042', line: null},
      {event: 'confirmation', company: 'Fabrikam', title: 'Software Engineer II', requisitionId: '2026-1042', line: null}],
    ['"null" and blanks are null; spaces fold', {event: 'interview', company: 'null', title: '  Data   Analyst ', requisition_id: '', line: 'Interview Tue Oct 13, 2:00 PM'},
      {event: 'interview', company: null, title: 'Data Analyst', requisitionId: null, line: 'Interview Tue Oct 13, 2:00 PM'}],
    ['a long line is cut', {event: 'assessment', company: 'Proseware', title: null, requisition_id: null, line: 'x'.repeat(100)},
      {event: 'assessment', company: 'Proseware', title: null, requisitionId: null, line: `${'x'.repeat(79)}…`}],
    ['an event Jobs doesn\'t know: unusable', {event: 'promotion', company: 'Fabrikam'}, null],
    ['no tool call: unusable', null, null],
  ])('%s', (_, input, reading) => {
    expect(emailReadingOf(input)).toEqual(reading);
  });

  test('the model reads triage\'s reading before the body', () => {
    const input = jobsPromptInput({
      accountLabel: 'Jobs', fromName: 'Fabrikam Recruiting', fromAddress: 'no-reply@fabrikam.example', subject: 'Thanks for applying', receivedAt: '2026-10-07T16:00:00.000Z',
      body: 'Thank you for applying to Software Engineer II.', organisation: 'Fabrikam', via: 'Workday', type: 'confirmation', kind: 'career', summary: 'Application received',
    });
    expect(input).toBe([
      'Account: Jobs', 'From: Fabrikam Recruiting <no-reply@fabrikam.example>', 'Subject: Thanks for applying', 'Date: 2026-10-07T16:00:00.000Z',
      'Triage read it as: organisation Fabrikam, via Workday, type confirmation, kind career.', 'Triage\'s summary: Application received', '',
      'Body:', 'Thank you for applying to Software Engineer II.',
    ].join('\n'));
  });
});
