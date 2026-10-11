// A fake Google on 127.0.0.1: OAuth's token endpoint, Calendar v3 (calendar list and its colours, events with sync
// tokens, instances, insert/patch/delete with etags, watch channels), Places (New) autocomplete and
// Routes. It answers in Google's shapes and with Google's errors: 401 for a token it didn't issue,
// invalid_grant for a revoked refresh token, 409 for an id that exists, 410 for a sync token it
// dropped or an event already deleted, 412 when If-Match doesn't match, 400 for a calendar that
// can't be watched. Recurring series are expanded with Setpoint's own rule reader, which is what
// the tests compare against anyway.
import {occurrenceDates, parseRule} from '../../src/domain/recurrence.ts';
import {localDay, localTime, zonedInstant} from '../../src/domain/time.ts';
import type {GoogleCalendarEntry, GoogleEvent} from '../../src/providers/gcal/api.ts';
import {fakeServer, on} from './server.ts';
import type {FakeRequest, FakeResponse} from './server.ts';

const googleError = (code: number, message: string, reason: string, status?: string): FakeResponse => ({
  status: code, body: {error: {code, message, errors: [{domain: 'global', reason, message}], ...(status ? {status} : {})}},
});

/** Google's compact instance suffix: 20261007T140000Z, or 20261007 for a day. */
const compact = (originalStart: string) => (originalStart.includes('T') ? new Date(originalStart).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '') : originalStart.replace(/-/g, ''));

/** A few days either side of one occurrence (a date or an instant), so finding it doesn't expand a century. */
const around = (start: string): [string, string] => {
  const at = Date.parse(start.includes('T') ? start : `${start}T12:00:00Z`);
  return [new Date(at - 2 * 86_400_000).toISOString(), new Date(at + 2 * 86_400_000).toISOString()];
};

/** The occurrence a compact suffix names: 20261007T140000Z → 2026-10-07T14:00:00Z, 20261007 → 2026-10-07. */
const expandCompact = (suffix: string) => {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z)?$/.exec(suffix);
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match;
  return hour ? `${year}-${month}-${day}T${hour}:${minute}:${second}Z` : `${year}-${month}-${day}`;
};

type Stored = GoogleEvent & {seq: number};

export interface FakeCalendarOptions {
  // Events per page, to take the adapter through pageToken.
  pageSize?: number;
}

