// The JD lookup's pure rules (J3), as tables: links that are postings, the platforms and board
// names to try, a board's postings that could be the role, what the model's verdicts make
// (confident, unsure with three at most, none), how a lookup ends (a failure is retried, never "No JD
// found"), which failures are misses, when web search runs, and how much of a salary or a location
// a reading keeps. Example domains stand in for the platforms' real hosts.
import {describe, expect, test} from 'vitest';
import {ProviderError} from '../../sync/errors.ts';
import {postingReadingOf} from '../jdPrompt.ts';
import {
  boardNames, emailLinks, isMiss, lookupEnd, matchPostings, nextSourceRuns, outcomeOf, platformsToTry, postingFit, postingLinks, postingRef, senderBoard,
} from '../lookupRules.ts';
import type {JobPlatform, LookupApplication, PostingCandidate, PostingHosts, StepOutcome, Verdict} from '../lookupRules.ts';

const HOSTS: PostingHosts = {greenhouse: ['greenhouse.example'], lever: ['lever.example'], ashby: ['ashby.example'], indeed: ['indeed.example']};

describe('postingRef', () => {
  test.each<[string, string, ReturnType<typeof postingRef>]>([
    ['a Greenhouse posting', 'https://greenhouse.example/lucernepublishing/jobs/5520391', {platform: 'greenhouse', board: 'lucernepublishing', id: '5520391'}],
    ['a Greenhouse posting on a subdomain', 'https://job-boards.greenhouse.example/relecloud/jobs/6120884?gh_src=mail', {platform: 'greenhouse', board: 'relecloud', id: '6120884'}],
    ['a Greenhouse board', 'https://greenhouse.example/relecloud', {platform: 'greenhouse', board: 'relecloud', id: null}],
    ['Greenhouse\'s embed', 'https://greenhouse.example/embed/job_app?for=northwindtalent&token=4471029', {platform: 'greenhouse', board: 'northwindtalent', id: '4471029'}],
    ['a careers page with gh_jid', 'https://humongous.example/careers/open?gh_jid=2026917', {platform: 'greenhouse', board: null, id: '2026917'}],
    ['a Lever posting and its apply page', 'https://lever.example/proseware/9a41c7e2-5d0b-4f1e-8c3a-2b7d90e1f4a6/apply', {platform: 'lever', board: 'proseware', id: '9a41c7e2-5d0b-4f1e-8c3a-2b7d90e1f4a6'}],
    ['an Ashby posting', 'https://ashby.example/litware/3f6e2a10-91c4-4b7e-a2d5-0c8f61e7b934', {platform: 'ashby', board: 'litware', id: '3f6e2a10-91c4-4b7e-a2d5-0c8f61e7b934'}],
    ['an Ashby board', 'https://ashby.example/litware', {platform: 'ashby', board: 'litware', id: null}],
    ['an Indeed view-job link', 'https://www.indeed.example/viewjob?jk=7c1e9a24f0b3&from=jobmatch', {platform: 'indeed', board: null, id: '7c1e9a24f0b3'}],
    ['Indeed\'s tracking link', 'https://indeed.example/rc/clk?jk=2b90d4e1c7a8', {platform: 'indeed', board: null, id: '2b90d4e1c7a8'}],
    ['Indeed\'s home page is nothing', 'https://indeed.example/', null],
    ['an employer\'s careers page is nothing yet', 'https://fabrikam.example/careers/data-analyst-2291', null],
    ['not a web link', 'mailto:jobs@fabrikam.example', null],
    ['a lookalike host isn\'t the platform', 'https://notgreenhouse.example/x/jobs/1', null],
  ])('%s', (_, link, ref) => {
    expect(postingRef(link, HOSTS)).toEqual(ref);
  });
});

