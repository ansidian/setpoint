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
// - Where, in order: the email's own links, then Greenhouse, Lever and Ashby's public job APIs,
//   then Sonnet 5.5 with Claude's web search, only when those cleanly missed (./lookupRules.ts).
// - The check: Haiku 5.5 weighs what a link or a platform found; Sonnet's search judges its own.
//   Confident is saved silently; unsure saves nothing and offers up to three candidates as a JD to
//   confirm in Needs you; nothing is "No JD found", never retried on its own (D320). A lookup that
//   failed (the network, a 5xx, a 429, a timeout, the AI down) is retried with backoff by the one
//   retry policy and never shown as not found.
// - The saved JD (decision 53): its full text as markdown, its link, when and how it was found, and
//   what Haiku 5.5 read in it. It's never overwritten: only Not this posting (J6) takes one away.
// - Cost: no cap (decision 61). Search is the ledger's `jobs_finding_jds`, the check and the reading
//   `jobs_reading_jds`. Every change sends the `jobs` live event.
import {OPEN_JOB_STATUSES} from '@setpoint/shared';
import type {JdSource, JobStatus} from '@setpoint/shared';
import {and, asc, desc, eq, inArray, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {localDay} from '../domain/time.ts';
import {notFound} from '../errors.ts';
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
  boardNames, emailLinks, isMiss, lookupEnd, matchPostings, nextSourceRuns, outcomeOf, platformsToTry, postingLinks, postingRef,
} from './lookupRules.ts';
import type {JobPlatform, StepOutcome} from './lookupRules.ts';
import {lookupEmail} from './mail.ts';
import {jobsModelClient, NO_JOBS_KEY, recordJobsUsage} from './models.ts';
import * as j from './schema.ts';
import {boardPostings, readLink} from './web.ts';
import type {FoundPosting, JobsWeb} from './web.ts';

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
  if (hasPosting(store, applicationId)) return 'already';
  const haiku = jobsModelClient(store, endpoints, 'reading', timeoutMs);
  const sonnet = jobsModelClient(store, endpoints, 'finding', timeoutMs);
  if (!haiku || !sonnet) throw new ProviderError('auth', NO_JOBS_KEY);

  const emails = emailsOf(store, application);
  const context: JdApplication = {
    company: application.company, title: application.title, requisitionId: application.requisitionId,
    appliedOn: localDay(application.appliedAt, store.timeZone), platform: application.platform, emails: emails.texts,
  };
  const steps: Step[] = [];

  // 1. The email's own links: the posting it points at (Indeed's view-job link on its match email).
  const links = postingLinks(emails.links, web.hosts);
  if (links.length) steps.push(await fromFound(store, haiku, context, 'email_link', links.map(link => () => readLink(web, link, signal)), signal));

  // 2. The hiring platforms' public APIs, by the board names the emails and the company suggest.
  if (nextSourceRuns('platforms', steps)) {
    const refs = emails.links.map(link => postingRef(link, web.hosts)).filter(ref => ref !== null && ref.platform !== 'indeed');
    const platforms = platformsToTry(application.platform, refs.map(ref => ref!.platform as JobPlatform));
    const step = await fromPlatforms(store, haiku, context, application, platforms, platform => boardNames(
      application.company, refs.filter(ref => ref!.platform === platform).map(ref => ref!.board), emails.senders,
    ), web, signal);
    if (step) steps.push(step);
  }

  // 3. Sonnet with web search, only when those cleanly missed.
  if (nextSourceRuns('search', steps)) steps.push(await fromSearch(store, sonnet, context, web, signal));

  const end = lookupEnd(steps);
  if (end.is === 'failed') throw end.error;
  if (end.is === 'save') {
    const found = end.posting.found!;
    const answer = await haiku.client.call({
      model: haiku.model, system: READING_SYSTEM, tool: READING_TOOL, input: readingInput(application, found), maxOutputTokens: READING_MAX_OUTPUT_TOKENS,
      cacheKey: `setpoint-jobs-reading:${JD_PROMPT_VERSION}:${haiku.model}`, signal,
    });
    recordJobsUsage(store, answer, 'jobs_reading_jds', null);
    return savePosting(store, applicationId, found, end.posting.source, postingReadingOf(answer.toolInput, found.location)) ? 'saved' : 'already';
  }
  if (end.is === 'candidates') {
    saveCandidates(store, applicationId, end.candidates);
    return 'candidates';
  }
  markNotFound(store, applicationId);
  return 'not_found';
}

