// How the JD lookup reads the web (J3; decision 54): the hiring platforms' public job APIs
// (Greenhouse's job board API, Lever's postings API, Ashby's posting API) and posting pages, each
// request with Setpoint's honest, named User-Agent, through News's one way to GET (redirects followed
// by hand, never to the home network, a cap on what's read, failures classified for the retry
// policy). Only production is given the real hosts (server.ts): a dev run, `npm run try`, the seed and
// every test get none, or example domains served by a fake on 127.0.0.1.
import type {NewsHttpOptions} from '../providers/news/http.ts';
import {hostOf, newsGet, newsGetJson, responseText} from '../providers/news/http.ts';
import {ProviderError} from '../sync/errors.ts';
import type {Element} from 'domhandler';
import {findAll, findOne, getAttributeValue, textContent} from 'domutils';
import {parseDocument} from 'htmlparser2';
import {domToMarkdown, flat, htmlToMarkdown, MIN_POSTING_CHARS, plainToMarkdown} from './markdown.ts';
import {isMiss, PLATFORM_NAMES, postingRef} from './lookupRules.ts';
import type {JobPlatform, PostingCandidate, PostingHosts} from './lookupRules.ts';

export const JOBS_USER_AGENT = 'Setpoint/2 (a personal job application tracker; self-hosted)';

export interface JobsWeb {
  // The network: tests pass a fetch that serves example domains from a fake, and `privateHosts`.
  http: NewsHttpOptions;
  // Each platform's public API base.
  apis: Record<JobPlatform, string>;
  // Where each platform's posting pages live, and Indeed's.
  hosts: PostingHosts;
  userAgent: string;
}

/** Production's web: the platforms' real public APIs and posting hosts. */
export function jobsWeb(http: NewsHttpOptions = {}): JobsWeb {
  return {
    http,
    apis: {greenhouse: 'https://boards-api.greenhouse.io', lever: 'https://api.lever.co', ashby: 'https://api.ashbyhq.com'},
    hosts: {
      greenhouse: ['boards.greenhouse.io', 'job-boards.greenhouse.io', 'job-boards.eu.greenhouse.io', 'boards.eu.greenhouse.io'],
      lever: ['jobs.lever.co', 'jobs.eu.lever.co'],
      ashby: ['jobs.ashbyhq.com'],
      indeed: ['indeed.com'],
    },
    userAgent: JOBS_USER_AGENT,
  };
}

/** A posting found, with its full text as markdown and what its source states outright (pay, setting) for the reading. */
export interface FoundPosting extends PostingCandidate {
  // Where it was found: "Greenhouse", "Indeed", or the site's own name.
  site: string;
  text: string;
  facts: string[];
}

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
const iso = (value: unknown): string | null => {
  const at = typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
};

/** GETs JSON; null when the source says it isn't there (404, 403, 410). Throws a failure to retry. */
async function getJson(web: JobsWeb, url: string, signal: AbortSignal): Promise<unknown> {
  try {
    return await newsGetJson<unknown>(web.http, {url, userAgent: web.userAgent, signal});
  } catch (error) {
    if (error instanceof ProviderError && isMiss(error)) return null;
    throw error;
  }
}

// ---- Greenhouse: GET /v1/boards/{board}/jobs?content=true, /v1/boards/{board}/jobs/{id} ----

function greenhouseJob(job: unknown): FoundPosting | null {
  if (!isRecord(job)) return null;
  const title = str(job.title);
  const link = str(job.absolute_url);
  if (!title || !link) return null;
  return {
    title, link, site: PLATFORM_NAMES.greenhouse,
    location: isRecord(job.location) ? str(job.location.name) : null,
    postedAt: iso(job.first_published),
    requisitionId: str(job.requisition_id),
    text: typeof job.content === 'string' ? htmlToMarkdown(job.content) : '',
    facts: [],
  };
}

// ---- Lever: GET /v0/postings/{site}?mode=json, /v0/postings/{site}/{id}?mode=json ----

const LEVER_WORKPLACES: Record<string, string> = {onsite: 'On-site', 'on-site': 'On-site', hybrid: 'Hybrid', remote: 'Remote'};

function leverPosting(posting: unknown): FoundPosting | null {
  if (!isRecord(posting)) return null;
  const title = str(posting.text);
  const link = str(posting.hostedUrl);
  if (!title || !link) return null;
  const categories = isRecord(posting.categories) ? posting.categories : {};
  const lists = Array.isArray(posting.lists) ? posting.lists.filter(isRecord) : [];
  const html = [
    str(posting.description) ?? '',
    ...lists.map(list => `<h3>${str(list.text) ?? ''}</h3><ul>${str(list.content) ?? ''}</ul>`),
    str(posting.additional) ?? '',
  ].join('\n');
  const text = html.trim() ? htmlToMarkdown(html) : plainToMarkdown([str(posting.descriptionPlain), str(posting.additionalPlain)].filter(Boolean).join('\n\n'));
  const salary = isRecord(posting.salaryRange) ? posting.salaryRange : null;
  const workplace = str(posting.workplaceType);
  return {
    title, link, site: PLATFORM_NAMES.lever,
    location: str(categories.location),
    postedAt: iso(posting.createdAt),
    requisitionId: null,
    text,
    facts: [
      ...(workplace && LEVER_WORKPLACES[workplace.toLowerCase()] ? [`Workplace: ${LEVER_WORKPLACES[workplace.toLowerCase()]}`] : []),
      ...(salary && typeof salary.min === 'number' && typeof salary.max === 'number'
        ? [`Pay: ${str(salary.currency) ?? ''} ${salary.min}–${salary.max} ${str(salary.interval) ?? ''}`.replace(/\s+/g, ' ').trim()] : []),
      ...(str(posting.salaryDescriptionPlain) ? [`Pay: ${str(posting.salaryDescriptionPlain)}`] : []),
    ],
  };
}

