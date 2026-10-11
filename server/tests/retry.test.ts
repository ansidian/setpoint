// The one retry policy for jobs and commands.
import {describe, expect, test} from 'vitest';
import {RETRY, retryAfterFailure} from '../src/domain/retry.ts';
import type {ProviderErrorKind} from '../src/domain/retry.ts';

const S = 1000;
const M = 60 * S;

describe('retryAfterFailure', () => {
  test.each<[ProviderErrorKind, number, number | null, false | number]>([
    // kind, attempt that failed, Retry-After, then: no retry, or the delay
    ['transient', 1, null, 30 * S],
    ['transient', 2, null, M],
    ['transient', 3, null, 2 * M],
    ['transient', 4, null, 4 * M],
    ['transient', 5, null, 8 * M],
    ['transient', 6, null, false],
    ['rate_limited', 1, null, 30 * S],
    ['rate_limited', 1, 90 * S, 90 * S],
    ['rate_limited', 3, 10 * S, 2 * M],
    ['rate_limited', 2, 2 * 60 * M, 30 * M],
    ['auth', 1, null, false],
    ['permanent', 1, null, false],
  ])('%s, attempt %i, Retry-After %s → %s', (kind, attempt, retryAfter, expected) => {
    expect(retryAfterFailure(kind, attempt, retryAfter)).toEqual(expected === false ? {retry: false} : {retry: true, delayMs: expected});
  });

  test('six attempts in all, and never more than 30 minutes apart', () => {
    expect(RETRY.maxAttempts).toBe(6);
    expect(retryAfterFailure('transient', 20, null)).toEqual({retry: false});
  });
});