describe('emailLinks and postingLinks', () => {
  test('every link in the text and the HTML, once, without trailing punctuation or &amp;', () => {
    expect(emailLinks(
      'See https://indeed.example/viewjob?jk=7c1e9a24f0b3. Or (https://fabrikam.example/careers).',
      '<a href="https://indeed.example/viewjob?jk=7c1e9a24f0b3&amp;from=mail">View</a> <a href=\'https://indeed.example/unsubscribe\'>x</a>',
    )).toEqual([
      'https://indeed.example/viewjob?jk=7c1e9a24f0b3&from=mail', 'https://indeed.example/unsubscribe',
      'https://indeed.example/viewjob?jk=7c1e9a24f0b3', 'https://fabrikam.example/careers',
    ]);
  });

  test.each<[string, string[], string[]]>([
    ['a platform posting first, then Indeed, then a careers page', [
      'https://fabrikam.example/careers/jobs/data-analyst-2291', 'https://indeed.example/viewjob?jk=7c1e9a24f0b3', 'https://greenhouse.example/lucernepublishing/jobs/5520391',
    ], ['https://greenhouse.example/lucernepublishing/jobs/5520391', 'https://indeed.example/viewjob?jk=7c1e9a24f0b3', 'https://fabrikam.example/careers/jobs/data-analyst-2291']],
    ['the account, the email and a board are never one', [
      'https://greenhouse.example/relecloud', 'https://fabrikam.example/careers/login', 'https://fabrikam.example/jobs/unsubscribe?u=1',
      'https://fabrikam.example/careers/account/settings', 'https://fabrikam.example/', 'https://fabrikam.example/careers',
    ], []],
    ['at most three', [
      'https://indeed.example/viewjob?jk=1', 'https://indeed.example/viewjob?jk=2', 'https://indeed.example/viewjob?jk=3', 'https://indeed.example/viewjob?jk=4',
    ], ['https://indeed.example/viewjob?jk=1', 'https://indeed.example/viewjob?jk=2', 'https://indeed.example/viewjob?jk=3']],
  ])('%s', (_, links, expected) => {
    expect(postingLinks(links, HOSTS)).toEqual(expected);
  });
});

describe('platformsToTry', () => {
  test.each<[string, string | null, JobPlatform[], JobPlatform[]]>([
    ['triage named Greenhouse', 'Greenhouse', [], ['greenhouse']],
    ['triage named Ashby, any case', 'ashby', [], ['ashby']],
    ['a job board: all three', 'Indeed', [], ['greenhouse', 'lever', 'ashby']],
    ['nothing named: all three', null, [], ['greenhouse', 'lever', 'ashby']],
    ['another tracking system: none', 'Workday', [], []],
    ['another tracking system, but a Lever link', 'iCIMS', ['lever'], ['lever']],
    ['a linked platform comes first', 'Greenhouse', ['ashby'], ['ashby', 'greenhouse']],
    ['nothing named, but a Lever link: Lever alone', null, ['lever'], ['lever']],
    ['a job board, but a Greenhouse link: Greenhouse alone', 'Indeed', ['greenhouse'], ['greenhouse']],
    ['Breezy HR is another', 'Breezy HR', [], []],
  ])('%s', (_, via, linked, expected) => {
    expect(platformsToTry(via, linked)).toEqual(expected);
  });
});

describe('board names', () => {
  test.each<[string, string, string | null]>([
    ['the employer\'s own domain', 'careers@mail.humongous.example', 'humongous'],
    ['a two-part top-level domain (an invented one)', 'jobs@lucerne.co.ex', 'lucerne'],
    ['a platform\'s mail says nothing', 'no-reply@us.greenhouse-mail.example', null],
    ['Lever\'s mail says nothing', 'no-reply@hire.lever.example', null],
    ['a mailbox provider says nothing', 'recruiter@gmail.example', null],
    ['no domain', 'nobody', null],
  ])('senderBoard: %s', (_, address, board) => {
    expect(senderBoard(address)).toBe(board);
  });

  test.each<[string, string, (string | null)[], string[], string[]]>([
    ['the company run together, dashed, and its first word', 'Lucerne Publishing', [], [], ['lucernepublishing', 'lucerne-publishing', 'lucerne']],
    ['a linked board, then the sender\'s domain', 'Humongous Insurance', ['humongousins'], ['talent@humongous.example'], ['humongousins', 'humongous', 'humongousinsurance', 'humongous-insurance']],
    ['one word, once', 'Relecloud', [], ['no-reply@greenhouse-mail.example'], ['relecloud']],
    ['"Inc." and punctuation go', 'Contoso, Inc.', [], [], ['contoso']],
    ['a short first word isn\'t guessed alone', 'City Power & Light', [], [], ['citypowerlight', 'city-power-light']],
  ])('boardNames: %s', (_, company, linked, senders, expected) => {
    expect(boardNames(company, linked, senders)).toEqual(expected);
  });
});

