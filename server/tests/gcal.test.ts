// The Google Calendar adapter against a fake Google on 127.0.0.1: the mirror from the calendar list
// and sync tokens; create, a recurring move with each scope, a 409 failed in place, deletes; and
// Google's errors (revoked consent, 410, 412, 429, timeouts).
import {itemCreateInput, itemScopeInput, itemUpdateInput} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {ensureCalendarSources} from '../src/calendar/sources.ts';
import {moveBackCommand, retryCommand} from '../src/commands/index.ts';
import {createItem, deleteItem, setCalendarColour, updateItem} from '../src/commands/items.ts';
import * as t from '../src/db/schema.ts';
import {zoned} from '../src/dev/sample.ts';
import {calendarList} from '../src/queries/items.ts';
import {sourceList} from '../src/queries/sources.ts';
import {DEFAULT_SCHEDULES} from '../src/domain/sources.ts';
import {connectMailAccount} from '../src/sync/connect.ts';
import {readSourceCredentials} from '../src/secrets/store.ts';
import {updateSettings} from '../src/settings.ts';
import {joinLocation, splitLocation} from '../src/providers/gcal/normalize.ts';
import {calendarWorld, connectPersonal, HOLIDAYS, PERSONAL} from './calendarWorld.ts';

const CLASSES = 'classes@group.calendar.google.com';
import {fakeNtfy} from './fakeNtfy.ts';
import {liveEvents, world} from './helpers.ts';

const conflict = {status: 409, body: {error: {code: 409, message: 'The requested event was modified by another client.', errors: [{domain: 'global', reason: 'conflict'}]}}};

describe('an event\'s location line', () => {
  test.each([
    ['a place and its address', 'Smile Dental', '1420 Elm St, Los Angeles, CA 90026, USA', 'Smile Dental, 1420 Elm St, Los Angeles, CA 90026, USA'],
    ['a place alone', 'University Student Union', null, 'University Student Union'],
    ['an address alone', null, '1420 Elm St, Los Angeles, CA 90026, USA', '1420 Elm St, Los Angeles, CA 90026, USA'],
    // A street address picked from Places is its own place: Google gets it once.
    ['a street picked as the place', '1420 Elm St', '1420 Elm St, Los Angeles, CA 90026, USA', '1420 Elm St, Los Angeles, CA 90026, USA'],
    ['nothing', null, null, ''],
  ])('%s', (_, place, address, line) => expect(joinLocation(place, address)).toBe(line));

  test('a street address reads back as the address in full', () => {
    expect(splitLocation(joinLocation('1420 Elm St', '1420 Elm St, Los Angeles, CA 90026, USA'))).toEqual({place: null, address: '1420 Elm St, Los Angeles, CA 90026, USA'});
  });
});

