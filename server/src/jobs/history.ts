// The history pass.
//
// - Once, when Jobs is turned on (./settings.ts), it reads every email Setpoint holds that came
//   before Jobs was turned on and that Jobs hasn't read. It reads only the accounts Jobs lists: the
//   Jobs account in full, and only triage's Career elsewhere. It reads oldest first, through the
//   live reader and its rules, so each email is read once and never charged for again. Its total is
//   fixed when it starts. Mail that arrives meanwhile is the live reader's.
// - Durable. It's a `jobs_read` job on Jobs's own worker (key `jobs_history`). What it has read is
//   jobs_emails_read itself, so a restart goes on from the next email. The rescan queues it again
//   while it runs. An AI that's down holds it (`waiting`) by the one retry policy, as it holds the
//   live reading.
// - It waits for an email triage hasn't sorted yet (triage sorts it again once it's back), because
//   in a Career-only account only the email's kind says whether to read it. Backfilled mail is
//   sorted as it lands (rules only), so it never waits. The Jobs account's mail is read whatever
//   kind it was given.
// - JDs come only for applications still open, and only once the pass is done (a later email in the
//   pass may close one). The applications it makes start without a lookup (`none`). At its end, it
//   marks the open ones `looking` for the worker to queue, and their unsure candidates go to From
//   history.
// - What it's unsure of goes to From history (the reader's `fromHistory`), apart from today's.
// - Turned off, it stops. Turned on again (or given other accounts), a new pass reads whatever those
//   accounts hold from before then that isn't read yet. A pass with nothing to read leaves the last
//   pass's record as it was.
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
 * The rescan and triage's nudge. A running pass gets its job, unless it has one, when it has
 * something it can read now (or nothing left at all, to end it). A pass waiting only on triage isn't
 * queued until triage sorts something.
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
 * provider refused outright this time (`passedOver`, read by a later pass). It keeps the pass's
 * count. It marks the open applications the pass made, never looked up, `looking` for their JD, and
 * their unsure candidates are bound for From history. Closed ones keep none. Returns those
 * applications. Returns null while the pass isn't done (still emails to read, or unsorted ones to
 * wait for) or when it was replaced.
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
      db.update(j.jobsApplications).set({jdLookup: 'looking', jdLookupAt: now, jdLookupStoppedAt: null, jdLookupFromHistory: true, updatedAt: now})
        .where(inArray(j.jobsApplications.id, open)).run();
    }
    noteLive(store, {type: 'jobs', applications: open, needs_you: [], history: historyStatus(store)});
    return open;
  });
}
