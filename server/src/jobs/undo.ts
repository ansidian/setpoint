// Undo for Jobs's answers and corrections (J6; DESIGN.md › Corrections: "each says what it did in the
// toast, with Undo for 6 seconds"). Before it changes anything, a correction takes a snapshot of every
// row it may touch: its applications with their events, JD, candidates, hand-set fields, aliases and
// turned-down postings, the Needs you items and the emails' read records and blocks; afterwards it
// says what it made. Undo puts those rows back exactly as they were, with their ids, and takes away
// what it made, so a merge, a delete or a block comes back whole. The toast offers only the latest,
// and a snapshot is kept a day.
import {eq, inArray, lt, or} from 'drizzle-orm';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {jobsDb} from './db.ts';
import * as j from './schema.ts';

const KEEP_MS = 24 * 60 * 60_000;

/** What a correction may touch: applications (with everything of theirs), Needs you items, and emails by message id. */
export interface UndoScope {
  applications?: number[];
  needsYou?: number[];
  messages?: number[];
}

interface Snapshot {
  applications: number[];
  needsYou: number[];
  messages: number[];
  rows: {
    applications: (typeof j.jobsApplications.$inferSelect)[];
    events: (typeof j.jobsEvents.$inferSelect)[];
    postings: (typeof j.jobsPostings.$inferSelect)[];
    candidates: (typeof j.jobsJdCandidates.$inferSelect)[];
    handSet: (typeof j.jobsHandSet.$inferSelect)[];
    aliases: (typeof j.jobsAliases.$inferSelect)[];
    rejected: (typeof j.jobsRejectedPostings.$inferSelect)[];
    needsYou: (typeof j.jobsNeedsYou.$inferSelect)[];
    emailsRead: (typeof j.jobsEmailsRead.$inferSelect)[];
    blocked: (typeof j.jobsBlockedEmails.$inferSelect)[];
    // Re-applications pointing at one of these applications, which a delete would unlink.
    links: {id: number; reappliedFromId: number | null}[];
  };
  created: {applications: number[]; needsYou: number[]};
}

const none = [-1];
const ids = (list: number[]) => (list.length ? list : none);

/** Every row the scope covers, as it is now. Call it inside the correction's transaction, before it writes. */
export function beginUndo(store: Store, scope: UndoScope): Snapshot {
  const db = jobsDb(store.sqlite);
  const applications = [...new Set(scope.applications ?? [])];
  const events = db.select().from(j.jobsEvents).where(inArray(j.jobsEvents.applicationId, ids(applications))).all();
  const needsYou = db.select().from(j.jobsNeedsYou)
    .where(or(inArray(j.jobsNeedsYou.id, ids(scope.needsYou ?? [])), inArray(j.jobsNeedsYou.applicationId, ids(applications)))).all();
  const messages = [...new Set([
    ...(scope.messages ?? []), ...events.flatMap(event => (event.messageId === null ? [] : [event.messageId])),
    ...needsYou.flatMap(item => (item.messageId === null ? [] : [item.messageId])),
  ])];
  return {
    applications, needsYou: needsYou.map(item => item.id), messages,
    rows: {
      applications: db.select().from(j.jobsApplications).where(inArray(j.jobsApplications.id, ids(applications))).all(),
      events,
      postings: db.select().from(j.jobsPostings).where(inArray(j.jobsPostings.applicationId, ids(applications))).all(),
      candidates: db.select().from(j.jobsJdCandidates).where(inArray(j.jobsJdCandidates.applicationId, ids(applications))).all(),
      handSet: db.select().from(j.jobsHandSet).where(inArray(j.jobsHandSet.applicationId, ids(applications))).all(),
      aliases: db.select().from(j.jobsAliases).where(inArray(j.jobsAliases.applicationId, ids(applications))).all(),
      rejected: db.select().from(j.jobsRejectedPostings).where(inArray(j.jobsRejectedPostings.applicationId, ids(applications))).all(),
      needsYou,
      emailsRead: db.select().from(j.jobsEmailsRead)
        .where(or(inArray(j.jobsEmailsRead.messageId, ids(messages)), inArray(j.jobsEmailsRead.applicationId, ids(applications)))).all(),
      blocked: db.select().from(j.jobsBlockedEmails)
        .where(or(inArray(j.jobsBlockedEmails.messageId, ids(messages)), inArray(j.jobsBlockedEmails.applicationId, ids(applications)))).all(),
      links: db.select({id: j.jobsApplications.id, reappliedFromId: j.jobsApplications.reappliedFromId}).from(j.jobsApplications)
        .where(inArray(j.jobsApplications.reappliedFromId, ids(applications))).all(),
    },
    created: {applications: [], needsYou: []},
  };
}

