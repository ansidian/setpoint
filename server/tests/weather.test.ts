// Weather as its own source against a fake Pirate Weather on 127.0.0.1, and calendar colours.
import {COLOURS, EVENT_COLOURS} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {CALENDAR_HEX, EVENT_COLOUR_IDS, eventColourOf, foregroundFor, GOOGLE_EVENT_COLOURS, swatchFor} from '../src/domain/colours.ts';
import {conditionOf, weatherAdapter} from '../src/providers/weather/index.ts';
import {weatherDays} from '../src/queries/items.ts';
import {sourceList} from '../src/queries/sources.ts';
import {writeSourceCredentials} from '../src/secrets/store.ts';
import {updateSettings} from '../src/settings.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {fakeServer, on} from './fakes/server.ts';
import {world} from './helpers.ts';

// Midnight Pacific on Oct 7, 8 and 9, as Dark Sky's day times.
const DAYS = [1791356400, 1791442800, 1791529200];

async function weatherWorld() {
  const w = world();
  const pirate = await fakeServer([
    on('GET', /^\/forecast\/([^/]+)\/([^/]+)$/, (_request, match) => {
      if (match[1] !== 'weather-key') return {status: 403, body: 'Forbidden'};
      return {status: 200, body: {
        timezone: 'America/Los_Angeles', latitude: 34.1016, longitude: -118.3267,
        daily: {data: [
          {time: DAYS[0], icon: 'clear-day', temperatureHigh: 78.4, temperatureLow: 60.6},
          {time: DAYS[1], icon: 'cloudy', temperatureHigh: 71.6, temperatureLow: 59.1},
          {time: DAYS[2], icon: 'rain', temperatureHigh: 64, temperatureLow: 55},
        ]},
      }};
    }),
  ]);
  const source = w.store.db.insert(t.sources).values({provider: 'weather', syncMode: 'poll', intervalSeconds: 1800, createdAt: w.store.now().toISOString()}).returning().get();
  const engine = new SyncEngine({store: w.store, adapters: new Adapters({weather: weatherAdapter({baseUrl: pirate.url})})});
  const run = async () => {
    await engine.tick();
    await engine.settled();
  };
  const health = () => sourceList(w.store).find(row => row.id === source.id)!.health;
  return {w, pirate, source, run, health, engine};
}

describe('weather', () => {
  test('day forecasts at Home, each on its own day, every 30 minutes', async () => {
    const {w, pirate, source, run, health} = await weatherWorld();
    writeSourceCredentials(w.store, source.id, {kind: 'api_key', key: 'weather-key'});
    updateSettings(w.store, {calendar: {home: {label: 'Home', address: '100 Example St', lat: 34.1016, lng: -118.3267}}});
    await run();
    expect(weatherDays(w.store, '2026-10-01', '2026-11-01', true)).toEqual([
      {date: '2026-10-07', condition: 'sun', high_f: 78, low_f: 61}, {date: '2026-10-08', condition: 'cloud', high_f: 72, low_f: 59}, {date: '2026-10-09', condition: 'rain', high_f: 64, low_f: 55},
    ]);
    expect(pirate.requests[0]!.path).toBe('/forecast/weather-key/34.1016%2C-118.3267');
    expect(pirate.requests[0]!.query.get('units')).toBe('us');
    expect(health().state).toBe('healthy');
    w.advance(29 * 60_000);
    await run();
    expect(pirate.requests).toHaveLength(1);
    w.advance(60_000);
    await run();
    expect(pirate.requests).toHaveLength(2);
  });

  test('a failed check fails, never passing old forecasts off as new, and never shows the key', async () => {
    const {w, pirate, source, run, health} = await weatherWorld();
    writeSourceCredentials(w.store, source.id, {kind: 'api_key', key: 'weather-key'});
    updateSettings(w.store, {calendar: {home: {label: 'Home', address: '100 Example St', lat: 34.1016, lng: -118.3267}}});
    pirate.fault({path: /forecast/, response: {status: 500, body: 'oops'}});
    await run();
    expect(health()).toMatchObject({state: 'failing', reason: 'Pirate Weather answered 500 Internal Server Error.'});
    expect(JSON.stringify(sourceList(w.store))).not.toContain('weather-key');
  });

  test('no key is needs reconnect; no Home is a failing check that says so; weather off checks nothing', async () => {
    const {w, pirate, source, run, health, engine} = await weatherWorld();
    updateSettings(w.store, {calendar: {home: {label: 'Home', address: '100 Example St', lat: 34.1016, lng: -118.3267}}});
    await run();
    expect(health()).toMatchObject({state: 'needs_reconnect', reason: 'Weather needs a Pirate Weather key.'});
    writeSourceCredentials(w.store, source.id, {kind: 'api_key', key: 'weather-key'});
    updateSettings(w.store, {calendar: {home: null}});
    // New credentials check at once (the API's PUT does the same).
    engine.checkNow(source.id);
    await run();
    expect(health()).toMatchObject({state: 'failing', reason: 'Set Home in Settings › Calendar for the forecast.'});
    updateSettings(w.store, {calendar: {weather: false}});
    w.advance(31 * 60_000);
    await run();
    expect(health().state).toBe('healthy');
    expect(pirate.requests).toHaveLength(0);
  });

  test.each([
    ['clear-day', 'sun'], ['clear-night', 'sun'], ['partly-cloudy-day', 'partly_cloudy'], ['partly-cloudy-night', 'partly_cloudy'], ['cloudy', 'cloud'],
    ['fog', 'cloud'], ['wind', 'cloud'], ['rain', 'rain'], ['snow', 'rain'], ['sleet', 'rain'], ['thunderstorm', 'rain'], ['something-new', 'cloud'],
  ])('%s is %s', (icon, condition) => {
    expect(conditionOf(icon)).toBe(condition);
  });
});

