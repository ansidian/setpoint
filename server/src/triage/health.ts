// Triage's health (DESIGN.md › Health and states: "Triage is down, as of 9:09 AM", with the Unsorted
// group under Attention). Like a source's, it's about the last attempt, not about whether mail
// arrived: triage is down while its last model call failed (or there was no model to call when an
// email needed one), as of its last successful call. A success brings it back.
import type {TriageStatusOut} from '@setpoint/shared';
import {and, count, eq, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';

type HealthRow = typeof t.triageHealth.$inferSelect;

function row(store: Store): HealthRow {
  return store.db.select().from(t.triageHealth).where(eq(t.triageHealth.id, 1)).get() ?? {id: 1, lastSuccessAt: null, lastFailureAt: null, lastError: null};
}

const isDown = (health: Pick<HealthRow, 'lastSuccessAt' | 'lastFailureAt'>) =>
  health.lastFailureAt !== null && (health.lastSuccessAt === null || health.lastFailureAt > health.lastSuccessAt);

function save(store: Store, values: Partial<HealthRow>) {
  store.db.insert(t.triageHealth).values({id: 1, ...values}).onConflictDoUpdate({target: t.triageHealth.id, set: values}).run();
}

/** A model answered. Returns true when that ended a spell of triage being down. */
export function recordTriageSuccess(store: Store): boolean {
  return transaction(store, () => {
    const wasDown = isDown(row(store));
    save(store, {lastSuccessAt: isoNow(store)});
    return wasDown;
  });
}

/** A model call failed, or none could be made. Returns true when triage just went down. */
export function recordTriageFailure(store: Store, reason: string): boolean {
  return transaction(store, () => {
    const wasDown = isDown(row(store));
    save(store, {lastFailureAt: isoNow(store), lastError: reason});
    return !wasDown;
  });
}

/** Mail waiting in the Unsorted group: not sorted yet, and still in the Inbox. */
export function unsortedCount(store: Store): number {
  return store.db.select({n: count()}).from(t.messages).where(and(
    isNull(t.messages.lane), isNull(t.messages.doneAt), isNull(t.messages.trashedAt), isNull(t.messages.archivedAt),
  )).get()?.n ?? 0;
}

export function triageStatus(store: Store): Omit<TriageStatusOut, 'history'> {
  const health = row(store);
  const down = isDown(health);
  return {state: down ? 'down' : 'healthy', as_of: health.lastSuccessAt, reason: down ? health.lastError : null, unsorted: unsortedCount(store)};
}
