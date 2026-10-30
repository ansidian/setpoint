// The web the JD lookup reads, faked at the HTTP boundary (J3): one fake on 127.0.0.1 serves every
// example domain, the hiring platforms' APIs and posting pages alike, from the invented fixtures in
// ./fixtures, in each API's real shape. The lookup's fetch sends `https://<host>/<path>` to the fake
// as `/<host>/<path>`, and refuses any host that isn't an example domain, so no test reaches a real
// platform or page.
import fs from 'node:fs';
import {fakeServer, on} from '../../../tests/fakes/server.ts';
import type {FakeResponse} from '../../../tests/fakes/server.ts';
import type {PostingHosts} from '../lookupRules.ts';
import {JOBS_USER_AGENT} from '../web.ts';
import type {JobsWeb} from '../web.ts';

export const fixture = (name: string) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
export const fixtureJson = <T = any>(name: string): T => JSON.parse(fixture(name)) as T; // eslint-disable-line @typescript-eslint/no-explicit-any

export const TEST_HOSTS: PostingHosts = {greenhouse: ['greenhouse.example'], lever: ['lever.example'], ashby: ['ashby.example'], indeed: ['indeed.example']};
export const TEST_APIS = {greenhouse: 'https://api.greenhouse.example', lever: 'https://api.lever.example', ashby: 'https://api.ashby.example'};
export const TEST_GOVERNMENT_JOBS = 'https://governmentjobs.example';

export const htmlPage = (body: string): FakeResponse => ({status: 200, body, headers: {'content-type': 'text/html; charset=UTF-8'}});

/** The fake web: `serve('https://host/path', answer)` (query strings ignored); anything not served is a 404. */
export async function fakeWeb() {
  const pages = new Map<string, FakeResponse | (() => FakeResponse)>();
  const server = await fakeServer([on('GET', /^\/.*$/, request => {
    const answer = pages.get(request.path.slice(1));
    return typeof answer === 'function' ? answer() : answer ?? {status: 404, body: {status: 404, error: 'Not found'}};
  })]);
  const fetchExample: typeof fetch = (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
    if (!url.hostname.endsWith('.example')) throw new Error(`The lookup tried to reach ${url.hostname}, which isn't an example domain`);
    return fetch(`${server.url}/${url.hostname}${url.pathname}${url.search}`, init);
  };
  const web: JobsWeb = {http: {fetch: fetchExample, timeoutMs: 2000}, apis: TEST_APIS, governmentJobs: TEST_GOVERNMENT_JOBS, hosts: TEST_HOSTS, userAgent: JOBS_USER_AGENT};
  return {
    web,
    server,
    serve(url: string, answer: FakeResponse | (() => FakeResponse)) {
      const parsed = new URL(url);
      pages.set(`${parsed.hostname}${parsed.pathname}`, answer);
    },
    /** The example URLs asked for, as `host/path`. */
    asked: () => server.requests.map(request => request.path.slice(1)),
  };
}

/** The three boards, GovernmentJobs' search with its two postings of a title at the City of Contoso, and both pages, each where the fixtures say. */
export function serveFixtures(fake: Awaited<ReturnType<typeof fakeWeb>>) {
  const greenhouse = fixtureJson('greenhouse-board.json');
  fake.serve(`${TEST_APIS.greenhouse}/v1/boards/lucernepublishing/jobs`, {status: 200, body: greenhouse});
  for (const job of greenhouse.jobs) fake.serve(`${TEST_APIS.greenhouse}/v1/boards/lucernepublishing/jobs/${job.id}`, {status: 200, body: job});
  const lever = fixtureJson('lever-postings.json');
  fake.serve(`${TEST_APIS.lever}/v0/postings/proseware`, {status: 200, body: lever});
  for (const posting of lever) fake.serve(`${TEST_APIS.lever}/v0/postings/proseware/${posting.id}`, {status: 200, body: posting});
  fake.serve(`${TEST_APIS.ashby}/posting-api/job-board/litware`, {status: 200, body: fixtureJson('ashby-board.json')});
  fake.serve(`${TEST_GOVERNMENT_JOBS}/jobs`, htmlPage(fixture('governmentjobs-search.html')));
  fake.serve(`${TEST_GOVERNMENT_JOBS}/jobs/7100123-0/office-assistant-ii`, htmlPage(fixture('governmentjobs-posting.html')));
  fake.serve(`${TEST_GOVERNMENT_JOBS}/jobs/7098777-0/office-assistant-ii-public-works`, htmlPage(fixture('governmentjobs-posting.html').replace('2026-10-05T16:00:00Z', '2026-03-02T16:00:00Z').replace('Water Department', 'Public Works Department')));
  fake.serve('https://fabrikam.example/careers/data-analyst-2291', htmlPage(fixture('posting-page.html')));
  fake.serve('https://indeed.example/viewjob', htmlPage(fixture('view-job.html')));
}