/** Haiku's verdict on postings a link or a platform found, as a step. */
async function check(store: Store, haiku: {client: ModelClient; model: string}, context: JdApplication, offers: Offer[], signal: AbortSignal): Promise<StepOutcome<Offer>> {
  const answer = await haiku.client.call({
    model: haiku.model, system: CHECK_SYSTEM, tool: CHECK_TOOL, maxOutputTokens: CHECK_MAX_OUTPUT_TOKENS,
    input: checkInput(context, offers.map(offer => ({...offer.found!, site: offer.site}))),
    cacheKey: `setpoint-jobs-check:${JD_PROMPT_VERSION}:${haiku.model}`, signal,
  });
  recordJobsUsage(store, answer, 'jobs_reading_jds', null);
  const verdicts = verdictsOf(answer.toolInput, offers.length);
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
  boardsFor: (platform: JobPlatform) => string[], web: JobsWeb, signal: AbortSignal,
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
      for (const posting of matchPostings(application, postings)) if (!offers.some(offer => offer.link === posting.link)) offers.push(offerOf(posting, 'platform'));
      break;
    }
  }
  const outcome: StepOutcome<Offer> = offers.length ? await check(store, haiku, context, offers.slice(0, 3), signal) : {is: 'none'};
  return outcome.is !== 'confident' && failed ? {is: 'failed', error: failed} : outcome;
}

/** Sonnet searches and judges; a confident answer is read for its text, and one that can't be read is offered instead. */
async function fromSearch(store: Store, sonnet: {client: ModelClient; model: string}, context: JdApplication, web: JobsWeb, signal: AbortSignal): Promise<Step> {
  const answer = await sonnet.client.call({
    model: sonnet.model, system: SEARCH_SYSTEM, tool: SEARCH_TOOL, input: searchInput(context), maxOutputTokens: SEARCH_MAX_OUTPUT_TOKENS,
    webSearch: {maxUses: SEARCH_MAX_USES}, signal,
  });
  recordJobsUsage(store, answer, 'jobs_finding_jds', null);
  const candidates = searchCandidatesOf(answer.toolInput);
  const offers = candidates.map((candidate): Offer => ({found: null, title: candidate.title, location: candidate.location, site: candidate.site, link: candidate.url, source: 'search'}));
  const outcome = outcomeOf(offers.map((candidate, index) => ({candidate, verdict: candidates[index]!.verdict})));
  if (outcome.is !== 'confident') return outcome;
  let found: FoundPosting | null;
  try {
    found = await readLink(web, outcome.posting.link, signal);
  } catch (error) {
    const failure = asProviderError(error);
    if (!isMiss(failure)) return {is: 'failed', error: failure};
    found = null;
  }
  if (!found) return {is: 'unsure', candidates: offers};
  return {is: 'confident', posting: {...outcome.posting, found}};
}

/** Saves the JD (decision 53), unless one was saved meanwhile: never overwritten. Returns whether it saved. */
function savePosting(store: Store, applicationId: number, found: FoundPosting, source: JdSource, reading: ReturnType<typeof postingReadingOf>): boolean {
  const db = jobsDb(store.sqlite);
  return transaction(store, () => {
    if (!db.select({id: j.jobsApplications.id}).from(j.jobsApplications).where(eq(j.jobsApplications.id, applicationId)).get()) return false;
    if (hasPosting(store, applicationId)) return false;
    const now = isoNow(store);
    db.insert(j.jobsPostings).values({
      applicationId, fullText: found.text, summary: reading.summary, location: reading.location, workplace: reading.workplace,
      workplaceDetail: reading.workplace === 'hybrid' ? reading.workplaceDetail : null, salary: reading.salary,
      mustHaves: reading.mustHaves, niceToHaves: reading.niceToHaves, link: found.link, source,
      // The platform it was found on ("Greenhouse", "Indeed"); none for a search.
      platform: source === 'search' ? null : found.site, foundAt: now,
    }).run();
    db.delete(j.jobsJdCandidates).where(eq(j.jobsJdCandidates.applicationId, applicationId)).run();
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
    if (!application || hasPosting(store, applicationId)) return;
    const now = isoNow(store);
    const answered = answerJdItems(store, applicationId, 'looked_up_again', now);
    db.delete(j.jobsJdCandidates).where(eq(j.jobsJdCandidates.applicationId, applicationId)).run();
    offers.slice(0, 3).forEach((offer, position) => db.insert(j.jobsJdCandidates).values({
      applicationId, title: offer.title, location: offer.location, platform: offer.site, link: offer.link, position, foundAt: now,
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
    if (hasPosting(store, applicationId)) return;
    const now = isoNow(store);
    db.update(j.jobsApplications).set({jdLookup: 'not_found', jdLookupAt: now, updatedAt: now}).where(eq(j.jobsApplications.id, applicationId)).run();
    noteLive(store, {type: 'jobs', applications: [applicationId], needs_you: []});
  });
}
