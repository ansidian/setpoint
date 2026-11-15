// A source's stored positions (sync_cursors). The engine keeps the incremental cursor (scope ""),
// and adapters keep their own beside it, such as the backfill's ("backfill"). Each is a string.
// Structured ones are JSON.
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
// The sent mail's own backfill, over the same 365 days: kept apart, so the Inbox's Indexing line and
// the header pass read only the received mail's.
export const SENT_BACKFILL_SCOPE = 'sent-backfill';

/**
 * Where a source's backfill stands, persisted after every step so a restart resumes rather than
 * starting over. `cursor` is the provider's own position (Gmail's page token, iCloud's UIDs left).
 * `total` is what there is to fetch (exact for IMAP, Gmail's estimate otherwise), and `fetched` is
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

export function readBackfill<C>(store: Store, sourceId: number, scope = BACKFILL_SCOPE): BackfillState<C> | null {
  const raw = readCursor(store, sourceId, scope);
  return raw ? JSON.parse(raw) as BackfillState<C> : null;
}

export function writeBackfill<C>(store: Store, sourceId: number, state: BackfillState<C>, scope = BACKFILL_SCOPE) {
  writeCursor(store, sourceId, JSON.stringify(state), scope);
}

export function startBackfill<C>(store: Store, sourceId: number, total: number, cursor: C | null, scope = BACKFILL_SCOPE): BackfillState<C> {
  const now = store.now();
  const state: BackfillState<C> = {
    since: new Date(now.getTime() - BACKFILL_DAYS * 24 * 60 * 60_000).toISOString(), total, fetched: 0, done: false, cursor,
    startedAt: now.toISOString(), finishedAt: null,
  };
  writeBackfill(store, sourceId, state, scope);
  return state;
}

/** 0–1. An estimate can undershoot, so an unfinished backfill never shows 100%. */
export function backfillProgress(state: Pick<BackfillState, 'done' | 'total' | 'fetched'>): number {
  if (state.done) return 1;
  if (state.total <= 0) return 0;
  return Math.min(0.99, state.fetched / state.total);
}

// ---- The header pass: recipients and reply headers for mail held from before they were kept ----

export const HEADERS_SCOPE = 'headers';

/**
 * Where a source's header pass stands (src/sync/headers.ts), persisted after every step. `afterId`
 * is the last message id it looked at; it goes up by id, so a row the provider no longer has is
 * passed over once and never asked for again. `total` is how many rows lacked the headers when it
 * started, `read` how many it filled and `skipped` how many the provider no longer had.
 */
export interface HeaderBackfillState {
  total: number;
  read: number;
  skipped: number;
  afterId: number;
  done: boolean;
  startedAt: string;
  finishedAt: string | null;
}

export function readHeaderBackfill(store: Store, sourceId: number): HeaderBackfillState | null {
  const raw = readCursor(store, sourceId, HEADERS_SCOPE);
  return raw ? JSON.parse(raw) as HeaderBackfillState : null;
}

export function writeHeaderBackfill(store: Store, sourceId: number, state: HeaderBackfillState) {
  writeCursor(store, sourceId, JSON.stringify(state), HEADERS_SCOPE);
}
