// Corrections (J6; BRIEF.md › Jobs › Corrections; DESIGN.md › Corrections; decisions 58, 67, 68; D322,
// D365): clicks on an application that stick. Each runs in one transaction, keeps what it touched for
// its toast's Undo (./undo.ts) and sends the `jobs` live event. What keeps each from being undone by a
// later email, re-run or lookup is ./stick.ts.
//
// - The company and title in place: set by hand, and kept; the application still answers to its old
//   name, so a later email naming that finds it.
// - Set status (D365): set by hand, until an email that sets one comes (D322). Let emails decide hands
//   it back to what the emails make it.
// - Merge with…: the other application comes into this one, its emails and all, and goes; this one
//   answers to its company and role from then on.
// - An event's Move to… takes its email to another application (which answers to its role from then
//   on); Not about this takes it off, back into Needs you.
// - Not an application: gone, its emails blocked with its company and role (decision 67). Delete:
//   gone, so a later email can make it again.
// - Not this posting: the JD goes and its link is turned down; the other candidates are offered again,
//   or it's No JD found.
// A merge, a move or an event taken off settles the status from the emails again, unless the user set it.
import {isQuietJobEvent, STATUS_OF_JOB_EVENT} from '@setpoint/shared';
import type {JobEventKind, JobHandField, JobStatus, JobsEdit} from '@setpoint/shared';
import {and, asc, eq, inArray, isNull} from 'drizzle-orm';
import {conflict, invalid, notFound} from '../errors.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {jobsDb} from './db.ts';
import {statusAfter, statusFromEvents, titleKey} from './rules.ts';
import * as j from './schema.ts';
import {addAlias, emailSetsStatus, rejectLinks, rejectedLinks, setByHand} from './stick.ts';
import {beginUndo, keepUndo} from './undo.ts';
import type {UndoScope} from './undo.ts';

type Application = typeof j.jobsApplications.$inferSelect;

/** A correction's answer: its Undo, and the application it made or kept. */
export interface Change {
  undo: number;
  application: number | null;
}

export function applicationOf(store: Store, id: number): Application {
  const application = jobsDb(store.sqlite).select().from(j.jobsApplications).where(eq(j.jobsApplications.id, id)).get();
  if (!application) throw notFound('No such application.');
  return application;
}

export function eventOf(store: Store, id: number) {
  const event = jobsDb(store.sqlite).select().from(j.jobsEvents).where(eq(j.jobsEvents.id, id)).get();
  if (!event) throw notFound('No such event.');
  return event;
}

/**
 * Runs a correction in one transaction: what the scope covers is kept for Undo first, then `change`
 * writes and says what it made. Sends the `jobs` event naming what changed.
 */
export function corrected(store: Store, scope: UndoScope, change: (now: string) => {application?: number | null; created?: {applications?: number[]; needsYou?: number[]}; changed?: {applications?: number[]; needsYou?: number[]}}): Change {
  return transaction(store, () => {
    const before = beginUndo(store, scope);
    const now = isoNow(store);
    const done = change(now);
    const undo = keepUndo(store, before, done.created);
    noteLive(store, {
      type: 'jobs',
      applications: [...new Set([...(scope.applications ?? []), ...(done.created?.applications ?? []), ...(done.changed?.applications ?? [])])],
      needs_you: [...new Set([...(scope.needsYou ?? []), ...(done.created?.needsYou ?? []), ...(done.changed?.needsYou ?? [])])],
    });
    return {undo, application: done.application ?? null};
  });
}

/** Marks a field set by hand, as of now (decision 58). */
export function markByHand(store: Store, applicationId: number, field: JobHandField, now: string) {
  jobsDb(store.sqlite).insert(j.jobsHandSet).values({applicationId, field, setAt: now})
    .onConflictDoUpdate({target: [j.jobsHandSet.applicationId, j.jobsHandSet.field], set: {setAt: now}}).run();
}

/** The status the application's emails make it, written, unless the user set it (D322). */
export function settleStatus(store: Store, applicationId: number, now: string) {
  if (setByHand(store, applicationId, 'status')) return;
  writeEmailsStatus(store, applicationId, now);
}

function writeEmailsStatus(store: Store, applicationId: number, now: string) {
  const db = jobsDb(store.sqlite);
  const application = applicationOf(store, applicationId);
  const events = db.select().from(j.jobsEvents).where(eq(j.jobsEvents.applicationId, applicationId)).orderBy(asc(j.jobsEvents.at), asc(j.jobsEvents.id)).all();
  const made = statusFromEvents(application.appliedAt, events);
  db.update(j.jobsApplications).set({...made, statusSetBy: 'email', updatedAt: now}).where(eq(j.jobsApplications.id, applicationId)).run();
}

