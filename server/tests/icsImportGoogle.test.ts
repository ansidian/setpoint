// SV-181: an .ics file read for review, then imported into a Google calendar by events.import,
// against the fake Google (D436–D438). The files are SV-178's invented ones.
import {icsImportInput} from '@setpoint/shared';
import type {IcsEventOut, IcsReadOut} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {importEvent, readImport} from '../src/calendar/icsImport.ts';
import {deleteItem} from '../src/commands/items.ts';
import {moveBackCommand, retryCommand} from '../src/commands/index.ts';
import {ICS_ERRORS, ICS_MAX_BYTES} from '../src/domain/icsImport.ts';
import {updateSettings} from '../src/settings.ts';
import {calendarWorld, PERSONAL} from './calendarWorld.ts';
import {CONFERENCE_SCHEDULE, crlf, INTERVIEW_INVITE, OUTLOOK_SERIES, OUTLOOK_SERIES_UID} from './fixtures/icsFiles.ts';
import {ORIGIN, signedIn, world} from './helpers.ts';

/** What the review sends back for one event: the draft as read, without the review's own fields. */
const sendable = (event: IcsEventOut) => {
  const {past: _past, existing: _existing, ...rest} = event;
  return rest;
};
const importInput = (calendarId: number, event: IcsEventOut, extra: Record<string, unknown> = {}) =>
  icsImportInput.parse({calendar_id: calendarId, event: {...sendable(event), ...extra}});

describe('SV-181: reading a file for review', () => {
  test('the route reads the file\'s bytes into drafts in start order, with what it leaves out; a bad file is one line', async () => {
    const w = world();
    const c = await signedIn(w);
    const read = async (text: string) => {
      const response = await c.app.request('/api/calendar/import/read', {
        method: 'POST', body: text, headers: {origin: ORIGIN, cookie: c.cookie!, 'content-type': 'text/calendar'},
      });
      return {status: response.status, body: await response.json() as IcsReadOut & {error?: {message: string}}};
    };
    const conference = await read(crlf(CONFERENCE_SCHEDULE));
    expect(conference.status).toBe(200);
    expect(conference.body.events.map(event => event.title)).toEqual(['Opening keynote', 'Typed SQL in practice', 'Calendars are hard', 'Accessible tables', 'Closing panel']);
    expect(conference.body.events[0]).toMatchObject({
      ical_uid: '101@devcon.example.com', place: 'Main Hall', address: 'Northwind Conference Center', transparency: 'transparent',
      url: 'https://devcon.example.com/sessions/101', reminders: [], recurrence: [], past: false, existing: [],
    });
    expect(conference.body.dropped).toMatchObject({categories: 5, cancelled: 0});
    expect(await read('not a calendar')).toMatchObject({status: 400, body: {error: {message: ICS_ERRORS.unreadable}}});
    // Over 2 MB, refused in readIcs's words rather than by the body limit.
    expect(await read(crlf(CONFERENCE_SCHEDULE).padEnd(ICS_MAX_BYTES + 10, ' '))).toMatchObject({status: 400, body: {error: {message: ICS_ERRORS.tooBig}}});
  });

  test('a past event is marked past, and an event a calendar already holds names that calendar', async () => {
    const {w, run, calendar} = await calendarWorld();
    await run();
    const invite = readImport(w.store, crlf(INTERVIEW_INVITE)).events[0]!;
    expect(invite).toMatchObject({title: 'Interview with Contoso: Software Engineer', past: false, existing: [], reminders: [30], time_zone: 'America/New_York'});
    importEvent(w.store, importInput(calendar(PERSONAL).id, invite));
    await run();
    expect(readImport(w.store, crlf(INTERVIEW_INVITE)).events[0]!.existing).toEqual([calendar(PERSONAL).id]);
    w.advance(40 * 86_400_000);
    expect(readImport(w.store, crlf(INTERVIEW_INVITE)).events[0]!.past).toBe(true);
  });
});

