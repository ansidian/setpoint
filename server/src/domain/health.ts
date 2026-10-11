// A source's health (decision 31; BRIEF.md › Health and states). Healthy means the last check
// succeeded, not that data changed: a quiet night with no new mail is healthy. v1 measured time since
// the last change, flagged quiet mirrors as stale and kept lengthening thresholds.
//
// Each source has a heartbeat (its poll, or the sweep behind a push), and the threshold comes from
// that schedule: twice the interval plus a grace.
import type {HealthState} from '@setpoint/shared';

/** Slack for a check that runs a little late or takes a while. */
export const HEALTH_GRACE_SECONDS = 60;

export interface HealthInput {
  now: string;
  intervalSeconds: number;
  // When the source was added: a new source has until the threshold for its first check.
  createdAt: string;
  lastCheckAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  needsReconnectAt: string | null;
}

export interface Health {
  state: HealthState;
  // The last successful check: "Personal, as of 9:14 PM".
  asOf: string | null;
  // The provider's words while failing or needing reconnect.
  reason: string | null;
}

export const staleAfterMs = (intervalSeconds: number) => (2 * intervalSeconds + HEALTH_GRACE_SECONDS) * 1000;

/**
 * - **Needs reconnect** wins: the provider refused the credentials, and nothing fixes that but
 *   new ones (checks may keep running and keep failing the same way).
 * - **Stale** when no check has finished within the threshold: checks stopped running (the worker
 *   died, a check hangs). It says "as of" the last success.
 * - **Failing** when checks run but the latest one failed.
 * - **Healthy** otherwise.
 */
export function deriveHealth(input: HealthInput): Health {
  const asOf = input.lastSuccessAt;
  if (input.needsReconnectAt) return {state: 'needs_reconnect', asOf, reason: input.lastError};
  const lastRan = input.lastCheckAt ?? input.createdAt;
  if (Date.parse(input.now) - Date.parse(lastRan) > staleAfterMs(input.intervalSeconds)) return {state: 'stale', asOf, reason: null};
  const failedLast = input.lastErrorAt !== null && (input.lastSuccessAt === null || input.lastErrorAt > input.lastSuccessAt);
  if (failedLast) return {state: 'failing', asOf, reason: input.lastError};
  return {state: 'healthy', asOf, reason: null};
}
