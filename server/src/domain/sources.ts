// What each provider is, how it's shown and how often it's checked by default (DESIGN.md ›
// Settings › Accounts: "Gmail · Push", "iCloud · IMAP every 2 min", "Polling every 5 min",
// "Every 30 min"). A push source's interval is the sweep behind its push.
import type {SourceProvider, SyncMode} from '@setpoint/shared';

export const PROVIDER_NAMES: Record<SourceProvider, string> = {
  gmail: 'Gmail', icloud: 'iCloud', google_calendar: 'Google Calendar', todoist: 'Todoist', weather: 'Weather',
};

export const DEFAULT_SCHEDULES: Record<SourceProvider, {mode: SyncMode; intervalSeconds: number}> = {
  gmail: {mode: 'push', intervalSeconds: 5 * 60},
  icloud: {mode: 'poll', intervalSeconds: 2 * 60},
  google_calendar: {mode: 'push', intervalSeconds: 15 * 60},
  todoist: {mode: 'poll', intervalSeconds: 5 * 60},
  weather: {mode: 'poll', intervalSeconds: 30 * 60},
};