/** Keeps the snapshot with what the correction made, for its toast's Undo; returns its token. */
export function keepUndo(store: Store, snapshot: Snapshot, created: Partial<Snapshot['created']> = {}): number {
  const db = jobsDb(store.sqlite);
  const now = isoNow(store);
  db.delete(j.jobsUndo).where(lt(j.jobsUndo.createdAt, new Date(store.now().getTime() - KEEP_MS).toISOString())).run();
  const kept: Snapshot = {...snapshot, created: {applications: created.applications ?? [], needsYou: created.needsYou ?? []}};
  return db.insert(j.jobsUndo).values({snapshot: kept, createdAt: now}).returning({id: j.jobsUndo.id}).get().id;
}

/**
 * Undo: what the correction made goes, and every row it may have touched is as it was, ids and all.
 * Returns the applications and Needs you items it changed back, or null when the token is gone.
 */
export function undoCorrection(store: Store, token: number): {applications: number[]; needs_you: number[]} | null {
  const db = jobsDb(store.sqlite);
  return transaction(store, () => {
    const row = db.select().from(j.jobsUndo).where(eq(j.jobsUndo.id, token)).get();
    if (!row) return null;
    const {applications, needsYou, messages, rows, created} = row.snapshot as Snapshot;
    // What it made.
    if (created.applications.length) db.delete(j.jobsApplications).where(inArray(j.jobsApplications.id, created.applications)).run();
    if (created.needsYou.length) db.delete(j.jobsNeedsYou).where(inArray(j.jobsNeedsYou.id, created.needsYou)).run();
    // The applications, back in place (a deleted or merged one made again with its id).
    for (const application of rows.applications) {
      const {id, ...rest} = application;
      db.insert(j.jobsApplications).values(application).onConflictDoUpdate({target: j.jobsApplications.id, set: rest}).run();
    }
    // Their rows, exactly as they were: wherever an event went (a move, a merge), it comes back.
    const scope = ids(applications);
    db.delete(j.jobsEvents).where(or(inArray(j.jobsEvents.applicationId, scope), inArray(j.jobsEvents.id, ids(rows.events.map(event => event.id))))).run();
    db.delete(j.jobsPostings).where(inArray(j.jobsPostings.applicationId, scope)).run();
    db.delete(j.jobsJdCandidates).where(inArray(j.jobsJdCandidates.applicationId, scope)).run();
    db.delete(j.jobsHandSet).where(inArray(j.jobsHandSet.applicationId, scope)).run();
    db.delete(j.jobsAliases).where(inArray(j.jobsAliases.applicationId, scope)).run();
    db.delete(j.jobsRejectedPostings).where(inArray(j.jobsRejectedPostings.applicationId, scope)).run();
    db.delete(j.jobsNeedsYou).where(or(inArray(j.jobsNeedsYou.id, ids(needsYou)), inArray(j.jobsNeedsYou.applicationId, scope))).run();
    if (rows.events.length) db.insert(j.jobsEvents).values(rows.events).run();
    if (rows.postings.length) db.insert(j.jobsPostings).values(rows.postings).run();
    if (rows.candidates.length) db.insert(j.jobsJdCandidates).values(rows.candidates).run();
    if (rows.handSet.length) db.insert(j.jobsHandSet).values(rows.handSet).run();
    if (rows.aliases.length) db.insert(j.jobsAliases).values(rows.aliases).run();
    if (rows.rejected.length) db.insert(j.jobsRejectedPostings).values(rows.rejected).run();
    if (rows.needsYou.length) db.insert(j.jobsNeedsYou).values(rows.needsYou).run();
    for (const read of rows.emailsRead) {
      const {messageId, ...rest} = read;
      db.insert(j.jobsEmailsRead).values(read).onConflictDoUpdate({target: j.jobsEmailsRead.messageId, set: rest}).run();
    }
    db.delete(j.jobsBlockedEmails).where(or(inArray(j.jobsBlockedEmails.messageId, ids(messages)), inArray(j.jobsBlockedEmails.applicationId, scope))).run();
    if (rows.blocked.length) db.insert(j.jobsBlockedEmails).values(rows.blocked).run();
    for (const link of rows.links) {
      db.update(j.jobsApplications).set({reappliedFromId: link.reappliedFromId}).where(eq(j.jobsApplications.id, link.id)).run();
    }
    db.delete(j.jobsUndo).where(eq(j.jobsUndo.id, token)).run();
    const changed = {applications: [...applications, ...created.applications], needs_you: [...needsYou, ...created.needsYou]};
    noteLive(store, {type: 'jobs', ...changed});
    return changed;
  });
}
