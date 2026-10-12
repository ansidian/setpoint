// Health and states (DESIGN.md › Health and states; BRIEF.md › Health and states), as the lines
// and words they show. Healthy shows nothing. Needs reconnect is a bar at the top of the Inbox;
// stale is a muted line, failing the same line in `caution` with the provider's reason; triage down
// notes the Unsorted group. Settings › Accounts says each source's state on its row, and the
// calendar's right pane has its own sources' lines (SV-20).
import type {AccountOut, HealthOut, SourceOut, TriageStatusOut} from '@setpoint/shared';
import {clockTime, readerTime} from './format.ts';
import {mergeSources} from './settings.ts';

const DAY = 24 * 60 * 60 * 1000;

/** "9:14 PM" within the last day (as boards 17 and 19a write yesterday evening), else "Oct 5, 9:14 PM". */
export function asOf(at: string, now: number, timeZone: string): string {
  return now - Date.parse(at) < DAY ? clockTime(at, timeZone) : readerTime(at, now, timeZone);
}

/** "Business", "Business and Work", "Business, Work and Jobs". */
export function listOf(names: string[]): string {
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** The Inbox's needs-reconnect bar: "Business needs sign-in", or null. */
export function reconnectLine(accounts: Pick<AccountOut, 'label' | 'health'>[]): string | null {
  const names = accounts.filter(account => account.health.state === 'needs_reconnect').map(account => account.label);
  if (!names.length) return null;
  return `${listOf(names)} ${names.length === 1 ? 'needs' : 'need'} sign-in`;
}

export interface HealthLine {
  state: 'stale' | 'failing';
  text: string;
}

/** "Personal, as of 9:14 PM" (stale), "Personal, as of 9:14 PM, <reason>" (failing); nothing for healthy. Status lines take commas (D50). */
export function healthLine(name: string, health: HealthOut, now: number, timeZone: string): HealthLine | null {
  if (health.state !== 'stale' && health.state !== 'failing') return null;
  const since = health.as_of ? `as of ${asOf(health.as_of, now, timeZone)}` : 'not checked yet';
  const reason = health.state === 'failing' && health.reason ? `, ${health.reason}` : '';
  return {state: health.state, text: `${name}, ${since}${reason}`};
}

/** The Inbox's stale and failing lines, one per mail account, in the accounts' order. */
export function inboxHealthLines(accounts: Pick<AccountOut, 'label' | 'health'>[], now: number, timeZone: string): HealthLine[] {
  return accounts.flatMap(account => healthLine(account.label, account.health, now, timeZone) ?? []);
}

// The calendar's sources, in the order their lines show, by the names Settings › Accounts gives them.
const CALENDAR_SOURCES = [['google_calendar', 'Google Calendar'], ['todoist', 'Todoist'], ['weather', 'Weather']] as const;

/**
 * SV-20: the calendar's right pane lines (board 19b's "Todoist, as of 8:40 AM"), stale or failing,
 * for Google Calendar (its accounts' sources as one, the worst, as Settings › Accounts shows it),
 * Todoist and Weather.
 */
export function calendarHealthLines(sources: SourceOut[], now: number, timeZone: string): HealthLine[] {
  return CALENDAR_SOURCES.flatMap(([provider, name]) => {
    const source = mergeSources(sources.filter(one => one.provider === provider));
    return (source && healthLine(name, source.health, now, timeZone)) ?? [];
  });
}

/** The Unsorted group's note: "Triage is down, as of 9:09 AM", or null while triage works. */
export function triageNote(triage: Pick<TriageStatusOut, 'state' | 'as_of'> | undefined, now: number, timeZone: string): string | null {
  if (!triage || triage.state !== 'down') return null;
  return triage.as_of ? `Triage is down, as of ${asOf(triage.as_of, now, timeZone)}` : 'Triage is down';
}

/**
 * Which glyph a Settings row's state leads with (the polish audit's settings-01, states-04): a `good`
 * dot when checked, `history` when checks stopped, `warning` when failing, `sync_problem` when it
 * needs sign-in; nothing before a first check.
 */
export type HealthKind = HealthOut['state'] | null;

/** The state Settings › Accounts writes on a source's row. */
export interface SourceState {
  tone: 'muted' | 'caution';
  text: string;
  reconnect: boolean;
  kind: HealthKind;
}

export function sourceState(health: HealthOut, now: number, timeZone: string): SourceState {
  switch (health.state) {
    case 'needs_reconnect':
      return {tone: 'caution', text: 'Needs sign-in', reconnect: true, kind: 'needs_reconnect'};
    case 'stale':
      return {tone: 'muted', text: health.as_of ? `Checks stopped, as of ${asOf(health.as_of, now, timeZone)}` : 'Checks stopped', reconnect: false, kind: 'stale'};
    case 'failing':
      return {tone: 'caution', text: health.reason ?? 'Failing', reconnect: false, kind: 'failing'};
    case 'healthy':
      return health.last_check_at
        ? {tone: 'muted', text: `Checked ${asOf(health.last_check_at, now, timeZone)}`, reconnect: false, kind: 'healthy'}
        : {tone: 'muted', text: 'Not checked yet', reconnect: false, kind: null};
  }
}

/** How often, as Settings words it: "5 min", "hour", "2 hours". */
export const every = (seconds: number) => (seconds === 3600 ? 'hour' : seconds % 3600 === 0 ? `${seconds / 3600} hours` : `${Math.round(seconds / 60)} min`);
const monthDay = (at: string, timeZone: string) => new Date(at).toLocaleDateString('en-US', {timeZone, month: 'short', day: 'numeric'});

/**
 * How a source syncs (board 17): "Gmail · Push", "iCloud · IMAP every 2 min", "Push · watch renews
 * Oct 9", "Polling every 5 min", "Every 30 min".
 */
export function syncLine(source: Pick<SourceOut, 'provider' | 'sync'>, timeZone: string): string {
  const {mode, interval_seconds: interval, push_renews_at: renews} = source.sync;
  switch (source.provider) {
    case 'gmail':
      return mode === 'push' ? 'Gmail · Push' : `Gmail · every ${every(interval)}`;
    case 'icloud':
      return `iCloud · IMAP every ${every(interval)}`;
    case 'google_calendar':
      return mode === 'push' ? (renews ? `Push · watch renews ${monthDay(renews, timeZone)}` : 'Push') : `Polling every ${every(interval)}`;
    case 'todoist':
      return `Polling every ${every(interval)}`;
    case 'weather':
      return `Every ${every(interval)}`;
  }
}