describe('a Google calendar\'s colour as a swatch', () => {
  test.each([
    ['#4986e7', 'cool'], ['#16a765', 'good'], ['#7bd148', 'good'], ['#f83a22', 'alert'], ['#ff7537', 'caution'], ['#ffad46', 'warm'],
    ['#fad165', 'sun'], ['#9a9cff', 'violet'], ['#9fe1e7', 'cyan'], ['#46d6db', 'cyan'], ['#42d692', 'comf'], ['#7ae7bf', 'comf'], ['#cabdbf', 'ink2'], ['#e1e1e1', 'ink2'], ['not a colour', 'ink2'],
  ])('%s → %s', (hex, swatch) => {
    expect(swatchFor(hex)).toBe(swatch);
  });
  // SV-20: the colour Setpoint writes for a calendar reads back as the swatch picked, case aside.
  test.each(COLOURS.map(swatch => [swatch, CALENDAR_HEX[swatch]]))('%s writes %s, which reads back as it', (swatch, hex) => {
    expect(swatchFor(hex)).toBe(swatch);
    expect(swatchFor(hex.toUpperCase())).toBe(swatch);
  });
  // What an earlier build wrote, before the polish audit moved the swatch (Night ink3, SV-58): calendars
  // already carrying it still read back as it.
  test.each([['#707277', 'ink3'], ['#57d4d4', 'cyan']])('%s, written before, still reads back as %s', (hex, swatch) => {
    expect(swatchFor(hex)).toBe(swatch);
  });
  test.each([['#71c9fa', '#000000'], ['#f7cd3a', '#000000'], ['#a3a4a8', '#000000'], ['#7d7f84', '#ffffff']])('text on %s is %s', (hex, foreground) => {
    expect(foregroundFor(hex)).toBe(foreground);
  });
});

describe('F6: an event\'s own colour, Google\'s colorId both ways', () => {
  test.each([
    ['1', 'violet'], ['2', 'comf'], ['3', 'violet'], ['4', 'alert'], ['5', 'sun'], ['6', 'warm'], ['7', 'cyan'], ['8', 'ink2'], ['9', 'cool'], ['10', 'good'], ['11', 'alert'],
    [null, null], ['', null], ['12', null],
  ])('colorId %s reads as %s', (colorId, swatch) => {
    expect(eventColourOf(colorId)).toBe(swatch);
  });
  test.each(EVENT_COLOURS.map(swatch => [swatch]))('%s writes a colorId that reads back as it', swatch => {
    expect(eventColourOf(EVENT_COLOUR_IDS[swatch])).toBe(swatch);
  });
  test('every colour Google has falls on a swatch an event can take', () => {
    expect(Object.keys(GOOGLE_EVENT_COLOURS).every(id => (EVENT_COLOURS as readonly string[]).includes(eventColourOf(id)!))).toBe(true);
  });
});
