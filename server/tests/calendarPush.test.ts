// Google Calendar push against the fake Google: watch channels per calendar (only with a public
// https address), Google's notifications admitted by channel, token and resource at
// POST /api/calendar/push without a session, make-before-break renewal, and calendars Google can't
// watch. Then Places, through the API.
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {deleteSecret, setSecret} from '../src/secrets/store.ts';
import {updateSettings} from '../src/settings.ts';
import {calendarWorld, PERSONAL, PUBLIC_URL} from './calendarWorld.ts';
import {fakeGoogle} from './fakes/google.ts';
import {client, signedIn, world} from './helpers.ts';

const DAY = 86_400_000;

describe('watch channels', () => {
  test('one per calendar Google can watch, told at Setpoint\'s public address; the token kept only as a hash', async () => {
    const {w, google, run} = await calendarWorld({push: true});
    await run();
    w.advance(6 * 60_000);
    await run();
    expect(google.channels.map(channel => [channel.calendarId, channel.address])).toEqual([[PERSONAL, `${PUBLIC_URL}/api/calendar/push`]]);
    const rows = w.store.db.select().from(t.calendarChannels).all();
    expect(rows.map(row => row.state).sort()).toEqual(['active', 'unsupported']);
    expect(JSON.stringify(rows)).not.toContain(google.channels[0]!.token);
    // A holiday calendar can't be watched; it isn't asked again while that's remembered.
    w.advance(16 * 60_000);
    await run();
    expect(google.requests.filter(request => request.path.endsWith('/watch') && request.path.includes('holiday'))).toHaveLength(1);
  });

  test('without a public https address there\'s no push: the sweep keeps it current', async () => {
    const {google, run, w} = await calendarWorld({push: false});
    await run();
    w.advance(6 * 60_000);
    await run();
    expect(google.channels).toEqual([]);
  });

  test('with SETPOINT_WEBHOOK_ORIGIN set, Google is told to post there; a changed origin re-registers within a sync, make before break', async () => {
    const {w, google, run, restart} = await calendarWorld({push: true, webhookOrigin: 'https://hooks.example.com:8443'});
    await run();
    w.advance(6 * 60_000);
    await run();
    expect(google.channels.map(channel => channel.address)).toEqual(['https://hooks.example.com:8443/api/calendar/push']);
    const first = google.channels[0]!;
    restart('https://hooks.example.net');
    w.advance(16 * 60_000);
    await run();
    expect(google.channels.map(channel => channel.address)).toEqual(['https://hooks.example.com:8443/api/calendar/push', 'https://hooks.example.net/api/calendar/push']);
    expect(google.stopped).toEqual([{id: first.id, resourceId: first.resourceId}]);
    // Unset again: back to the public URL.
    restart(null);
    w.advance(16 * 60_000);
    await run();
    expect(google.channels.at(-1)!.address).toBe(`${PUBLIC_URL}/api/calendar/push`);
    expect(w.store.db.select().from(t.calendarChannels).all().filter(row => row.state === 'active').map(row => row.address)).toEqual([`${PUBLIC_URL}/api/calendar/push`]);
  });

  test('a notification queues a sync before Google hears 204; anything not quite right is 401', async () => {
    const {w, google, run, source} = await calendarWorld({push: true});
    await run();
    w.advance(6 * 60_000);
    await run();
    const c = client(w, {providers: {calendarApi: google.calendarApi}});
    const channel = google.channels[0]!;
    const send = (headers: Record<string, string>) => c.send('POST', '/api/calendar/push', {headers});
    const queued = () => w.store.db.select().from(t.jobs).where(eq(t.jobs.key, `sync:${source.id}`)).all().filter(job => job.state === 'queued').length;
    expect((await send(google.notification(channel, 'sync', 1))).status).toBe(204);
    expect(queued()).toBe(1);
    // Many notifications, one queued sync.
    expect((await send(google.notification(channel, 'exists', 2))).status).toBe(204);
    expect(queued()).toBe(1);
    expect((await send({...google.notification(channel, 'exists', 3), 'x-goog-channel-token': 'guess'})).status).toBe(401);
    expect((await send({...google.notification(channel, 'exists', 3), 'x-goog-resource-id': 'resource-99'})).status).toBe(401);
    expect((await send({...google.notification(channel, 'exists', 3), 'x-goog-resource-uri': `${google.calendarApi}/calendars/other/events`})).status).toBe(401);
    expect((await send(google.notification(channel, 'sync', 2))).status).toBe(401);
    expect((await send({...google.notification(channel, 'exists', 3), 'x-goog-resource-state': 'deleted'})).status).toBe(401);
    expect((await send({...google.notification(channel, 'exists', 3), 'x-goog-channel-id': 'not-a-channel'})).status).toBe(401);
    expect((await send({...google.notification(channel, 'exists', 3), 'x-goog-message-number': '0'})).status).toBe(401);
  });

  test('renewal makes the new channel before it retires and stops the old one', async () => {
    const {w, google, run} = await calendarWorld({push: true});
    await run();
    w.advance(6 * 60_000);
    await run();
    const first = google.channels[0]!;
    w.advance(6 * DAY);
    await run();
    expect(google.channels).toHaveLength(2);
    expect(google.stopped).toEqual([{id: first.id, resourceId: first.resourceId}]);
    const c = client(w, {providers: {calendarApi: google.calendarApi}});
    expect((await c.send('POST', '/api/calendar/push', {headers: google.notification(first, 'exists', 9)})).status).toBe(401);
    expect((await c.send('POST', '/api/calendar/push', {headers: google.notification(google.channels[1]!, 'exists', 2)})).status).toBe(204);
    const source = w.store.db.select().from(t.sources).where(eq(t.sources.provider, 'google_calendar')).get()!;
    expect(Date.parse(source.pushRenewsAt!)).toBe(Date.parse(new Date(google.channels[1]!.expiration).toISOString()) - DAY);
  });
});

