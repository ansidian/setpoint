// Jobs reads mail into applications, events and Needs you (J2; BRIEF.md › Jobs › Where it reads,
// What makes an application, Statuses; decisions 50, 51, 55, 56, 59, 61, 67, 68).
//
// - The hook: triage tells the server when it has sorted an email (TriageWorker's `onSorted`, wired in
//   server.ts), and the server nudges this worker. A nudge only queues the one durable `jobs_read`
//   job on the sync engine; the job finds what to read itself, so a missed nudge or a restart loses
//   nothing, and every five minutes it looks again anyway.
// - What it reads: emails triage has sorted in the accounts Jobs lists (all of the Jobs account, only
//   Career elsewhere), received since Jobs was turned on, not in jobs_emails_read, oldest first, one
//   at a time, so a confirmation is read before its update. Older mail is J4's history pass, which
//   feeds `readEmail` the same way with its own window and `fromHistory`.
// - Each email is read once by Haiku 5.5 (./prompt.ts), written to the ledger as Jobs's "emails", and
//   never charged for again. The rules (./rules.ts planEmail) decide what it does.
// - The AI down: the job fails by the one retry policy and the emails wait, counted on the page; a
//   missing or refused key waits for Settings › AI. They're read once it's back.
// - Passive (decision 59): every change sends the `jobs` live event, and nothing else: no
//   notification, nothing added to mail, nothing in the calendar.
import type {JobEventKind} from '@setpoint/shared';
import {and, eq, isNotNull} from 'drizzle-orm';
import {AI_ENDPOINTS} from '../providers/ai/index.ts';
import type {AiEndpoints, ModelClient} from '../providers/ai/index.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import type {JobWorker} from '../sync/engine.ts';
import {asProviderError, ProviderError} from '../sync/errors.ts';
import {enqueueJob, failJob, finishJob} from '../sync/jobs.ts';
import type {Job} from '../sync/jobs.ts';
import {jobsDb} from './db.ts';
import {emailsToRead, jobsEmail} from './mail.ts';
import type {JobsEmail, ReadWindow} from './mail.ts';
import {jobsEmailClient, NO_JOBS_KEY, recordJobsUsage} from './models.ts';
import {emailReadingOf, JOBS_MAX_OUTPUT_TOKENS, JOBS_PROMPT_VERSION, JOBS_SYSTEM, JOBS_TOOL, jobsPromptInput} from './prompt.ts';
import type {EmailReading} from './prompt.ts';
import {readWindow, recordReadFailure, recordReadSuccess} from './readerState.ts';
import {EVENT_OF_EMAIL, planEmail, sameCompany, titleKey} from './rules.ts';
import type {BlockedEmail, KnownApplication, Plan, ReadMatchEmail} from './rules.ts';
import * as j from './schema.ts';

export const JOBS_READ_KEY = 'jobs_read';

/** Asks the model about one email: its reading, or null for an answer it couldn't use. Throws a provider's refusal. */
export type AskJobs = (email: JobsEmail) => Promise<EmailReading | null>;

export interface ReadOptions {
  // The history pass (J4): what it's unsure of goes to From history (decision 57).
  fromHistory?: boolean;
}

/** Jobs's own state changed (down, back, emails waiting): a `jobs` event naming nothing, so the page asks again. */
const announce = (store: Store) => noteLive(store, {type: 'jobs', applications: [], needs_you: []});

const alreadyRead = (store: Store, messageId: number) =>
  jobsDb(store.sqlite).select({id: j.jobsEmailsRead.messageId}).from(j.jobsEmailsRead).where(eq(j.jobsEmailsRead.messageId, messageId)).get() !== undefined;

/**
 * Reads one email, once: asks the model (outside any transaction), then applies what it read. An
 * email already read, or gone, or not sorted by triage yet, is left as it is. Throws a provider's
 * refusal, with nothing written but the ledger.
 */
export async function readEmail(store: Store, ask: AskJobs, messageId: number, options: ReadOptions = {}): Promise<'read' | 'already' | 'gone'> {
  if (alreadyRead(store, messageId)) return 'already';
  const email = jobsEmail(store, messageId);
  if (!email) return 'gone';
  const reading = await ask(email);
  return applyReading(store, email, reading, options) ? 'read' : 'already';
}

