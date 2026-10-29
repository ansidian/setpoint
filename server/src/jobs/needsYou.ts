// Answering Needs you (J4 adds From history's Dismiss all; J6 adds the rest, boards 34a–34c).
//
// - Dismiss all (D324, decision 70) clears From history: the same as ignoring each item, so those
//   emails make nothing. Each item is resolved as `dismissed` and kept, with its email's read
//   untouched (outcome `needs_you`, no application), so it's never offered again; a JD to confirm's
//   application keeps its candidates (its detail can still offer them) and nothing is saved.
// - Undo (the toast's, 6 s) brings back the items Dismiss all named, those still dismissed.
import {and, eq, inArray, isNull} from 'drizzle-orm';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {jobsDb} from './db.ts';
import * as j from './schema.ts';

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
