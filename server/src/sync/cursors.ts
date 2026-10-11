// A source's stored positions (sync_cursors): the engine keeps the incremental cursor (scope ""),
// and adapters keep their own beside it, such as the backfill's ("backfill"). Each is a string;
// structured ones are JSON.
import {and, eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';

export function readCursor(store: Store, sourceId: number, scope = ''): string | null {
  return store.db.select({cursor: t.syncCursors.cursor}).from(t.syncCursors)
    .where(and(eq(t.syncCursors.sourceId, sourceId), eq(t.syncCursors.scope, scope))).get()?.cursor ?? null;
}

export function writeCursor(store: Store, sourceId: number, cursor: string, scope = '') {
  const updatedAt = isoNow(store);
  store.db.insert(t.syncCursors).values({sourceId, scope, cursor, updatedAt})
    .onConflictDoUpdate({target: [t.syncCursors.sourceId, t.syncCursors.scope], set: {cursor, updatedAt}}).run();
}

export function deleteCursor(store: Store, sourceId: number, scope = '') {
  store.db.delete(t.syncCursors).where(and(eq(t.syncCursors.sourceId, sourceId), eq(t.syncCursors.scope, scope))).run();
}

// ---- The first backfill: 365 days of mail, resumable, with progress ----

export const BACKFILL_DAYS = 365;
export const BACKFILL_SCOPE = 'backfill';

/**
 * Where a source's backfill stands, persisted after every step so a restart resumes rather than
 * starting over. `cursor` is the provider's own position (Gmail's page token, iCloud's UIDs left);
 * `total` is what there is to fetch (exact for IMAP, Gmail's estimate otherwise) and `fetched`
 * how many have been looked at.
 */
export interface BackfillState<C = unknown> {
  // The window's start: mail received since then is backfilled.
  since: string;
  total: number;
  fetched: number;
  done: boolean;
  cursor: C | null;
  startedAt: string;
  finishedAt: string | null;
}

export function readBackfill<C>(store: Store, sourceId: number): BackfillState<C> | null {
  const raw = readCursor(store, sourceId, BACKFILL_SCOPE);
  return raw ? JSON.parse(raw) as BackfillState<C> : null;
}

export function writeBackfill<C>(store: Store, sourceId: number, state: BackfillState<C>) {
  writeCursor(store, sourceId, JSON.stringify(state), BACKFILL_SCOPE);
}

export function startBackfill<C>(store: Store, sourceId: number, total: number, cursor: C | null): BackfillState<C> {
  const now = store.now();
  const state: BackfillState<C> = {
    since: new Date(now.getTime() - BACKFILL_DAYS * 24 * 60 * 60_000).toISOString(), total, fetched: 0, done: false, cursor,
    startedAt: now.toISOString(), finishedAt: null,
  };
  writeBackfill(store, sourceId, state);
  return state;
}

/** 0–1. An estimate can undershoot, so an unfinished backfill never shows 100%. */
export function backfillProgress(state: Pick<BackfillState, 'done' | 'total' | 'fetched'>): number {
  if (state.done) return 1;
  if (state.total <= 0) return 0;
  return Math.min(0.99, state.fetched / state.total);
}
