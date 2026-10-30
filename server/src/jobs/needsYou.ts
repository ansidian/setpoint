// Answering Needs you (J4 adds From history's Dismiss all; J6 adds the rest, boards 34a–34c): pick a
// candidate or None of these, Assign to…, Track this and Not about a job, each kept for its toast's
// Undo (./undo.ts), From history's alike (D364).
//
// - Dismiss all (D324, decision 70) clears From history: the same as ignoring each item, so those
//   emails make nothing. Each item is resolved as `dismissed` and kept, with its email's read
//   untouched (outcome `needs_you`, no application), so it's never offered again; a JD to confirm's
//   application keeps its candidates (its detail can still offer them) and nothing is saved.
// - Undo (the toast's, 6 s) brings back the items Dismiss all named, those still dismissed.
import type {JobEventKind} from '@setpoint/shared';
import {and, eq, inArray, isNull} from 'drizzle-orm';
import {conflict, invalid, notFound} from '../errors.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {applicationOf, corrected, openJdItems, takeEmail, trackedStatus} from './corrections.ts';
import type {Change} from './corrections.ts';
import {jobsDb} from './db.ts';
import {requestLookup, requestPick} from './lookup.ts';
import {titleKey} from './rules.ts';
import * as j from './schema.ts';
import {addAlias, rejectLinks} from './stick.ts';

export const DISMISSED = 'dismissed';

/** POST /api/jobs/from-history/dismiss: every From history item waiting now. Returns their ids, for Undo. */
export function dismissFromHistory(store: Store): number[] {
  const db = jobsDb(store.sqlite);
  return transaction(store, () => {
    const ids = db.select({id: j.jobsNeedsYou.id}).from(j.jobsNeedsYou)
      .where(and(eq(j.jobsNeedsYou.fromHistory, true), isNull(j.jobsNeedsYou.resolvedAt))).all().map(row => row.id);
    if (!ids.length) return [];
    db.update(j.jobsNeedsYou).set({resolvedAt: isoNow(store), resolution: DISMISSED}).where(inArray(j.jobsNeedsYou.id, ids)).run();
    noteLive(store, {type: 'jobs', applications: [], needs_you: ids});
    return ids;
  });
}

/** POST /api/jobs/from-history/undo: the items Dismiss all named that are still dismissed, back in From history. */
export function undoDismissFromHistory(store: Store, ids: number[]): number[] {
  const db = jobsDb(store.sqlite);
  return transaction(store, () => {
    const back = db.select({id: j.jobsNeedsYou.id}).from(j.jobsNeedsYou)
      .where(and(inArray(j.jobsNeedsYou.id, ids), eq(j.jobsNeedsYou.fromHistory, true), eq(j.jobsNeedsYou.resolution, DISMISSED))).all().map(row => row.id);
    if (!back.length) return [];
    db.update(j.jobsNeedsYou).set({resolvedAt: null, resolution: null}).where(inArray(j.jobsNeedsYou.id, back)).run();
    noteLive(store, {type: 'jobs', applications: [], needs_you: back});
    return back;
  });
}

// ---- Answering an item (J6; boards 34a–34c; decisions 54, 69; D364) ----

/** An item still waiting, or a 404 (a 409 once it's answered). */
function openItem(store: Store, id: number) {
  const item = jobsDb(store.sqlite).select().from(j.jobsNeedsYou).where(eq(j.jobsNeedsYou.id, id)).get();
  if (!item) throw notFound('No such item in Needs you.');
  if (item.resolvedAt !== null) throw conflict('answered', 'That item has been answered already.');
  return item;
}

const resolve = (store: Store, ids: number[], resolution: string, now: string) => {
  if (ids.length) jobsDb(store.sqlite).update(j.jobsNeedsYou).set({resolvedAt: now, resolution}).where(inArray(j.jobsNeedsYou.id, ids)).run();
};

/**
 * POST /api/jobs/applications/:id/jd/pick: a JD to confirm's candidate is the posting (a Needs you
 * item, From history's Choose…, or the detail after Not this posting). Its job reads that posting
 * and saves it (lookup.ts `requestPick`); Undo puts the candidates back as they were.
 */
export function pickCandidate(store: Store, applicationId: number, candidateId: number): Change {
  return corrected(store, {applications: [applicationId]}, () => {
    applicationOf(store, applicationId);
    const answered = requestPick(store, applicationId, candidateId);
    return {application: applicationId, changed: {needsYou: answered}};
  });
}

