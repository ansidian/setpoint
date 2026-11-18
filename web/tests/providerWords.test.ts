import {describe, expect, test} from 'vitest';
import {failureText, refusalWords, retryingLine, splitProviderMessage, troubleLine, withCode} from '../src/logic/providerWords.ts';

// The messages the server keeps, in their real shapes: a provider's words then its status, the
// status alone, another code, Setpoint's own sentences, and a mail server's reply.
describe('a provider\'s trouble in a sentence', () => {
  test.each([
    ['todoist', 'Scheduled maintenance (503 Service Unavailable)', 'Todoist is down (scheduled maintenance)', '503 Service Unavailable'],
    ['todoist', '503 Service Unavailable', 'Todoist is down', '503 Service Unavailable'],
    ['google_calendar', 'Service Unavailable (503 Service Unavailable)', 'Google Calendar is down', '503 Service Unavailable'],
    ['google_calendar', 'Rate Limit Exceeded (429 Too Many Requests)', 'Google Calendar is limiting requests (rate limit exceeded)', '429 Too Many Requests'],
    ['todoist', 'Not Found (404 Not Found)', 'Todoist is refusing Setpoint', '404 Not Found'],
    [null, 'Backend Error (500 Internal Server Error)', 'The provider is down (backend error)', '500 Internal Server Error'],
    ['google_calendar', 'The calendar is read-only. (403 Forbidden)', 'The calendar is read-only', '403 Forbidden'],
    ['google_calendar', 'Request had insufficient authentication scopes. Reconnect this Google account in Settings › Accounts to allow colour changes. (403 Forbidden)',
      'Request had insufficient authentication scopes. Reconnect this Google account in Settings › Accounts to allow colour changes', '403 Forbidden'],
    ['todoist', 'Todoist didn\'t answer in time.', 'Todoist didn\'t answer in time', null],
    ['todoist', 'Couldn\'t reach Todoist (ENOTFOUND).', 'Couldn\'t reach Todoist', 'ENOTFOUND'],
    ['gmail', 'Token has been expired or revoked. (invalid_grant)', 'Token has been expired or revoked', 'invalid_grant'],
    ['weather', 'Pirate Weather answered 500 Internal Server Error.', 'Pirate Weather answered 500 Internal Server Error', null],
    ['gmail', '550 5.1.1 <sam@example.com>: Recipient address rejected: User unknown', '550 5.1.1 <sam@example.com>: Recipient address rejected: User unknown', null],
    ['gmail', 'fetch failed', 'Fetch failed', null],
  ] as const)('%s, %s', (provider, message, line, code) => {
    expect(troubleLine(provider, message)).toBe(line);
    expect(splitProviderMessage(message).code).toBe(code);
  });

  test('a row\'s tip carries the code after the words', () => {
    expect(withCode('Todoist is down (scheduled maintenance)', 'Scheduled maintenance (503 Service Unavailable)')).toBe('Todoist is down (scheduled maintenance) · 503 Service Unavailable');
    expect(withCode('Todoist didn\'t answer in time', 'Todoist didn\'t answer in time.')).toBe('Todoist didn\'t answer in time');
  });
});

describe('a refused change, beside it', () => {
  test.each([
    ['google_calendar', 'The calendar is read-only. (403 Forbidden)', 'The calendar is read-only.'],
    ['todoist', 'Scheduled maintenance (503 Service Unavailable)', 'Todoist is down (scheduled maintenance).'],
    ['todoist', null, 'It wasn’t created.'],
  ] as const)('%s, %s', (provider, message, words) => expect(refusalWords(provider, message, 'It wasn’t created.')).toBe(words));
});

describe('a failure line: what failed, then why', () => {
  test.each([
    ['Can’t reach Setpoint', 'Failed to pin, can’t reach Setpoint'],
    ['No such calendar.', 'Failed to pin, no such calendar'],
    ['Setpoint couldn\'t send it.', 'Failed to pin, Setpoint couldn\'t send it'],
    ['Todoist is down (scheduled maintenance).', 'Failed to pin, Todoist is down (scheduled maintenance)'],
    ['JD text was empty.', 'Failed to pin, JD text was empty'],
  ] as const)('%s', (why, line) => expect(failureText('Failed to pin', why)).toBe(line));
});

describe('a change waiting to try again', () => {
  const command = {state: 'pending', provider: 'todoist', provider_message: 'Scheduled maintenance (503 Service Unavailable)'} as const;
  test('as of its latest try', () => {
    expect(retryingLine({...command, retry: {failed_at: '2026-11-18T03:26:59.000Z', next_at: '2026-11-18T03:32:07.000Z'}}, 'America/Los_Angeles'))
      .toBe('Todoist is down (scheduled maintenance) as of 7:26 PM');
  });

  test('says nothing while on its way, or once settled', () => {
    expect(retryingLine({...command, provider_message: null, retry: null}, 'America/Los_Angeles')).toBeNull();
    expect(retryingLine({...command, state: 'failed', retry: null}, 'America/Los_Angeles')).toBeNull();
  });
});
