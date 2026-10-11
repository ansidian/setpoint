// Recording a source's heartbeat and reading its health (src/domain/health.ts has the rule). The
// engine announces a `health` event when a state changes, not on every check.
import type {HealthOut} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {deriveHealth} from '../domain/health.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import type {SourceRow} from './adapter.ts';
import type {ProviderError} from './errors.ts';

export function sourceHealth(source: SourceRow, now: string): HealthOut {
  const health = deriveHealth({
    now, intervalSeconds: source.intervalSeconds, createdAt: source.createdAt, lastCheckAt: source.lastCheckAt,
    lastSuccessAt: source.lastSuccessAt, lastErrorAt: source.lastErrorAt, lastError: source.lastError, needsReconnectAt: source.needsReconnectAt,
  });
  return {state: health.state, as_of: health.asOf, reason: health.reason, last_check_at: source.lastCheckAt};
}

/** A check finished and the provider answered. */
export function recordSuccess(store: Store, sourceId: number) {
  const now = isoNow(store);
  store.db.update(t.sources).set({lastCheckAt: now, lastSuccessAt: now}).where(eq(t.sources.id, sourceId)).run();
}

/**
 * A check finished and the provider refused. Refused credentials mean needs reconnect, which only
 * new credentials clear; returns true when that just began.
 */
export function recordFailure(store: Store, sourceId: number, error: ProviderError): boolean {
  const now = isoNow(store);
  return transaction(store, () => {
    const source = store.db.select().from(t.sources).where(eq(t.sources.id, sourceId)).get();
    if (!source) return false;
    const beganReconnect = error.kind === 'auth' && !source.needsReconnectAt;
    store.db.update(t.sources).set({
      lastCheckAt: now, lastErrorAt: now, lastError: error.message, ...(error.kind === 'auth' && !source.needsReconnectAt ? {needsReconnectAt: now} : {}),
    }).where(eq(t.sources.id, sourceId)).run();
    return beganReconnect;
  });
}