export async function fakeGoogle({pageSize = 50}: FakeCalendarOptions = {}) {
  let seq = 0;
  let issued = 0;
  // Access tokens to the refresh token (the Google account) they were issued for.
  const accessTokens = new Map<string, string>();
  const refreshTokens = new Set<string>(['refresh-personal', 'refresh-work']);
  const calendars: (GoogleCalendarEntry & {timeZone: string})[] = [];
  // A calendar on only some accounts' lists, by refresh token; every account lists the others.
  const listedFor = new Map<string, string[]>();
  const events = new Map<string, Map<string, Stored>>();
  // Sync tokens Google has dropped (a 410 next time).
  const droppedTokens = new Set<string>();
  const channels: {id: string; calendarId: string; address: string; token: string; resourceId: string; expiration: number}[] = [];
  const stopped: {id: string; resourceId: string}[] = [];
  const placesKeys = new Set(['maps-key']);
  let places: {placeId: string; main: string; secondary: string; distanceMeters: number; radius: number; lat?: number; lng?: number}[] = [];
  let routes = new Map<string, {duration: string; distanceMeters: number}>();

  const nextEtag = () => `"${(seq += 1)}"`;
  const calendarEvents = (id: string) => {
    let list = events.get(id);
    if (!list) events.set(id, (list = new Map()));
    return list;
  };
  const authorized = (request: FakeRequest) => accessTokens.has((request.headers.authorization ?? '').replace(/^Bearer /, ''));
  const unauthorized = () => googleError(401, 'Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.', 'authError', 'UNAUTHENTICATED');
  const store = (calendarId: string, event: GoogleEvent, keepEtag = false): Stored => {
    const etag = keepEtag && event.etag ? event.etag : nextEtag();
    const stored: Stored = {status: 'confirmed', eventType: 'default', ...event, etag, seq: keepEtag ? (seq += 1) : seq, updated: new Date().toISOString()};
    calendarEvents(calendarId).set(event.id, stored);
    return stored;
  };
  const publicEvent = ({seq: _seq, ...event}: Stored): GoogleEvent => event;

  /** A series' occurrences (its exceptions in their place), within [timeMin, timeMax). */
  const instancesOf = (calendarId: string, master: Stored, timeMin: string, timeMax: string): GoogleEvent[] => {
    const zone = master.start?.timeZone ?? calendars.find(calendar => calendar.id === calendarId)!.timeZone;
    const rule = parseRule(master.recurrence!.find(line => line.startsWith('RRULE:'))!, until => localDay(until, zone));
    if (!rule) return [];
    const allDay = Boolean(master.start?.date);
    const firstDay = allDay ? master.start!.date! : localDay(master.start!.dateTime!, zone);
    const exdates = new Set((master.recurrence ?? []).filter(line => line.startsWith('EXDATE')).flatMap(line => line.split(':')[1]!.split(',')));
    const length = allDay ? 0 : Date.parse(master.end!.dateTime!) - Date.parse(master.start!.dateTime!);
    const list: GoogleEvent[] = [];
    for (const date of occurrenceDates(rule, firstDay, localDay(timeMin, zone), localDay(timeMax, zone))) {
      const originalStart = allDay ? date : zonedInstant(date, localTime(master.start!.dateTime!, zone), zone);
      if (rule.untilAt && originalStart > rule.untilAt) continue;
      if (exdates.has(allDay ? date.replace(/-/g, '') : `${date.replace(/-/g, '')}T${localTime(master.start!.dateTime!, zone).replace(':', '')}00`)) continue;
      const id = `${master.id}_${compact(originalStart)}`;
      const exception = calendarEvents(calendarId).get(id);
      if (exception) {
        list.push(publicEvent(exception));
        continue;
      }
      list.push({
        ...publicEvent(master), id, etag: `"${master.etag!.replace(/"/g, '')}-${compact(originalStart)}"`, recurrence: undefined, recurringEventId: master.id,
        originalStartTime: allDay ? {date} : {dateTime: originalStart, timeZone: zone},
        start: allDay ? {date} : {dateTime: originalStart, timeZone: zone},
        end: allDay ? master.end : {dateTime: new Date(Date.parse(originalStart) + length).toISOString(), timeZone: zone},
      });
    }
    return list;
  };

  /** The stored event, or an occurrence of a series made into an exception when first written. */
  const findOrMaterialise = (calendarId: string, id: string): Stored | null => {
    const found = calendarEvents(calendarId).get(id);
    if (found) return found;
    const [masterId, suffix] = id.split('_');
    const master = masterId ? calendarEvents(calendarId).get(masterId) : undefined;
    if (!master?.recurrence || !suffix) return null;
    const start = expandCompact(suffix);
    if (!start) return null;
    const occurrence = instancesOf(calendarId, master, ...around(start)).find(instance => instance.id === id);
    return occurrence ? store(calendarId, occurrence, true) : null;
  };

  const ifMatch = (request: FakeRequest, event: Stored): FakeResponse | null => {
    const wanted = request.headers['if-match'];
    return wanted && wanted !== event.etag ? googleError(412, 'Precondition Failed', 'conditionNotMet') : null;
  };

  const server = await fakeServer([
    on('POST', /^\/token$/, request => {
      const form = request.body as Record<string, string>;
      if (form.grant_type !== 'refresh_token' || !form.client_id || !form.client_secret) return {status: 400, body: {error: 'invalid_request'}};
      if (!refreshTokens.has(form.refresh_token!)) return {status: 400, body: {error: 'invalid_grant', error_description: 'Token has been expired or revoked.'}};
      const token = `access-${(issued += 1)}`;
      accessTokens.set(token, form.refresh_token!);
      return {status: 200, body: {access_token: token, expires_in: 3599, scope: 'https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar.events', token_type: 'Bearer'}};
    }),
    on('GET', /^\/calendar\/v3\/users\/me\/calendarList$/, request => {
      if (!authorized(request)) return unauthorized();
      const account = accessTokens.get((request.headers.authorization ?? '').replace(/^Bearer /, ''))!;
      return {status: 200, body: {kind: 'calendar#calendarList', items: calendars.filter(entry => listedFor.get(entry.id)?.includes(account) ?? true)}};
    }),
    // calendarList.patch (SV-20): the user's colour for a calendar. RGB only with colorRgbFormat=true,
    // and then both colours, as Google asks.
    on('PATCH', /^\/calendar\/v3\/users\/me\/calendarList\/([^/]+)$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      const entry = calendars.find(calendar => calendar.id === decodeURIComponent(match[1]!));
      if (!entry) return googleError(404, 'Not Found', 'notFound');
      const body = request.body as Partial<GoogleCalendarEntry>;
      const hex = /^#[0-9a-f]{6}$/i;
      if (body.backgroundColor !== undefined || body.foregroundColor !== undefined) {
        if (request.query.get('colorRgbFormat') !== 'true') return googleError(400, 'Invalid Value', 'invalid');
        if (!hex.test(body.backgroundColor ?? '') || !hex.test(body.foregroundColor ?? '')) return googleError(400, 'Invalid Value', 'invalid');
      }
      Object.assign(entry, body);
      return {status: 200, body: {kind: 'calendar#calendarListEntry', ...entry}};
    }),
    on('GET', /^\/calendar\/v3\/calendars\/([^/]+)\/events$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      const calendarId = decodeURIComponent(match[1]!);
      const calendar = calendars.find(entry => entry.id === calendarId);
      if (!calendar) return googleError(404, 'Not Found', 'notFound');
      const syncToken = request.query.get('syncToken');
      if (syncToken && (droppedTokens.has(syncToken) || !/^sync-\d+$/.test(syncToken))) return googleError(410, 'Sync token is no longer valid, a full sync is required.', 'fullSyncRequired');
      const since = syncToken ? Number(syncToken.slice(5)) : -1;
      const timeMin = request.query.get('timeMin');
      const all = [...calendarEvents(calendarId).values()]
        .filter(event => event.seq > since)
        .filter(event => syncToken || event.status !== 'cancelled' || event.recurringEventId)
        .filter(event => !timeMin || event.recurrence || !event.end?.dateTime || event.end.dateTime > timeMin)
        .sort((a, b) => a.seq - b.seq);
      const offset = Number(request.query.get('pageToken') ?? 0);
      const page = all.slice(offset, offset + pageSize);
      const more = offset + pageSize < all.length;
      return {status: 200, body: {
        kind: 'calendar#events', timeZone: calendar.timeZone, defaultReminders: calendar.defaultReminders ?? [], items: page.map(publicEvent),
        ...(more ? {nextPageToken: String(offset + pageSize)} : {nextSyncToken: `sync-${seq}`}),
      }};
    }),
    on('GET', /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)\/instances$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      const calendarId = decodeURIComponent(match[1]!);
      const master = calendarEvents(calendarId).get(decodeURIComponent(match[2]!));
      if (!master?.recurrence) return googleError(404, 'Not Found', 'notFound');
      const originalStart = request.query.get('originalStart');
      const [nearFrom, nearTo] = originalStart ? around(originalStart) : ['2000-01-01T00:00:00.000Z', '2100-01-01T00:00:00.000Z'];
      const list = instancesOf(calendarId, master, request.query.get('timeMin') ?? nearFrom, request.query.get('timeMax') ?? nearTo);
      const items = originalStart ? list.filter(instance => (instance.originalStartTime?.dateTime ? Date.parse(instance.originalStartTime.dateTime) === Date.parse(originalStart) : instance.originalStartTime?.date === originalStart)) : list;
      return {status: 200, body: {kind: 'calendar#events', items}};
    }),
    on('GET', /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      const event = calendarEvents(decodeURIComponent(match[1]!)).get(decodeURIComponent(match[2]!));
      return event ? {status: 200, body: publicEvent(event)} : googleError(404, 'Not Found', 'notFound');
    }),
    on('POST', /^\/calendar\/v3\/calendars\/([^/]+)\/events$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      const calendarId = decodeURIComponent(match[1]!);
      const body = request.body as GoogleEvent;
      if (body.id && !/^[0-9a-v]{5,1024}$/.test(body.id)) return googleError(400, 'Invalid resource id value.', 'invalid');
      const id = body.id ?? `gen${(seq + 1).toString(32)}x`;
      if (calendarEvents(calendarId).has(id)) return googleError(409, 'The requested identifier already exists.', 'duplicate');
      return {status: 200, body: publicEvent(store(calendarId, {...body, id}))};
    }),
    on('PATCH', /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      const calendarId = decodeURIComponent(match[1]!);
      const event = findOrMaterialise(calendarId, decodeURIComponent(match[2]!));
      if (!event) return googleError(404, 'Not Found', 'notFound');
      const refused = ifMatch(request, event);
      if (refused) return refused;
      return {status: 200, body: publicEvent(store(calendarId, {...publicEvent(event), ...(request.body as GoogleEvent)}))};
    }),
    on('DELETE', /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      const calendarId = decodeURIComponent(match[1]!);
      const event = findOrMaterialise(calendarId, decodeURIComponent(match[2]!));
      if (!event) return googleError(404, 'Not Found', 'notFound');
      if (event.status === 'cancelled') return googleError(410, 'Resource has been deleted', 'deleted');
      const refused = ifMatch(request, event);
      if (refused) return refused;
      store(calendarId, {...publicEvent(event), status: 'cancelled'});
      return {status: 204};
    }),
    // events.move: a single event or a whole series (its exceptions with it), never one occurrence.
    on('POST', /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)\/move$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      const calendarId = decodeURIComponent(match[1]!);
      const id = decodeURIComponent(match[2]!);
      const destination = request.query.get('destination') ?? '';
      const event = calendarEvents(calendarId).get(id);
      if (!event || event.status === 'cancelled') return googleError(404, 'Not Found', 'notFound');
      if (event.recurringEventId) return googleError(400, 'Cannot change the organizer of an instance.', 'cannotChangeOrganizerOfInstance');
      if (!calendars.some(calendar => calendar.id === destination)) return googleError(404, 'Not Found', 'notFound');
      const there = calendarEvents(destination).get(id);
      if (there && there.status !== 'cancelled') return googleError(409, 'The requested identifier already exists.', 'duplicate');
      const refused = ifMatch(request, event);
      if (refused) return refused;
      for (const one of [...calendarEvents(calendarId).values()].filter(other => other.id === id || other.recurringEventId === id)) {
        store(destination, publicEvent(one));
        // The source calendar's sync sees it go.
        store(calendarId, {...publicEvent(one), status: 'cancelled'});
      }
      return {status: 200, body: publicEvent(calendarEvents(destination).get(id)!)};
    }),
    on('POST', /^\/calendar\/v3\/calendars\/([^/]+)\/events\/watch$/, (request, match) => {
      if (!authorized(request)) return unauthorized();
      const calendarId = decodeURIComponent(match[1]!);
      if (/#holiday@/.test(calendarId)) return googleError(400, 'Push notifications are not supported by this resource.', 'pushNotSupportedForRequestedResource');
      const body = request.body as {id: string; address: string; token: string; expiration: string};
      const channel = {id: body.id, calendarId, address: body.address, token: body.token, resourceId: `resource-${channels.length + 1}`, expiration: Number(body.expiration)};
      channels.push(channel);
      return {status: 200, body: {
        kind: 'api#channel', id: channel.id, resourceId: channel.resourceId, expiration: String(channel.expiration),
        resourceUri: `${server.url}/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?alt=json`,
      }};
    }),
    on('POST', /^\/calendar\/v3\/channels\/stop$/, request => {
      if (!authorized(request)) return unauthorized();
      stopped.push(request.body as {id: string; resourceId: string});
      return {status: 204};
    }),
    on('POST', /^\/v1\/places:autocomplete$/, request => {
      if (!placesKeys.has(request.headers['x-goog-api-key'] as string)) return googleError(403, 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID', 'PERMISSION_DENIED');
      const body = request.body as {locationRestriction?: {circle: {radius: number}}};
      const radius = body.locationRestriction?.circle.radius ?? Infinity;
      return {status: 200, body: {suggestions: places.filter(place => place.radius <= radius).map(place => ({placePrediction: {
        placeId: place.placeId, text: {text: `${place.main}, ${place.secondary}`}, distanceMeters: place.distanceMeters,
        structuredFormat: {mainText: {text: place.main}, secondaryText: {text: place.secondary}},
      }}))}};
    }),
    on('GET', /^\/v1\/places\/([^/?]+)$/, (request, match) => {
      if (!placesKeys.has(request.headers['x-goog-api-key'] as string)) return googleError(403, 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID', 'PERMISSION_DENIED');
      const place = places.find(one => one.placeId === decodeURIComponent(match[1]!));
      if (!place) return googleError(404, 'Requested entity was not found.', 'NOT_FOUND', 'NOT_FOUND');
      return {status: 200, body: {id: place.placeId, displayName: {text: place.main}, formattedAddress: place.secondary, location: {latitude: place.lat ?? 34, longitude: place.lng ?? -118}}};
    }),
    on('POST', /^\/directions\/v2:computeRoutes$/, request => {
      if (!placesKeys.has(request.headers['x-goog-api-key'] as string)) return googleError(403, 'API key not valid. Please pass a valid API key.', 'API_KEY_INVALID', 'PERMISSION_DENIED');
      const route = routes.get((request.body as {destination: {address: string}}).destination.address);
      return {status: 200, body: route ? {routes: [route]} : {}};
    }),
  ]);

  return {
    ...server,
    tokenUrl: `${server.url}/token`,
    calendarApi: `${server.url}/calendar/v3`,
    channels, stopped,
    /** A calendar on every account's list, or only on those of `accounts` (refresh tokens). */
    addCalendar(entry: GoogleCalendarEntry & {timeZone?: string}, accounts?: string[]) {
      calendars.push({timeZone: 'America/Los_Angeles', accessRole: 'owner', ...entry});
      if (accounts) listedFor.set(entry.id, accounts);
    },
    /** The user's calendar list entry, as Google holds it. */
    calendar(id: string): GoogleCalendarEntry | undefined {
      return calendars.find(calendar => calendar.id === id);
    },
    /** An event as someone changed it in Google (its own app, or another client). */
    put(calendarId: string, event: GoogleEvent) {
      return publicEvent(store(calendarId, event));
    },
    event(calendarId: string, id: string): GoogleEvent | undefined {
      const found = calendarEvents(calendarId).get(id);
      return found ? publicEvent(found) : undefined;
    },
    events(calendarId: string): GoogleEvent[] {
      return [...calendarEvents(calendarId).values()].map(publicEvent);
    },
    instances(calendarId: string, masterId: string, from: string, to: string) {
      return instancesOf(calendarId, calendarEvents(calendarId).get(masterId)!, from, to);
    },
    /** The user revoked Setpoint's access in their Google account. */
    revoke() {
      refreshTokens.clear();
      accessTokens.clear();
    },
    /** Every sync token handed out so far stops working (410). */
    dropSyncTokens() {
      for (let at = 0; at <= seq; at += 1) droppedTokens.add(`sync-${at}`);
    },
    setPlaces(list: typeof places) {
      places = list;
    },
    setRoute(destination: string, duration: string, distanceMeters: number) {
      routes = new Map(routes).set(destination, {duration, distanceMeters});
    },
    /** Google's push notification for a channel, as headers. */
    notification(channel: {id: string; token: string; resourceId: string; calendarId: string}, state: 'sync' | 'exists', message: number) {
      return {
        'x-goog-channel-id': channel.id, 'x-goog-channel-token': channel.token, 'x-goog-resource-id': channel.resourceId,
        'x-goog-resource-uri': `${server.url}/calendar/v3/calendars/${encodeURIComponent(channel.calendarId)}/events?alt=json`,
        'x-goog-resource-state': state, 'x-goog-message-number': String(message),
      };
    },
  };
}

export type FakeGoogle = Awaited<ReturnType<typeof fakeGoogle>>;