/** The platform an application came through: triage's `via`, else its organisation when that isn't the company ("Indeed"). */
const platformOf = (email: JobsEmail, company: string) =>
  email.via ?? (email.organisation && !sameCompany(email.organisation, company) ? email.organisation : null);

/** What the rules know of every application, the blocked emails and the match emails read. */
function known(store: Store) {
  const db = jobsDb(store.sqlite);
  const applications: KnownApplication[] = db.select({
    id: j.jobsApplications.id, company: j.jobsApplications.company, titleKey: j.jobsApplications.titleKey, requisitionId: j.jobsApplications.requisitionId,
    status: j.jobsApplications.status, statusSetAt: j.jobsApplications.statusSetAt, appliedAt: j.jobsApplications.appliedAt,
    companyUnknown: j.jobsApplications.companyUnknown,
  }).from(j.jobsApplications).all().map(row => ({...row, titleKey: row.titleKey || null}));
  const blocked: BlockedEmail[] = db.select({
    messageId: j.jobsBlockedEmails.messageId, company: j.jobsEmailsRead.company, titleKey: j.jobsEmailsRead.titleKey, requisitionId: j.jobsEmailsRead.requisitionId,
  }).from(j.jobsBlockedEmails).leftJoin(j.jobsEmailsRead, eq(j.jobsEmailsRead.messageId, j.jobsBlockedEmails.messageId)).all();
  const matches = db.select({
    messageId: j.jobsEmailsRead.messageId, at: j.jobsEmailsRead.at, company: j.jobsEmailsRead.company, titleKey: j.jobsEmailsRead.titleKey,
    applicationId: j.jobsEmailsRead.applicationId,
  }).from(j.jobsEmailsRead).where(and(eq(j.jobsEmailsRead.event, 'match'), isNotNull(j.jobsEmailsRead.company), isNotNull(j.jobsEmailsRead.titleKey)))
    .all() as ReadMatchEmail[];
  return {applications, blocked, matches};
}

/**
 * Applies what the model read to Jobs's tables in one transaction, and records the email as read.
 * Returns false when it had been read meanwhile.
 */
