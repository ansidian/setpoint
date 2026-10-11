// Reminders and Time to Leave: the timing rules as tables, then the scheduler over the seed, sending
// through notify() to a fake ntfy, with routes from a fake Google Routes.
import {itemUpdateInput} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {completeItem, updateItem} from '../src/commands/items.ts';
import * as t from '../src/db/schema.ts';
import {zoned} from '../src/dev/sample.ts';
import {reminderDue, remindersOf} from '../src/domain/reminders.ts';
import type {ReminderItem} from '../src/domain/reminders.ts';
import {isPhysicalLocation, leaveAt, nextRouteCheck, plausibleRoute, travelMinutes} from '../src/domain/timeToLeave.ts';
import {Notifier} from '../src/notify/index.ts';
import {itemsInRange} from '../src/queries/items.ts';
import {ReminderScheduler} from '../src/reminders/scheduler.ts';
import {setSecret} from '../src/secrets/store.ts';
import {updateSettings} from '../src/settings.ts';
import {fakeGoogle} from './fakes/google.ts';
import {fakeNtfy} from './fakeNtfy.ts';
import {world} from './helpers.ts';

const ZONE = 'America/Los_Angeles';
const base: ReminderItem = {id: 2, kind: 'event', title: 'Dentist', all_day: false, starts_at: zoned('2026-10-07', '14:30'), start_date: null, due_date: null, due_at: null, done: false, reminders: [30], place: 'Smile Dental', project: null, occurrence_start: null};
const settings = {taskTime: '09:00', timeZone: ZONE};

describe('when reminders go off', () => {
  test.each<[string, Partial<ReminderItem>, [string, string][]]>([
    ['an event: minutes before its start', {}, [[zoned('2026-10-07', '14:00'), `reminder:2@${zoned('2026-10-07', '14:30')}:30`]]],
    ['several', {reminders: [10, 60]}, [[zoned('2026-10-07', '14:20'), `reminder:2@${zoned('2026-10-07', '14:30')}:10`], [zoned('2026-10-07', '13:30'), `reminder:2@${zoned('2026-10-07', '14:30')}:60`]]],
    ['none', {reminders: []}, []],
    ['an all-day event counts from local midnight', {all_day: true, starts_at: null, start_date: '2026-10-12', reminders: [900]}, [[zoned('2026-10-11', '09:00'), `reminder:2@${zoned('2026-10-12', '00:00')}:900`]]],
    ['a dated task: Settings\' time on its day', {kind: 'task', starts_at: null, due_date: '2026-10-08', reminders: []}, [[zoned('2026-10-08', '09:00'), 'reminder:2@2026-10-08T09:00']]],
    ['a timed task: at its time', {kind: 'task', starts_at: null, due_date: '2026-10-07', due_at: zoned('2026-10-07', '19:00'), reminders: []}, [[zoned('2026-10-07', '19:00'), `reminder:2@${zoned('2026-10-07', '19:00')}:0`]]],
    ['a done task: nothing', {kind: 'task', starts_at: null, due_date: '2026-10-08', done: true}, []],
  ])('%s', (_, change, expected) => {
    expect(remindersOf({...base, ...change}, settings).map(reminder => [reminder.at, reminder.key])).toEqual(expected);
  });

  // Settings' task reminders at None (D49): no dated or timed task reminds unless it asks to.
  test.each<[string, Partial<ReminderItem>, [string, string][]]>([
    ['a dated task: nothing', {kind: 'task', starts_at: null, due_date: '2026-10-08', reminders: []}, []],
    ['a timed task: nothing', {kind: 'task', starts_at: null, due_date: '2026-10-07', due_at: zoned('2026-10-07', '19:00'), reminders: []}, []],
    ['a timed task with its own reminder keeps it', {kind: 'task', starts_at: null, due_date: '2026-10-07', due_at: zoned('2026-10-07', '19:00'), reminders: [15]}, [[zoned('2026-10-07', '18:45'), `reminder:2@${zoned('2026-10-07', '19:00')}:15`]]],
  ])('task reminders at None, %s', (_, change, expected) => {
    expect(remindersOf({...base, ...change}, {...settings, taskTime: null}).map(reminder => [reminder.at, reminder.key])).toEqual(expected);
  });

  test.each([
    ['due now', '14:00', '14:00', '13:59', false, true],
    ['not yet', '14:00', '13:59', '13:58', false, false],
    ['late, within the hour', '14:00', '14:59', '13:59', false, true],
    ['too late', '14:00', '15:01', '13:59', false, false],
    ['moved into the past: its moment was before the last pass', '14:00', '14:05', '14:04', false, false],
    ['a failed send tried again', '14:00', '14:05', '14:04', true, true],
  ])('%s', (_, at, now, lastPass, retrying, due) => {
    expect(reminderDue(zoned('2026-10-07', at), zoned('2026-10-07', now), zoned('2026-10-07', lastPass), retrying)).toBe(due);
  });
});

