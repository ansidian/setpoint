// The JD lookup (J3; BRIEF.md › Jobs › The JD, When things break; decisions 53, 54, 57, 61, 66).
//
// - When: J2's confirmation leaves its application at `jd_lookup = 'looking'` (D341), and Jobs's
//   worker queues a durable lookup for each one still open, right after reading and on its
//   five-minute rescan (`queueDueLookups`). The history pass's applications wait for its end, when
//   the open ones are marked `looking` with their unsure candidates bound for From history (J4).
//   Look it up by hand and Track this (J6) call `requestLookup`, which looks on any application,
//   open or closed, whoever asks. Each
//   lookup is its own `jobs_read` job on the sync engine, keyed `jobs_jd:<application>`, so one
//   that fails waits out its own backoff.
// - Where, in order: the email's own links, then Greenhouse, Lever and Ashby's public job APIs, or
//   GovernmentJobs' site-wide search for an application through it (D389), then Sonnet 5.5 with
//   Claude's web search, only when those cleanly missed (./lookupRules.ts).
// - The check: Haiku 5.5 weighs what a link or a platform found; Sonnet's search judges its own.
//   Confident is saved silently; unsure saves nothing and offers up to three candidates as a JD to
//   confirm in Needs you; nothing is "No JD found", never retried on its own (D320). A lookup that
//   failed (the network, a 5xx, a 429, a timeout, the AI down) is retried with backoff by the one
//   retry policy and never shown as not found.
// - Opening what the search offers (D388): a sole match that reads is saved with no check. Otherwise
//   each candidate is opened: gone is dropped, one Jobs can't read or couldn't reach stays offered,
//   and one that reads goes to Haiku, who can only drop it, never save it.
// - The saved JD (decision 53): its full text as markdown, its link, when and how it was found, and
//   what Haiku 5.5 read in it. It's never overwritten: only Not this posting (J6) takes one away.
// - J6: a candidate the user picks is read and saved without a check (`requestPick`); what the user
//   turned down is never saved or offered again, and a lookup writes only while its application is
//   still `looking` (./stick.ts). One that can't be read stays `not_found` with its link (SV-132).
// - Cost: no cap (decision 61). Search is the ledger's `jobs_finding_jds`, the check and the reading
//   `jobs_reading_jds`. Every change sends the `jobs` live event.
import {OPEN_JOB_STATUSES} from '@setpoint/shared';
import type {JdSource, JobStatus} from '@setpoint/shared';
import {and, asc, desc, eq, inArray, isNotNull, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {localDay} from '../domain/time.ts';
import {conflict, notFound} from '../errors.ts';
import type {AiEndpoints, ModelClient} from '../providers/ai/index.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {asProviderError, ProviderError} from '../sync/errors.ts';
import {enqueueJob} from '../sync/jobs.ts';
import {jobsDb} from './db.ts';
import {
  CHECK_MAX_OUTPUT_TOKENS, CHECK_SYSTEM, CHECK_TOOL, checkInput, JD_PROMPT_VERSION, postingReadingOf, READING_MAX_OUTPUT_TOKENS, READING_SYSTEM,
  READING_TOOL, readingInput, SEARCH_MAX_OUTPUT_TOKENS, SEARCH_MAX_USES, SEARCH_SYSTEM, SEARCH_TOOL, searchCandidatesOf, searchInput, verdictsOf,
} from './jdPrompt.ts';
import type {JdApplication} from './jdPrompt.ts';
import {
  boardNames, emailLinks, governmentJobMatches, lookupEnd, matchPostings, nextSourceRuns, outcomeOf, PLATFORM_NAMES, platformsToTry, postingLinks, postingRef,
  throughGovernmentJobs,
} from './lookupRules.ts';
import type {JobPlatform, StepOutcome, Verdict} from './lookupRules.ts';
import {lookupEmail} from './mail.ts';
import {jobsModelClient, NO_JOBS_KEY, recordJobsUsage} from './models.ts';
import * as j from './schema.ts';
import {rejectedLinks, stillLooking} from './stick.ts';
import {boardPostings, governmentJobsSearch, openLink, readLink} from './web.ts';
import type {FoundPosting, GovernmentJob, JobsWeb, OpenedLink} from './web.ts';

export const LOOKUP_KEY_PREFIX = 'jobs_jd:';
export const lookupKey = (applicationId: number) => `${LOOKUP_KEY_PREFIX}${applicationId}`;

/**
 * A lookup that failed for good (six tries, or no key) is queued again by the rescan after this
 * long, so it's still never "No JD found" and an outage costs a few tries an hour, not one a tick.
 */
export const LOOKUP_COOL_OFF_MS = 60 * 60_000;

type Application = typeof j.jobsApplications.$inferSelect;

const isOpen = (status: JobStatus) => (OPEN_JOB_STATUSES as readonly string[]).includes(status);
const hasPosting = (store: Store, applicationId: number) =>
  jobsDb(store.sqlite).select({id: j.jobsPostings.id}).from(j.jobsPostings).where(eq(j.jobsPostings.applicationId, applicationId)).get() !== undefined;

/** Answers this application's open JD to confirm (a new lookup or a saved JD replaces it). Returns the items answered. */
function answerJdItems(store: Store, applicationId: number, resolution: string, now: string): number[] {
  const db = jobsDb(store.sqlite);
  const open = db.select({id: j.jobsNeedsYou.id}).from(j.jobsNeedsYou)
    .where(and(eq(j.jobsNeedsYou.applicationId, applicationId), eq(j.jobsNeedsYou.kind, 'jd_to_confirm'), isNull(j.jobsNeedsYou.resolvedAt))).all().map(row => row.id);
  if (open.length) db.update(j.jobsNeedsYou).set({resolvedAt: now, resolution}).where(inArray(j.jobsNeedsYou.id, open)).run();
  return open;
}

/** Queues the application's lookup now: a new one, or the one waiting out a retry, brought forward. */
function queueLookup(store: Store, applicationId: number) {
  const key = lookupKey(applicationId);
  if (enqueueJob(store, {kind: 'jobs_read', key})) return;
  store.db.update(t.jobs).set({runAt: isoNow(store)}).where(and(eq(t.jobs.key, key), eq(t.jobs.state, 'queued'))).run();
}

/**
 * Starts a lookup on any application, open or closed, whoever asks (D320's Look it up, J6's Track
 * this): it's `looking` at once, its unanswered candidates go, and the job runs as
 * soon as the engine takes it. A saved JD is never replaced (decision 53): Not this posting (J6)
 * comes first, so this answers `saved` and changes nothing.
 */
export function requestLookup(store: Store, applicationId: number): 'looking' | 'saved' {
  const db = jobsDb(store.sqlite);
  return transaction(store, () => {
    const application = db.select({id: j.jobsApplications.id}).from(j.jobsApplications).where(eq(j.jobsApplications.id, applicationId)).get();
    if (!application) throw notFound('No such application.');
    if (hasPosting(store, applicationId)) return 'saved';
    const now = isoNow(store);
    const answered = answerJdItems(store, applicationId, 'looked_up_again', now);
    db.delete(j.jobsJdCandidates).where(eq(j.jobsJdCandidates.applicationId, applicationId)).run();
    // Asked for now, so what it's unsure of is today's, whoever made the application.
    db.update(j.jobsApplications).set({jdLookup: 'looking', jdLookupAt: now, jdLookupFromHistory: false, updatedAt: now})
      .where(eq(j.jobsApplications.id, applicationId)).run();
    queueLookup(store, applicationId);
    noteLive(store, {type: 'jobs', applications: [applicationId], needs_you: answered});
    return 'looking';
  });
}

/**
 * A candidate picked (J6: a JD to confirm, Choose…, or the detail after Not this posting): it's the
 * posting, so the application is `looking` at once and its job reads that one link and saves it
 * without a check; its JD to confirm is answered. The other candidates stay, for Not this posting.
 * Without a web (a dev run) it stays `looking`, as any lookup does there.
 */
export function requestPick(store: Store, applicationId: number, candidateId: number): number[] {
  const db = jobsDb(store.sqlite);
  return transaction(store, () => {
    const candidate = db.select().from(j.jobsJdCandidates)
      .where(and(eq(j.jobsJdCandidates.id, candidateId), eq(j.jobsJdCandidates.applicationId, applicationId))).get();
    if (!candidate) throw notFound('No such candidate.');
    if (hasPosting(store, applicationId)) throw conflict('jd_saved', 'This application has its JD already, Not this posting takes it away first.');
    const now = isoNow(store);
    const answered = answerJdItems(store, applicationId, 'picked', now);
    db.update(j.jobsJdCandidates).set({pickedAt: null}).where(eq(j.jobsJdCandidates.applicationId, applicationId)).run();
    db.update(j.jobsJdCandidates).set({pickedAt: now}).where(eq(j.jobsJdCandidates.id, candidateId)).run();
    db.update(j.jobsApplications).set({jdLookup: 'looking', jdLookupAt: now, jdLookupFromHistory: false, updatedAt: now})
      .where(eq(j.jobsApplications.id, applicationId)).run();
    queueLookup(store, applicationId);
    noteLive(store, {type: 'jobs', applications: [applicationId], needs_you: answered});
    return answered;
  });
}

/**
 * The automatic lookups (decision 54, D341): each application `looking` with no posting gets its
 * job, unless one is queued or running, or one failed for good within the cool-off. One closed before
 * its lookup ever started (an update read right after its confirmation) isn't looked up (decision 57)
 * and goes back to `none`. Returns the applications queued.
 */
export function queueDueLookups(store: Store): number[] {
  const db = jobsDb(store.sqlite);
  return transaction(store, () => {
    const due = db.select({id: j.jobsApplications.id, status: j.jobsApplications.status}).from(j.jobsApplications)
      .leftJoin(j.jobsPostings, eq(j.jobsPostings.applicationId, j.jobsApplications.id))
      .where(and(eq(j.jobsApplications.jdLookup, 'looking'), isNull(j.jobsPostings.id))).orderBy(asc(j.jobsApplications.appliedAt)).all();
    const now = store.now().getTime();
    const queued: number[] = [];
    const closed: number[] = [];
    for (const application of due) {
      const last = store.db.select({state: t.jobs.state, finishedAt: t.jobs.finishedAt}).from(t.jobs).where(eq(t.jobs.key, lookupKey(application.id)))
        .orderBy(desc(t.jobs.id)).limit(1).get();
      if (!last && !isOpen(application.status)) {
        closed.push(application.id);
        continue;
      }
      if (last && (last.state === 'queued' || last.state === 'running')) continue;
      if (last?.state === 'failed' && last.finishedAt && now - Date.parse(last.finishedAt) < LOOKUP_COOL_OFF_MS) continue;
      if (enqueueJob(store, {kind: 'jobs_read', key: lookupKey(application.id)})) queued.push(application.id);
    }
    if (closed.length) {
      db.update(j.jobsApplications).set({jdLookup: 'none', updatedAt: isoNow(store)}).where(inArray(j.jobsApplications.id, closed)).run();
      noteLive(store, {type: 'jobs', applications: closed, needs_you: []});
    }
    return queued;
  });
}

export interface LookupOptions {
  web: JobsWeb;
  endpoints: AiEndpoints;
  // One model call's limit.
  timeoutMs?: number;
  signal: AbortSignal;
}

/** What one source offers: a posting read in full (or only its address, from a search), and how it was found. */
interface Offer {
  found: FoundPosting | null;
  title: string;
  location: string | null;
  site: string;
  link: string;
  source: JdSource;
}

type Step = StepOutcome<Offer> | {is: 'failed'; error: ProviderError};

const offerOf = (found: FoundPosting, source: JdSource): Offer => ({found, title: found.title, location: found.location, site: found.site, link: found.link, source});

/** The application's emails the lookup reads: its confirmation, a duplicate and a job board's match, with their links and senders. */
function emailsOf(store: Store, application: Application) {
  const events = jobsDb(store.sqlite).select().from(j.jobsEvents)
    .where(and(eq(j.jobsEvents.applicationId, application.id), inArray(j.jobsEvents.kind, ['applied', 'duplicate', 'match'])))
    .orderBy(asc(j.jobsEvents.at), asc(j.jobsEvents.id)).all();
  const texts: string[] = [];
  const links: string[] = [];
  const senders: string[] = [];
  for (const event of events) {
    const email = event.messageId === null ? null : lookupEmail(store, event.messageId);
    texts.push([`Subject: ${event.subject}`, `From: ${event.sender}`, email?.text ?? event.line ?? ''].join('\n'));
    if (!email) continue;
    senders.push(email.fromAddress);
    for (const link of emailLinks(email.text, email.html)) if (!links.includes(link)) links.push(link);
  }
  return {texts, links, senders};
}

/**
 * Looks up one application's JD, from whichever source answers first, and keeps what it finds.
 * Throws a ProviderError when it failed, for the job to retry; nothing is written but the ledger.
 */
export async function lookUpJd(store: Store, applicationId: number, {web, endpoints, timeoutMs, signal}: LookupOptions): Promise<'saved' | 'candidates' | 'not_found' | 'already' | 'gone'> {
  const db = jobsDb(store.sqlite);
  const application = db.select().from(j.jobsApplications).where(eq(j.jobsApplications.id, applicationId)).get();
  if (!application) return 'gone';
  // A saved JD is never replaced, and one no longer looked for (Undo, None of these) isn't looked up (stick.ts).
  if (hasPosting(store, applicationId) || !stillLooking(store, applicationId)) return 'already';
  const haiku = jobsModelClient(store, endpoints, 'reading', timeoutMs);
  const sonnet = jobsModelClient(store, endpoints, 'finding', timeoutMs);
  if (!haiku || !sonnet) throw new ProviderError('auth', NO_JOBS_KEY);

  // The user picked a candidate (J6): read that posting and save it, with no check, since they chose it.
  const picked = db.select().from(j.jobsJdCandidates).where(and(eq(j.jobsJdCandidates.applicationId, applicationId), isNotNull(j.jobsJdCandidates.pickedAt))).get();
  if (picked) {
    const found = await readLink(web, picked.link, signal);
    if (!found) {
      // It came down, the site turned Jobs away, or its page draws itself by script. Not retried on
      // its own (D320), and the pick stays, so the application says so and still opens it (SV-132).
      markNotFound(store, applicationId);
      return 'not_found';
    }
    // Found as the lookup found it; one kept from before that was recorded (the seed's) by where it is.
    const platform = postingRef(picked.link, web.hosts)?.platform;
    const source = picked.source ?? (platform === 'indeed' ? 'email_link' : platform ? 'platform' : 'search');
    return await readAndSave(store, haiku, application, found, source, signal, {keepCandidates: true}) ? 'saved' : 'already';
  }

  // What the user turned down is never saved or offered again (stick.ts).
  const rejected = rejectedLinks(store, applicationId);
  const fresh = (link: string) => !rejected.has(link);

  const emails = emailsOf(store, application);
  const context: JdApplication = {
    company: application.company, title: application.title, requisitionId: application.requisitionId,
    appliedOn: localDay(application.appliedAt, store.timeZone), platform: application.platform, emails: emails.texts,
  };
  const steps: Step[] = [];

  // 1. The email's own links: the posting it points at (Indeed's view-job link on its match email).
  const links = postingLinks(emails.links, web.hosts).filter(fresh);
  if (links.length) steps.push(await fromFound(store, haiku, context, 'email_link', links.map(link => () => readLink(web, link, signal)), signal));

  // 2. The hiring platforms' public APIs, by the board names the emails and the company suggest, or
  // GovernmentJobs' search for an application through it.
  if (nextSourceRuns('platforms', steps)) {
    if (throughGovernmentJobs(application.platform, emails.senders)) {
      steps.push(await fromGovernmentJobs(store, haiku, context, application, web, fresh, signal));
    } else {
      const refs = emails.links.map(link => postingRef(link, web.hosts)).filter(ref => ref !== null && ref.platform !== 'indeed');
      const platforms = platformsToTry(application.platform, refs.map(ref => ref!.platform as JobPlatform));
      const step = await fromPlatforms(store, haiku, context, application, platforms, platform => boardNames(
        application.company, refs.filter(ref => ref!.platform === platform).map(ref => ref!.board), emails.senders,
      ), web, fresh, signal);
      if (step) steps.push(step);
    }
  }

  // 3. Sonnet with web search, only when those cleanly missed.
  if (nextSourceRuns('search', steps)) steps.push(await fromSearch(store, haiku, sonnet, context, web, fresh, signal));

  const end = lookupEnd(steps);
  if (end.is === 'failed') throw end.error;
  if (end.is === 'save') return await readAndSave(store, haiku, application, end.posting.found!, end.posting.source, signal) ? 'saved' : 'already';
  if (end.is === 'candidates') {
    saveCandidates(store, applicationId, end.candidates);
    return 'candidates';
  }
  markNotFound(store, applicationId);
  return 'not_found';
}

/** Haiku reads a posting (its summary, lists, salary and setting), the call on the ledger. */
export async function readPosting(
  store: Store, haiku: {client: ModelClient; model: string}, application: Pick<Application, 'company' | 'title'>, posting: Pick<FoundPosting, 'title' | 'location' | 'facts' | 'text'>, signal?: AbortSignal,
) {
  const answer = await haiku.client.call({
    model: haiku.model, system: READING_SYSTEM, tool: READING_TOOL, input: readingInput(application, posting), maxOutputTokens: READING_MAX_OUTPUT_TOKENS,
    cacheKey: `setpoint-jobs-reading:${JD_PROMPT_VERSION}:${haiku.model}`, signal,
  });
  recordJobsUsage(store, answer, 'jobs_reading_jds', null);
  return postingReadingOf(answer.toolInput, posting.location);
}

/** Reads the posting, then saves it. Returns whether it saved. */
async function readAndSave(
  store: Store, haiku: {client: ModelClient; model: string}, application: Application, found: FoundPosting, source: JdSource, signal: AbortSignal,
  options: {keepCandidates?: boolean} = {},
): Promise<boolean> {
  return savePosting(store, application.id, found, source, await readPosting(store, haiku, application, found, signal), options);
}

/** Haiku's verdict on each posting read, the call on the ledger. */
async function verdictsOn(store: Store, haiku: {client: ModelClient; model: string}, context: JdApplication, offers: Offer[], signal: AbortSignal): Promise<Verdict[]> {
  const answer = await haiku.client.call({
    model: haiku.model, system: CHECK_SYSTEM, tool: CHECK_TOOL, maxOutputTokens: CHECK_MAX_OUTPUT_TOKENS,
    input: checkInput(context, offers.map(offer => ({...offer.found!, site: offer.site}))),
    cacheKey: `setpoint-jobs-check:${JD_PROMPT_VERSION}:${haiku.model}`, signal,
  });
  recordJobsUsage(store, answer, 'jobs_reading_jds', null);
  return verdictsOf(answer.toolInput, offers.length);
}

/** Haiku's verdict on postings a link or a platform found, as a step. */
async function check(store: Store, haiku: {client: ModelClient; model: string}, context: JdApplication, offers: Offer[], signal: AbortSignal): Promise<StepOutcome<Offer>> {
  const verdicts = await verdictsOn(store, haiku, context, offers, signal);
  return outcomeOf(offers.map((candidate, index) => ({candidate, verdict: verdicts[index]!})));
}

/** Reads what each source gives (a source that isn't there is a miss), then checks what was found. */
async function fromFound(store: Store, haiku: {client: ModelClient; model: string}, context: JdApplication, source: JdSource, reads: (() => Promise<FoundPosting | null>)[], signal: AbortSignal): Promise<Step> {
  const offers: Offer[] = [];
  let failed: ProviderError | null = null;
  for (const read of reads) {
    try {
      const found = await read();
      if (found && !offers.some(offer => offer.link === found.link)) offers.push(offerOf(found, source));
    } catch (error) {
      failed ??= asProviderError(error);
    }
  }
  const outcome: StepOutcome<Offer> = offers.length ? await check(store, haiku, context, offers, signal) : {is: 'none'};
  return outcome.is !== 'confident' && failed ? {is: 'failed', error: failed} : outcome;
}

/** The platforms' boards: on each platform, the first board name that exists, and its postings that could be the role. */
async function fromPlatforms(
  store: Store, haiku: {client: ModelClient; model: string}, context: JdApplication, application: Application, platforms: JobPlatform[],
  boardsFor: (platform: JobPlatform) => string[], web: JobsWeb, fresh: (link: string) => boolean, signal: AbortSignal,
): Promise<Step | null> {
  if (!application.titleKey && !application.requisitionId) return {is: 'none'};
  const offers: Offer[] = [];
  let failed: ProviderError | null = null;
  for (const platform of platforms) {
    for (const board of boardsFor(platform)) {
      let postings: FoundPosting[] | null;
      try {
        postings = await boardPostings(web, platform, board, signal);
      } catch (error) {
        failed ??= asProviderError(error);
        continue;
      }
      if (postings === null) continue;
      for (const posting of matchPostings(application, postings)) if (fresh(posting.link) && !offers.some(offer => offer.link === posting.link)) offers.push(offerOf(posting, 'platform'));
      break;
    }
  }
  const outcome: StepOutcome<Offer> = offers.length ? await check(store, haiku, context, offers.slice(0, 3), signal) : {is: 'none'};
  return outcome.is !== 'confident' && failed ? {is: 'failed', error: failed} : outcome;
}

/**
 * GovernmentJobs' search for the title (D389): the employer's results are read as any page, and Haiku
 * checks them, with their dates and text, since an employer posts a title more than once. A result
 * keeps the address the search gave, which what the user turns down is compared with, and the place
 * it gave, since the page's own repeats the state ("Contoso, WA, WA").
 */
async function fromGovernmentJobs(
  store: Store, haiku: {client: ModelClient; model: string}, context: JdApplication, application: Application, web: JobsWeb, fresh: (link: string) => boolean, signal: AbortSignal,
): Promise<Step> {
  if (!application.titleKey) return {is: 'none'};
  let results: GovernmentJob[];
  try {
    results = await governmentJobsSearch(web, application.title, signal);
  } catch (error) {
    return {is: 'failed', error: asProviderError(error)};
  }
  const reads = governmentJobMatches(application, results.filter(result => fresh(result.link))).map(({link, location}) => async () => {
    const found = await readLink(web, link, signal);
    return found && {...found, link, location: location ?? found.location, site: PLATFORM_NAMES.governmentjobs};
  });
  return fromFound(store, haiku, context, 'platform', reads, signal);
}

/**
 * A search candidate opened. One that failed (the network, a 5xx, a 429, a timeout) stays offered, as
 * one Jobs can't read does, rather than paying for the search again over one page.
 */
async function openCandidate(web: JobsWeb, link: string, signal: AbortSignal): Promise<OpenedLink> {
  try {
    return await openLink(web, link, signal);
  } catch {
    signal.throwIfAborted();
    return {is: 'unreadable'};
  }
}

/**
 * Sonnet searches and judges (decision 54), and what it offers is opened (D388). A sole match that
 * reads is saved with no check. Otherwise each candidate is opened: one that's gone is dropped, one
 * Jobs can't read stays for the user to open, and one that reads goes to Haiku, who can only drop it,
 * never save it. Nothing left is `none`.
 */
async function fromSearch(
  store: Store, haiku: {client: ModelClient; model: string}, sonnet: {client: ModelClient; model: string}, context: JdApplication, web: JobsWeb, fresh: (link: string) => boolean, signal: AbortSignal,
): Promise<Step> {
  const answer = await sonnet.client.call({
    model: sonnet.model, system: SEARCH_SYSTEM, tool: SEARCH_TOOL, input: searchInput(context), maxOutputTokens: SEARCH_MAX_OUTPUT_TOKENS,
    webSearch: {maxUses: SEARCH_MAX_USES}, signal,
  });
  recordJobsUsage(store, answer, 'jobs_finding_jds', null);
  const candidates = searchCandidatesOf(answer.toolInput).filter(candidate => fresh(candidate.url));
  const offers = candidates.map((candidate): Offer => ({found: null, title: candidate.title, location: candidate.location, site: candidate.site, link: candidate.url, source: 'search'}));
  const outcome = outcomeOf(offers.map((candidate, index) => ({candidate, verdict: candidates[index]!.verdict})));
  const reads = new Map<Offer, OpenedLink>();
  if (outcome.is === 'confident') {
    const read = await openCandidate(web, outcome.posting.link, signal);
    if (read.is === 'read') return {is: 'confident', posting: {...outcome.posting, found: read.posting}};
    reads.set(outcome.posting, read);
  }
  for (const offer of offers) if (!reads.has(offer)) reads.set(offer, await openCandidate(web, offer.link, signal));
  const left = offers.flatMap((offer): Offer[] => {
    const read = reads.get(offer)!;
    return read.is === 'gone' ? [] : read.is === 'read' ? [{...offer, found: read.posting}] : [offer];
  });
  const readable = left.filter(offer => offer.found);
  const verdicts = readable.length ? await verdictsOn(store, haiku, context, readable, signal) : [];
  const turnedDown = new Set(readable.filter((_, index) => verdicts[index] === 'no'));
  const kept = left.filter(offer => !turnedDown.has(offer));
  return kept.length ? {is: 'unsure', candidates: kept} : {is: 'none'};
}

/**
 * Saves the JD (decision 53), unless one was saved meanwhile (never overwritten) or the application
 * is no longer looked up (stick.ts). A pick keeps the other candidates, for Not this posting to offer
 * again. Returns whether it saved.
 */
export function savePosting(store: Store, applicationId: number, found: FoundPosting, source: JdSource, reading: ReturnType<typeof postingReadingOf>, {keepCandidates = false}: {keepCandidates?: boolean} = {}): boolean {
  const db = jobsDb(store.sqlite);
  return transaction(store, () => {
    if (!stillLooking(store, applicationId)) return false;
    if (hasPosting(store, applicationId)) return false;
    const now = isoNow(store);
    db.insert(j.jobsPostings).values({
      applicationId, fullText: found.text, summary: reading.summary, location: reading.location, workplace: reading.workplace,
      workplaceDetail: reading.workplace === 'hybrid' ? reading.workplaceDetail : null, salary: reading.salary,
      mustHaves: reading.mustHaves, niceToHaves: reading.niceToHaves, link: found.link, source,
      // The platform it was found on ("Greenhouse", "Indeed"); none for a search.
      platform: source === 'search' ? null : found.site, foundAt: now,
    }).run();
    if (keepCandidates) db.update(j.jobsJdCandidates).set({pickedAt: null}).where(eq(j.jobsJdCandidates.applicationId, applicationId)).run();
    else db.delete(j.jobsJdCandidates).where(eq(j.jobsJdCandidates.applicationId, applicationId)).run();
    const answered = answerJdItems(store, applicationId, 'found', now);
    db.update(j.jobsApplications).set({jdLookup: 'none', jdLookupAt: now, updatedAt: now}).where(eq(j.jobsApplications.id, applicationId)).run();
    noteLive(store, {type: 'jobs', applications: [applicationId], needs_you: answered});
    return true;
  });
}

/**
 * Unsure (decision 54): nothing saved; up to three candidates wait in Needs you as a JD to confirm,
 * in From history when the history pass's end started the lookup (J4, decision 57).
 */
function saveCandidates(store: Store, applicationId: number, offers: Offer[]) {
  const db = jobsDb(store.sqlite);
  transaction(store, () => {
    const application = db.select().from(j.jobsApplications).where(eq(j.jobsApplications.id, applicationId)).get();
    if (!application || hasPosting(store, applicationId) || !stillLooking(store, applicationId)) return;
    const now = isoNow(store);
    const answered = answerJdItems(store, applicationId, 'looked_up_again', now);
    db.delete(j.jobsJdCandidates).where(eq(j.jobsJdCandidates.applicationId, applicationId)).run();
    offers.slice(0, 3).forEach((offer, position) => db.insert(j.jobsJdCandidates).values({
      applicationId, title: offer.title, location: offer.location, platform: offer.site, link: offer.link, position, foundAt: now, source: offer.source,
    }).onConflictDoNothing().run());
    const item = db.insert(j.jobsNeedsYou).values({
      kind: 'jd_to_confirm', reason: 'unsure_posting', fromHistory: application.jdLookupFromHistory, applicationId, company: application.company, title: application.title || null,
      platform: application.platform, accountId: application.accountId, at: application.appliedAt, createdAt: now,
    }).returning({id: j.jobsNeedsYou.id}).get();
    db.update(j.jobsApplications).set({jdLookup: 'candidates', jdLookupAt: now, updatedAt: now}).where(eq(j.jobsApplications.id, applicationId)).run();
    noteLive(store, {type: 'jobs', applications: [applicationId], needs_you: [...answered, item.id]});
  });
}

/** Not found (D320): "No JD found", with Look it up by hand; never retried on its own. */
function markNotFound(store: Store, applicationId: number) {
  const db = jobsDb(store.sqlite);
  transaction(store, () => {
    if (hasPosting(store, applicationId) || !stillLooking(store, applicationId)) return;
    const now = isoNow(store);
    db.update(j.jobsApplications).set({jdLookup: 'not_found', jdLookupAt: now, updatedAt: now}).where(eq(j.jobsApplications.id, applicationId)).run();
    noteLive(store, {type: 'jobs', applications: [applicationId], needs_you: []});
  });
}