export function applyReading(store: Store, email: JobsEmail, reading: EmailReading | null, {fromHistory = false}: ReadOptions = {}): boolean {
  const db = jobsDb(store.sqlite);
  return transaction(store, () => {
    if (alreadyRead(store, email.id)) return false;
    const now = isoNow(store);
    const at = email.receivedAt;
    const sender = email.fromName || email.fromAddress;
    const key = reading?.title ? titleKey(reading.title) || null : null;
    const role = {titleKey: key, requisitionId: reading?.requisitionId ?? null};
    const company = reading?.company ?? email.organisation ?? sender;
    const applications: number[] = [];
    const needsYou: number[] = [];
    let outcome: 'application' | 'event' | 'needs_you' | 'ignored' = 'ignored';
    let applicationId: number | null = null;

    const addEvent = (application: number, kind: JobEventKind, copy: {at: string; sender: string; subject: string; line: string | null; messageId: number | null}) =>
      db.insert(j.jobsEvents).values({applicationId: application, kind, ...copy, createdAt: now}).run();
    const handSet = (application: number, field: 'company' | 'title' | 'status') =>
      db.select().from(j.jobsHandSet).where(and(eq(j.jobsHandSet.applicationId, application), eq(j.jobsHandSet.field, field))).get() !== undefined;
    // The match email an Indeed confirmation pairs with joins it as a quiet event, with its own copy.
    const joinMatch = (application: number, messageId: number, line: string | null) => {
      const match = jobsEmail(store, messageId);
      if (match) addEvent(application, 'match', {at: match.receivedAt, sender: match.fromName || match.fromAddress, subject: match.subject, line, messageId});
      db.update(j.jobsEmailsRead).set({applicationId: application, outcome: 'event'}).where(eq(j.jobsEmailsRead.messageId, messageId)).run();
    };

    const plan: Plan = reading
      ? (() => {
        const {applications: apps, blocked, matches} = known(store);
        return planEmail({messageId: email.id, at, event: reading.event, company, companyNamed: reading.company !== null, role}, apps, blocked, matches);
      })()
      : {do: 'ignore', why: 'out'};

    switch (plan.do) {
      case 'create': {
        const row = db.insert(j.jobsApplications).values({
          company: plan.company, title: reading!.title ?? '', titleKey: key ?? '', requisitionId: role.requisitionId,
          platform: platformOf(email, plan.company), accountId: email.accountId, appliedAt: at, status: 'applied', statusSetBy: 'email', statusSetAt: at,
          reappliedFromId: plan.reappliedFrom, companyUnknown: plan.companyUnknown,
          // J3's seam: its JD lookup is due (decision 54).
          jdLookup: 'looking', jdLookupAt: now, createdAt: now, updatedAt: now,
        }).returning({id: j.jobsApplications.id}).get();
        addEvent(row.id, 'applied', {at, sender, subject: email.subject, line: reading!.line, messageId: email.id});
        if (plan.pairedWith) joinMatch(row.id, plan.pairedWith.messageId, null);
        applicationId = row.id;
        outcome = 'application';
        break;
      }
      case 'event': {
        addEvent(plan.applicationId, plan.kind, {at, sender, subject: email.subject, line: reading!.line, messageId: email.id});
        const changes: Partial<typeof j.jobsApplications.$inferInsert> = {updatedAt: now};
        if (plan.status) {
          Object.assign(changes, {
            status: plan.status, statusSetBy: 'email', statusSetAt: at,
            step: plan.status === 'in_process' ? reading!.line ?? email.summary : null, stepAt: plan.status === 'in_process' ? at : null,
          });
          // An email that sets a status wins over one set by hand (decision 68).
          db.delete(j.jobsHandSet).where(and(eq(j.jobsHandSet.applicationId, plan.applicationId), eq(j.jobsHandSet.field, 'status'))).run();
        }
        db.update(j.jobsApplications).set(changes).where(eq(j.jobsApplications.id, plan.applicationId)).run();
        applicationId = plan.applicationId;
        outcome = 'event';
        break;
      }
      case 'pair': {
        if (!handSet(plan.applicationId, 'company')) {
          db.update(j.jobsApplications).set({company: plan.company, companyUnknown: false, updatedAt: now}).where(eq(j.jobsApplications.id, plan.applicationId)).run();
        }
        addEvent(plan.applicationId, 'match', {at, sender, subject: email.subject, line: reading!.line, messageId: email.id});
        applicationId = plan.applicationId;
        outcome = 'event';
        break;
      }
      case 'needs_you': {
        const item = db.insert(j.jobsNeedsYou).values({
          kind: plan.kind, reason: plan.reason, fromHistory, company, title: reading!.title, platform: platformOf(email, company), subject: email.subject, sender,
          eventKind: EVENT_OF_EMAIL[reading!.event as keyof typeof EVENT_OF_EMAIL], line: reading!.line, accountId: email.accountId, at, messageId: email.id,
          createdAt: now,
        }).returning({id: j.jobsNeedsYou.id}).get();
        needsYou.push(item.id);
        outcome = 'needs_you';
        break;
      }
      case 'ignore':
        break;
    }
    if (applicationId !== null) applications.push(applicationId);

    db.insert(j.jobsEmailsRead).values({
      messageId: email.id, readAt: now, outcome, at, event: reading?.event ?? null, company: reading?.company ?? null, title: reading?.title ?? null,
      titleKey: key, requisitionId: role.requisitionId, line: reading?.line ?? null, applicationId,
    }).run();
    // Even an email that made nothing changes how many wait.
    noteLive(store, {type: 'jobs', applications, needs_you: needsYou});
    return true;
  });
}

/** Asks Haiku 5.5 with Jobs's prompt, each call written to the ledger as `jobs_emails` and to the reader's health. */
export function askHaiku(store: Store, {client, model}: {client: ModelClient; model: string}, signal?: AbortSignal): AskJobs {
  return async email => {
    const answer = await client.call({
      model, system: JOBS_SYSTEM, tool: JOBS_TOOL, input: jobsPromptInput(email), maxOutputTokens: JOBS_MAX_OUTPUT_TOKENS,
      cacheKey: `setpoint-jobs:${JOBS_PROMPT_VERSION}:${model}`, signal,
    });
    recordJobsUsage(store, answer, 'jobs_emails', email.id);
    if (recordReadSuccess(store)) announce(store);
    return emailReadingOf(answer.toolInput);
  };
}