// ---- Ashby: GET /posting-api/job-board/{board}?includeCompensation=true ----

function ashbyJob(job: unknown): (FoundPosting & {id: string | null}) | null {
  if (!isRecord(job) || job.isListed === false) return null;
  const title = str(job.title);
  const link = str(job.jobUrl);
  if (!title || !link) return null;
  const compensation = isRecord(job.compensation) ? job.compensation : {};
  const workplace = str(job.workplaceType);
  const html = str(job.descriptionHtml);
  return {
    id: str(job.id), title, link, site: PLATFORM_NAMES.ashby,
    location: str(job.location),
    postedAt: iso(job.publishedAt),
    requisitionId: null,
    text: html ? htmlToMarkdown(html) : plainToMarkdown(str(job.descriptionPlain) ?? ''),
    facts: [
      ...(workplace ? [`Workplace: ${workplace.replace(/([a-z])([A-Z])/g, '$1-$2')}`] : job.isRemote === true ? ['Workplace: Remote'] : []),
      ...(str(compensation.compensationTierSummary) ? [`Pay: ${str(compensation.compensationTierSummary)}`] : []),
    ],
  };
}

/**
 * A board's open postings on one platform; null when the platform has no board by that name. Throws
 * a failure to retry (the network, a 5xx, a 429).
 */
export async function boardPostings(web: JobsWeb, platform: JobPlatform, board: string, signal: AbortSignal): Promise<FoundPosting[] | null> {
  const name = encodeURIComponent(board);
  if (platform === 'greenhouse') {
    const body = await getJson(web, `${web.apis.greenhouse}/v1/boards/${name}/jobs?content=true`, signal);
    if (!isRecord(body) || !Array.isArray(body.jobs)) return null;
    return body.jobs.map(greenhouseJob).filter((job): job is FoundPosting => job !== null);
  }
  if (platform === 'lever') {
    const body = await getJson(web, `${web.apis.lever}/v0/postings/${name}?mode=json`, signal);
    if (!Array.isArray(body)) return null;
    return body.map(leverPosting).filter((posting): posting is FoundPosting => posting !== null);
  }
  const body = await getJson(web, `${web.apis.ashby}/posting-api/job-board/${name}?includeCompensation=true`, signal);
  if (!isRecord(body) || !Array.isArray(body.jobs)) return null;
  return body.jobs.map(ashbyJob).filter((job): job is FoundPosting & {id: string | null} => job !== null).map(({id: _, ...job}) => job);
}

// ---- Posting pages ----

const HTML = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5';

const attr = (element: Element, key: string) => getAttributeValue(element, key)?.trim() || null;

