// Where the history pass stands (J4; BRIEF.md › Jobs › History, When things break; decisions 57, 72):
// its one row (./schema.ts jobsHistory) and the progress the page, Settings › Jobs and the `jobs`
// live event carry: "Reading history · 140 of 330 emails" while it runs, waiting while the AI is
// down, "Read 330 emails once, when Jobs was turned on · finished Oct 1, 8:14 PM" once it's done.
import type {JobsHistoryOut} from '@setpoint/shared';
import {and, count, gte, lt} from 'drizzle-orm';
import type {Store} from '../store.ts';
import {jobsDb} from './db.ts';
import type {ReadWindow} from './mail.ts';
import {readerIsDown, readWindow} from './readerState.ts';
import * as j from './schema.ts';

export type HistoryRow = typeof j.jobsHistory.$inferSelect;

export const historyRow = (store: Store): HistoryRow | undefined => jobsDb(store.sqlite).select().from(j.jobsHistory).get();

/** The pass's window while it runs and Jobs is on: what Jobs lists, received before it was turned on. Null otherwise. */
export function historyWindow(store: Store, pass = historyRow(store)): ReadWindow | null {
  const live = readWindow(store);
  if (!live || pass?.state !== 'running') return null;
  return {accounts: live.accounts, before: pass.before};
}

/**
 * The emails the running pass has read: those read since it started that came before its cutoff
 * (the live reader reads only what came after). Never more than its total.
 */
export function historyRead(store: Store, pass: HistoryRow): number {
  const read = jobsDb(store.sqlite).select({n: count()}).from(j.jobsEmailsRead)
    .where(and(gte(j.jobsEmailsRead.readAt, pass.startedAt), lt(j.jobsEmailsRead.at, pass.before))).get()?.n ?? 0;
  return Math.min(read, pass.total);
}

/** The pass as the API and the `jobs` event carry it. */
export function historyStatus(store: Store): JobsHistoryOut {
  const pass = historyRow(store);
  if (!pass) return {state: 'not_started', read: 0, total: 0, started_at: null, finished_at: null};
  if (pass.state === 'done') return {state: 'done', read: pass.read ?? pass.total, total: pass.total, started_at: pass.startedAt, finished_at: pass.finishedAt};
  return {state: readerIsDown(store) ? 'waiting' : 'running', read: historyRead(store, pass), total: pass.total, started_at: pass.startedAt, finished_at: null};
}
