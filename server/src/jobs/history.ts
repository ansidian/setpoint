// The history pass (J4; BRIEF.md › Jobs › History; decisions 57, 70, 72; darma SV-122).
//
// - Once, when Jobs is turned on (./settings.ts): it reads, oldest first, every email Setpoint holds
//   in the accounts Jobs lists that came before it was turned on and that Jobs hasn't read (the Jobs
//   account in full, only triage's Career elsewhere), through J2's reader and rules, so each is read
//   once and never charged for again. Its total is fixed when it starts: mail arriving meanwhile is
//   the live reader's.
// - Durable: it's a `jobs_read` job on Jobs's own worker (key `jobs_history`), and what it has read is
//   jobs_emails_read itself, so a restart goes on from the next email. The rescan queues it again
//   while it runs; an AI that's down holds it (`waiting`) by the one retry policy, as J2's reading.
// - An email triage hasn't sorted yet is waited for (triage sorts it again once it's back), since in a
//   Career-only account only its kind says whether to read it. Backfilled mail is sorted as it lands
//   (rules only), so it never waits; the Jobs account's is read whatever kind it was given.
// - JDs only for applications still open, and only once it's done (a later email in the pass may
//   close one): the applications it makes start without a lookup (`none`), and at its end the open
//   ones are marked `looking` for the worker to queue, their unsure candidates going to From history.
// - What it's unsure of goes to From history (the reader's `fromHistory`), apart from today's.
// - Turned off, it stops; turned on again (or given other accounts), a new pass reads whatever those
//   accounts hold from before then that isn't read yet, and one with nothing to read leaves the
//   last pass's record as it was.
import {OPEN_JOB_STATUSES} from '@setpoint/shared';
import {and, eq, inArray, isNull, lt} from 'drizzle-orm';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {enqueueJob, hasActiveJob} from '../sync/jobs.ts';
import {jobsDb} from './db.ts';
import {emailsToRead, historyLeft} from './mail.ts';
import {historyRead, historyRow, historyStatus, historyWindow} from './historyState.ts';
import * as j from './schema.ts';

export const HISTORY_KEY = 'jobs_history';

/** A `jobs` event naming nothing, with the pass as it stands: the page and Settings ask again. */
export const announceHistory = (store: Store) => noteLive(store, {type: 'jobs', applications: [], needs_you: [], history: historyStatus(store)});

/**
 * Starts the pass over what Jobs hasn't read from before it was turned on, in the accounts it lists
 * now (Jobs on). Nothing to read leaves the last pass as it was (a second turn-on reads nothing), or
 * records one done at 0 when there was none. Returns whether a pass is running.
 */
export function startHistory(store: Store): boolean {
  const db = jobsDb(store.sqlite);
  return transaction(store, () => {
    const settings = db.select().from(j.jobsSettings).get();
    if (!settings?.enabled) return false;
    const before = settings.enabledAt ?? settings.updatedAt;
    const left = historyLeft(store, {accounts: settings.accounts, before});
    const total = left.sorted + left.unsorted;
    const now = isoNow(store);
    const last = historyRow(store);
    if (!total) {
      if (!last) db.insert(j.jobsHistory).values({id: 1, state: 'done', before, startedAt: now, total: 0, read: 0, finishedAt: now}).run();
      // One stopped by turning Jobs off, with nothing left now: it's done.
      else if (last.state === 'running') finishHistory(store, last.startedAt);
      announceHistory(store);
      return false;
    }
    const pass = {state: 'running' as const, before, startedAt: now, total, read: null, finishedAt: null};
    db.insert(j.jobsHistory).values({id: 1, ...pass}).onConflictDoUpdate({target: j.jobsHistory.id, set: pass}).run();
    enqueueJob(store, {kind: 'jobs_read', key: HISTORY_KEY});
    announceHistory(store);
    return true;
  });
}

/**
 * The rescan and triage's nudge: a running pass with something it can read now (or nothing left at
 * all, to end it) gets its job, unless it has one. One waiting only on triage isn't queued until
 * triage sorts something.
 */
export function resumeHistory(store: Store) {
  const pass = historyRow(store);
  const window = historyWindow(store, pass);
  if (!window || hasActiveJob(store, HISTORY_KEY)) return;
  const left = historyLeft(store, window);
  const readable = emailsToRead(store, window, isoNow(store), 1).length > 0;
  if (readable || left.sorted + left.unsorted === 0) enqueueJob(store, {kind: 'jobs_read', key: HISTORY_KEY});
}

/**
 * Ends the pass that started at `startedAt`, once nothing in its window is left but the emails the
 * provider refused outright this time (`passedOver`, read by a later pass): its count is kept, and
 * the open applications it made, never looked up, are marked `looking` for their JD (decision 57),
 * their unsure candidates bound for From history. Closed ones keep none. Returns those applications,
 * or null while it isn't done (still emails to read, or unsorted ones to wait for) or was replaced.
 */
export function finishHistory(store: Store, startedAt: string, passedOver: ReadonlySet<number> = new Set()): number[] | null {
  const db = jobsDb(store.sqlite);
  return transaction(store, () => {
    const pass = historyRow(store);
    if (pass?.state !== 'running' || pass.startedAt !== startedAt) return null;
    // Jobs off holds the pass where it is.
    const window = historyWindow(store, pass);
    if (!window) return null;
    const left = historyLeft(store, window);
    if (left.unsorted || left.sorted > passedOver.size) return null;
    if (emailsToRead(store, window, isoNow(store), passedOver.size + 1).some(id => !passedOver.has(id))) return null;
    const now = isoNow(store);
    db.update(j.jobsHistory).set({state: 'done', read: historyRead(store, pass), finishedAt: now}).where(eq(j.jobsHistory.id, 1)).run();
    const open = db.select({id: j.jobsApplications.id}).from(j.jobsApplications)
      .leftJoin(j.jobsPostings, eq(j.jobsPostings.applicationId, j.jobsApplications.id))
      .where(and(
        eq(j.jobsApplications.jdLookup, 'none'), isNull(j.jobsApplications.jdLookupAt), isNull(j.jobsPostings.id),
        lt(j.jobsApplications.appliedAt, pass.before), inArray(j.jobsApplications.status, [...OPEN_JOB_STATUSES]),
      )).all().map(row => row.id);
    if (open.length) {
      db.update(j.jobsApplications).set({jdLookup: 'looking', jdLookupAt: now, jdLookupFromHistory: true, updatedAt: now})
        .where(inArray(j.jobsApplications.id, open)).run();
    }
    noteLive(store, {type: 'jobs', applications: open, needs_you: [], history: historyStatus(store)});
    return open;
  });
}