describe('Time to Leave\'s rules', () => {
  test.each([
    ['Smile Dental, 1420 Elm St', true], ['', false], [null, false], ['https://meet.google.com/abc-defg-hij', false], ['meet.google.com/room', false],
    ['www.example.com', false], ['Zoom Meeting', false], ['join zoom', false], ['Blue Door', true],
  ])('%s is a place to drive to: %s', (location, physical) => {
    expect(isPhysicalLocation(location)).toBe(physical);
  });

  test.each([
    ['17 min 10 s with a 5 min buffer', 1030, 5, '14:07', 18],
    ['30 minutes exactly with 15 (v1\'s 20:00 − 15m − 1800 s)', 1800, 15, '13:45', 30],
    ['a quarter-second over rounds the travel up', 901, 0, '14:14', 16],
  ])('%s', (_, seconds, buffer, leave, minutes) => {
    expect(leaveAt(zoned('2026-10-07', '14:30'), seconds, buffer)).toBe(zoned('2026-10-07', leave));
    expect(travelMinutes(seconds)).toBe(minutes);
  });

  test.each([
    ['more than 3 hours before leaving: once, 3 hours before', '08:00', '14:07', '11:07'],
    ['exactly 3 hours: every 15 minutes', '11:07', '14:07', '11:22'],
    ['between 1 and 3 hours: every 15 minutes', '12:00', '14:07', '12:15'],
    ['in the last hour: every 5 minutes', '13:30', '14:07', '13:35'],
    ['past leaving: every 5 minutes', '14:10', '14:07', '14:15'],
    ['never after the start', '14:28', '14:07', '14:30'],
  ])('%s', (_, now, departure, next) => {
    expect(nextRouteCheck(zoned('2026-10-07', now), zoned('2026-10-07', departure), zoned('2026-10-07', '14:30'))).toBe(zoned('2026-10-07', next));
  });

  test('none once it has started; implausible routes refused', () => {
    expect(nextRouteCheck(zoned('2026-10-07', '14:30'), zoned('2026-10-07', '14:07'), zoned('2026-10-07', '14:30'))).toBeNull();
    expect(plausibleRoute(1030, 8_000)).toBe(true);
    expect(plausibleRoute(9 * 3600, 900_000)).toBe(false);
  });
});

async function reminderWorld() {
  const w = world({seed: true});
  const ntfy = await fakeNtfy();
  const google = await fakeGoogle();
  updateSettings(w.store, {notifications: {ntfy_server: ntfy.url}});
  const notifier = new Notifier(w.store, {publicUrl: 'https://setpoint.example.com'});
  const scheduler = new ReminderScheduler({store: w.store, notifier, routes: {baseUrl: google.url}});
  const at = async (date: string, time: string, seconds = 0) => {
    w.at(new Date(Date.parse(zoned(date, time)) + seconds * 1000).toISOString());
    await scheduler.tick();
  };
  const sent = () => ntfy.published.map(message => [message.body.title, message.body.message]);
  const item = (title: string) => w.store.db.select().from(t.items).where(eq(t.items.title, title)).get()!;
  return {w, ntfy, google, scheduler, at, sent, item};
}