describe('the mirror', () => {
  test('the calendar list and events: names, colours, series, reminders, places and attendees', async () => {
    const {w, run, titles, day, calendar, source} = await calendarWorld();
    await run();
    expect(w.store.db.select().from(t.calendars).all().map(row => [row.name, row.colour])).toEqual([['Personal', 'cool'], ['Holidays in United States', 'good']]);
    expect(titles('2026-10-07')).toEqual(['Gym 7:00 AM']);
    expect(titles('2026-10-09')).toEqual(['Gym 7:00 AM', 'Dinner with Sam 7:00 PM']);
    expect(day('2026-10-09').find(item => item.title === 'Dinner with Sam')).toMatchObject({place: 'Blue Door', address: '2118 Sunset Blvd', attendees: ['Sam Lee'], reminders: [60], read_only: false});
    // useDefault takes the calendar's default reminders.
    expect(day('2026-10-07')[0]).toMatchObject({title: 'Gym', recurring: true, reminders: [10]});
    expect(day('2026-10-12').map(item => [item.title, item.all_day, item.calendar_id])).toEqual([['Columbus Day', true, calendar(HOLIDAYS).id], ['Gym', false, calendar(PERSONAL).id]]);
    expect(sourceList(w.store).find(row => row.id === source.id)!.health.state).toBe('healthy');
    expect(liveEvents(w).some(event => event.type === 'items' && event.items.length > 0)).toBe(true);
  });

  test('a change made in Google arrives on the next sync, and a deletion takes the event away', async () => {
    const {w, google, engine, run, titles, source} = await calendarWorld();
    await run();
    google.put(PERSONAL, {...google.event(PERSONAL, 'dinner')!, start: {dateTime: zoned('2026-10-09', '19:30')}, end: {dateTime: zoned('2026-10-09', '21:30')}});
    google.put(PERSONAL, {...google.event(PERSONAL, 'gym_20261014T140000Z') ?? {
      id: 'gym_20261014T140000Z', recurringEventId: 'gym', originalStartTime: {dateTime: zoned('2026-10-14', '07:00')}, summary: 'Gym',
      start: {dateTime: zoned('2026-10-14', '07:00')}, end: {dateTime: zoned('2026-10-14', '08:00')},
    }, status: 'cancelled'});
    engine.pushed(source.id);
    await run();
    expect(titles('2026-10-09')).toEqual(['Gym 7:00 AM', 'Dinner with Sam 7:30 PM']);
    expect(titles('2026-10-14')).toEqual([]);
    // The incremental request carried the token, not a time range.
    const incremental = google.requests.filter(request => request.path.endsWith(`/calendars/${encodeURIComponent(PERSONAL)}/events`)).at(-1)!;
    expect(incremental.query.get('syncToken')).toMatch(/^sync-/);
    expect(incremental.query.get('timeMin')).toBeNull();
    google.put(PERSONAL, {...google.event(PERSONAL, 'dinner')!, status: 'cancelled'});
    engine.pushed(source.id);
    await run();
    expect(titles('2026-10-09')).toEqual(['Gym 7:00 AM']);
    void w;
  });

  test('a series with an EXDATE, which the expander can\'t draw alone, takes Google\'s instances', async () => {
    const {google, run, titles} = await calendarWorld();
    google.put(PERSONAL, {
      id: 'lecture', summary: 'CS 101 lecture', start: {dateTime: zoned('2026-08-25', '18:00'), timeZone: 'America/Los_Angeles'}, end: {dateTime: zoned('2026-08-25', '19:15'), timeZone: 'America/Los_Angeles'},
      recurrence: ['EXDATE;TZID=America/Los_Angeles:20261008T180000', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261204T075959Z'],
    });
    await run();
    expect(titles('2026-10-06')).toEqual(['CS 101 lecture 6:00 PM']);
    expect(titles('2026-10-08')).toEqual([]);
    expect(titles('2026-10-13')).toEqual(['CS 101 lecture 6:00 PM']);
  });

  test('a sync token Google dropped (410) is replaced by a full read', async () => {
    const {google, engine, run, titles, source} = await calendarWorld();
    await run();
    google.dropSyncTokens();
    google.put(PERSONAL, {id: 'coffee', summary: 'Coffee', start: {dateTime: zoned('2026-10-08', '10:00')}, end: {dateTime: zoned('2026-10-08', '10:30')}});
    engine.pushed(source.id);
    await run();
    expect(titles('2026-10-08')).toEqual(['Coffee 10:00 AM']);
    const reads = google.requests.filter(request => request.path.endsWith(`/calendars/${encodeURIComponent(PERSONAL)}/events`)).slice(-2);
    expect(reads.map(request => [request.query.get('syncToken') !== null, request.query.get('timeMin') !== null])).toEqual([[true, false], [false, true]]);
  });

  test('pages are followed to the last, which carries the sync token', async () => {
    const {google, run, titles} = await calendarWorld();
    for (let at = 0; at < 60; at += 1) google.put(PERSONAL, {id: `filler${at}`, summary: `Filler ${at}`, start: {dateTime: zoned('2026-11-02', '12:00')}, end: {dateTime: zoned('2026-11-02', '12:30')}});
    await run();
    expect(titles('2026-11-02')).toHaveLength(61);
    expect(google.requests.some(request => request.query.get('pageToken') === '50')).toBe(true);
  });

  test('SV-9: a calendar on two accounts\' lists (Personal shared in, Holidays) syncs under each account, with its own items', async () => {
    const {w, google, run, account, source} = await calendarWorld();
    google.addCalendar({id: 'work@example.net', summary: 'Work', backgroundColor: '#9a9cff', primary: true}, ['refresh-work']);
    google.put('work@example.net', {id: 'standup', summary: 'Standup', start: {dateTime: zoned('2026-10-09', '09:00')}, end: {dateTime: zoned('2026-10-09', '09:15')}});
    const work = connectMailAccount(w.store, {
      provider: 'gmail', address: 'user@example.net', label: 'Work', colour: 'warm', icon: 'briefcase',
      credentials: {kind: 'oauth', refresh_token: 'refresh-work', access_token: null, expires_at: null, scope: null},
      syncMode: DEFAULT_SCHEDULES.gmail.mode, intervalSeconds: DEFAULT_SCHEDULES.gmail.intervalSeconds,
      alsoSources: [{provider: 'google_calendar', syncMode: DEFAULT_SCHEDULES.google_calendar.mode, intervalSeconds: DEFAULT_SCHEDULES.google_calendar.intervalSeconds}],
    });
    await run();
    const health = (id: number) => sourceList(w.store).find(row => row.id === id)!.health.state;
    expect([health(source.id), health(work.sourceIds[1]!)]).toEqual(['healthy', 'healthy']);
    // The two accounts sync at once, so either may insert first: order by account, then list position.
    const rows = w.store.db.select().from(t.calendars).orderBy(t.calendars.accountId, t.calendars.position).all();
    expect(rows.map(row => [row.accountId, row.providerId])).toEqual([
      [account.id, PERSONAL], [account.id, HOLIDAYS], [work.accountId, PERSONAL], [work.accountId, 'work@example.net'], [work.accountId, HOLIDAYS],
    ]);
    // Each account's copy holds its own rows of the shared calendar's events.
    const dinners = w.store.db.select().from(t.items).where(eq(t.items.providerId, 'dinner')).all();
    expect(dinners.map(row => row.calendarId).sort()).toEqual(rows.filter(row => row.providerId === PERSONAL).map(row => row.id).sort());
    expect(w.store.db.select().from(t.items).where(eq(t.items.providerId, 'columbus')).all()).toHaveLength(2);
    expect(w.store.db.select().from(t.items).where(eq(t.items.providerId, 'standup')).all().map(row => row.calendarId)).toEqual([rows[3]!.id]);
  });
});

describe('changes through the command layer', () => {
  test('create: pending, then confirmed with the id Setpoint chose; a retry after a lost answer finds it', async () => {
    const {w, google, run, calendar, command, titles} = await calendarWorld();
    await run();
    // Google makes the event, but its answer is lost (a 503 after the write).
    google.fault({method: 'POST', path: /\/events$/, response: {status: 503, body: {error: {code: 503, message: 'Backend Error', errors: [{reason: 'backendError'}]}}}});
    const created = createItem(w.store, itemCreateInput.parse({
      kind: 'event', calendar_id: calendar(PERSONAL).id, title: 'Coffee with Priya', place: 'Blue Bottle', address: '1 Ferry Building',
      starts_at: zoned('2026-10-08', '10:00'), ends_at: zoned('2026-10-08', '10:30'), reminders: [10],
    }));
    await run();
    // Transient: still pending, retried after 30 s.
    expect(command(created.id).state).toBe('pending');
    w.advance(30_000);
    await run();
    expect(command(created.id)).toMatchObject({state: 'confirmed', providerMessage: null});
    const row = w.store.db.select().from(t.items).where(eq(t.items.id, created.targetId)).get()!;
    expect(row.providerId).toMatch(/^sp[0-9a-f]{30}$/);
    expect(google.event(PERSONAL, row.providerId)).toMatchObject({
      summary: 'Coffee with Priya', location: 'Blue Bottle, 1 Ferry Building', reminders: {useDefault: false, overrides: [{method: 'popup', minutes: 10}]},
      start: {dateTime: zoned('2026-10-08', '10:00'), timeZone: 'America/Los_Angeles'},
    });
    // The retry found it already there: one event, not two.
    expect(google.events(PERSONAL).filter(event => event.summary === 'Coffee with Priya')).toHaveLength(1);
    w.advance(16 * 60_000);
    await run();
    expect(titles('2026-10-08')).toEqual(['Coffee with Priya 10:00 AM']);
  });

  test('a recurring move, This event: Wednesday\'s Gym moves to Thursday at Google as an exception', async () => {
    const {w, google, run, item, titles, command} = await calendarWorld();
    await run();
    const moved = updateItem(w.store, item('gym').id, itemUpdateInput.parse({
      changes: {starts_at: zoned('2026-10-08', '07:00'), ends_at: zoned('2026-10-08', '08:00')}, scope: 'this', occurrence_start: zoned('2026-10-07', '07:00'),
    }));
    await run();
    expect(command(moved.id)).toMatchObject({state: 'confirmed', providerMessage: null});
    expect(google.event(PERSONAL, 'gym_20261007T140000Z')).toMatchObject({recurringEventId: 'gym', start: {dateTime: zoned('2026-10-08', '07:00')}});
    expect(google.event(PERSONAL, 'gym')!.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR']);
    // After a full read, the mirror says the same, with Google's ids.
    w.advance(25 * 3600_000);
    await run();
    expect(titles('2026-10-07')).toEqual([]);
    expect(titles('2026-10-08')).toEqual(['Gym 7:00 AM']);
    expect(titles('2026-10-14')).toEqual(['Gym 7:00 AM']);
    expect(w.store.db.select().from(t.items).where(eq(t.items.title, 'Gym')).all().map(row => row.providerId).sort()).toEqual(['gym', 'gym_20261007T140000Z']);
  });

  test('a recurring move, This and following: the series ends before Oct 7 and a new one runs Mon, Thu, Fri', async () => {
    const {w, google, run, item, titles, command} = await calendarWorld();
    await run();
    const moved = updateItem(w.store, item('gym').id, itemUpdateInput.parse({
      changes: {starts_at: zoned('2026-10-08', '07:00'), ends_at: zoned('2026-10-08', '08:00')}, scope: 'following', occurrence_start: zoned('2026-10-07', '07:00'),
    }));
    await run();
    expect(command(moved.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'gym')!.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261007T135959Z']);
    const series = google.events(PERSONAL).filter(event => event.summary === 'Gym' && event.id !== 'gym');
    expect(series).toEqual([expect.objectContaining({recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TH,FR'], start: {dateTime: zoned('2026-10-08', '07:00'), timeZone: 'America/Los_Angeles'}})]);
    w.advance(25 * 3600_000);
    await run();
    expect(titles('2026-10-05')).toEqual(['Gym 7:00 AM']);
    expect(titles('2026-10-07')).toEqual([]);
    expect(titles('2026-10-08')).toEqual(['Gym 7:00 AM']);
    expect(titles('2026-10-15')).toEqual(['Gym 7:00 AM']);
  });

  test('a recurring move, All events: the series shifts by the move (Wednesday → Thursday), past ones too', async () => {
    const {w, google, run, item, titles, command} = await calendarWorld();
    await run();
    const moved = updateItem(w.store, item('gym').id, itemUpdateInput.parse({
      changes: {starts_at: zoned('2026-10-08', '07:00'), ends_at: zoned('2026-10-08', '08:00')}, scope: 'all', occurrence_start: zoned('2026-10-07', '07:00'),
    }));
    await run();
    expect(command(moved.id).state).toBe('confirmed');
    // v1 moved the series' start to the edited occurrence; v2 shifts it by the change (Aug 31 + 1 day).
    expect(google.event(PERSONAL, 'gym')).toMatchObject({start: {dateTime: zoned('2026-09-01', '07:00'), timeZone: 'America/Los_Angeles'}, recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,TH,FR']});
    w.advance(25 * 3600_000);
    await run();
    expect(titles('2026-09-30')).toEqual([]);
    expect(titles('2026-10-01')).toEqual(['Gym 7:00 AM']);
    expect(titles('2026-10-08')).toEqual(['Gym 7:00 AM']);
  });

  test('board 19b: a 409 fails in place with Google\'s words; Try again sends it again; Move back restores it', async () => {
    const {w, google, run, item, titles, command, day} = await calendarWorld();
    await run();
    google.fault({method: 'PATCH', path: /\/events\/dinner$/, response: conflict});
    const moved = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {starts_at: zoned('2026-10-10', '19:00'), ends_at: zoned('2026-10-10', '21:00')}}));
    await run();
    expect(command(moved.id)).toMatchObject({state: 'failed', providerMessage: 'The requested event was modified by another client. (409 Conflict)'});
    // In place: still on Saturday, with the failure, and a sync doesn't put it back.
    w.advance(16 * 60_000);
    await run();
    const failed = day('2026-10-10').find(entry => entry.title === 'Dinner with Sam')!;
    expect(failed.command).toMatchObject({state: 'failed', provider: 'google_calendar', can_retry: true, can_move_back: true, provider_message: 'The requested event was modified by another client. (409 Conflict)'});
    expect(google.event(PERSONAL, 'dinner')!.start!.dateTime).toBe(zoned('2026-10-09', '19:00'));
    // Try again: Google takes it this time.
    retryCommand(w.store, moved.id);
    await run();
    expect(command(moved.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'dinner')!.start).toEqual({dateTime: zoned('2026-10-10', '19:00'), timeZone: 'America/Los_Angeles'});
    // Another one fails, and Move back takes it back to where Google has it.
    google.fault({method: 'PATCH', path: /\/events\/dinner$/, response: conflict});
    const again = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {title: 'Dinner with Sam and Jo'}}));
    await run();
    expect(command(again.id).state).toBe('failed');
    moveBackCommand(w.store, again.id);
    expect(titles('2026-10-10')).toEqual(['Dinner with Sam 7:00 PM']);
  });

  test('an event changed in Google since Setpoint saw it is refused (412), not overwritten', async () => {
    const {w, google, run, item, command} = await calendarWorld();
    await run();
    google.put(PERSONAL, {...google.event(PERSONAL, 'dinner')!, summary: 'Dinner with Sam (moved inside)'});
    const renamed = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {title: 'Dinner'}}));
    await run();
    expect(command(renamed.id)).toMatchObject({state: 'failed', providerMessage: 'Precondition Failed (412 Precondition Failed)'});
    expect(google.event(PERSONAL, 'dinner')!.summary).toBe('Dinner with Sam (moved inside)');
  });

  test('deleting: one occurrence is cancelled, following trims the series, all deletes it; already gone counts as done', async () => {
    const {w, google, run, item, titles, command} = await calendarWorld();
    await run();
    const one = deleteItem(w.store, item('gym').id, itemScopeInput.parse({scope: 'this', occurrence_start: zoned('2026-10-09', '07:00')}));
    await run();
    expect(command(one.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'gym_20261009T140000Z')).toMatchObject({status: 'cancelled'});
    expect(titles('2026-10-09')).toEqual(['Dinner with Sam 7:00 PM']);
    const following = deleteItem(w.store, item('gym').id, itemScopeInput.parse({scope: 'following', occurrence_start: zoned('2026-10-19', '07:00')}));
    await run();
    expect(command(following.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'gym')!.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261019T135959Z']);
    expect(titles('2026-10-19')).toEqual([]);
    expect(titles('2026-10-16')).toEqual(['Gym 7:00 AM']);
    // Someone deleted Dinner in Google already: Setpoint's delete is done, not failed.
    google.put(PERSONAL, {...google.event(PERSONAL, 'dinner')!, status: 'cancelled'});
    const dinner = deleteItem(w.store, item('dinner').id, itemScopeInput.parse({}));
    await run();
    expect(command(dinner.id).state).toBe('confirmed');
    const all = deleteItem(w.store, item('gym').id, itemScopeInput.parse({scope: 'all'}));
    await run();
    expect(command(all.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'gym')!.status).toBe('cancelled');
    expect(titles('2026-10-12')).toEqual(['Columbus Day']);
  });

  test('Google\'s own kinds of event are shown, never written', async () => {
    const {w, google, run, item} = await calendarWorld();
    google.put(PERSONAL, {id: 'birthday1', summary: 'Sam\'s birthday', eventType: 'birthday', start: {date: '2026-10-20'}, end: {date: '2026-10-21'}, recurrence: ['RRULE:FREQ=YEARLY']});
    await run();
    expect(item('birthday1').readOnly).toBe(true);
    expect(() => updateItem(w.store, item('birthday1').id, itemUpdateInput.parse({changes: {title: 'x'}}))).toThrow(/be changed here/);
  });

  test('F6: an event\'s own colour reads from Google\'s colorId and is written back only when it changes', async () => {
    const {w, google, run, item, calendar, command, day} = await calendarWorld();
    google.put(PERSONAL, {...google.event(PERSONAL, 'dinner')!, colorId: '1'});
    await run();
    // Lavender (1) reads as violet; Gym has none, so it takes its calendar's.
    expect(day('2026-10-09').map(entry => [entry.title, entry.colour])).toEqual([['Gym', null], ['Dinner with Sam', 'violet']]);
    // Another change leaves Google's Lavender alone (violet would write back as Grape, 3).
    const renamed = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {title: 'Dinner with Sam and Jo'}}));
    await run();
    expect(command(renamed.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'dinner')!.colorId).toBe('1');
    // Colour: Blueberry (9) for cool; none again clears it.
    const coloured = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {colour: 'cool'}}));
    await run();
    expect(command(coloured.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'dinner')!.colorId).toBe('9');
    const cleared = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {colour: null}}));
    await run();
    expect(command(cleared.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'dinner')!.colorId).toBeNull();
    // One occurrence of a series alone, and a new event with a colour.
    const gym = updateItem(w.store, item('gym').id, itemUpdateInput.parse({changes: {colour: 'good'}, scope: 'this', occurrence_start: zoned('2026-10-09', '07:00')}));
    await run();
    expect(command(gym.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'gym_20261009T140000Z')).toMatchObject({colorId: '10'});
    expect(google.event(PERSONAL, 'gym')!.colorId).toBeUndefined();
    const created = createItem(w.store, itemCreateInput.parse({
      kind: 'event', calendar_id: calendar(PERSONAL).id, title: 'Coffee', colour: 'sun', starts_at: zoned('2026-10-08', '10:00'), ends_at: zoned('2026-10-08', '10:30'),
    }));
    await run();
    const row = w.store.db.select().from(t.items).where(eq(t.items.id, created.targetId)).get()!;
    expect(google.event(PERSONAL, row.providerId)).toMatchObject({summary: 'Coffee', colorId: '5'});
    w.advance(25 * 3600_000);
    await run();
    expect(day('2026-10-09').map(entry => [entry.title, entry.colour])).toEqual([['Gym', 'good'], ['Dinner with Sam and Jo', null]]);
    expect(day('2026-10-08').find(entry => entry.title === 'Coffee')!.colour).toBe('sun');
  });

  test('SV-31: an event\'s Time to Leave reads from its private property, is written with every change, and is off for a new event', async () => {
    const {w, google, run, item, calendar, command} = await calendarWorld();
    google.put(PERSONAL, {...google.event(PERSONAL, 'dinner')!, extendedProperties: {private: {setpointTimeToLeave: 'on'}}});
    await run();
    expect([item('dinner').leaveReminder, item('gym').leaveReminder]).toEqual([true, false]);
    // Taken off: "off", since Google's patch would keep a property left out.
    const off = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {leave_reminder: false}}));
    await run();
    expect(command(off.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'dinner')!.extendedProperties).toEqual({private: {setpointTimeToLeave: 'off'}});
    expect(item('dinner').leaveReminder).toBe(false);
    // One occurrence of a series alone.
    const gym = updateItem(w.store, item('gym').id, itemUpdateInput.parse({changes: {leave_reminder: true}, scope: 'this', occurrence_start: zoned('2026-10-09', '07:00')}));
    await run();
    expect(command(gym.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'gym_20261009T140000Z')!.extendedProperties).toEqual({private: {setpointTimeToLeave: 'on'}});
    expect(google.event(PERSONAL, 'gym')!.extendedProperties).toBeUndefined();
    // A new event has none unless asked for.
    const created = createItem(w.store, itemCreateInput.parse({
      kind: 'event', calendar_id: calendar(PERSONAL).id, title: 'Coffee', place: 'Blue Door', starts_at: zoned('2026-10-08', '10:00'), ends_at: zoned('2026-10-08', '10:30'),
    }));
    await run();
    const row = w.store.db.select().from(t.items).where(eq(t.items.id, created.targetId)).get()!;
    expect([row.leaveReminder, google.event(PERSONAL, row.providerId)!.extendedProperties]).toEqual([false, {private: {setpointTimeToLeave: 'off'}}]);
    // … and one asked for is created with it.
    const asked = createItem(w.store, itemCreateInput.parse({
      kind: 'event', calendar_id: calendar(PERSONAL).id, title: 'Lunch', place: 'Blue Door', leave_reminder: true, starts_at: zoned('2026-10-08', '12:00'), ends_at: zoned('2026-10-08', '13:00'),
    }));
    await run();
    const lunch = w.store.db.select().from(t.items).where(eq(t.items.id, asked.targetId)).get()!;
    expect([lunch.leaveReminder, google.event(PERSONAL, lunch.providerId)!.extendedProperties]).toEqual([true, {private: {setpointTimeToLeave: 'on'}}]);
  });

  test('F6b: to another calendar: events.move with the etag, then the rest of the change there; the mirror follows', async () => {
    const {w, google, run, item, calendar, command, day, titles} = await calendarWorld();
    google.addCalendar({id: CLASSES, summary: 'Classes', backgroundColor: '#9fe1e7'});
    await run();
    const etag = item('dinner').etag;
    const moved = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {calendar_id: calendar(CLASSES).id, title: 'Dinner with Sam and Jo'}}));
    // At once, pending, in its new calendar.
    expect(day('2026-10-09').find(entry => entry.title === 'Dinner with Sam and Jo')).toMatchObject({calendar_id: calendar(CLASSES).id, command: {state: 'pending'}});
    await run();
    expect(command(moved.id)).toMatchObject({state: 'confirmed', providerMessage: null});
    const move = google.requests.find(request => request.path.endsWith('/events/dinner/move'))!;
    expect([move.method, move.query.get('destination'), move.headers['if-match']]).toEqual(['POST', CLASSES, etag]);
    expect(google.event(CLASSES, 'dinner')).toMatchObject({summary: 'Dinner with Sam and Jo', status: 'confirmed'});
    expect(google.event(PERSONAL, 'dinner')!.status).toBe('cancelled');
    // After a full read of both calendars, one Dinner, in Classes.
    w.advance(25 * 3600_000);
    await run();
    expect(titles('2026-10-09')).toEqual(['Gym 7:00 AM', 'Dinner with Sam and Jo 7:00 PM']);
    expect(day('2026-10-09').find(entry => entry.title === 'Dinner with Sam and Jo')!.calendar_id).toBe(calendar(CLASSES).id);
  });

  test('F6b: a move whose answer was lost: the retry finds the event already in the other calendar, and moves nothing twice', async () => {
    const {w, google, run, item, calendar, command} = await calendarWorld();
    google.addCalendar({id: CLASSES, summary: 'Classes', backgroundColor: '#9fe1e7'});
    await run();
    google.fault({method: 'POST', path: /\/events\/dinner\/move/, response: {status: 503, body: {error: {code: 503, message: 'Backend Error', errors: [{reason: 'backendError'}]}}}});
    const moved = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {calendar_id: calendar(CLASSES).id}}));
    await run();
    expect(command(moved.id).state).toBe('pending');
    // Google had moved it before its answer was lost.
    const dinner = google.event(PERSONAL, 'dinner')!;
    google.put(CLASSES, dinner);
    google.put(PERSONAL, {...dinner, status: 'cancelled'});
    w.advance(30_000);
    await run();
    expect(command(moved.id)).toMatchObject({state: 'confirmed', providerMessage: null});
    const calls = google.requests.filter(request => request.path.includes('/events/dinner')).map(request => `${request.method} ${decodeURIComponent(request.path.replace(/^\/calendar\/v3\/calendars\//, ''))}`);
    expect(calls).toEqual([`POST ${PERSONAL}/events/dinner/move`, `POST ${PERSONAL}/events/dinner/move`, `GET ${CLASSES}/events/dinner`]);
    expect(google.events(CLASSES).filter(event => event.summary === 'Dinner with Sam')).toHaveLength(1);
    expect(item('dinner')).toBeUndefined();
    expect(w.store.db.select().from(t.items).where(eq(t.items.providerId, 'dinner')).get()).toMatchObject({calendarId: calendar(CLASSES).id, etag: google.event(CLASSES, 'dinner')!.etag});
  });

  test('F6b: a move refused with 412 (changed elsewhere) or 409 fails in place in Google\'s words; Move back and Try again', async () => {
    const {w, google, run, item, calendar, command, day} = await calendarWorld();
    google.addCalendar({id: CLASSES, summary: 'Classes', backgroundColor: '#9fe1e7'});
    await run();
    const dinnerId = item('dinner').id;
    google.put(PERSONAL, {...google.event(PERSONAL, 'dinner')!, summary: 'Dinner with Sam (moved inside)'});
    const stale = updateItem(w.store, dinnerId, itemUpdateInput.parse({changes: {calendar_id: calendar(CLASSES).id}}));
    await run();
    expect(command(stale.id)).toMatchObject({state: 'failed', providerMessage: 'Precondition Failed (412 Precondition Failed)'});
    expect(google.event(PERSONAL, 'dinner')!.status).toBe('confirmed');
    expect(google.event(CLASSES, 'dinner')).toBeUndefined();
    // In place: shown in Classes, failed, until Move back.
    expect(day('2026-10-09').find(entry => entry.id === dinnerId)).toMatchObject({calendar_id: calendar(CLASSES).id, command: {state: 'failed', can_move_back: true}});
    moveBackCommand(w.store, stale.id);
    expect(day('2026-10-09').find(entry => entry.id === dinnerId)!.calendar_id).toBe(calendar(PERSONAL).id);
    // Setpoint catches up with the change made elsewhere, then a 409 fails the next move; Try again takes it.
    w.advance(16 * 60_000);
    await run();
    google.fault({method: 'POST', path: /\/events\/dinner\/move/, response: conflict});
    const again = updateItem(w.store, dinnerId, itemUpdateInput.parse({changes: {calendar_id: calendar(CLASSES).id}}));
    await run();
    expect(command(again.id)).toMatchObject({state: 'failed', providerMessage: 'The requested event was modified by another client. (409 Conflict)'});
    retryCommand(w.store, again.id);
    await run();
    expect(command(again.id).state).toBe('confirmed');
    expect(google.event(CLASSES, 'dinner')).toMatchObject({summary: 'Dinner with Sam (moved inside)', status: 'confirmed'});
  });

  test('F6b: a repeating event moves as a series: All events moves it whole, This and following starts a new one there, one occurrence is refused', async () => {
    const {w, google, run, item, calendar, command, titles, day} = await calendarWorld();
    google.addCalendar({id: CLASSES, summary: 'Classes', backgroundColor: '#9fe1e7'});
    await run();
    const classes = calendar(CLASSES).id;
    // Google refuses to move one occurrence (cannotChangeOrganizerOfInstance), so Setpoint does before asking.
    expect(() => updateItem(w.store, item('gym').id, itemUpdateInput.parse({changes: {calendar_id: classes}, scope: 'this', occurrence_start: zoned('2026-10-09', '07:00')}))).toThrow(/only as a series/);
    // This and following from Fri, Oct 9: the series ends before it in Personal and goes on in Classes.
    const following = updateItem(w.store, item('gym').id, itemUpdateInput.parse({changes: {calendar_id: classes}, scope: 'following', occurrence_start: zoned('2026-10-09', '07:00')}));
    await run();
    expect(command(following.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'gym')!.recurrence).toEqual(['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261009T135959Z']);
    expect(google.events(CLASSES).filter(event => event.summary === 'Gym')).toEqual([expect.objectContaining({recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'], start: {dateTime: zoned('2026-10-09', '07:00'), timeZone: 'America/Los_Angeles'}})]);
    w.advance(25 * 3600_000);
    await run();
    expect(day('2026-10-07').map(entry => [entry.title, entry.calendar_id])).toEqual([['Gym', calendar(PERSONAL).id]]);
    expect(day('2026-10-12').map(entry => [entry.title, entry.calendar_id])).toEqual([['Columbus Day', calendar(HOLIDAYS).id], ['Gym', classes]]);
    // All events: the Personal part, with an occurrence changed on its own, moves whole.
    const lone = updateItem(w.store, item('gym').id, itemUpdateInput.parse({changes: {title: 'Gym (legs)'}, scope: 'this', occurrence_start: zoned('2026-10-05', '07:00')}));
    await run();
    expect(command(lone.id).state).toBe('confirmed');
    const all = updateItem(w.store, item('gym').id, itemUpdateInput.parse({changes: {calendar_id: classes}, scope: 'all', occurrence_start: zoned('2026-10-07', '07:00')}));
    expect(day('2026-10-05').map(entry => [entry.title, entry.calendar_id])).toEqual([['Gym (legs)', classes]]);
    await run();
    expect(command(all.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'gym')!.status).toBe('cancelled');
    expect(google.event(CLASSES, 'gym')).toMatchObject({status: 'confirmed', recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20261009T135959Z']});
    w.advance(25 * 3600_000);
    await run();
    expect(titles('2026-10-05')).toEqual(['Gym (legs) 7:00 AM']);
    expect(day('2026-10-07').map(entry => [entry.title, entry.calendar_id])).toEqual([['Gym', classes]]);
  });

  test('F6b: an event moves only between calendars of its own Google account', async () => {
    const {w, run, item} = await calendarWorld();
    await run();
    const elsewhere = w.store.db.insert(t.calendars).values({provider: 'google', providerId: 'jobs@example.net', name: 'Jobs', colour: 'violet', position: 9}).returning().get();
    expect(() => updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {calendar_id: elsewhere.id}}))).toThrow(/same Google account/);
  });
});

describe('SV-20: a calendar\'s colour, written to Google', () => {
  const forbidden = {status: 403, body: {error: {code: 403, message: 'The caller does not have permission', errors: [{domain: 'global', reason: 'forbidden'}]}}};

  test('picked in Settings: shown at once, pending until Google confirms, written as RGB on the calendar list, and read back as the same swatch', async () => {
    const {w, google, run, calendar, command} = await calendarWorld();
    await run();
    expect(calendar(PERSONAL).colour).toBe('cool');
    const picked = setCalendarColour(w.store, calendar(PERSONAL).id, 'violet');
    expect(calendar(PERSONAL).colour).toBe('violet');
    expect(calendarList(w.store).find(entry => entry.name === 'Personal')!.command).toMatchObject({state: 'pending', kind: 'calendar_colour', target: 'calendar'});
    expect(() => setCalendarColour(w.store, calendar(PERSONAL).id, 'good')).toThrow(/still waiting/);
    await run();
    expect(command(picked.id).state).toBe('confirmed');
    const patch = google.requests.find(request => request.method === 'PATCH' && request.path.endsWith(`/users/me/calendarList/${encodeURIComponent(PERSONAL)}`))!;
    expect(patch.query.get('colorRgbFormat')).toBe('true');
    expect(patch.body).toEqual({backgroundColor: '#c8aefa', foregroundColor: '#000000'});
    expect(google.calendar(PERSONAL)!.backgroundColor).toBe('#c8aefa');
    // The next sync reads Google's colour back: still violet, nothing pending.
    w.advance(16 * 60_000);
    await run();
    expect(calendarList(w.store).find(entry => entry.name === 'Personal')).toMatchObject({colour: 'violet', command: null});
    // ink3, a grey that hue alone reads as ink2, survives the read back too.
    setCalendarColour(w.store, calendar(PERSONAL).id, 'ink3');
    await run();
    w.advance(16 * 60_000);
    await run();
    expect(google.calendar(PERSONAL)).toMatchObject({backgroundColor: '#7d7f84', foregroundColor: '#ffffff'});
    expect(calendar(PERSONAL).colour).toBe('ink3');
    // A colour changed in Google's own app arrives with the next sync.
    google.calendar(PERSONAL)!.backgroundColor = '#16a765';
    w.advance(16 * 60_000);
    await run();
    expect(calendar(PERSONAL).colour).toBe('good');
  });

  test('refused by Google: failed in place with Google\'s words, kept through a sync; Move back restores it, Try again sends it again', async () => {
    const {w, google, run, calendar, command} = await calendarWorld();
    await run();
    google.fault({method: 'PATCH', path: /\/users\/me\/calendarList\//, response: forbidden});
    const picked = setCalendarColour(w.store, calendar(PERSONAL).id, 'warm');
    await run();
    expect(command(picked.id)).toMatchObject({state: 'failed', providerMessage: 'The caller does not have permission (403 Forbidden)'});
    w.advance(16 * 60_000);
    await run();
    expect(calendarList(w.store).find(entry => entry.name === 'Personal')).toMatchObject({
      colour: 'warm', command: {state: 'failed', provider: 'google_calendar', can_retry: true, can_move_back: true, provider_message: 'The caller does not have permission (403 Forbidden)'},
    });
    expect(google.calendar(PERSONAL)!.backgroundColor).toBe('#4986e7');
    moveBackCommand(w.store, picked.id);
    expect(calendarList(w.store).find(entry => entry.name === 'Personal')).toMatchObject({colour: 'cool', command: null});
    // Again, refused once more, then Try again: Google takes it.
    google.fault({method: 'PATCH', path: /\/users\/me\/calendarList\//, response: forbidden});
    const again = setCalendarColour(w.store, calendar(PERSONAL).id, 'warm');
    await run();
    expect(command(again.id).state).toBe('failed');
    retryCommand(w.store, again.id);
    await run();
    expect(command(again.id).state).toBe('confirmed');
    expect(google.calendar(PERSONAL)!.backgroundColor).toBe('#f5ab77');
  });

  test('a consent without calendar-list write (v1\'s carried-over tokens) fails only the colour, in place, saying to reconnect; the account stays healthy and events still write', async () => {
    const {w, google, run, calendar, command, item, source, gmail} = await calendarWorld();
    const ntfy = await fakeNtfy();
    updateSettings(w.store, {notifications: {ntfy_server: ntfy.url}});
    await run();
    const scope = {status: 403, body: {error: {code: 403, message: 'Request had insufficient authentication scopes.', errors: [{domain: 'global', reason: 'insufficientPermissions'}], status: 'PERMISSION_DENIED'}}};
    google.fault({method: 'PATCH', path: /\/users\/me\/calendarList\//, response: scope});
    const picked = setCalendarColour(w.store, calendar(PERSONAL).id, 'violet');
    await run();
    const words = 'Request had insufficient authentication scopes. (403 Forbidden), Reconnect this Google account in Settings › Accounts to allow colour changes';
    expect(command(picked.id)).toMatchObject({state: 'failed', providerMessage: words});
    expect(calendarList(w.store).find(entry => entry.name === 'Personal')).toMatchObject({colour: 'violet', command: {state: 'failed', can_retry: true, can_move_back: true}});
    const health = (id: number) => sourceList(w.store).find(row => row.id === id)!.health.state;
    expect([health(source.id), health(gmail.id)]).toEqual(['healthy', 'healthy']);
    expect(ntfy.published).toEqual([]);
    // An event write on the same account still goes through.
    const renamed = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {title: 'Dinner at Blue Door'}}));
    await run();
    expect(command(renamed.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'dinner')!.summary).toBe('Dinner at Blue Door');
    // Change back restores the colour; after a reconnect, Try again would send it again.
    moveBackCommand(w.store, picked.id);
    expect(calendar(PERSONAL).colour).toBe('cool');
  });

  test('Todoist has no calendar colour, and the colour a calendar already has isn\'t sent again', async () => {
    const {w, run, calendar} = await calendarWorld();
    await run();
    const todoist = w.store.db.insert(t.calendars).values({provider: 'todoist', providerId: 'todoist', name: 'Todoist', colour: null, position: 9}).returning().get();
    expect(() => setCalendarColour(w.store, todoist.id, 'violet')).toThrow(/Todoist has no calendar colour/);
    expect(() => setCalendarColour(w.store, calendar(PERSONAL).id, 'cool')).toThrow(/already has that colour/);
    expect(w.store.db.select().from(t.commands).all()).toEqual([]);
  });
});

describe('Google\'s errors', () => {
  test('a revoked consent is needs reconnect (once, by ntfy) until Gmail is reconnected', async () => {
    const {w, google, run, source, account} = await calendarWorld();
    const ntfy = await fakeNtfy();
    updateSettings(w.store, {notifications: {ntfy_server: ntfy.url}});
    await run();
    google.revoke();
    w.advance(16 * 60_000);
    await run();
    const health = () => sourceList(w.store).find(row => row.id === source.id)!.health;
    expect(health()).toMatchObject({state: 'needs_reconnect', reason: 'Google refused Setpoint\'s access: Token has been expired or revoked. (invalid_grant) (400 Bad Request)'});
    expect(ntfy.published.map(message => [message.body.title, message.body.click])).toEqual([['Personal needs sign-in', 'https://setpoint.example.com/settings/accounts']]);
    w.advance(60 * 60_000);
    await run();
    expect(ntfy.published).toHaveLength(1);
    // Reconnecting Gmail (B2's flow) reconnects Calendar: one consent, written to both.
    connectPersonal(w.store, account.id);
    expect(health().state).not.toBe('needs_reconnect');
  });

  test('429 waits for Retry-After; a hung Google is a timeout, retried', async () => {
    const {w, google, run, item, command, restart} = await calendarWorld();
    await run();
    google.fault({method: 'PATCH', path: /\/events\/dinner$/, response: {status: 429, headers: {'retry-after': '120'}, body: {error: {code: 429, message: 'Rate Limit Exceeded', errors: [{reason: 'rateLimitExceeded'}]}}}});
    const renamed = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {title: 'Dinner at Blue Door'}}));
    await run();
    expect(command(renamed.id).state).toBe('pending');
    const job = () => w.store.db.select().from(t.jobs).where(eq(t.jobs.commandId, renamed.id)).get()!;
    expect(Date.parse(job().runAt) - w.store.now().getTime()).toBe(120_000);
    w.advance(120_000);
    // A short timeout for the hung PATCH only: the full sync and the retry take what they take.
    restart(null, 300);
    google.fault({method: 'PATCH', path: /\/events\/dinner$/, response: 'hang'});
    await run();
    expect(command(renamed.id).state).toBe('pending');
    expect(job().lastError).toMatch(/didn't answer in time/);
    restart(null);
    w.advance(60_000);
    await run();
    expect(command(renamed.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, 'dinner')!.summary).toBe('Dinner at Blue Door');
  });

  test('403 rate limits wait; 403 forbidden is the provider\'s refusal', async () => {
    const {w, google, run, item, command} = await calendarWorld();
    await run();
    google.fault({method: 'PATCH', path: /\/events\/dinner$/, response: {status: 403, body: {error: {code: 403, message: 'Rate Limit Exceeded', errors: [{reason: 'userRateLimitExceeded'}]}}}});
    const renamed = updateItem(w.store, item('dinner').id, itemUpdateInput.parse({changes: {title: 'Dinner'}}));
    await run();
    expect(command(renamed.id).state).toBe('pending');
    w.advance(30_000);
    google.fault({method: 'PATCH', path: /\/events\/dinner$/, response: {status: 403, body: {error: {code: 403, message: 'You need to have writer access to this calendar.', errors: [{reason: 'requiredAccessLevel'}]}}}});
    await run();
    expect(command(renamed.id)).toMatchObject({state: 'failed', providerMessage: 'You need to have writer access to this calendar. (403 Forbidden)'});
  });
});

describe('sources', () => {
  test('Connect Gmail gives a Google account exactly one Calendar source (one consent), reconnecting keeps it, and there\'s one weather source', async () => {
    const {w, account, gmail, source} = await calendarWorld();
    expect(ensureCalendarSources(w.store)).toHaveLength(1);
    expect(connectPersonal(w.store, account.id)).toMatchObject({accountId: account.id, sourceIds: [gmail.id, source.id], created: false});
    expect(connectPersonal(w.store)).toMatchObject({accountId: account.id, sourceIds: [gmail.id, source.id], created: false});
    expect(ensureCalendarSources(w.store)).toEqual([]);
    expect(w.store.db.select().from(t.sources).all().map(row => [row.provider, row.accountId, row.syncMode, row.intervalSeconds])).toEqual([
      ['gmail', account.id, 'push', 300], ['google_calendar', account.id, 'push', 900], ['weather', null, 'poll', 1800],
    ]);
    // Both hold the consent, so Calendar refreshes its own tokens.
    expect([readSourceCredentials(w.store, gmail.id), readSourceCredentials(w.store, source.id)].map(credentials => credentials?.kind === 'oauth' && credentials.refresh_token)).toEqual(['refresh-personal', 'refresh-personal']);
  });

  test('the seed\'s dev sources stay the only ones', () => {
    const w = world({seed: true});
    expect(ensureCalendarSources(w.store)).toEqual([]);
  });
});