export interface JobsReaderOptions {
  store: Store;
  // The providers' base URLs; tests point them at a fake on 127.0.0.1.
  endpoints?: AiEndpoints;
  // How often it looks for emails to read without a nudge (5 minutes, as triage's resort).
  rescanEveryMs?: number;
  // One model call's limit.
  timeoutMs?: number;
}

/** Jobs's reading worker on the sync engine: the one `jobs_read` job, queued by a nudge or the rescan. */
export class JobsReader implements JobWorker {
  readonly kind = 'jobs_read' as const;
  private readonly store: Store;
  private readonly endpoints: AiEndpoints;
  private readonly rescanEveryMs: number;
  private readonly timeoutMs: number | undefined;
  private lastRescanAt = Number.NEGATIVE_INFINITY;

  constructor({store, endpoints = AI_ENDPOINTS, rescanEveryMs = 5 * 60_000, timeoutMs}: JobsReaderOptions) {
    this.store = store;
    this.endpoints = endpoints;
    this.rescanEveryMs = rescanEveryMs;
    this.timeoutMs = timeoutMs;
  }

  /**
   * Something may want reading (the hook: triage sorted an email): queue the job if Jobs is on and an
   * email waits. A job already queued or running takes it; one waiting out a retry keeps its time.
   */
  nudge() {
    const window = readWindow(this.store);
    if (!window || !emailsToRead(this.store, window, isoNow(this.store), 1).length) return;
    if (!enqueueJob(this.store, {kind: 'jobs_read', key: JOBS_READ_KEY})) announce(this.store);
  }

  /** The engine's tick: look again every few minutes, so nothing waits on a nudge that never came. */
  schedule() {
    const now = this.store.now().getTime();
    if (now - this.lastRescanAt < this.rescanEveryMs) return;
    this.lastRescanAt = now;
    this.nudge();
  }

  async run(job: Job, signal: AbortSignal) {
    const store = this.store;
    const window = readWindow(store);
    if (!window) return finishJob(store, job.id);
    const chosen = jobsEmailClient(store, this.endpoints, this.timeoutMs);
    if (!chosen) {
      // Nothing to retry until a key arrives; the rescan queues it again.
      if (recordReadFailure(store, 'auth', NO_JOBS_KEY)) announce(store);
      failJob(store, job, new ProviderError('auth', NO_JOBS_KEY));
      return;
    }
    const {failed, passed} = await readWindowEmails(store, askHaiku(store, chosen, signal), window);
    if (failed) {
      if (recordReadFailure(store, failed.kind, failed.message)) announce(store);
      failJob(store, job, failed);
      return;
    }
    finishJob(store, job.id);
    // An email sorted while this job was finishing found it still running: look once more, leaving
    // what was passed over to the rescan.
    if (emailsToRead(store, window, isoNow(store), 1 + passed.size).some(id => !passed.has(id))) enqueueJob(store, {kind: 'jobs_read', key: JOBS_READ_KEY});
  }
}

/**
 * Reads what waits in the window, oldest first, until nothing does. Returns the provider's refusal
 * that stopped it (the rest wait), if one did. An email the provider refuses outright (a 400) is
 * passed over this time rather than holding up the rest, and returned; the rescan tries it again.
 */
export async function readWindowEmails(store: Store, ask: AskJobs, window: ReadWindow, options: ReadOptions = {}): Promise<{failed: ProviderError | null; passed: Set<number>}> {
  const passed = new Set<number>();
  for (;;) {
    const ids = emailsToRead(store, window, isoNow(store), 20 + passed.size).filter(id => !passed.has(id));
    if (!ids.length) return {failed: null, passed};
    for (const id of ids) {
      try {
        await readEmail(store, ask, id, options);
      } catch (caught) {
        const error = asProviderError(caught);
        if (error.kind !== 'permanent') return {failed: error, passed};
        console.error(`Jobs couldn't read email ${id}, ${error.message}`);
        passed.add(id);
      }
    }
  }
}
