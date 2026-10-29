// The JD lookup's pure rules (J3; BRIEF.md › Jobs › The JD; decisions 53, 54, 61, 66), tested as
// tables (tests/lookupRules.test.ts): which links in an email are postings and on which platform,
// which hiring platforms and board names to try, which of a board's postings could be the role, what
// the model's verdicts make (confident, unsure, nothing), how a lookup ends, and what counts as a
// failure to retry rather than a miss. No network, no database, no clock.
import type {ProviderError} from '../sync/errors.ts';
import {companyKey, requisitionKey, titleKey} from './rules.ts';

/** The hiring platforms whose public job APIs Jobs reads (decision 54). */
export const JOB_PLATFORMS = ['greenhouse', 'lever', 'ashby'] as const;
export type JobPlatform = (typeof JOB_PLATFORMS)[number];

export const PLATFORM_NAMES: Record<JobPlatform | 'indeed', string> = {greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', indeed: 'Indeed'};

/**
 * The hosts each platform's public posting pages live on, and Indeed's: production's real ones
 * (./web.ts), tests' example domains. A host matches itself and its subdomains.
 */
export type PostingHosts = Record<JobPlatform | 'indeed', string[]>;

/** A link recognised as one platform's posting, with the board's name and the posting's id when the link gives them. */
export type PostingRef =
  | {platform: JobPlatform; board: string | null; id: string | null}
  | {platform: 'indeed'; board: null; id: string | null};

const hostIs = (host: string, hosts: string[]) => hosts.some(each => host === each || host.endsWith(`.${each}`));
const segments = (url: URL) => url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
// A board's name as the platforms write it: letters, digits, dashes and underscores.
const BOARD = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;

function parse(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * What a link is, when it's a platform's posting or board: Greenhouse's `/<board>/jobs/<id>` (and its
 * embed's `?for=<board>&token=<id>`, and a careers page's `?gh_jid=<id>`), Lever's and Ashby's
 * `/<board>/<id>`, Indeed's `viewjob?jk=<id>`. A link to a board without a posting gives its name.
 */
export function postingRef(raw: string, hosts: PostingHosts): PostingRef | null {
  const url = parse(raw);
  if (!url) return null;
  const host = url.hostname.toLowerCase();
  const parts = segments(url);
  if (hostIs(host, hosts.indeed)) {
    const id = url.searchParams.get('jk') ?? url.searchParams.get('vjk');
    return id || /viewjob|rc\/clk/i.test(url.pathname) ? {platform: 'indeed', board: null, id} : null;
  }
  if (hostIs(host, hosts.greenhouse)) {
    if (parts[0] === 'embed') {
      const board = url.searchParams.get('for');
      return board && BOARD.test(board) ? {platform: 'greenhouse', board, id: url.searchParams.get('token')} : null;
    }
    const board = parts[0];
    if (!board || !BOARD.test(board)) return null;
    return {platform: 'greenhouse', board, id: parts[1] === 'jobs' && /^\d+$/.test(parts[2] ?? '') ? parts[2]! : null};
  }
  for (const platform of ['lever', 'ashby'] as const) {
    if (!hostIs(host, hosts[platform])) continue;
    const board = parts[0];
    if (!board || !BOARD.test(board)) return null;
    const id = parts[1] && /^[0-9a-f][0-9a-f-]{5,}$/i.test(parts[1]) ? parts[1] : null;
    return {platform, board, id};
  }
  const ghJid = url.searchParams.get('gh_jid');
  if (ghJid && /^\d+$/.test(ghJid)) return {platform: 'greenhouse', board: null, id: ghJid};
  return null;
}

// A link that is about the email or the account, never a posting.
const NOT_A_POSTING = /unsubscribe|optout|opt-out|privacy|terms|login|log-in|signin|sign-in|sign_in|signup|register|account|settings|preferences|password|verify|verification|confirm|help|support|faq|cookie|candidate-?home|dashboard|mailto/i;
// A path that reads like one posting.
const LOOKS_LIKE_A_POSTING = /\b(jobs?|careers?|positions?|openings?|vacanc(y|ies)|requisitions?|viewjob|job-?details|postings?|roles?|opportunit(y|ies))\b/i;

/** Every http(s) link in an email: its text's and its HTML's hrefs, in order, once each. */
export function emailLinks(text: string, html: string | null): string[] {
  const found: string[] = [];
  const add = (raw: string) => {
    const cleaned = raw.replace(/&amp;/g, '&').replace(/[)>\].,;:'"!?]+$/, '');
    if (parse(cleaned) && !found.includes(cleaned)) found.push(cleaned);
  };
  for (const match of (html ?? '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) add(match[1]!);
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) add(match[0]);
  return found;
}

/**
 * The links in an application's emails that could be its posting, most likely first, at most
 * `limit`: a platform's posting, then Indeed's view-job links, then any link whose path reads like a
 * posting. Links about the account or the email itself are never one.
 */
export function postingLinks(links: string[], hosts: PostingHosts, limit = 3): string[] {
  const rank = (raw: string): number | null => {
    const url = parse(raw);
    if (!url || NOT_A_POSTING.test(`${url.pathname}${url.search}`)) return null;
    const ref = postingRef(raw, hosts);
    if (ref && ref.platform !== 'indeed' && ref.id) return 0;
    if (ref?.platform === 'indeed' && ref.id) return 1;
    if (!ref && LOOKS_LIKE_A_POSTING.test(url.pathname) && segments(url).length >= 2) return 2;
    return null;
  };
  return links.map((link, index) => ({link, index, rank: rank(link)}))
    .filter((entry): entry is {link: string; index: number; rank: number} => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit).map(entry => entry.link);
}

// Applicant tracking systems other than the three: an application through one of these has no board
// on Greenhouse, Lever or Ashby to look at.
const OTHER_PLATFORMS = /^(workday|icims|taleo|successfactors|smartrecruiters|breezy( ?hr)?|workable|jobvite|bamboo ?hr|jazzhr|recruitee|teamtailor|personio|paylocity|adp|ukg|ultipro|oracle|governmentjobs|neogov|usajobs|dayforce|rippling|gusto|pinpoint|eightfold|avature|phenom)\b/i;

/**
 * Which platforms to ask, in order: one an email's link points at first; the one triage named when
 * it's one of the three; otherwise all three (a job board like Indeed or LinkedIn, or nothing named),
 * unless a link already said which, or triage named another tracking system (Workday, iCIMS), which
 * has no board on these to look at.
 */
export function platformsToTry(via: string | null, linked: JobPlatform[]): JobPlatform[] {
  const named = JOB_PLATFORMS.find(platform => via !== null && via.trim().toLowerCase() === PLATFORM_NAMES[platform].toLowerCase());
  const fromVia: JobPlatform[] = named ? [named] : linked.length || (via && OTHER_PLATFORMS.test(via.trim())) ? [] : [...JOB_PLATFORMS];
  return [...new Set([...linked, ...fromVia])];
}

// Mail and job-board services whose domain says nothing about the employer.
const SERVICE_DOMAINS = /^(greenhouse|greenhouse-mail|lever|hire|ashbyhq|ashby|myworkday|myworkdayjobs|workday|icims|smartrecruiters|breezy|breezyhr|workable|jobvite|bamboohr|indeed|indeedemail|linkedin|ziprecruiter|glassdoor|dice|monster|handshake|wellfound|gmail|googlemail|outlook|hotmail|live|yahoo|icloud|me|aol|proton|protonmail|google|amazonses|sendgrid|mailgun|mailchimp|mcsv|successfactors|taleo|oraclecloud|paylocity|adp|recruitee|teamtailor|jazzhr|applytojob|governmentjobs|neogov|example)$/i;

/** The employer's name in a sender's address, when the domain is the employer's own ("careers@mail.humongous.example" → "humongous"). */
export function senderBoard(address: string): string | null {
  const domain = address.split('@')[1]?.toLowerCase().trim();
  if (!domain) return null;
  const labels = domain.split('.').filter(Boolean);
  // The label before the top-level domain, or before a two-part one ("co.uk").
  const tail = labels.length >= 3 && /^(co|com|org|net|ac|gov)$/.test(labels.at(-2)!) && labels.at(-1)!.length === 2 ? 3 : 2;
  const label = labels.at(-tail);
  return label && !SERVICE_DOMAINS.test(label) && BOARD.test(label) ? label : null;
}

/**
 * The board names to try on each platform, most likely first, at most `limit` (D-recorded): the
 * board an email's link names, the employer's own mail domain, then the company's name as the
 * platforms usually write it: run together ("lucernepublishing"), dashed ("lucerne-publishing"), and
 * its first word when that's long enough to be distinctive ("lucerne", not "city").
 */
export function boardNames(company: string, linked: (string | null)[], senders: string[], limit = 4): string[] {
  const words = companyKey(company).split(' ').filter(word => word && !/^(the|inc|incorporated|llc|ltd|limited|corp|corporation|co|company|plc|gmbh)$/.test(word));
  const guesses = [
    ...linked,
    ...senders.map(senderBoard),
    words.join(''),
    words.join('-'),
    words.length > 1 && words[0]!.length >= 5 ? words[0]! : null,
  ];
  const out: string[] = [];
  for (const guess of guesses) {
    const name = guess?.toLowerCase();
    if (name && BOARD.test(name) && !out.includes(name)) out.push(name);
  }
  return out.slice(0, limit);
}

/** A posting as a platform or page gave it, before the model checks it. */
export interface PostingCandidate {
  title: string;
  location: string | null;
  // When it was first published, if the source says.
  postedAt: string | null;
  requisitionId: string | null;
  link: string;
}

export interface LookupApplication {
  company: string;
  title: string;
  titleKey: string;
  requisitionId: string | null;
  appliedAt: string;
}

const DAY_MS = 86_400_000;
/** A posting published this long after the application can't be the one applied to. */
export const POSTED_AFTER_APPLYING_DAYS = 2;

const words = (key: string) => key.split(' ').filter(Boolean);

/**
 * How well a board's posting fits the application (decision 54's company, title and date; the
 * model weighs location): 3 its requisition ID, 2 its normalised title, 1 a title whose words hold
 * the other's ("Junior Developer" and "Junior Developer, Digital"), 0 not at all. A posting published
 * after the application can't be it.
 */
export function postingFit(application: LookupApplication, posting: PostingCandidate): number {
  if (posting.postedAt && Date.parse(posting.postedAt) > Date.parse(application.appliedAt) + POSTED_AFTER_APPLYING_DAYS * DAY_MS) return 0;
  if (application.requisitionId && posting.requisitionId && requisitionKey(application.requisitionId) === requisitionKey(posting.requisitionId)) return 3;
  const mine = application.titleKey;
  const theirs = titleKey(posting.title);
  if (!mine || !theirs) return 0;
  if (mine === theirs) return 2;
  const [short, long] = [words(mine), words(theirs)].sort((a, b) => a.length - b.length) as [string[], string[]];
  return short.length >= 2 && short.every(word => long.includes(word)) ? 1 : 0;
}

/**
 * The board's postings that could be the role, best first, at most `limit`: a requisition ID match
 * alone when there is one; else the closest titles, those published nearest before the application
 * first.
 */
export function matchPostings<T extends PostingCandidate>(application: LookupApplication, postings: T[], limit = 3): T[] {
  const scored = postings.map(posting => ({posting, fit: postingFit(application, posting)})).filter(entry => entry.fit > 0);
  const best = Math.max(0, ...scored.map(entry => entry.fit));
  const applied = Date.parse(application.appliedAt);
  const distance = (posting: T) => (posting.postedAt ? Math.abs(applied - Date.parse(posting.postedAt)) : Number.MAX_SAFE_INTEGER);
  return scored.filter(entry => (best === 3 ? entry.fit === 3 : true))
    .sort((a, b) => b.fit - a.fit || distance(a.posting) - distance(b.posting))
    .slice(0, limit).map(entry => entry.posting);
}

/** The model's verdict on one candidate: it's the posting, it might be, or it isn't. */
export type Verdict = 'match' | 'maybe' | 'no';

export type StepOutcome<T> = {is: 'confident'; posting: T} | {is: 'unsure'; candidates: T[]} | {is: 'none'};

/**
 * What the model's verdicts make (decision 54): exactly one match is confident; otherwise the
 * matches and maybes, in order and at most three, are unsure; nothing is none.
 */
export function outcomeOf<T>(judged: {candidate: T; verdict: Verdict}[], limit = 3): StepOutcome<T> {
  const matches = judged.filter(entry => entry.verdict === 'match');
  if (matches.length === 1) return {is: 'confident', posting: matches[0]!.candidate};
  const kept = judged.filter(entry => entry.verdict !== 'no').slice(0, limit).map(entry => entry.candidate);
  return kept.length ? {is: 'unsure', candidates: kept} : {is: 'none'};
}

/**
 * Whether a source's failure is a miss (it said no: a 404, a 403, a posting taken down) or a failure
 * to retry (the network, a timeout, a 5xx, a 429): a lookup that failed is never "No JD found"
 * (BRIEF.md › When things break).
 */
export const isMiss = (error: ProviderError) => error.kind === 'permanent';

/**
 * How a lookup ends, from what its sources gave in order (decision 54): the first confident posting
 * is saved; a source that failed means the lookup failed, to be retried, never "No JD found"; then
 * the unsure candidates, at most three, wait in Needs you; with nothing at all, "No JD found".
 */
export type LookupEnd<T> = {is: 'save'; posting: T} | {is: 'failed'; error: ProviderError} | {is: 'candidates'; candidates: T[]} | {is: 'not_found'};

export function lookupEnd<T>(steps: (StepOutcome<T> | {is: 'failed'; error: ProviderError})[], limit = 3): LookupEnd<T> {
  for (const step of steps) if (step.is === 'confident') return {is: 'save', posting: step.posting};
  const failed = steps.find((step): step is {is: 'failed'; error: ProviderError} => step.is === 'failed');
  if (failed) return {is: 'failed', error: failed.error};
  const candidates = steps.flatMap(step => (step.is === 'unsure' ? step.candidates : [])).slice(0, limit);
  return candidates.length ? {is: 'candidates', candidates} : {is: 'not_found'};
}

/**
 * Whether the next source runs (decision 54): the platforms run while nothing is confident; web
 * search, which costs, only when the email's link and the platforms cleanly missed: nothing
 * confident, nothing unsure, nothing failed.
 */
export function nextSourceRuns(source: 'platforms' | 'search', steps: (StepOutcome<unknown> | {is: 'failed'})[]): boolean {
  if (steps.some(step => step.is === 'confident')) return false;
  if (source === 'platforms') return true;
  return steps.every(step => step.is === 'none');
}