describe('reminders through notify() to ntfy', () => {
  test('Dentist 30 min before, once, opening the item; tasks at 9:00 AM on their day; a done one stays quiet', async () => {
    const {ntfy, at, sent, item, w} = await reminderWorld();
    // Starting at 9:12 AM: today's 9:00 AM tasks went before Setpoint's first pass, so they don't fire.
    await at('2026-10-07', '09:12');
    expect(sent()).toEqual([]);
    await at('2026-10-07', '13:59');
    expect(sent()).toEqual([]);
    await at('2026-10-07', '14:00', 20);
    await at('2026-10-07', '14:01');
    expect(sent()).toEqual([['Dentist', '2:30 PM · Smile Dental']]);
    expect(ntfy.published[0]!.body).toMatchObject({topic: 'setpoint-reminders', tags: ['calendar'], click: `https://setpoint.example.com/calendar/item/${item('Dentist').id}`});
    // Tomorrow 9:00 AM: the car registration (Home); not Gym (Thursday).
    completeItem(w.store, item('Pay rent').id, true);
    await at('2026-10-08', '06:00');
    await at('2026-10-08', '09:00', 30);
    expect(sent().slice(1)).toEqual([['Renew car registration', 'Due today · Home']]);
    expect(ntfy.published[1]!.body.click).toBe('https://setpoint.example.com/calendar/2026-10-08');
    // Friday: Gym at 6:50 AM, an occurrence of a series, opening that occurrence.
    await at('2026-10-09', '06:50', 10);
    expect(sent().slice(2)).toEqual([['Gym', '7:00 AM']]);
    expect(ntfy.published[2]!.body.click).toBe(`https://setpoint.example.com/calendar/item/${item('Gym').id}?at=${encodeURIComponent(zoned('2026-10-09', '07:00'))}`);
  });

  test('a moved event reminds at its new time; one moved into the past doesn\'t fire', async () => {
    const {w, at, sent, item} = await reminderWorld();
    await at('2026-10-07', '09:12');
    updateItem(w.store, item('Dentist').id, itemUpdateInput.parse({changes: {starts_at: zoned('2026-10-07', '16:00'), ends_at: zoned('2026-10-07', '17:00')}}));
    await at('2026-10-07', '14:00', 30);
    expect(sent()).toEqual([]);
    await at('2026-10-07', '15:30', 30);
    expect(sent()).toEqual([['Dentist', '4:00 PM · Smile Dental']]);
    // Moved at 3:45 PM to 4:10 PM: its reminder (3:40) is already behind, so nothing more.
    await at('2026-10-07', '15:45');
    updateItem(w.store, item('Study group').id, itemUpdateInput.parse({changes: {starts_at: zoned('2026-10-07', '16:10'), ends_at: zoned('2026-10-07', '17:00')}}));
    await at('2026-10-07', '15:50');
    expect(sent()).toHaveLength(1);
  });

  test('a send that failed is tried again on the next pass, then sent once', async () => {
    const {ntfy, at, sent} = await reminderWorld();
    await at('2026-10-07', '13:00');
    ntfy.refuseWith(503, 'service unavailable');
    await at('2026-10-07', '14:00', 20);
    expect(sent()).toEqual([]);
    ntfy.accept();
    await at('2026-10-07', '14:01');
    await at('2026-10-07', '14:02');
    expect(sent()).toEqual([['Dentist', '2:30 PM · Smile Dental']]);
  });
});