/** The schema.org JobPostings in a page's JSON-LD. */
function jsonLdPostings(html: string): Json[] {
  const document = parseDocument(html);
  const found: Json[] = [];
  for (const script of findAll(element => element.name === 'script' && attr(element, 'type') === 'application/ld+json', document.children)) {
    let data: unknown;
    try {
      data = JSON.parse(textContent(script));
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    while (queue.length) {
      const item = queue.shift();
      if (Array.isArray(item)) queue.push(...item);
      else if (isRecord(item)) {
        if (Array.isArray(item['@graph'])) queue.push(...item['@graph']);
        const type = item['@type'];
        if (type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'))) found.push(item);
      }
    }
  }
  return found;
}

function placeOf(location: unknown): string | null {
  const one = Array.isArray(location) ? location[0] : location;
  if (!isRecord(one)) return null;
  const address = isRecord(one.address) ? one.address : one;
  const parts = [str(address.addressLocality), str(address.addressRegion)].filter(Boolean);
  return parts.length ? parts.join(', ') : str(address.addressCountry) ?? str(one.name);
}

function salaryOf(salary: unknown): string | null {
  if (!isRecord(salary)) return null;
  const value = isRecord(salary.value) ? salary.value : {};
  const min = value.minValue ?? value.value;
  const max = value.maxValue;
  if (typeof min !== 'number') return null;
  return [str(salary.currency), typeof max === 'number' ? `${min}–${max}` : `${min}`, str(value.unitText)?.toLowerCase()].filter(Boolean).join(' ');
}

/** A posting page as a posting: its JSON-LD JobPosting when it has one, else its main content. Null with too little text. */
export function pagePosting(html: string, link: string): FoundPosting | null {
  const ld = jsonLdPostings(html)[0];
  const document = parseDocument(html);
  const meta = (key: string) => {
    const element = findOne(node => node.name === 'meta' && (attr(node, 'property') ?? attr(node, 'name'))?.toLowerCase() === key, document.children);
    return element ? attr(element, 'content') : null;
  };
  const site = meta('og:site_name') ?? hostOf(link).replace(/^www\./, '');
  if (ld) {
    const title = str(ld.title);
    const description = str(ld.description);
    const text = description ? (/<[a-z][\s\S]*>/i.test(description) || /^&lt;/.test(description) ? htmlToMarkdown(description) : plainToMarkdown(description)) : '';
    const identifier = isRecord(ld.identifier) ? str(ld.identifier.value) : str(ld.identifier);
    const salary = salaryOf(ld.baseSalary);
    if (title && text.length >= MIN_POSTING_CHARS) {
      return {
        title, link, site, text,
        location: ld.jobLocationType === 'TELECOMMUTE' && !ld.jobLocation ? 'Remote' : placeOf(ld.jobLocation),
        postedAt: iso(ld.datePosted),
        requisitionId: identifier,
        facts: [...(ld.jobLocationType === 'TELECOMMUTE' ? ['Workplace: Remote'] : []), ...(salary ? [`Pay: ${salary}`] : [])],
      };
    }
  }
  const main = findOne(node => node.name === 'main' || attr(node, 'role') === 'main', document.children)
    ?? findOne(node => node.name === 'article', document.children)
    ?? findOne(node => node.name === 'body', document.children);
  if (!main) return null;
  const text = domToMarkdown(main);
  const heading = findOne(node => node.name === 'h1', document.children);
  const title = meta('og:title') ?? (heading ? flat(textContent(heading)) : null) ?? flat(textContent(findOne(node => node.name === 'title', document.children) ?? []));
  if (!title || text.length < MIN_POSTING_CHARS) return null;
  return {title, link, site, text, location: null, postedAt: null, requisitionId: null, facts: []};
}

/**
 * What opening a link found: its posting; `gone` (a 404, a 410, a platform that says it isn't there);
 * or `unreadable`, there but not for Jobs (a 403, a non-HTML answer, a page with no posting Jobs can
 * read, such as one drawn by script), which the user can still open in a browser.
 */
export type OpenedLink = {is: 'read'; posting: FoundPosting} | {is: 'gone'} | {is: 'unreadable'};

const opened = (posting: FoundPosting | null): OpenedLink => (posting ? {is: 'read', posting} : {is: 'unreadable'});

/**
 * Opens one link: a platform's posting through its API, anything else as a page (an Indeed view-job
 * link, a careers site). Throws a failure to retry.
 */
export async function openLink(web: JobsWeb, link: string, signal: AbortSignal): Promise<OpenedLink> {
  const ref = postingRef(link, web.hosts);
  try {
    if (ref?.platform === 'greenhouse' && ref.board && ref.id) {
      return opened(greenhouseJob(await newsGetJson<unknown>(web.http, {url: `${web.apis.greenhouse}/v1/boards/${encodeURIComponent(ref.board)}/jobs/${ref.id}`, userAgent: web.userAgent, signal})));
    }
    if (ref?.platform === 'lever' && ref.board && ref.id) {
      return opened(leverPosting(await newsGetJson<unknown>(web.http, {url: `${web.apis.lever}/v0/postings/${encodeURIComponent(ref.board)}/${encodeURIComponent(ref.id)}?mode=json`, userAgent: web.userAgent, signal})));
    }
    if (ref?.platform === 'ashby' && ref.board && ref.id) {
      const body = await newsGetJson<unknown>(web.http, {url: `${web.apis.ashby}/posting-api/job-board/${encodeURIComponent(ref.board)}?includeCompensation=true`, userAgent: web.userAgent, signal});
      const jobs = isRecord(body) && Array.isArray(body.jobs) ? body.jobs.map(ashbyJob) : [];
      const job = jobs.find(each => each?.id === ref.id || each?.link === link);
      if (!job) return {is: 'gone'};
      const {id: _, ...posting} = job;
      return opened(posting);
    }
    const response = await newsGet(web.http, {url: link, userAgent: web.userAgent, signal, accept: HTML});
    const type = response.headers.get('content-type') ?? '';
    if (response.status !== 200 || (type && !/html|xml/i.test(type))) return {is: 'unreadable'};
    const posting = pagePosting(responseText(response), response.url);
    // An Indeed link is Indeed's, wherever its redirects led.
    return opened(posting && ref?.platform === 'indeed' ? {...posting, site: PLATFORM_NAMES.indeed} : posting);
  } catch (error) {
    if (!(error instanceof ProviderError) || !isMiss(error)) throw error;
    return error.status === 404 || error.status === 410 ? {is: 'gone'} : {is: 'unreadable'};
  }
}

/** A link's posting; null when it isn't there or isn't a posting. Throws a failure to retry. */
export async function readLink(web: JobsWeb, link: string, signal: AbortSignal): Promise<FoundPosting | null> {
  const result = await openLink(web, link, signal);
  return result.is === 'read' ? result.posting : null;
}
