// Reading again what Jobs read before it saw an email's HTML (SV-128). It's for mail read before
// that fix, run once with `jobs-reread`, and safe to run again:
//
// - An application with no title, or waiting for its company, that its confirmation's HTML can fill
//   is filled first, so a rejection read next finds a role to match. A field the user set stays
//   theirs (./stick.ts). One still open looks for its JD again, the title-less search's candidates
//   going with it.
// - Then the ignored emails that now read differently, and the ignored rejections, which the rules
//   now take differently (D384), are forgotten, and a history pass reads them through the usual
//   rules. Only ignored ones: an email that made something may have been moved or assigned since,
//   and those are never replayed (./stick.ts).
import {OPEN_JOB_STATUSES} from '@setpoint/shared';
import type {JobStatus} from '@setpoint/shared';
import {and, eq, inArray, isNotNull, or} from 'drizzle-orm';
import type {AiEndpoints} from '../providers/ai/index.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {ProviderError} from '../sync/errors.ts';
import {jobsDb} from './db.ts';
import {startHistory} from './history.ts';
import {requestLookup} from './lookup.ts';
import {jobsEmail, readsDifferently} from './mail.ts';
import {jobsEmailClient} from './models.ts';
import {askHaiku} from './reader.ts';
import type {AskJobs} from './reader.ts';
import {titleKey} from './rules.ts';
import * as j from './schema.ts';
import {setByHand} from './stick.ts';

export interface RereadPlan {
  emails: number[];
  applications: number[];
}

// The confirmation an application was made from, for each one with something blank.
const blankApplications = (store: Store) => (jobsDb(store.sqlite).select({
  id: j.jobsApplications.id, title: j.jobsApplications.title, companyUnknown: j.jobsApplications.companyUnknown, messageId: j.jobsEvents.messageId,
}).from(j.jobsApplications).innerJoin(j.jobsEvents, eq(j.jobsEvents.applicationId, j.jobsApplications.id))
  .where(and(or(eq(j.jobsApplications.title, ''), eq(j.jobsApplications.companyUnknown, true)), eq(j.jobsEvents.kind, 'applied'), isNotNull(j.jobsEvents.messageId)))
  .all() as {id: number; title: string; companyUnknown: boolean; messageId: number}[])
  .filter(application => (!application.title && !setByHand(store, application.id, 'title'))
    || (application.companyUnknown && !setByHand(store, application.id, 'company')));

/** What `jobs-reread` would do. It writes nothing. */
export function rereadPlan(store: Store): RereadPlan {
  const ignored = jobsDb(store.sqlite).select({id: j.jobsEmailsRead.messageId, event: j.jobsEmailsRead.event})
    .from(j.jobsEmailsRead).where(eq(j.jobsEmailsRead.outcome, 'ignored')).all();
  const different = readsDifferently(store, ignored.map(email => email.id));
  const blank = blankApplications(store);
  const filled = readsDifferently(store, blank.map(application => application.messageId));
  return {
    emails: ignored.filter(email => email.event === 'rejection' || different.has(email.id)).map(email => email.id),
    applications: [...new Set(blank.filter(application => filled.has(application.messageId)).map(application => application.id))],
  };
}

/** Fills what the application's confirmation says and it lacks. Returns whether it filled anything. */
async function fill(store: Store, ask: AskJobs, applicationId: number, messageId: number): Promise<boolean> {
  const email = jobsEmail(store, messageId);
  const reading = email ? await ask(email) : null;
  if (reading?.event !== 'confirmation') return false;
  const db = jobsDb(store.sqlite);
  const application = db.select().from(j.jobsApplications).where(eq(j.jobsApplications.id, applicationId)).get();
  if (!application) return false;
  const title = !application.title && reading.title && !setByHand(store, applicationId, 'title') ? reading.title : null;
  const company = application.companyUnknown && reading.company && !setByHand(store, applicationId, 'company') ? reading.company : null;
  if (!title && !company) return false;
  db.update(j.jobsApplications).set({
    ...(title ? {title, titleKey: titleKey(title), requisitionId: application.requisitionId ?? reading.requisitionId} : {}),
    ...(company ? {company, companyUnknown: false} : {}),
    updatedAt: isoNow(store),
  }).where(eq(j.jobsApplications.id, applicationId)).run();
  return true;
}

/**
 * Does the plan: the applications, each kept as it's done, then the emails. A provider's refusal
 * stops it with nothing forgotten yet, so it can run again.
 */
export async function reread(store: Store, ask: AskJobs): Promise<RereadPlan> {
  const plan = rereadPlan(store);
  const db = jobsDb(store.sqlite);
  const confirmation = new Map(blankApplications(store).map(application => [application.id, application.messageId]));
  for (const id of plan.applications) {
    if (!await fill(store, ask, id, confirmation.get(id)!)) continue;
    const {status} = db.select({status: j.jobsApplications.status}).from(j.jobsApplications).where(eq(j.jobsApplications.id, id)).get()!;
    if ((OPEN_JOB_STATUSES as readonly JobStatus[]).includes(status)) requestLookup(store, id);
  }
  transaction(store, () => {
    if (plan.emails.length) db.delete(j.jobsEmailsRead).where(inArray(j.jobsEmailsRead.messageId, plan.emails)).run();
    startHistory(store);
  });
  return plan;
}

/** `jobs-reread --apply`: reread with Jobs's own model, charged to its ledger. */
export function rereadWithHaiku(store: Store, endpoints: AiEndpoints): Promise<RereadPlan> {
  const chosen = jobsEmailClient(store, endpoints);
  if (!chosen) throw new ProviderError('auth', 'Jobs has no Anthropic key.');
  return reread(store, askHaiku(store, chosen));
}
