// A provider's error, classified for the one retry policy and carrying the provider's own words,
// which a failed change shows as they are ("The requested event was modified by another client.
// (409 Conflict)"). Adapters throw these; anything else a check throws counts as transient.
import type {ProviderErrorKind} from '../domain/retry.ts';

export class ProviderError extends Error {
  readonly kind: ProviderErrorKind;
  readonly status: number | null;
  readonly retryAfterMs: number | null;

  constructor(kind: ProviderErrorKind, message: string, {status = null, retryAfterMs = null}: {status?: number | null; retryAfterMs?: number | null} = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

/** The kind an HTTP status means (for adapters over HTTP). */
export function kindOfStatus(status: number): ProviderErrorKind {
  if (status === 401) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status >= 500 || status === 408) return 'transient';
  return 'permanent';
}

export function asProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) return new ProviderError('transient', 'The provider didn\'t answer in time.');
  return new ProviderError('transient', error instanceof Error ? error.message : String(error));
}
