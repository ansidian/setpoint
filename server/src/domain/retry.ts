// The one retry policy for durable jobs: syncs, sweeps, push renewals and commands.
// Providers' errors arrive classified (src/sync/errors.ts). What a retry can fix is retried with
// backoff. What it can't fix fails at once.

/**
 * How a provider call failed:
 * - `auth`: the credentials were refused (401, a revoked refresh token). Needs reconnect.
 * - `rate_limited`: 429, maybe with Retry-After.
 * - `transient`: a timeout, a dropped connection, a 5xx.
 * - `permanent`: the provider said no (400, 404, 409 conflict). Retrying asks the same question.
 */
export const PROVIDER_ERROR_KINDS = ['auth', 'rate_limited', 'transient', 'permanent'] as const;
export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

export const RETRY = {
  // Attempts in all, the first included.
  maxAttempts: 6,
  baseDelayMs: 30_000,
  maxDelayMs: 30 * 60_000,
} as const;

export type RetryDecision = {retry: true; delayMs: number} | {retry: false};

/**
 * After `attempt` (1 for the first) failed with `kind`: retry after 30 s, 1, 2, 4 and 8 minutes
 * (capped at 30), honouring a longer Retry-After, until the sixth attempt. Never retry `auth` or
 * `permanent`.
 */
export function retryAfterFailure(kind: ProviderErrorKind, attempt: number, retryAfterMs: number | null = null): RetryDecision {
  if (kind === 'auth' || kind === 'permanent') return {retry: false};
  if (attempt >= RETRY.maxAttempts) return {retry: false};
  const backoff = Math.min(RETRY.maxDelayMs, RETRY.baseDelayMs * 2 ** (attempt - 1));
  const delayMs = kind === 'rate_limited' && retryAfterMs !== null ? Math.min(RETRY.maxDelayMs, Math.max(backoff, retryAfterMs)) : backoff;
  return {retry: true, delayMs};
}
