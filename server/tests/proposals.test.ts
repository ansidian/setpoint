// Proposals (BRIEF.md › The reader; DESIGN.md › Proposal; board 08): pre-filled from the email's
// subject, key date and the body line naming that date, each field marked when the email says it,
// with the conflict line against the day's items. Nothing is created until Create.
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {proposeFromMessage} from '../src/alfred/proposals.ts';
import * as t from '../src/db/schema.ts';
import {conflictLine, durationLabel, fromEmail, keyLine, placeIn, proposalFields, titleFromSubject} from '../src/domain/proposal.ts';
import {signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

describe('the pure rules', () => {
  test.each<[string, string]>([
    ['Final exam schedule · CS 101', 'CS 101 final exam'],
    ['Lease renewal terms', 'Lease renewal'],
    ['Re: Fwd: Dinner Friday?', 'Dinner Friday?'],
    ['Your appointment confirmation', 'Appointment'],
    ['Interview availability for Software Engineer I', 'Interview availability for Software Engineer I'],
    ['MATH 101 - Midterm reminder', 'MATH 101 midterm'],
  ])('title from "%s" → "%s"', (subject, title) => {
    expect(titleFromSubject(subject)).toBe(title);
  });

  test('the key line gives the time and the place', () => {
    const body = 'Exams below.\n\nCS 3310 · Data structures — Tue, Dec 8 · 7:00 – 9:00 PM · Room 214\nCS 101 · Software engineering — Wed, Dec 9 · 7:00 – 9:00 PM · Room 214\n';
    expect(keyLine(body, '2026-12-09')).toEqual({line: 'CS 101 · Software engineering — Wed, Dec 9 · 7:00 – 9:00 PM · Room 214', start: '19:00', end: '21:00'});
    expect(keyLine('Sign by: Oct 31, 2026', '2026-10-31')).toEqual({line: 'Sign by: Oct 31, 2026', start: null, end: null});
    expect(keyLine('Nothing dated here.', '2026-10-31')).toBeNull();
    expect(keyLine('Sign by Oct 31, 2025.', '2026-10-31')).toBeNull();
  });

  test.each<[string, string | null, string | null]>([
    ['CS 101 — Wed, Dec 9 · 7:00 – 9:00 PM · Room 214', 'Contoso University', 'Contoso University · Room 214'],
    ['Wed, Dec 9 · rm 12', null, 'Room 12'],
    ['Fri, Oct 9 · 7 PM · 2118 Sunset Blvd', null, '2118 Sunset Blvd'],
    ['Sign by: Oct 31, 2026', 'Parkside Apartments', null],
  ])('place on "%s"', (line, organisation, place) => {
    expect(placeIn(line, organisation)).toBe(place);
  });

  test.each<[number, string]>([[90, '1h 30m'], [120, '2h'], [45, '45m'], [0, '0m']])('%i minutes → %s', (minutes, label) => {
    expect(durationLabel(minutes)).toBe(label);
  });

  test('the conflict line', () => {
    const day = [
      {title: 'Gym', kind: 'event' as const, all_day: false, starts_at: '2026-10-09T14:00:00.000Z', ends_at: '2026-10-09T15:00:00.000Z'},
      {title: 'Study group', kind: 'event' as const, all_day: false, starts_at: '2026-10-10T01:30:00.000Z', ends_at: '2026-10-10T03:30:00.000Z'},
      {title: 'Pay rent', kind: 'task' as const, all_day: true, starts_at: null, ends_at: null},
    ];
    const dinner = {all_day: false, starts_at: '2026-10-10T02:00:00.000Z', ends_at: '2026-10-10T04:00:00.000Z', startHour: 19};
    expect(conflictLine(dinner, day)).toEqual({free: false, label: 'Overlaps Study group · 1h 30m'});
    expect(conflictLine({...dinner, starts_at: '2026-10-09T13:30:00.000Z', ends_at: '2026-10-10T03:00:00.000Z'}, day)).toEqual({free: false, label: 'Overlaps Gym · 1h and 1 more'});
    expect(conflictLine({...dinner, starts_at: '2026-10-10T04:00:00.000Z', ends_at: '2026-10-10T05:00:00.000Z', startHour: 21}, day)).toEqual({free: true, label: 'Free that evening'});
    expect(conflictLine({...dinner, starts_at: '2026-10-09T16:00:00.000Z', ends_at: '2026-10-09T17:00:00.000Z', startHour: 9}, day)).toEqual({free: true, label: 'Free that morning'});
    expect(conflictLine({...dinner, starts_at: '2026-10-09T21:00:00.000Z', ends_at: '2026-10-09T22:00:00.000Z', startHour: 14}, day)).toEqual({free: true, label: 'Free that afternoon'});
    expect(conflictLine({all_day: true, starts_at: null, ends_at: null, startHour: null}, day)).toEqual({free: false, label: 'Overlaps Gym and 1 more'});
    expect(conflictLine({all_day: true, starts_at: null, ends_at: null, startHour: null}, [day[2]!])).toEqual({free: true, label: 'Free that day'});
  });

  test('"from the email" marks only what the email says', () => {
    const email = {subject: 'Final exam schedule · CS 101', organisation: 'Contoso University', bodyText: 'CS 101 · Software engineering — Wed, Dec 9 · 7:00 – 9:00 PM · Room 214', keyDate: '2026-12-09'};
    const fields = proposalFields(email);
    expect(fromEmail(email, fields)).toEqual(['title', 'date', 'time', 'place']);
    expect(fromEmail(email, {...fields, title: 'Study for the exam', start: '18:00', place: 'Library'})).toEqual(['date']);
    expect(fromEmail(email, {...fields, date: '2026-12-08'})).toEqual(['title', 'place']);
  });
});

const idOf = (w: World, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!.id;
const calendarId = (w: World, name: string) => w.store.db.select().from(t.calendars).where(eq(t.calendars.name, name)).get()!.id;

describe('proposals over the seed', () => {
  test('Add to calendar on the Contoso University email: board 08', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const before = w.store.db.select().from(t.items).all().length;
    const response = await c.send('POST', '/api/proposals/from-message', {body: {message_id: idOf(w, 'Final exam schedule · CS 101'), kind: 'event'}});
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      kind: 'event', message_id: idOf(w, 'Final exam schedule · CS 101'),
      item: {
        kind: 'event', calendar_id: calendarId(w, 'Classes'), title: 'CS 101 final exam', all_day: false,
        starts_at: '2026-12-10T03:00:00.000Z', ends_at: '2026-12-10T05:00:00.000Z', start_date: null, end_date: null, due_date: null, due_at: null,
        time_zone: 'America/Los_Angeles', place: 'Contoso University · Room 214', project: null,
      },
      from_email: ['title', 'date', 'time', 'place'],
      conflict: {free: true, label: 'Free that evening'},
    });
    // Nothing was created; Create is POST /api/items with the item as it stands.
    expect(w.store.db.select().from(t.items).all().length).toBe(before);
    const {kind, ...item} = response.body.item;
    const created = await c.send('POST', '/api/items', {body: {kind, ...item}});
    expect(created.status).toBe(201);
  });

  test('the overlap line: a proposal for Sam\'s dinner meets the study group, and the dinner already on the calendar', () => {
    const w = world({seed: true});
    const dinner = proposeFromMessage(w.store, idOf(w, 'Dinner Friday?'), 'event', {title: 'Dinner with Sam', date: '2026-10-09', start: '19:00', end: '21:00', place: 'Blue Door'});
    expect(dinner.conflict).toEqual({free: false, label: 'Overlaps Study group · 1h 30m and 1 more'});
    w.store.db.delete(t.items).where(eq(t.items.title, 'Dinner with Sam')).run();
    expect(proposeFromMessage(w.store, idOf(w, 'Dinner Friday?'), 'event', {title: 'Dinner with Sam', date: '2026-10-09', start: '19:00', end: '21:00'}).conflict)
      .toEqual({free: false, label: 'Overlaps Study group · 1h 30m'});
    expect(dinner.item.calendar_id).toBe(calendarId(w, 'Personal'));
    // "Blue Door" and "Dinner" are in Sam's email; the date and time Alfred worked out aren't.
    expect(dinner.from_email).toEqual(['place']);
  });

  test('Add as task on the lease email: due on the key date, in Todoist; and an email with no key date', () => {
    const w = world({seed: true});
    const task = proposeFromMessage(w.store, idOf(w, 'Lease renewal terms'), 'task');
    expect(task).toMatchObject({
      kind: 'task', conflict: null, from_email: ['title', 'date'],
      item: {calendar_id: calendarId(w, 'Todoist'), title: 'Lease renewal', due_date: '2026-10-31', due_at: null, project: null},
    });
    const exam = proposeFromMessage(w.store, idOf(w, 'Lab 5 posted'), 'task');
    expect(exam.item).toMatchObject({due_date: '2026-10-07', project: 'School'});
    const undated = proposeFromMessage(w.store, idOf(w, 'Interview availability for Software Engineer I'), 'event');
    expect(undated).toMatchObject({conflict: null, from_email: ['title'], item: {all_day: false, starts_at: null, start_date: null, calendar_id: calendarId(w, 'Jobs')}});
    const allDay = proposeFromMessage(w.store, idOf(w, 'Lease renewal terms'), 'event');
    expect(allDay.item).toMatchObject({all_day: true, start_date: '2026-10-31', end_date: '2026-11-01'});
    expect(allDay.conflict).toEqual({free: true, label: 'Free that day'});
  });

  test('refuses a missing or trashed email', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    expect((await c.send('POST', '/api/proposals/from-message', {body: {message_id: 9999, kind: 'event'}})).status).toBe(404);
    expect((await c.send('POST', '/api/proposals/from-message', {body: {message_id: 1, kind: 'meeting'}})).status).toBe(400);
  });
});