/**
 * An email has just come to this application by the user's hand (Assign to…, Move to…, a merge): one
 * that sets a status no older than the status there takes over, as it would have on arrival (D322);
 * then the status is what the emails make it, unless the user still holds it.
 */
export function takeEmail(store: Store, applicationId: number, kind: JobEventKind, at: string, now: string) {
  const application = applicationOf(store, applicationId);
  if (statusAfter(application, kind, at) !== null) emailSetsStatus(store, applicationId);
  settleStatus(store, applicationId, now);
}

/** PATCH /api/jobs/applications/:id: the title in place, or the company from More; set by hand and kept. */
export function editApplication(store: Store, id: number, edit: JobsEdit): Change {
  return corrected(store, {applications: [id]}, now => {
    const db = jobsDb(store.sqlite);
    const application = applicationOf(store, id);
    if (edit.company !== undefined && edit.company !== application.company) {
      // Its emails still name the old company: it keeps answering to that (stick.ts).
      addAlias(store, id, {company: application.company, titleKey: application.titleKey || null, requisitionId: application.requisitionId}, now);
      db.update(j.jobsApplications).set({company: edit.company, companyUnknown: false, updatedAt: now}).where(eq(j.jobsApplications.id, id)).run();
      markByHand(store, id, 'company', now);
    }
    // The title's key stays the emails' own; the new title is matched as well (stick.ts).
    if (edit.title !== undefined && edit.title !== application.title) {
      db.update(j.jobsApplications).set({title: edit.title, updatedAt: now}).where(eq(j.jobsApplications.id, id)).run();
      markByHand(store, id, 'title', now);
    }
    return {application: id};
  });
}

/** POST /api/jobs/applications/:id/status: set by hand (D322), or null, Let emails decide (D365). */
export function setStatus(store: Store, id: number, status: JobStatus | null): Change {
  return corrected(store, {applications: [id]}, now => {
    const db = jobsDb(store.sqlite);
    const application = applicationOf(store, id);
    if (status === null) {
      db.delete(j.jobsHandSet).where(and(eq(j.jobsHandSet.applicationId, id), eq(j.jobsHandSet.field, 'status'))).run();
      writeEmailsStatus(store, id, now);
      return {application: id};
    }
    // In process set by hand keeps the step its email gave it, if it had one.
    const keepStep = status === 'in_process' && application.status === 'in_process';
    db.update(j.jobsApplications).set({
      status, statusSetBy: 'user', statusSetAt: now, step: keepStep ? application.step : null, stepAt: keepStep ? application.stepAt : null, updatedAt: now,
    }).where(eq(j.jobsApplications.id, id)).run();
    markByHand(store, id, 'status', now);
    return {application: id};
  });
}

/** POST /api/jobs/applications/:id/merge: the other comes into this one with all its emails, and goes. */
export function mergeApplications(store: Store, id: number, otherId: number): Change {
  if (id === otherId) throw invalid('An application can\'t merge with itself.');
  return corrected(store, {applications: [id, otherId]}, now => {
    const db = jobsDb(store.sqlite);
    const application = applicationOf(store, id);
    const other = applicationOf(store, otherId);
    const moved = db.select().from(j.jobsEvents).where(eq(j.jobsEvents.applicationId, otherId)).all();
    db.update(j.jobsEvents).set({applicationId: id}).where(eq(j.jobsEvents.applicationId, otherId)).run();
    db.update(j.jobsEmailsRead).set({applicationId: id}).where(eq(j.jobsEmailsRead.applicationId, otherId)).run();
    // It answers to the other's company and role, and to whatever the other answered to.
    addAlias(store, id, {company: other.company, titleKey: other.titleKey || null, requisitionId: other.requisitionId}, now);
    db.update(j.jobsAliases).set({applicationId: id}).where(eq(j.jobsAliases.applicationId, otherId)).run();
    db.update(j.jobsRejectedPostings).set({applicationId: id}).where(eq(j.jobsRejectedPostings.applicationId, otherId)).run();
    // With no JD of its own, it takes the other's.
    const hasPosting = db.select({id: j.jobsPostings.id}).from(j.jobsPostings).where(eq(j.jobsPostings.applicationId, id)).get();
    const otherPosting = db.select({id: j.jobsPostings.id}).from(j.jobsPostings).where(eq(j.jobsPostings.applicationId, otherId)).get();
    if (!hasPosting && otherPosting) {
      db.update(j.jobsPostings).set({applicationId: id}).where(eq(j.jobsPostings.id, otherPosting.id)).run();
      db.update(j.jobsApplications).set({jdLookup: 'none'}).where(eq(j.jobsApplications.id, id)).run();
      const waiting = openJdItems(store, id);
      if (waiting.length) db.update(j.jobsNeedsYou).set({resolvedAt: now, resolution: 'found'}).where(inArray(j.jobsNeedsYou.id, waiting)).run();
    }
    // A re-application of the other is now one of this, unless it's this one.
    db.update(j.jobsApplications).set({reappliedFromId: id}).where(eq(j.jobsApplications.reappliedFromId, otherId)).run();
    if (application.reappliedFromId === otherId || application.reappliedFromId === id) db.update(j.jobsApplications).set({reappliedFromId: null}).where(eq(j.jobsApplications.id, id)).run();
    // Applied is the earlier of the two.
    if (other.appliedAt < application.appliedAt) db.update(j.jobsApplications).set({appliedAt: other.appliedAt}).where(eq(j.jobsApplications.id, id)).run();
    db.delete(j.jobsApplications).where(eq(j.jobsApplications.id, otherId)).run();
    const latest = moved.filter(event => !isQuietJobEvent(event.kind)).sort((a, b) => b.at.localeCompare(a.at))[0];
    if (latest) takeEmail(store, id, latest.kind, latest.at, now);
    else settleStatus(store, id, now);
    return {application: id};
  });
}

