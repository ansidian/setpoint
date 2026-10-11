// Health and states' words as tables: the reconnect bar, the stale and failing lines, triage's
// note, and Settings › Accounts' states and sync lines.
import type {HealthOut, SourceOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {asOf, calendarHealthLines, healthLine, inboxHealthLines, listOf, reconnectLine, sourceState, syncLine, triageNote} from '../src/logic/health.ts';

const now = Date.parse(SEED_NOW);
const zone = SEED_TIME_ZONE;
const health = (fields: Partial<HealthOut>): HealthOut => ({state: 'healthy', as_of: null, reason: null, last_check_at: null, ...fields});
const YESTERDAY_914 = '2026-10-07T04:14:00.000Z';
const TODAY_840 = '2026-10-07T15:40:00.000Z';

describe('health and states', () => {
  test.each([
    [TODAY_840, '8:40 AM'], [YESTERDAY_914, '9:14 PM'], ['2026-10-05T17:00:00.000Z', 'Oct 5, 10:00 AM'],
  ])('as of %s reads %s', (at, text) => expect(asOf(at, now, zone)).toBe(text));

  test.each([
    [[], ''], [['Business'], 'Business'], [['Business', 'Work'], 'Business and Work'], [['Business', 'Work', 'Jobs'], 'Business, Work and Jobs'],
  ])('%j as a list: %s', (names, text) => expect(listOf(names)).toBe(text));

  test.each([
    [[], null],
    [[{label: 'Business', health: health({state: 'needs_reconnect'})}, {label: 'Personal', health: health({state: 'stale'})}], 'Business needs sign-in'],
    [[{label: 'Business', health: health({state: 'needs_reconnect'})}, {label: 'Work', health: health({state: 'needs_reconnect'})}], 'Business and Work need sign-in'],
  ])('the reconnect bar for %j', (accounts, line) => expect(reconnectLine(accounts)).toBe(line));

  test.each([
    ['healthy', health({last_check_at: TODAY_840}), null],
    ['needs reconnect (its bar says so)', health({state: 'needs_reconnect'}), null],
    ['stale', health({state: 'stale', as_of: YESTERDAY_914}), {state: 'stale', text: 'Personal, as of 9:14 PM'}],
    ['stale, never checked', health({state: 'stale'}), {state: 'stale', text: 'Personal, not checked yet'}],
    ['failing', health({state: 'failing', as_of: TODAY_840, reason: 'Gmail answered 503.'}), {state: 'failing', text: 'Personal, as of 8:40 AM, Gmail answered 503.'}],
  ] as const)('the line for %s', (_, value, line) => expect(healthLine('Personal', value, now, zone)).toEqual(line));

  test('the Inbox lists each stale or failing account in order', () => {
    expect(inboxHealthLines([
      {label: 'Business', health: health({state: 'needs_reconnect'})},
      {label: 'Personal', health: health({state: 'stale', as_of: YESTERDAY_914})},
      {label: 'iCloud', health: health({state: 'failing', as_of: TODAY_840, reason: 'IMAP said no.'})},
    ], now, zone).map(line => line.text)).toEqual(['Personal, as of 9:14 PM', 'iCloud, as of 8:40 AM, IMAP said no.']);
  });

  // SV-20: the calendar's right pane, its sources' lines in order; Google Calendar's accounts as one, the worst.
  const source = (id: number, provider: SourceOut['provider'], fields: Partial<HealthOut>): SourceOut => ({
    id, provider, account_id: null, name: provider, sync: {mode: 'poll', interval_seconds: 300, push_renews_at: null}, health: health(fields), has_credentials: true, dev: false,
  });
  test.each([
    ['every source healthy', [source(1, 'google_calendar', {}), source(2, 'todoist', {}), source(3, 'weather', {})], []],
    ['none at all', [], []],
    ['Todoist stale (board 19b)', [source(1, 'google_calendar', {}), source(2, 'todoist', {state: 'stale', as_of: TODAY_840}), source(3, 'weather', {})], ['stale Todoist, as of 8:40 AM']],
    ['one Google account failing, the other healthy', [source(1, 'google_calendar', {}), source(4, 'google_calendar', {state: 'failing', as_of: TODAY_840, reason: 'Backend Error (503 Service Unavailable)'})],
      ['failing Google Calendar, as of 8:40 AM, Backend Error (503 Service Unavailable)']],
    ['weather failing, Google Calendar stale, a mail source ignored', [
      source(3, 'weather', {state: 'failing', as_of: TODAY_840, reason: 'Pirate Weather answered 500 Internal Server Error.'}), source(1, 'google_calendar', {state: 'stale', as_of: YESTERDAY_914}),
      source(5, 'gmail', {state: 'stale', as_of: YESTERDAY_914}),
    ], ['stale Google Calendar, as of 9:14 PM', 'failing Weather, as of 8:40 AM, Pirate Weather answered 500 Internal Server Error.']],
    ['Google Calendar needing sign-in has no line here (Settings and the Inbox say so)', [source(1, 'google_calendar', {state: 'needs_reconnect'})], []],
  ] as const)('the calendar\'s lines: %s', (_, sources, lines) => {
    expect(calendarHealthLines([...sources], now, zone).map(line => `${line.state} ${line.text}`)).toEqual(lines);
  });

  test.each([
    [undefined, null],
    [{state: 'healthy', as_of: TODAY_840}, null],
    [{state: 'down', as_of: '2026-10-07T16:09:00.000Z'}, 'Triage is down, as of 9:09 AM'],
    [{state: 'down', as_of: null}, 'Triage is down'],
  ] as const)('triage %j notes %s', (triage, note) => expect(triageNote(triage, now, zone)).toBe(note));

  test.each([
    [health({state: 'healthy', last_check_at: '2026-10-07T16:11:00.000Z'}), {tone: 'muted', text: 'Checked 9:11 AM', reconnect: false}],
    [health({state: 'healthy'}), {tone: 'muted', text: 'Not checked yet', reconnect: false}],
    [health({state: 'stale', as_of: YESTERDAY_914}), {tone: 'muted', text: 'Checks stopped, as of 9:14 PM', reconnect: false}],
    [health({state: 'failing', reason: 'Gmail answered 503.'}), {tone: 'caution', text: 'Gmail answered 503.', reconnect: false}],
    [health({state: 'needs_reconnect', reason: 'invalid_grant'}), {tone: 'caution', text: 'Needs sign-in', reconnect: true}],
  ])('Settings › Accounts writes %j as %j', (value, state) => expect(sourceState(value, now, zone)).toEqual(state));

  test.each([
    ['gmail', 'push', 300, null, 'Gmail · Push'],
    ['icloud', 'poll', 120, null, 'iCloud · IMAP every 2 min'],
    ['google_calendar', 'push', 900, '2026-10-09T16:00:00.000Z', 'Push · watch renews Oct 9'],
    ['todoist', 'poll', 300, null, 'Polling every 5 min'],
    ['weather', 'poll', 1800, null, 'Every 30 min'],
    ['weather', 'poll', 3600, null, 'Every hour'],
  ] as const)('%s (%s every %i s) syncs: %s', (provider, mode, interval, renews, line) =>
    expect(syncLine({provider, sync: {mode, interval_seconds: interval, push_renews_at: renews}}, zone)).toBe(line));
});