const APPLICATION: LookupApplication = {company: 'Lucerne Publishing', title: 'Junior Developer', titleKey: 'junior developer', requisitionId: null, appliedAt: '2026-10-05T17:20:00.000Z'};
const posting = (title: string, extra: Partial<PostingCandidate> = {}): PostingCandidate => ({title, location: null, postedAt: '2026-09-28T14:00:00.000Z', requisitionId: null, link: `https://greenhouse.example/lucernepublishing/jobs/${title.length}`, ...extra});

describe('matching a board\'s postings', () => {
  test.each<[string, Partial<LookupApplication>, PostingCandidate, number]>([
    ['the same normalised title', {}, posting('Junior Developer (Remote)'), 2],
    ['the requisition ID, whatever the title', {requisitionId: 'LP-0412'}, posting('Associate Engineer', {requisitionId: 'lp 0412'}), 3],
    ['a title holding the other\'s words', {}, posting('Junior Developer, Digital'), 1],
    ['another role', {}, posting('Senior Editor'), 0],
    ['one shared word isn\'t enough', {title: 'Developer', titleKey: 'developer'}, posting('Developer Advocate'), 0],
    ['published after the application', {}, posting('Junior Developer', {postedAt: '2026-10-09T00:00:00.000Z'}), 0],
    ['published the day after is still it', {}, posting('Junior Developer', {postedAt: '2026-10-06T12:00:00.000Z'}), 2],
    ['no publish date doesn\'t count against it', {}, posting('Junior Developer', {postedAt: null}), 2],
    ['an application with no role matches nothing by title', {title: '', titleKey: ''}, posting('Junior Developer'), 0],
  ])('postingFit: %s', (_, changes, candidate, fit) => {
    expect(postingFit({...APPLICATION, ...changes}, candidate)).toBe(fit);
  });

  test('a requisition ID match stands alone', () => {
    const byId = posting('Associate Engineer', {requisitionId: 'LP-0412'});
    expect(matchPostings({...APPLICATION, requisitionId: 'LP-0412'}, [posting('Junior Developer'), byId])).toEqual([byId]);
  });

  test('the closest titles first, then the one published nearest before applying, three at most', () => {
    const exactOld = posting('Junior Developer', {link: 'https://x.example/1', postedAt: '2026-06-01T00:00:00.000Z'});
    const exactNew = posting('Junior Developer', {link: 'https://x.example/2', postedAt: '2026-10-01T00:00:00.000Z'});
    const close = posting('Junior Developer, Digital', {link: 'https://x.example/3'});
    const closer = posting('Junior Web Developer', {link: 'https://x.example/4'});
    const other = posting('Senior Editor', {link: 'https://x.example/5'});
    expect(matchPostings(APPLICATION, [other, close, exactOld, exactNew, closer]).map(each => each.link)).toEqual([
      'https://x.example/2', 'https://x.example/1', 'https://x.example/3',
    ]);
  });
});

describe('what the verdicts make', () => {
  test.each<[string, Verdict[], StepOutcome<string>]>([
    ['one match is confident', ['no', 'match', 'maybe'], {is: 'confident', posting: 'b'}],
    ['two matches are unsure', ['match', 'match'], {is: 'unsure', candidates: ['a', 'b']}],
    ['maybes are unsure, in order', ['maybe', 'no', 'maybe'], {is: 'unsure', candidates: ['a', 'c']}],
    ['four maybes offer three', ['maybe', 'maybe', 'maybe', 'maybe'], {is: 'unsure', candidates: ['a', 'b', 'c']}],
    ['all no is none', ['no', 'no'], {is: 'none'}],
    ['nothing is none', [], {is: 'none'}],
  ])('%s', (_, verdicts, outcome) => {
    expect(outcomeOf(verdicts.map((verdict, index) => ({candidate: 'abcd'[index]!, verdict})))).toEqual(outcome);
  });
});

const NETWORK = new ProviderError('transient', 'Couldn\'t reach greenhouse.example (ECONNRESET).');
const RATE = new ProviderError('rate_limited', '429 Too Many Requests', {status: 429, retryAfterMs: 20_000});