/** Records an email's read as belonging to an application now, and the role it names as one the application answers to. */
function claimEmail(store: Store, applicationId: number, messageId: number | null, fallback: {company: string; title: string | null}, now: string) {
  const db = jobsDb(store.sqlite);
  const read = messageId === null ? undefined : db.select().from(j.jobsEmailsRead).where(eq(j.jobsEmailsRead.messageId, messageId)).get();
  if (read) db.update(j.jobsEmailsRead).set({applicationId, outcome: 'event'}).where(eq(j.jobsEmailsRead.messageId, read.messageId)).run();
  const key = read?.titleKey ?? (fallback.title ? titleKey(fallback.title) || null : null);
  const requisitionId = read?.requisitionId ?? null;
  if (key || requisitionId) addAlias(store, applicationId, {company: read?.company ?? fallback.company, titleKey: key, requisitionId}, now);
}

/** POST /api/jobs/events/:id/move: Move to… another application, which answers to its role from then on. */
export function moveEvent(store: Store, eventId: number, targetId: number): Change {
  const event = eventOf(store, eventId);
  if (event.applicationId === targetId) throw invalid('The event is on that application already.');
  return corrected(store, {applications: [event.applicationId, targetId], messages: event.messageId === null ? [] : [event.messageId]}, now => {
    const db = jobsDb(store.sqlite);
    const source = applicationOf(store, event.applicationId);
    applicationOf(store, targetId);
    db.update(j.jobsEvents).set({applicationId: targetId}).where(eq(j.jobsEvents.id, eventId)).run();
    claimEmail(store, targetId, event.messageId, {company: source.company, title: null}, now);
    settleStatus(store, source.id, now);
    takeEmail(store, targetId, event.kind, event.at, now);
    return {application: targetId};
  });
}

/** POST /api/jobs/events/:id/not-about-this: the email comes off its application and waits in Needs you, to assign. */
export function notAboutThis(store: Store, eventId: number): Change {
  const event = eventOf(store, eventId);
  return corrected(store, {applications: [event.applicationId], messages: event.messageId === null ? [] : [event.messageId]}, now => {
    const db = jobsDb(store.sqlite);
    const application = applicationOf(store, event.applicationId);
    const read = event.messageId === null ? undefined : db.select().from(j.jobsEmailsRead).where(eq(j.jobsEmailsRead.messageId, event.messageId)).get();
    db.delete(j.jobsEvents).where(eq(j.jobsEvents.id, eventId)).run();
    if (read) db.update(j.jobsEmailsRead).set({applicationId: null, outcome: 'needs_you'}).where(eq(j.jobsEmailsRead.messageId, read.messageId)).run();
    const item = db.insert(j.jobsNeedsYou).values({
      kind: 'update_to_assign', reason: 'taken_off', company: read?.company ?? application.company, title: read?.title ?? null, platform: application.platform,
      subject: event.subject, sender: event.sender, eventKind: event.kind, line: event.line, accountId: application.accountId, at: event.at,
      messageId: event.messageId, createdAt: now,
    }).returning({id: j.jobsNeedsYou.id}).get();
    settleStatus(store, application.id, now);
    return {application: application.id, created: {needsYou: [item.id]}};
  });
}

