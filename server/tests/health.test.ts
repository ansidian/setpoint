// Health is "the last check succeeded", against a threshold from the source's own schedule
// (decision 31): twice the interval plus a grace.
import {describe, expect, test} from 'vitest';
import {deriveHealth, HEALTH_GRACE_SECONDS, staleAfterMs} from '../src/domain/health.ts';
import type {HealthInput} from '../src/domain/health.ts';

const NOW = '2026-10-07T16:12:00.000Z';
const ago = (minutes: number) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();

// A source polled every 2 minutes (iCloud): stale after 2 × 2 min + 1 min = 5 minutes without a check.
const base: HealthInput = {
  now: NOW, intervalSeconds: 120, createdAt: ago(60 * 24),
  lastCheckAt: ago(1), lastSuccessAt: ago(1), lastErrorAt: null, lastError: null, needsReconnectAt: null,
};

describe('deriveHealth', () => {
  test('the threshold is twice the interval plus the grace', () => {
    expect(HEALTH_GRACE_SECONDS).toBe(60);
    expect(staleAfterMs(120)).toBe(5 * 60_000);
    expect(staleAfterMs(30 * 60)).toBe(61 * 60_000);
  });

  test.each<[string, Partial<HealthInput>, string, string | null, string | null]>([
    // name, changes from a source checked a minute ago, state, as of, reason
    ['checked a minute ago', {}, 'healthy', ago(1), null],
    ['a quiet source whose checks keep succeeding is healthy', {lastCheckAt: ago(4), lastSuccessAt: ago(4)}, 'healthy', ago(4), null],
    ['exactly at the threshold is still healthy', {lastCheckAt: ago(5), lastSuccessAt: ago(5)}, 'healthy', ago(5), null],
    ['past the threshold with no check: stale, as of the last success', {lastCheckAt: ago(6), lastSuccessAt: ago(6)}, 'stale', ago(6), null],
    ['checks stopped after a failure: stale, not failing', {lastCheckAt: ago(9), lastSuccessAt: ago(20), lastErrorAt: ago(9), lastError: 'timeout'}, 'stale', ago(20), null],
    ['the latest check failed: failing, with the provider\'s words', {lastCheckAt: ago(1), lastSuccessAt: ago(3), lastErrorAt: ago(1), lastError: 'IMAP: Too many connections'}, 'failing', ago(3), 'IMAP: Too many connections'],
    ['failing since it was added', {lastCheckAt: ago(1), lastSuccessAt: null, lastErrorAt: ago(1), lastError: '503'}, 'failing', null, '503'],
    ['a success after a failure is healthy again', {lastCheckAt: ago(1), lastSuccessAt: ago(1), lastErrorAt: ago(3), lastError: '503'}, 'healthy', ago(1), null],
    ['refused credentials: needs reconnect', {needsReconnectAt: ago(2), lastErrorAt: ago(2), lastError: 'invalid_grant'}, 'needs_reconnect', ago(1), 'invalid_grant'],
    ['needs reconnect wins over stale', {needsReconnectAt: ago(90), lastCheckAt: ago(90), lastSuccessAt: ago(95), lastError: 'invalid_grant'}, 'needs_reconnect', ago(95), 'invalid_grant'],
    ['new, not checked yet, within the threshold', {createdAt: ago(2), lastCheckAt: null, lastSuccessAt: null}, 'healthy', null, null],
    ['new and never checked past the threshold', {createdAt: ago(10), lastCheckAt: null, lastSuccessAt: null}, 'stale', null, null],
    ['a slow schedule (weather, 30 min) is healthy after 45 minutes', {intervalSeconds: 1800, lastCheckAt: ago(45), lastSuccessAt: ago(45)}, 'healthy', ago(45), null],
    ['and stale after 62', {intervalSeconds: 1800, lastCheckAt: ago(62), lastSuccessAt: ago(62)}, 'stale', ago(62), null],
  ])('%s', (_, changes, state, asOf, reason) => {
    expect(deriveHealth({...base, ...changes})).toEqual({state, asOf, reason});
  });
});
