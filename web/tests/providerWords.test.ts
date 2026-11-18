import {describe, expect, test} from 'vitest';
import {retryingLine, troubleLine} from '../src/logic/providerWords.ts';

describe('a provider\'s trouble in a sentence', () => {
  test.each([
    ['todoist', 'Scheduled maintenance (503 Service Unavailable)', 'Todoist is down (scheduled maintenance)'],
    ['todoist', '503 Service Unavailable', 'Todoist is down'],
    ['google_calendar', 'Rate Limit Exceeded (429 Too Many Requests)', 'Google Calendar is limiting requests (rate Limit Exceeded)'],
    ['google_calendar', 'The calendar is read-only. (403 Forbidden)', 'Google Calendar is refusing Setpoint (the calendar is read-only)'],
    ['gmail', 'fetch failed', 'Gmail can\'t be reached (fetch failed)'],
    [null, 'Backend Error (500 Internal Server Error)', 'The provider is down (backend Error)'],
  ] as const)('%s, %s', (provider, message, line) => {
    expect(troubleLine(provider, message)).toBe(line);
  });
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