/** POST /api/jobs/applications/:id/not-an-application: gone, and its emails, company and role blocked (decision 67). */
export function notAnApplication(store: Store, id: number): Change {
  return corrected(store, {applications: [id]}, now => {
    const db = jobsDb(store.sqlite);
    const application = applicationOf(store, id);
    const role = {company: application.company, titleKey: application.titleKey || null, requisitionId: application.requisitionId, applicationId: id, blockedAt: now};
    const messages = [...new Set(db.select({messageId: j.jobsEvents.messageId}).from(j.jobsEvents).where(eq(j.jobsEvents.applicationId, id)).all()
      .flatMap(row => (row.messageId === null ? [] : [row.messageId])))];
    for (const messageId of messages) {
      db.insert(j.jobsBlockedEmails).values({messageId, ...role}).onConflictDoUpdate({target: j.jobsBlockedEmails.messageId, set: role}).run();
    }
    // Its emails Setpoint never held: its company and role alone.
    if (!messages.length) db.insert(j.jobsBlockedEmails).values({messageId: null, ...role}).run();
    db.delete(j.jobsApplications).where(eq(j.jobsApplications.id, id)).run();
    return {};
  });
}

/** DELETE /api/jobs/applications/:id: forgotten, so a later email can make it again (decision 67). */
export function deleteApplication(store: Store, id: number): Change {
  return corrected(store, {applications: [id]}, () => {
    applicationOf(store, id);
    jobsDb(store.sqlite).delete(j.jobsApplications).where(eq(j.jobsApplications.id, id)).run();
    return {};
  });
}

/** Offers the application's candidates still standing as a JD to confirm; returns the item, or null with none left. */
export function offerCandidates(store: Store, application: Application, now: string): number | null {
  const db = jobsDb(store.sqlite);
  const turnedDown = rejectedLinks(store, application.id);
  const left = db.select().from(j.jobsJdCandidates).where(eq(j.jobsJdCandidates.applicationId, application.id)).all().filter(candidate => !turnedDown.has(candidate.link));
  db.delete(j.jobsJdCandidates).where(and(eq(j.jobsJdCandidates.applicationId, application.id), inArray(j.jobsJdCandidates.link, [...turnedDown, '']))).run();
  if (!left.length) {
    db.update(j.jobsApplications).set({jdLookup: 'not_found', jdLookupAt: now, updatedAt: now}).where(eq(j.jobsApplications.id, application.id)).run();
    return null;
  }
  db.update(j.jobsApplications).set({jdLookup: 'candidates', jdLookupAt: now, jdLookupFromHistory: false, updatedAt: now}).where(eq(j.jobsApplications.id, application.id)).run();
  return db.insert(j.jobsNeedsYou).values({
    kind: 'jd_to_confirm', reason: 'unsure_posting', applicationId: application.id, company: application.company, title: application.title || null,
    platform: application.platform, accountId: application.accountId, at: application.appliedAt, createdAt: now,
  }).returning({id: j.jobsNeedsYou.id}).get().id;
}

/** POST /api/jobs/applications/:id/not-this-posting: the JD goes, never to be saved again; its other candidates are offered, or No JD found. */
export function notThisPosting(store: Store, id: number): Change {
  return corrected(store, {applications: [id]}, now => {
    const db = jobsDb(store.sqlite);
    const application = applicationOf(store, id);
    const posting = db.select().from(j.jobsPostings).where(eq(j.jobsPostings.applicationId, id)).get();
    if (!posting) throw conflict('no_jd', 'This application has no JD to take away.');
    if (posting.link) rejectLinks(store, id, [posting.link], now);
    db.delete(j.jobsPostings).where(eq(j.jobsPostings.id, posting.id)).run();
    const item = offerCandidates(store, application, now);
    return {application: id, created: item === null ? {} : {needsYou: [item]}};
  });
}

/** The open JD to confirm items of an application. */
export const openJdItems = (store: Store, applicationId: number) => jobsDb(store.sqlite).select({id: j.jobsNeedsYou.id}).from(j.jobsNeedsYou)
  .where(and(eq(j.jobsNeedsYou.applicationId, applicationId), eq(j.jobsNeedsYou.kind, 'jd_to_confirm'), isNull(j.jobsNeedsYou.resolvedAt))).all().map(row => row.id);

/** The status an email to track starts its application at: an interview or an assessment In process, an offer Offer (decision 69). */
export const trackedStatus = (kind: JobEventKind | null): JobStatus => {
  const status = kind && !isQuietJobEvent(kind) ? STATUS_OF_JOB_EVENT[kind as keyof typeof STATUS_OF_JOB_EVENT] : null;
  return status === 'offer' ? 'offer' : 'in_process';
};
