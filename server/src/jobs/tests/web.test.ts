// The JD lookup's reads of the web (J3, Done when): each platform's invented fixture (Greenhouse's
// job board API, Lever's postings API, Ashby's posting API, each in its real shape) and the posting
// pages parse into postings with their text as markdown, faked at the HTTP boundary (./fakeWeb.ts).
// Every request names Setpoint in its User-Agent; a board or posting that isn't there is nothing, and
// a failure is thrown for the retry policy.
import {describe, expect, test} from 'vitest';
import {ProviderError} from '../../sync/errors.ts';
import {boardPostings, JOBS_USER_AGENT, openLink, pagePosting, readLink} from '../web.ts';
import {fakeWeb, fixture, serveFixtures, TEST_APIS} from './fakeWeb.ts';

const signal = new AbortController().signal;

async function web() {
  const fake = await fakeWeb();
  serveFixtures(fake);
  return fake;
}

describe('the platforms\' public APIs', () => {
  test('Greenhouse\'s board parses, its escaped content as markdown', async () => {
    const fake = await web();
    const postings = await boardPostings(fake.web, 'greenhouse', 'lucernepublishing', signal);
    expect(postings!.map(({text: _, ...posting}) => posting)).toEqual([
      {title: 'Junior Developer', link: 'https://greenhouse.example/lucernepublishing/jobs/5520391', site: 'Greenhouse', location: 'New York, NY', postedAt: '2026-09-28T14:00:00.000Z', requisitionId: 'LP-0412', facts: []},
      {title: 'Junior Developer, Digital', link: 'https://greenhouse.example/lucernepublishing/jobs/5520412', site: 'Greenhouse', location: 'Remote', postedAt: '2026-09-20T15:30:00.000Z', requisitionId: 'LP-0415', facts: []},
      {title: 'Senior Editor', link: 'https://greenhouse.example/lucernepublishing/jobs/5519870', site: 'Greenhouse', location: 'New York, NY', postedAt: '2026-09-01T13:00:00.000Z', requisitionId: 'LP-0398', facts: []},
    ]);
    expect(postings![0]!.text).toBe([
      '## About Lucerne Publishing', '',
      'Lucerne Publishing makes reading apps for schools and libraries. Our digital team builds the apps teachers and students open every day, and the services behind them.', '',
      '## What you\'ll do', '',
      '- Build features in TypeScript and React with a senior engineer beside you', '- Write tests for what you ship, and fix what they find', '- Join planning and design reviews from your first week', '',
      '## What you\'ll need', '',
      '- JavaScript or TypeScript, from work, school or your own projects', '- Comfort with Git and code review', '- A degree in computer science or equivalent experience', '',
      '## Nice to have', '',
      '- React Native', '- Accessibility work', '',
      'This role is hybrid, three days a week in our New York, NY office. The salary range is $80,000–$95,000.',
    ].join('\n'));
    expect(fake.server.requests[0]).toMatchObject({path: '/api.greenhouse.example/v1/boards/lucernepublishing/jobs', headers: {'user-agent': JOBS_USER_AGENT}});
    expect(fake.server.requests[0]!.query.get('content')).toBe('true');
  });

  test('Lever\'s postings parse, with their lists, setting and pay', async () => {
    const fake = await web();
    const [platform, designer] = (await boardPostings(fake.web, 'lever', 'proseware', signal))!;
    expect(platform).toMatchObject({
      title: 'Software Engineer, Platform', site: 'Lever', location: 'Remote, US', postedAt: '2026-09-15T16:00:00.000Z', requisitionId: null,
      link: 'https://lever.example/proseware/9a41c7e2-5d0b-4f1e-8c3a-2b7d90e1f4a6', facts: ['Workplace: Remote', 'Pay: USD 105000–125000 per-year-salary'],
    });
    expect(platform!.text).toBe([
      'Proseware builds project tools for small engineering firms. The platform team keeps the API, the job queue and the database fast and up.', '',
      '## What you\'ll do', '', '- Own services in Go and TypeScript, from design to on-call', '- Make deploys boring: CI, canaries and rollbacks', '- Pair with the product teams on what they need from the platform', '',
      '## What you\'ll bring', '', '- 3 or more years building backend services', '- Postgres in production', '- Kubernetes or another container platform', '',
      '## Bonus points', '', '- Terraform', '- Work on a small team', '',
      'We hire from anywhere in the United States and meet in person twice a year.',
    ].join('\n'));
    expect(designer).toMatchObject({title: 'Product Designer', location: 'Seattle, WA', facts: ['Workplace: On-site']});
    expect(fake.server.requests[0]!.query.get('mode')).toBe('json');
  });

  test('Ashby\'s board parses, with its setting and pay', async () => {
    const fake = await web();
    const postings = (await boardPostings(fake.web, 'ashby', 'litware', signal))!;
    expect(postings[0]).toMatchObject({
      title: 'QA Engineer', site: 'Ashby', location: 'Raleigh, NC', postedAt: '2026-09-24T15:02:11.204Z',
      link: 'https://ashby.example/litware/3f6e2a10-91c4-4b7e-a2d5-0c8f61e7b934', facts: ['Workplace: Remote', 'Pay: $76K – $90K'],
    });
    expect(postings[0]!.text).toMatch(/^## About Litware\n\nLitware makes the scheduling software clinics use to book patients\./);
    expect(postings[0]!.text).toContain('## Requirements\n\n- 1 or more years in QA or testing\n- Some scripting in JavaScript or Python');
    expect(postings[1]).toMatchObject({title: 'Office Manager', facts: ['Workplace: On-Site']});
    expect(fake.server.requests[0]!.query.get('includeCompensation')).toBe('true');
  });

  test('a board the platform doesn\'t have is nothing; a failing platform throws for the retry', async () => {
    const fake = await web();
    expect(await boardPostings(fake.web, 'greenhouse', 'lucerne', signal)).toBeNull();
    expect(await boardPostings(fake.web, 'lever', 'lucerne', signal)).toBeNull();
    fake.server.fault({path: /lever/, response: {status: 503, body: 'Service Unavailable'}});
    await expect(boardPostings(fake.web, 'lever', 'proseware', signal)).rejects.toMatchObject({kind: 'transient', status: 503});
    fake.server.fault({path: /ashby/, response: {status: 429, body: {}, headers: {'retry-after': '30'}}});
    const error = await boardPostings(fake.web, 'ashby', 'litware', signal).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({kind: 'rate_limited', retryAfterMs: 30_000});
  });
});

describe('a link', () => {
  test('a platform\'s posting is read through its API, not its page', async () => {
    const fake = await web();
    const greenhouse = await readLink(fake.web, 'https://greenhouse.example/lucernepublishing/jobs/5520391', signal);
    expect(greenhouse).toMatchObject({title: 'Junior Developer', site: 'Greenhouse', requisitionId: 'LP-0412'});
    const lever = await readLink(fake.web, 'https://lever.example/proseware/9a41c7e2-5d0b-4f1e-8c3a-2b7d90e1f4a6', signal);
    expect(lever).toMatchObject({title: 'Software Engineer, Platform', site: 'Lever'});
    const ashby = await readLink(fake.web, 'https://ashby.example/litware/3f6e2a10-91c4-4b7e-a2d5-0c8f61e7b934', signal);
    expect(ashby).toMatchObject({title: 'QA Engineer', site: 'Ashby'});
    expect(fake.asked()).toEqual([
      'api.greenhouse.example/v1/boards/lucernepublishing/jobs/5520391', 'api.lever.example/v0/postings/proseware/9a41c7e2-5d0b-4f1e-8c3a-2b7d90e1f4a6',
      'api.ashby.example/posting-api/job-board/litware',
    ]);
  });

  test('a posting page parses by its JSON-LD JobPosting', async () => {
    const fake = await web();
    const posting = await readLink(fake.web, 'https://fabrikam.example/careers/data-analyst-2291', signal);
    expect(posting).toMatchObject({
      title: 'Data Analyst', site: 'Fabrikam Careers', location: 'Atlanta, GA', postedAt: '2026-09-29T00:00:00.000Z', requisitionId: 'FAB-2291',
      link: 'https://fabrikam.example/careers/data-analyst-2291', facts: ['Pay: USD 70000–82000 year'],
    });
    expect(posting!.text).toBe([
      '## The role', '',
      'Fabrikam\'s analytics team turns plant and shipping data into the reports operations runs on. You\'ll own weekly reporting and help managers answer their own questions.', '',
      '## What you\'ll do', '', '- Build and keep the weekly operations dashboards', '- Write SQL against the warehouse, and clean what you find', '- Explain the numbers to the people who use them', '',
      '## Requirements', '', '- SQL', '- A spreadsheet you\'d be proud to share', '- 1 or more years of analysis work', '',
      '## Nice to have', '', '- Python or R', '- Power BI', '',
      'Hybrid, two days a week in Atlanta.',
    ].join('\n'));
    expect(fake.server.requests[0]!.headers['user-agent']).toBe(JOBS_USER_AGENT);
  });

  test('a page without JSON-LD gives its main content, without the page around it', async () => {
    const fake = await web();
    const posting = await readLink(fake.web, 'https://indeed.example/viewjob?jk=7c1e9a24f0b3', signal);
    expect(posting).toMatchObject({title: 'Full Stack Developer', site: 'Indeed', location: null, link: 'https://indeed.example/viewjob?jk=7c1e9a24f0b3'});
    expect(posting!.text).toBe([
      '## Full Stack Developer', '',
      'Tailspin Toys · Denver, CO · Hybrid', '',
      '## About the job', '',
      'Tailspin Toys sells toys online and in 40 stores. The commerce team builds the storefront and checkout, and this year that means getting ready for the holidays.', '',
      '## What you\'ll do', '',
      '- Build storefront and checkout features in React and Node.js', '- Make the busiest pages faster', '- Help the store staff tools team when the holidays are over', '  - Inventory lookups', '  - Gift card tools', '',
      '## Requirements', '', '- React and a server-side language', '- SQL', '- 1 or more years building web apps', '',
      'Pay: $85,000 - $105,000 per year',
    ].join('\n'));
  });

  test('a redirect is followed to the posting', async () => {
    const fake = await web();
    fake.serve('https://click.indeed.example/rc/clk', {status: 302, body: '', headers: {location: 'https://indeed.example/viewjob?jk=7c1e9a24f0b3'}});
    expect(await readLink(fake.web, 'https://click.indeed.example/rc/clk?jk=7c1e9a24f0b3', signal)).toMatchObject({title: 'Full Stack Developer', site: 'Indeed'});
  });

  test.each<[string, Parameters<Awaited<ReturnType<typeof fakeWeb>>['serve']>[1]]>([
    ['a posting taken down (404)', {status: 404, body: 'Not Found', headers: {'content-type': 'text/html'}}],
    ['a page that refuses robots (403)', {status: 403, body: 'Forbidden', headers: {'content-type': 'text/html'}}],
    ['a page with no posting on it', {status: 200, body: '<html><head><title>Sign in</title></head><body><main><p>Sign in to see this job.</p></main></body></html>', headers: {'content-type': 'text/html'}}],
    ['a PDF', {status: 200, body: '%PDF-1.7', headers: {'content-type': 'application/pdf'}}],
  ])('%s is nothing', async (_, answer) => {
    const fake = await web();
    fake.serve('https://woodgrovebank.example/careers/jobs/31877', answer);
    expect(await readLink(fake.web, 'https://woodgrovebank.example/careers/jobs/31877', signal)).toBeNull();
  });

  // What a search candidate is, once opened (D388): gone is dropped; unreadable stays, since the user can open it in a browser.
  const html = {'content-type': 'text/html'};
  test.each<[string, Parameters<Awaited<ReturnType<typeof fakeWeb>>['serve']>[1], 'gone' | 'unreadable']>([
    ['a 404', {status: 404, body: 'Not Found', headers: html}, 'gone'],
    ['a 410', {status: 410, body: 'Gone', headers: html}, 'gone'],
    ['a 403', {status: 403, body: 'Forbidden', headers: html}, 'unreadable'],
    ['a 401', {status: 401, body: 'Unauthorized', headers: html}, 'unreadable'],
    ['a redirect to nowhere', {status: 302, body: '', headers: {}}, 'unreadable'],
    ['a PDF', {status: 200, body: '%PDF-1.7', headers: {'content-type': 'application/pdf'}}, 'unreadable'],
    ['a page drawn by script', {status: 200, body: fixture('script-drawn.html'), headers: html}, 'unreadable'],
    ['a page with no posting on it', {status: 200, body: '<html><head><title>Sign in</title></head><body><main><p>Sign in to see this job.</p></main></body></html>', headers: html}, 'unreadable'],
  ])('openLink: %s', async (_, answer, is) => {
    const fake = await web();
    fake.serve('https://woodgrovebank.example/careers/jobs/31877', answer);
    expect(await openLink(fake.web, 'https://woodgrovebank.example/careers/jobs/31877', signal)).toEqual({is});
  });

  test('openLink: a page that reads gives its posting', async () => {
    const fake = await web();
    const opened = await openLink(fake.web, 'https://fabrikam.example/careers/data-analyst-2291', signal);
    expect(opened).toMatchObject({is: 'read', posting: {title: 'Data Analyst', site: 'Fabrikam Careers'}});
  });

  test.each<[string, string, 'read' | 'gone' | 'unreadable']>([
    ['Greenhouse\'s posting', 'https://greenhouse.example/lucernepublishing/jobs/5520391', 'read'],
    ['Greenhouse without it', 'https://greenhouse.example/lucernepublishing/jobs/9999999', 'gone'],
    ['Lever\'s posting', 'https://lever.example/proseware/9a41c7e2-5d0b-4f1e-8c3a-2b7d90e1f4a6', 'read'],
    ['Lever without it', 'https://lever.example/proseware/ffffffff-0000-4000-8000-000000000000', 'gone'],
    ['Ashby\'s posting', 'https://ashby.example/litware/3f6e2a10-91c4-4b7e-a2d5-0c8f61e7b934', 'read'],
    ['Ashby\'s board without it', 'https://ashby.example/litware/ffffffff-0000-4000-8000-000000000000', 'gone'],
    ['a board Ashby doesn\'t have', 'https://ashby.example/nobody/ffffffff-0000-4000-8000-000000000000', 'gone'],
  ])('openLink, through a platform\'s API: %s', async (_, link, is) => {
    const fake = await web();
    expect((await openLink(fake.web, link, signal)).is).toBe(is);
  });

  test('openLink: a platform\'s API refusing Jobs is unreadable, not gone', async () => {
    const fake = await web();
    fake.server.fault({path: /greenhouse/, response: {status: 403, body: 'Forbidden'}});
    expect(await openLink(fake.web, 'https://greenhouse.example/lucernepublishing/jobs/5520391', signal)).toEqual({is: 'unreadable'});
  });

  test('openLink: a failure is thrown, as readLink\'s is', async () => {
    const fake = await web();
    fake.server.fault({path: /woodgrovebank/, response: {status: 503, body: 'Service Unavailable'}});
    await expect(openLink(fake.web, 'https://woodgrovebank.example/careers/jobs/31877', signal)).rejects.toMatchObject({kind: 'transient', status: 503});
  });

  test('a page that fails is thrown for the retry', async () => {
    const fake = await web();
    fake.server.fault({path: /woodgrovebank/, response: {status: 502, body: 'Bad Gateway'}});
    await expect(readLink(fake.web, 'https://woodgrovebank.example/careers/jobs/31877', signal)).rejects.toMatchObject({kind: 'transient', status: 502});
    fake.server.fault({path: /woodgrovebank/, response: 'hang'});
    await expect(readLink(fake.web, 'https://woodgrovebank.example/careers/jobs/31877', signal)).rejects.toMatchObject({kind: 'transient'});
  });

  test('the fixtures stay on example domains', () => {
    for (const name of ['greenhouse-board.json', 'lever-postings.json', 'ashby-board.json', 'posting-page.html', 'view-job.html', 'script-drawn.html', 'closed-posting.html']) {
      const hosts = [...fixture(name).matchAll(/https?:\/\/([^/"'\s<>]+)/g)].map(match => match[1]!).filter(host => host !== 'schema.org');
      expect(hosts.every(host => host.endsWith('.example')), name).toBe(true);
    }
    expect(pagePosting('<html><body></body></html>', 'https://fabrikam.example/x')).toBeNull();
    expect(TEST_APIS.greenhouse.endsWith('.example')).toBe(true);
  });
});