describe('Time to Leave', () => {
  async function leaveWorld() {
    const world = await reminderWorld();
    setSecret(world.w.store, 'places_api_key', 'maps-key');
    updateSettings(world.w.store, {calendar: {home: {label: 'Home', address: '100 Example St', lat: 34.1016, lng: -118.3267}}});
    world.google.setRoute('Smile Dental, 1420 Elm St', '1030s', 8_000);
    world.google.setRoute('Blue Door, 2118 Sunset Blvd', '1500s', 14_000);
    const routeCalls = () => world.google.requests.filter(request => request.path === '/directions/v2:computeRoutes');
    return {...world, routeCalls};
  }

  test('Dentist: a live route from Home, "Leave by 2:07 PM · 18 min", checked again before it goes', async () => {
    const {w, at, sent, routeCalls, item, ntfy, google} = await leaveWorld();
    await at('2026-10-07', '09:12');
    // Today's and tomorrow's events with a place: Dentist (and Dinner on Friday is beyond a day).
    expect(routeCalls().map(call => call.body.destination.address)).toEqual(['Smile Dental, 1420 Elm St']);
    expect(routeCalls()[0]!.body).toMatchObject({
      origin: {location: {latLng: {latitude: 34.1016, longitude: -118.3267}}}, travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE_OPTIMAL', departureTime: zoned('2026-10-07', '13:55'),
    });
    expect(routeCalls()[0]!.headers['x-goog-fieldmask']).toBe('routes.duration,routes.distanceMeters');
    const dentist = itemsInRange(w.store, '2026-10-07', '2026-10-08').items.find(entry => entry.title === 'Dentist')!;
    expect(dentist.time_to_leave).toMatchObject({leave_at: zoned('2026-10-07', '14:07'), travel_minutes: 18});
    // Not checked again until 3 hours before leaving.
    await at('2026-10-07', '11:00');
    expect(routeCalls()).toHaveLength(1);
    await at('2026-10-07', '11:07');
    expect(routeCalls()).toHaveLength(2);
    // Traffic worsens just before: checked once more at 2:07, and it goes at once.
    google.setRoute('Smile Dental, 1420 Elm St', '1500s', 8_000);
    await at('2026-10-07', '13:55');
    await at('2026-10-07', '14:07');
    const leave = ntfy.published.find(message => message.body.title === 'Time to leave for Dentist')!;
    expect(leave.body).toMatchObject({message: 'Leave by 2:00 PM · 25 min · Smile Dental', tags: ['car'], priority: 4, click: `https://setpoint.example.com/calendar/item/${item('Dentist').id}`});
    // Home never appears in what's sent.
    expect(JSON.stringify(ntfy.published)).not.toMatch(/100 Example St|34\.06|-118\.02/);
    // Once.
    await at('2026-10-07', '14:10');
    expect(sent().filter(([title]) => title === 'Time to leave for Dentist')).toHaveLength(1);
  });

  test('better traffic on the last check holds it back until the new time', async () => {
    const {at, sent, google} = await leaveWorld();
    await at('2026-10-07', '13:40');
    google.setRoute('Smile Dental, 1420 Elm St', '600s', 8_000);
    await at('2026-10-07', '14:07');
    expect(sent().filter(([title]) => title!.startsWith('Time to leave'))).toEqual([]);
    await at('2026-10-07', '14:15');
    expect(sent().filter(([title]) => title!.startsWith('Time to leave'))).toEqual([['Time to leave for Dentist', 'Leave by 2:15 PM · 10 min · Smile Dental']]);
  });

  test('a failed check keeps the last estimate and tries again in 5 minutes', async () => {
    const {at, sent, google, routeCalls} = await leaveWorld();
    await at('2026-10-07', '13:00');
    google.fault({path: /computeRoutes/, response: {status: 503, body: {error: {code: 503, message: 'The service is currently unavailable.'}}}, times: 3});
    await at('2026-10-07', '13:15');
    await at('2026-10-07', '13:17');
    expect(routeCalls()).toHaveLength(2);
    await at('2026-10-07', '13:20');
    expect(routeCalls()).toHaveLength(3);
    await at('2026-10-07', '14:07');
    expect(sent().filter(([title]) => title!.startsWith('Time to leave'))).toEqual([['Time to leave for Dentist', 'Leave by 2:07 PM · 18 min · Smile Dental']]);
  });

  test('an answer for a Home that changed meanwhile is thrown away', async () => {
    const world = await reminderWorld();
    setSecret(world.w.store, 'places_api_key', 'maps-key');
    updateSettings(world.w.store, {calendar: {home: {label: 'Home', address: '100 Example St', lat: 34.1016, lng: -118.3267}}});
    world.google.setRoute('Smile Dental, 1420 Elm St', '1030s', 8_000);
    // Home moves while Google is answering.
    const racing: typeof fetch = async (input, init) => {
      const answer = await fetch(input, init);
      updateSettings(world.w.store, {calendar: {home: {label: 'Home', address: '200 Elsewhere Ave', lat: 34.1, lng: -118.1}}});
      return answer;
    };
    const scheduler = new ReminderScheduler({store: world.w.store, notifier: new Notifier(world.w.store, {publicUrl: null}), routes: {baseUrl: world.google.url, fetch: racing}});
    world.w.at(zoned('2026-10-07', '13:00'));
    await scheduler.tick();
    expect(world.w.store.db.select().from(t.travelEstimates).all()).toEqual([]);
  });

  test('only an event given Time to Leave: one with a place and none asks no route; taking it off stops it (SV-31)', async () => {
    const {w, at, sent, routeCalls, item} = await leaveWorld();
    await at('2026-10-07', '09:12');
    expect(routeCalls()).toHaveLength(1);
    updateItem(w.store, item('Dentist').id, itemUpdateInput.parse({changes: {leave_reminder: false}}));
    const dentist = () => itemsInRange(w.store, '2026-10-07', '2026-10-08').items.find(entry => entry.title === 'Dentist')!;
    expect([dentist().leave_reminder, dentist().time_to_leave]).toEqual([false, null]);
    await at('2026-10-07', '11:07');
    await at('2026-10-07', '14:07');
    expect(routeCalls()).toHaveLength(1);
    expect(sent().filter(([title]) => title === 'Time to leave for Dentist')).toEqual([]);
    // Career fair has a place and no Time to Leave.
    await at('2026-10-14', '13:00');
    expect(routeCalls()).toHaveLength(1);
  });

  test('off in Settings, no Home, or no key: no routes asked for', async () => {
    const {w, at, routeCalls} = await leaveWorld();
    updateSettings(w.store, {time_to_leave: {enabled: false}});
    await at('2026-10-07', '13:00');
    updateSettings(w.store, {time_to_leave: {enabled: true}, calendar: {home: null}});
    await at('2026-10-07', '13:10');
    expect(routeCalls()).toEqual([]);
  });
});
