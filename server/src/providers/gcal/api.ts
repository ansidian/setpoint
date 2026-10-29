// Google Calendar's REST API (v3) over plain fetch, for one Google account. Harvested from v1's
// `calendar-google-client` (googleCalendarFetch): a bearer token per call, a 30-second limit, and
// Google's error envelope read for its own words and reason. v2 shows those words as they are
// ("The requested event was modified by another client. (409 Conflict)"), where v1 swapped in its
// own; and v1's 403 lumping (auth and rate limits alike) is split by reason.
import type {AdapterContext} from '../../sync/adapter.ts';
import {ProviderError} from '../../sync/errors.ts';
import type {GoogleTokens} from '../google/auth.ts';
import {requestJson, reasonPhrase} from '../http.ts';
import type {HttpOptions, Refusal} from '../http.ts';

export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
export const CALENDAR_TIMEOUT_MS = 30_000;

// null clears a field in a patch: Google merges start and end into what they were (SV-117).
export type EventTime = {dateTime?: string | null; date?: string | null; timeZone?: string | null};

/** The parts of Google's Event resource Setpoint reads and writes. */
export interface GoogleEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: EventTime;
  end?: EventTime;
  recurrence?: string[];
  recurringEventId?: string;
  originalStartTime?: EventTime;
  attendees?: {email?: string; displayName?: string; self?: boolean; resource?: boolean; responseStatus?: string}[];
  reminders?: {useDefault?: boolean; overrides?: {method?: string; minutes?: number}[]};
  eventType?: string;
  updated?: string;
  // "1" … "11", Google's event colours (F6).
  colorId?: string | null;
  // SV-31: Setpoint's own flags (normalize.ts's LEAVE_PROPERTY).
  extendedProperties?: {private?: Record<string, string>; shared?: Record<string, string>};
}

export interface GoogleCalendarEntry {
  id: string;
  summary?: string;
  summaryOverride?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  accessRole?: string;
  primary?: boolean;
  selected?: boolean;
  hidden?: boolean;
  deleted?: boolean;
  defaultReminders?: {method?: string; minutes?: number}[];
  timeZone?: string;
}

export interface EventsPage {
  items?: GoogleEvent[];
  nextPageToken?: string;
  nextSyncToken?: string;
  defaultReminders?: {method?: string; minutes?: number}[];
  timeZone?: string;
}

export interface WatchAnswer {
  id: string;
  resourceId: string;
  resourceUri?: string;
  expiration?: string;
}

export interface CalendarApiOptions extends HttpOptions {
  baseUrl?: string;
}

// Google's reasons for a 403 that waiting fixes, and for a 403 only a new consent fixes.
const RATE_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded']);
const SCOPE_REASONS = new Set(['insufficientPermissions', 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'authError']);

/** Google's error envelope: `{error: {code, message, errors: [{reason}], status}}`. */
export function readGoogleRefusal(status: number, text: string): Refusal & {reason: string | null} {
  let message: string | null = null;
  let reason: string | null = null;
  try {
    const parsed = JSON.parse(text) as {error?: {message?: string; status?: string; errors?: {reason?: string}[]; details?: {reason?: string}[]}};
    message = parsed.error?.message?.trim() || null;
    reason = parsed.error?.errors?.[0]?.reason ?? parsed.error?.details?.[0]?.reason ?? parsed.error?.status ?? null;
  } catch {
    // Not Google's envelope (a proxy's page): the status alone.
  }
  const words = `${message ?? reasonPhrase(status)} (${status} ${reasonPhrase(status)})`;
  if (status === 403 && reason && RATE_REASONS.has(reason)) return {message: words, kind: 'rate_limited', reason};
  if (status === 403 && reason && SCOPE_REASONS.has(reason)) return {message: words, kind: 'auth', reason};
  return {message: words, reason};
}

/** A sync token Google no longer takes: a full sync is due. */
export const isSyncTokenGone = (error: unknown) => error instanceof ProviderError && error.status === 410;
export const isNotFound = (error: unknown) => error instanceof ProviderError && (error.status === 404 || error.status === 410);
export const isAlreadyThere = (error: unknown) => error instanceof ProviderError && error.status === 409 && /already exists/i.test(error.message);

/** Calendar for one source: its own copy of the account's Google consent (src/providers/google/auth.ts). */
export class GoogleCalendarApi {
  private readonly options: CalendarApiOptions;
  private readonly tokens: GoogleTokens;
  private readonly context: AdapterContext;

  constructor(options: CalendarApiOptions, tokens: GoogleTokens, context: AdapterContext) {
    this.options = {timeoutMs: CALENDAR_TIMEOUT_MS, ...options};
    this.tokens = tokens;
    this.context = context;
  }

  get baseUrl() {
    return (this.options.baseUrl ?? CALENDAR_API).replace(/\/+$/, '');
  }