describe('SV-181: importing into Google', () => {
  test('one event: events.import with its iCalUID, description, source.url, free/busy and only the file\'s reminders', async () => {
    const {w, google, run, calendar, command, day} = await calendarWorld();
    await run();
    // Settings › Notifications' default never applies to an import (D438).
    updateSettings(w.store, {reminders: {event_minutes_before: 10, task_time: null}});
    const keynote = readImport(w.store, crlf(CONFERENCE_SCHEDULE)).events[0]!;
    const asked = importEvent(w.store, importInput(calendar(PERSONAL).id, keynote));
    expect(asked).toMatchObject({kind: 'item_create', state: 'pending'});
    expect(day('2026-11-12').find(item => item.title === 'Opening keynote')).toMatchObject({command: {state: 'pending'}, transparency: 'transparent', link: 'https://devcon.example.com/sessions/101'});
    await run();
    expect(command(asked.id).state).toBe('confirmed');
    expect(google.imports).toHaveLength(1);
    expect(google.imports[0]!.body).toMatchObject({
      iCalUID: '101@devcon.example.com', summary: 'Opening keynote', location: 'Main Hall, Northwind Conference Center',
      description: 'Opening keynote, a session at Northwind DevCon.', source: {url: 'https://devcon.example.com/sessions/101'},
      transparency: 'transparent', reminders: {useDefault: false, overrides: []},
      start: {dateTime: '2026-11-12T15:00:00.000Z'}, end: {dateTime: '2026-11-12T16:00:00.000Z'},
    });
    // The row has Google's id, so a sync finds it rather than drawing it twice.
    const imported = google.events(PERSONAL).find(event => event.iCalUID === '101@devcon.example.com')!;
    w.advance(16 * 60_000);
    await run();
    expect(day('2026-11-12').filter(item => item.title === 'Opening keynote')).toEqual([expect.objectContaining({command: null, reminders: []})]);
    expect(w.store.sqlite.prepare('select provider_id, ical_uid from items where title = ?').all('Opening keynote')).toEqual([{provider_id: imported.id, ical_uid: '101@devcon.example.com'}]);
  });

  test('importing it again updates the same event, in Google and the mirror, as item_update', async () => {
    const {w, google, run, calendar, command, day} = await calendarWorld();
    await run();
    const invite = readImport(w.store, crlf(INTERVIEW_INVITE)).events[0]!;
    importEvent(w.store, importInput(calendar(PERSONAL).id, invite));
    await run();
    // The job board's reschedule: the same UID, an hour later.
    const moved = {...invite, starts_at: '2026-11-10T20:00:00.000Z', ends_at: '2026-11-10T20:30:00.000Z', sequence: 1};
    const again = importEvent(w.store, importInput(calendar(PERSONAL).id, moved));
    expect(again.kind).toBe('item_update');
    await run();
    expect(command(again.id).state).toBe('confirmed');
    expect(google.events(PERSONAL).filter(event => event.iCalUID === invite.ical_uid)).toEqual([expect.objectContaining({start: expect.objectContaining({dateTime: '2026-11-10T20:00:00.000Z'}), sequence: 1})]);
    expect(day('2026-11-10').filter(item => item.title.startsWith('Interview'))).toEqual([expect.objectContaining({starts_at: '2026-11-10T20:00:00.000Z'})]);
  });

  test('an event deleted in Google is imported again: Google takes it back under its id', async () => {
    const {w, google, run, calendar, command, day} = await calendarWorld();
    await run();
    const invite = readImport(w.store, crlf(INTERVIEW_INVITE)).events[0]!;
    const first = importEvent(w.store, importInput(calendar(PERSONAL).id, invite));
    await run();
    const deleted = deleteItem(w.store, command(first.id).targetId, {scope: 'all', occurrence_start: null});
    await run();
    expect(command(deleted.id).state).toBe('confirmed');
    expect(day('2026-11-10').some(item => item.title.startsWith('Interview'))).toBe(false);
    const id = google.events(PERSONAL).find(event => event.iCalUID === invite.ical_uid)!.id;
    const again = importEvent(w.store, importInput(calendar(PERSONAL).id, invite));
    expect(again.kind).toBe('item_create');
    await run();
    expect(command(again.id).state).toBe('confirmed');
    expect(google.event(PERSONAL, id)).toMatchObject({status: 'confirmed'});
    expect(day('2026-11-10').filter(item => item.title.startsWith('Interview'))).toHaveLength(1);
  });

  test('a series with an EXDATE and a moved occurrence: its lines, then the change by the start it replaces; the sync after draws Google\'s', async () => {
    const {w, google, run, calendar, command, titles} = await calendarWorld();
    await run();
    const series = readImport(w.store, crlf(OUTLOOK_SERIES)).events[0]!;
    const asked = importEvent(w.store, importInput(calendar(PERSONAL).id, series));
    await run();
    expect(command(asked.id).state).toBe('confirmed');
    expect(google.imports.map(({body}) => ({uid: body.iCalUID, original: body.originalStartTime ?? null, recurrence: body.recurrence ?? null}))).toEqual([
      {uid: OUTLOOK_SERIES_UID, original: null, recurrence: [expect.stringMatching(/^RRULE:FREQ=WEEKLY/), 'EXDATE:20261124T180000Z,20261201T180000Z']},
      {uid: OUTLOOK_SERIES_UID, original: {dateTime: '2026-11-10T18:00:00.000Z', timeZone: 'America/Los_Angeles'}, recurrence: null},
    ]);
    expect(titles('2026-11-03')).toEqual(['Fabrikam weekly sync 10:00 AM']);
    expect(titles('2026-11-10')).toEqual(['Fabrikam weekly sync (moved) 2:00 PM']);
    expect(titles('2026-11-24')).toEqual([]);
    expect(titles('2026-12-01')).toEqual([]);
  });

  test('a refusal fails that event in place with Google\'s words; Try again sends it again; Move back takes a new one off', async () => {
    const {w, google, run, calendar, command, day} = await calendarWorld();
    await run();
    const [keynote, sql] = readImport(w.store, crlf(CONFERENCE_SCHEDULE)).events;
    google.refuseImport(sql!.ical_uid, {code: 400, message: 'Invalid start time.'});
    const one = importEvent(w.store, importInput(calendar(PERSONAL).id, keynote!));
    const two = importEvent(w.store, importInput(calendar(PERSONAL).id, sql!));
    await run();
    expect(command(one.id).state).toBe('confirmed');
    expect(command(two.id)).toMatchObject({state: 'failed', providerMessage: 'Invalid start time. (400 Bad Request)'});
    google.refuseImport(sql!.ical_uid, null);
    retryCommand(w.store, two.id);
    await run();
    expect(command(two.id).state).toBe('confirmed');
    // Refused again and moved back: the new event leaves the mirror.
    const accessible = readImport(w.store, crlf(CONFERENCE_SCHEDULE)).events[3]!;
    google.refuseImport(accessible.ical_uid, {code: 403, message: 'You need to have writer access to this calendar.'});
    const three = importEvent(w.store, importInput(calendar(PERSONAL).id, accessible));
    await run();
    expect(command(three.id).state).toBe('failed');
    moveBackCommand(w.store, three.id);
    expect(day('2026-11-12').map(item => item.title)).not.toContain('Accessible tables');
  });

  test('only a Google calendar takes an import, and an event whose last change is on its way waits', async () => {
    const {w, run, calendar} = await calendarWorld();
    await run();
    const invite = readImport(w.store, crlf(INTERVIEW_INVITE)).events[0]!;
    importEvent(w.store, importInput(calendar(PERSONAL).id, invite));
    expect(() => importEvent(w.store, importInput(calendar(PERSONAL).id, invite))).toThrow('The last change is still waiting for its provider.');
    expect(() => importEvent(w.store, importInput(9999, invite))).toThrow('No such calendar.');
  });
});