describe('how a lookup ends', () => {
  test.each<[string, Parameters<typeof lookupEnd<string>>[0], ReturnType<typeof lookupEnd<string>>]>([
    ['confident is saved', [{is: 'none'}, {is: 'confident', posting: 'gh'}], {is: 'save', posting: 'gh'}],
    ['the first confident wins over a failure', [{is: 'failed', error: NETWORK}, {is: 'confident', posting: 'gh'}], {is: 'save', posting: 'gh'}],
    ['unsure offers its candidates', [{is: 'none'}, {is: 'unsure', candidates: ['a', 'b']}], {is: 'candidates', candidates: ['a', 'b']}],
    ['unsure from two sources offers three at most', [{is: 'unsure', candidates: ['a', 'b']}, {is: 'unsure', candidates: ['c', 'd']}], {is: 'candidates', candidates: ['a', 'b', 'c']}],
    ['nothing anywhere is not found', [{is: 'none'}, {is: 'none'}, {is: 'none'}], {is: 'not_found'}],
    ['a failure with nothing found failed: retried, never not found', [{is: 'failed', error: NETWORK}, {is: 'none'}], {is: 'failed', error: NETWORK}],
    ['a failure beside an unsure source failed too', [{is: 'unsure', candidates: ['a']}, {is: 'failed', error: RATE}], {is: 'failed', error: RATE}],
  ])('%s', (_, steps, end) => {
    expect(lookupEnd(steps)).toEqual(end);
  });

  test.each<[string, ProviderError, boolean]>([
    ['a 404 is a miss', new ProviderError('permanent', '404 Not Found', {status: 404}), true],
    ['a 403 is a miss', new ProviderError('permanent', '403 Forbidden', {status: 403}), true],
    ['a 429 is retried', RATE, false],
    ['a 503 is retried', new ProviderError('transient', '503 Service Unavailable', {status: 503}), false],
    ['a timeout is retried', new ProviderError('transient', 'greenhouse.example didn\'t answer in time.'), false],
    ['the AI\'s refused key isn\'t a miss either', new ProviderError('auth', 'Anthropic: invalid x-api-key (401).'), false],
  ])('isMiss: %s', (_, error, miss) => {
    expect(isMiss(error)).toBe(miss);
  });

  test.each<[string, 'platforms' | 'search', Parameters<typeof nextSourceRuns>[1], boolean]>([
    ['the platforms run after a link that missed', 'platforms', [{is: 'none'}], true],
    ['the platforms run after a link that was unsure', 'platforms', [{is: 'unsure', candidates: []}], true],
    ['the platforms run after a link that failed', 'platforms', [{is: 'failed'}], true],
    ['nothing runs after confident', 'platforms', [{is: 'confident', posting: 'a'}], false],
    ['search runs when everything cleanly missed', 'search', [{is: 'none'}, {is: 'none'}], true],
    ['search runs when there was nothing before it', 'search', [], true],
    ['no search when a source was unsure', 'search', [{is: 'none'}, {is: 'unsure', candidates: []}], false],
    ['no search when a source failed: retried first', 'search', [{is: 'failed'}, {is: 'none'}], false],
  ])('nextSourceRuns: %s', (_, source, steps, runs) => {
    expect(nextSourceRuns(source, steps)).toBe(runs);
  });
});

describe('what a reading keeps of a salary and a location (SV-129)', () => {
  const PAY = '$3,900.00 - $6,500.00 per month (grades A, B, C, D, E, F; varies by grade, by office and by bargaining unit)';
  const PLACES = 'Fresno, Sacramento, Oakland, Riverside, San Diego, Santa Rosa, Redding, Bakersfield, Stockton, Modesto, Visalia, San Bernardino, Eureka and Salinas, CA';

  test.each<[string, 'salary' | 'location', string, string]>([
    ['a salary with its notes is kept whole', 'salary', PAY, PAY],
    ['a salary of 240 is kept whole', 'salary', 'x'.repeat(240), 'x'.repeat(240)],
    ['a salary past 240 is cut', 'salary', 'x'.repeat(241), `${'x'.repeat(239)}…`],
    ['a list of places is kept whole', 'location', PLACES, PLACES],
    ['a location of 200 is kept whole', 'location', 'x'.repeat(200), 'x'.repeat(200)],
    ['a location past 200 is cut', 'location', 'x'.repeat(201), `${'x'.repeat(199)}…`],
  ])('%s', (_, field, stated, kept) => {
    expect(postingReadingOf({[field]: stated}, null)[field]).toBe(kept);
  });
});