describe('Places', () => {
  async function placesWorld() {
    const w = world();
    const google = await fakeGoogle();
    const c = await signedIn(w, {providers: {places: {baseUrl: google.url}}});
    setSecret(w.store, 'places_api_key', 'maps-key');
    updateSettings(w.store, {calendar: {home: {label: 'Home', address: '100 Example St', lat: 34.1016, lng: -118.3267}}});
    return {w, google, c};
  }

  test('a&b auto: normalised, restricted near Home, widened when sparse, nearest first, one session', async () => {
    const {google, c} = await placesWorld();
    google.setPlaces([
      {placeId: 'far', main: 'A & B Auto', secondary: 'Glendale, CA', distanceMeters: 19_000, radius: 20_000},
      {placeId: 'near', main: 'A & B Auto Body', secondary: '100 Example Ave, Los Angeles, CA', distanceMeters: 3_100, radius: 5_000},
    ]);
    const answer = await c.send('GET', `/api/places?query=${encodeURIComponent('a&b auto')}&session_token=editor-session-1`);
    expect(answer.body).toEqual([
      {place_id: 'near', name: 'A & B Auto Body', address: '100 Example Ave, Los Angeles, CA'},
      {place_id: 'far', name: 'A & B Auto', address: 'Glendale, CA'},
    ]);
    const calls = google.requests.filter(request => request.path === '/v1/places:autocomplete');
    expect(calls.map(call => [call.body.input, call.body.sessionToken, call.body.locationRestriction.circle.radius, call.body.locationBias])).toEqual([
      ['a & b auto', 'editor-session-1', 12_000, undefined], ['a & b auto', 'editor-session-1', 24_000, undefined],
    ]);
    expect(calls[0]!.headers['x-goog-fieldmask']).toBe('suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.distanceMeters');
  });

  test('Google\'s refusal comes back as a 502 in its words; no key is 503 without a call', async () => {
    const {w, google, c} = await placesWorld();
    setSecret(w.store, 'places_api_key', 'wrong-key');
    const refused = await c.send('GET', '/api/places?query=blue%20door&session_token=editor-session-1');
    expect(refused).toMatchObject({status: 502, body: {error: {code: 'places_failed', message: 'API key not valid. Please pass a valid API key. (403 Forbidden)'}}});
    deleteSecret(w.store, 'places_api_key');
    const calls = google.requests.length;
    expect(await c.send('GET', '/api/places?query=blue%20door&session_token=editor-session-1')).toMatchObject({status: 503, body: {error: {code: 'places_not_configured'}}});
    expect(google.requests).toHaveLength(calls);
  });

  test('F7: a place\'s details give Home its coordinates, closing the session; Google\'s refusal is a 502', async () => {
    const {google, c} = await placesWorld();
    google.setPlaces([{placeId: 'home', main: '100 Example St', secondary: '100 Example St, Los Angeles, CA', distanceMeters: 0, radius: 0, lat: 34.1016, lng: -118.3267}]);
    const answer = await c.send('GET', '/api/places/home?session_token=settings-session-1');
    expect(answer.body).toEqual({place_id: 'home', name: '100 Example St', address: '100 Example St, Los Angeles, CA', lat: 34.1016, lng: -118.3267});
    const call = google.requests.find(request => request.path === '/v1/places/home')!;
    expect([call.headers['x-goog-fieldmask'], call.query.get('sessionToken')]).toEqual(['id,displayName,formattedAddress,location', 'settings-session-1']);
    expect(await c.send('GET', '/api/places/nowhere')).toMatchObject({status: 502, body: {error: {code: 'places_failed'}}});
  });

  test('F7: the dev runs\' invented places have coordinates too, never Google\'s', async () => {
    const w = world({seed: true});
    const google = await fakeGoogle();
    const c = await signedIn(w, {providers: {places: {baseUrl: google.url}}});
    expect((await c.send('GET', '/api/places/dev-blue-door')).body).toEqual({place_id: 'dev-blue-door', name: 'Blue Door', address: '2118 Sunset Blvd', lat: 34.0901, lng: -118.2768});
    // Its details name the address in full, as Google's do when a suggestion's second line is shorter.
    expect((await c.send('GET', '/api/places/dev-blue-door-coffee')).body).toMatchObject({name: 'Blue Door Coffee', address: '77 Elm Ave, Glendale, CA 91203'});
    expect(await c.send('GET', '/api/places/dev-nowhere')).toMatchObject({status: 404});
    expect(google.requests).toHaveLength(0);
  });

  test('F6: the seed\'s dev runs suggest invented places with no key, never Google; a key turns that off', async () => {
    const w = world({seed: true});
    const google = await fakeGoogle();
    const c = await signedIn(w, {providers: {places: {baseUrl: google.url}}});
    const answer = await c.send('GET', '/api/places?query=blue%20door&session_token=editor-session-1');
    expect(answer.body).toEqual([
      {place_id: 'dev-blue-door', name: 'Blue Door', address: '2118 Sunset Blvd'},
      {place_id: 'dev-blue-door-bistro', name: 'Blue Door Bistro', address: '845 Example St, Los Angeles'},
      {place_id: 'dev-blue-door-coffee', name: 'Blue Door Coffee', address: '77 Elm Ave, Glendale'},
    ]);
    expect(google.requests).toHaveLength(0);
    setSecret(w.store, 'places_api_key', 'maps-key');
    await c.send('GET', '/api/places?query=blue%20door&session_token=editor-session-1');
    expect(google.requests).toHaveLength(1);
  });
});