/** POST /api/jobs/applications/:id/jd/none: None of these. They're turned down for good, and it's No JD found, with Look it up. */
export function noneOfThese(store: Store, applicationId: number): Change {
  return corrected(store, {applications: [applicationId]}, now => {
    const db = jobsDb(store.sqlite);
    applicationOf(store, applicationId);
    const candidates = db.select().from(j.jobsJdCandidates).where(eq(j.jobsJdCandidates.applicationId, applicationId)).all();
    rejectLinks(store, applicationId, candidates.map(candidate => candidate.link), now);
    db.delete(j.jobsJdCandidates).where(eq(j.jobsJdCandidates.applicationId, applicationId)).run();
    const answered = openJdItems(store, applicationId);
    resolve(store, answered, 'none_of_these', now);
    const posting = db.select({id: j.jobsPostings.id}).from(j.jobsPostings).where(eq(j.jobsPostings.applicationId, applicationId)).get();
    if (!posting) db.update(j.jobsApplications).set({jdLookup: 'not_found', jdLookupAt: now, updatedAt: now}).where(eq(j.jobsApplications.id, applicationId)).run();
    return {application: applicationId, changed: {needsYou: answered}};
  });
}

/** POST /api/jobs/needs-you/:id/assign: Assign to… an application; the email becomes its event, and it answers to the role named. */
export function assignItem(store: Store, id: number, applicationId: number): Change {
  const item = openItem(store, id);
  if (item.kind === 'jd_to_confirm') throw invalid('A JD to confirm is answered by picking a candidate.');
  return corrected(store, {applications: [applicationId], needsYou: [id], messages: item.messageId === null ? [] : [item.messageId]}, now => {
    applicationOf(store, applicationId);
    const kind: JobEventKind = item.eventKind ?? 'other';
    jobsDb(store.sqlite).insert(j.jobsEvents).values({
      applicationId, at: item.at, kind, sender: item.sender ?? item.company, subject: item.subject ?? item.company, line: item.line, messageId: item.messageId, createdAt: now,
    }).run();
    claimItemEmail(store, applicationId, item, now);
    takeEmail(store, applicationId, kind, item.at, now);
    resolve(store, [id], 'assigned', now);
    return {application: applicationId};
  });
}

/** The item's email now belongs to the application: its read record, and the role it names as one the application answers to. */
function claimItemEmail(store: Store, applicationId: number, item: typeof j.jobsNeedsYou.$inferSelect, now: string) {
  const db = jobsDb(store.sqlite);
  const read = item.messageId === null ? undefined : db.select().from(j.jobsEmailsRead).where(eq(j.jobsEmailsRead.messageId, item.messageId)).get();
  if (read) db.update(j.jobsEmailsRead).set({applicationId, outcome: 'event'}).where(eq(j.jobsEmailsRead.messageId, read.messageId)).run();
  const key = read?.titleKey ?? (item.title ? titleKey(item.title) || null : null);
  const requisitionId = read?.requisitionId ?? null;
  if (key || requisitionId) addAlias(store, applicationId, {company: item.company, titleKey: key, requisitionId}, now);
}

/**
 * POST /api/jobs/needs-you/:id/track: Track this (decision 69, D323). The application is made from the
 * email: Applied on its date, "First seen in this email", In process (Offer for an offer), with its
 * JD looked up at once.
 */
export function trackItem(store: Store, id: number): Change {
  const item = openItem(store, id);
  if (item.kind !== 'email_to_track') throw invalid('Only an email to track is tracked.');
  return corrected(store, {needsYou: [id], messages: item.messageId === null ? [] : [item.messageId]}, now => {
    const db = jobsDb(store.sqlite);
    const read = item.messageId === null ? undefined : db.select().from(j.jobsEmailsRead).where(eq(j.jobsEmailsRead.messageId, item.messageId)).get();
    const status = trackedStatus(item.eventKind);
    const title = item.title ?? read?.title ?? '';
    const made = db.insert(j.jobsApplications).values({
      company: item.company, title, titleKey: titleKey(title), requisitionId: read?.requisitionId ?? null, platform: item.platform, accountId: item.accountId,
      appliedAt: item.at, status, statusSetBy: 'email', statusSetAt: item.at,
      step: status === 'in_process' ? item.line ?? item.subject : null, stepAt: status === 'in_process' ? item.at : null,
      firstSeenInEmail: true, createdAt: now, updatedAt: now,
    }).returning({id: j.jobsApplications.id}).get();
    db.insert(j.jobsEvents).values({
      applicationId: made.id, at: item.at, kind: item.eventKind ?? 'interview', sender: item.sender ?? item.company, subject: item.subject ?? item.company,
      line: item.line, messageId: item.messageId, firstSeen: true, createdAt: now,
    }).run();
    if (read) db.update(j.jobsEmailsRead).set({applicationId: made.id, outcome: 'application'}).where(eq(j.jobsEmailsRead.messageId, read.messageId)).run();
    resolve(store, [id], 'tracked', now);
    requestLookup(store, made.id);
    return {application: made.id, created: {applications: [made.id]}};
  });
}

/** POST /api/jobs/needs-you/:id/not-a-job: Not about a job; its email makes nothing. */
export function notAJob(store: Store, id: number): Change {
  const item = openItem(store, id);
  return corrected(store, {needsYou: [id]}, now => {
    if (item.kind === 'jd_to_confirm') throw invalid('A JD to confirm is answered with None of these.');
    resolve(store, [id], 'not_about_a_job', now);
    return {};
  });
}