  private async call<T>(method: string, path: string, {query, body, headers}: {query?: Record<string, string | undefined>; body?: unknown; headers?: Record<string, string>} = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}/${path}`);
    for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined) url.searchParams.set(key, value);
    const send = async (force: boolean) => requestJson<T>(this.options, {
      method, url: url.href, body, signal: this.context.signal,
      headers: {authorization: `Bearer ${await this.tokens.accessToken(this.context, force)}`, ...headers},
    }, readGoogleRefusal, 'Google Calendar');
    try {
      return await send(false);
    } catch (error) {
      // An access token Google stopped taking early: refresh once before calling it a reconnect.
      if (error instanceof ProviderError && error.status === 401) return send(true);
      throw error;
    }
  }

  async calendarList(): Promise<GoogleCalendarEntry[]> {
    const entries: GoogleCalendarEntry[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.call<{items?: GoogleCalendarEntry[]; nextPageToken?: string}>('GET', 'users/me/calendarList', {query: {pageToken, maxResults: '250', showHidden: 'true'}});
      entries.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return entries;
  }

  /**
   * One sync of a calendar's events, every page: incremental from `syncToken`, or a full read from
   * `timeMin`. Masters and their exceptions (singleEvents off), deleted ones included. No orderBy:
   * Google leaves out nextSyncToken when it's set (v1, 47e21fd7).
   */
  async events(calendarId: string, from: {syncToken: string} | {timeMin: string}): Promise<{items: GoogleEvent[]; nextSyncToken: string | null; defaultReminders: number[]; timeZone: string | null}> {
    const items: GoogleEvent[] = [];
    let pageToken: string | undefined;
    let nextSyncToken: string | null = null;
    let defaultReminders: number[];
    let timeZone: string | null = null;
    do {
      const page = await this.call<EventsPage>('GET', `calendars/${encodeURIComponent(calendarId)}/events`, {
        query: {
          ...('syncToken' in from ? {syncToken: from.syncToken} : {timeMin: from.timeMin}),
          singleEvents: 'false', showDeleted: 'true', maxResults: '2500', pageToken,
        },
      });
      items.push(...(page.items ?? []));
      defaultReminders = (page.defaultReminders ?? []).flatMap(reminder => (typeof reminder.minutes === 'number' ? [reminder.minutes] : []));
      timeZone = page.timeZone ?? timeZone;
      pageToken = page.nextPageToken;
      nextSyncToken = page.nextSyncToken ?? nextSyncToken;
    } while (pageToken);
    return {items, nextSyncToken, defaultReminders, timeZone};
  }

  /** A recurring event's occurrences in a window, as Google expands them. */
  async instances(calendarId: string, eventId: string, query: {timeMin?: string; timeMax?: string; originalStart?: string}): Promise<GoogleEvent[]> {
    const items: GoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.call<EventsPage>('GET', `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/instances`, {
        query: {...query, showDeleted: 'true', maxResults: '2500', pageToken},
      });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return items;
  }

  /**
   * SV-20: the user's own colour for a calendar (their calendar list entry, not the calendar), as RGB:
   * Google keeps the colour as given and sets its nearest colorId itself. Needs the
   * calendar.calendarlist scope.
   */
  patchCalendarListEntry(calendarId: string, body: {backgroundColor: string; foregroundColor: string}): Promise<GoogleCalendarEntry> {
    return this.call('PATCH', `users/me/calendarList/${encodeURIComponent(calendarId)}`, {query: {colorRgbFormat: 'true'}, body});
  }

  getEvent(calendarId: string, eventId: string): Promise<GoogleEvent> {
    return this.call('GET', `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`);
  }

  insertEvent(calendarId: string, body: Partial<GoogleEvent>): Promise<GoogleEvent> {
    return this.call('POST', `calendars/${encodeURIComponent(calendarId)}/events`, {body});
  }

  /** A field-level change; `etag` (what Setpoint last saw) makes Google refuse it if the event changed since. */
  patchEvent(calendarId: string, eventId: string, body: Partial<GoogleEvent>, etag?: string | null): Promise<GoogleEvent> {
    return this.call('PATCH', `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {body, headers: etag ? {'if-match': etag} : {}});
  }

  /**
   * events.move: the event (a single one, or a whole series) to another calendar of the account,
   * keeping its id. Not idempotent: a retry after a lost answer finds it gone from `calendarId`.
   */
  moveEvent(calendarId: string, eventId: string, destination: string, etag?: string | null): Promise<GoogleEvent> {
    return this.call('POST', `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/move`, {query: {destination}, headers: etag ? {'if-match': etag} : {}});
  }

  async deleteEvent(calendarId: string, eventId: string, etag?: string | null): Promise<void> {
    await this.call('DELETE', `calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, {headers: etag ? {'if-match': etag} : {}});
  }

  watch(calendarId: string, body: {id: string; type: 'web_hook'; address: string; token: string; expiration: string; params: {ttl: string}}): Promise<WatchAnswer> {
    return this.call('POST', `calendars/${encodeURIComponent(calendarId)}/events/watch`, {body});
  }

  async stopChannel(id: string, resourceId: string): Promise<void> {
    await this.call('POST', 'channels/stop', {body: {id, resourceId}});
  }
}
