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
    expect(keyLine(body, '2026-12-09')).toEqual({line: 'CS 101 · Software engineering — Wed, Dec 9 · 7:00 – 9:00 PM · Room 214', date: '2026-12-09', start: '19:00', end: '21:00', near: []});
    expect(keyLine('Sign by: Oct 31, 2026', '2026-10-31')).toEqual({line: 'Sign by: Oct 31, 2026', date: '2026-10-31', start: null, end: null, near: []});
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

  // SV-263: real mail spreads the date, the time and the address over lines; these bodies are in
  // the shapes of an interview scheduler's, a maintenance notice's and a shop's emails.
  const LA = 'America/Los_Angeles';
  const read = (bodyText: string, keyDate: string) => {
    const {title: _title, ...fields} = proposalFields({subject: 'Details', organisation: null, bodyText, keyDate}, LA);
    return fields;
  };
  test.each<[string, string, string, {date: string; start: string | null; end: string | null; place: string | null}]>([
    ['the date, the time and the address on three lines, the address its own paragraph',
      'You scheduled an interview with Contoso\n\nIn-person interview\n- Software Engineer\n- Thursday, November 12\n- 9 am to 9:45 am PT\n\n500 Harbor Blvd, Fairview, CA 90000\n\nCancel or reschedule\nhttps://jobs.example.com/cancel',
      '2026-11-12', {date: '2026-11-12', start: '09:00', end: '09:45', place: '500 Harbor Blvd, Fairview, CA 90000'}],
    ['a time under the date and no address: the link under it is no place',
      'Video interview\n- Software Engineer\n- Monday, November 16\n- 3 pm to 3:45 pm PT\n\nJoin interview\nhttps://jobs.example.com/join/1\nCancel or reschedule\nhttps://jobs.example.com/cancel',
      '2026-11-16', {date: '2026-11-16', start: '15:00', end: '15:45', place: null}],
    ['the block further down the email',
      'Hi Jordan,\n\nCan you make it to your interview with Contoso today?\n\nvideo Interview,\n- Software Engineer\n- Monday, November 16\n- 3 pm to 3:45 pm PT\n\nJoin interview:\nhttps://jobs.example.com/join/1',
      '2026-11-16', {date: '2026-11-16', start: '15:00', end: '15:45', place: null}],
    ['a later line with the time wins over an earlier one without, in the zone it names; the footer address is no place',
      'Northwind is set to undergo scheduled maintenance on Saturday November 21, 2026\n\nMaintenance may affect performance starting Saturday, November 21 around 2pm ET, estimated to last up to 4 hours.\n\nNorthwind Inc. 100 Market Street, Floor 4 | Fairview, CA 90000 | US',
      '2026-11-21', {date: '2026-11-21', start: '11:00', end: null, place: null}],
    ['a deadline with no time and no address',
      'Hello Jordan, Your return request is confirmed.\n\nDrop off by Sat, Oct 31 Dropoff location Any carrier dropoff location\n\nNorthwind Inc. 100 Market Street, Fairview, CA 90000.',
      '2026-10-31', {date: '2026-10-31', start: null, end: null, place: null}],
    ['a shipping address under a delivery date is no place',
      'Arriving Tue, Nov 17\n\nShipping to: Jordan Lee, 12 Elm St, Fairview, CA 90000',
      '2026-11-17', {date: '2026-11-17', start: null, end: null, place: null}],
    ['nor is one over several lines',
      'Arriving Tue, Nov 17\n\nJordan Lee\n12 Elm St\nFairview, CA 90000',
      '2026-11-17', {date: '2026-11-17', start: null, end: null, place: null}],
    ['a time in another zone that falls on the day before here',
      'Launch stream: Fri, Nov 20 · 1 am ET',
      '2026-11-20', {date: '2026-11-19', start: '22:00', end: null, place: null}],
    ['a range in a named zone: its end moves with its start',
      'Webinar: Tue, Nov 17 · 1 pm to 2 pm ET',
      '2026-11-17', {date: '2026-11-17', start: '10:00', end: '11:00', place: null}],
    ['a quoted email\'s own date and time are when it was written, not the time',
      'See you Tue, Nov 17.\n\nOn Tue, Nov 17, 2026 at 9:14 AM Jordan Lee wrote:\n> Are we still on for Tue, Nov 17 at 8 AM?',
      '2026-11-17', {date: '2026-11-17', start: null, end: null, place: null}],
    ['a summer time in a named zone',
      'Webinar: Wed, Jul 15 · 3 pm ET',
      '2026-07-15', {date: '2026-07-15', start: '12:00', end: null, place: null}],
    ['a time with no zone is the user\'s own',
      'Dinner: Fri, Oct 9 · 7 PM · 2118 Sunset Blvd',
      '2026-10-09', {date: '2026-10-09', start: '19:00', end: null, place: '2118 Sunset Blvd'}],
  ])('SV-263: %s', (_, body, keyDate, fields) => {
    expect(read(body, keyDate)).toEqual(fields);
  });

  test('SV-263: what the lines around the date gave is marked "from the email"', () => {
    const email = {subject: 'Interview', organisation: null, keyDate: '2026-11-12', bodyText: 'In-person interview\n- Thursday, November 12\n- 9 am to 9:45 am PT\n\n500 Harbor Blvd, Fairview, CA 90000'};
    expect(fromEmail(email, proposalFields(email, LA), LA)).toEqual(['title', 'date', 'time', 'place']);
    const stream = {subject: 'Launch stream', organisation: null, keyDate: '2026-11-20', bodyText: 'Launch stream: Fri, Nov 20 · 1 am ET'};
    expect(fromEmail(stream, proposalFields(stream, LA), LA)).toEqual(['title', 'date', 'time']);
  });

  test.each<[number, string]>([[90, '1h 30m'], [120, '2h'], [45, '45m']])('%i minutes → %s', (minutes, label) => {
    expect(durationLabel(minutes)).toBe(label);
  });

  const day = [
    {title: 'Gym', kind: 'event' as const, all_day: false, starts_at: '2026-10-09T14:00:00.000Z', ends_at: '2026-10-09T15:00:00.000Z'},
    {title: 'Study group', kind: 'event' as const, all_day: false, starts_at: '2026-10-10T01:30:00.000Z', ends_at: '2026-10-10T03:30:00.000Z'},
    {title: 'Pay rent', kind: 'task' as const, all_day: true, starts_at: null, ends_at: null},
  ];
  const dinner = {all_day: false, starts_at: '2026-10-10T02:00:00.000Z', ends_at: '2026-10-10T04:00:00.000Z', startHour: 19};
  test('the conflict line', () => {
    expect(conflictLine(dinner, day)).toEqual({free: false, label: 'Overlaps Study group · 1h 30m'});
    expect(conflictLine({...dinner, starts_at: '2026-10-09T13:30:00.000Z', ends_at: '2026-10-10T03:00:00.000Z'}, day)).toEqual({free: false, label: 'Overlaps Gym and 1 more · 1h'});
    expect(conflictLine({...dinner, starts_at: '2026-10-10T04:00:00.000Z', ends_at: '2026-10-10T05:00:00.000Z', startHour: 21}, day)).toEqual({free: true, label: 'Free that evening'});
    expect(conflictLine({...dinner, starts_at: '2026-10-09T16:00:00.000Z', ends_at: '2026-10-09T17:00:00.000Z', startHour: 9}, day)).toEqual({free: true, label: 'Free that morning'});
    expect(conflictLine({...dinner, starts_at: '2026-10-09T21:00:00.000Z', ends_at: '2026-10-09T22:00:00.000Z', startHour: 14}, day)).toEqual({free: true, label: 'Free that afternoon'});
    expect(conflictLine({all_day: true, starts_at: null, ends_at: null, startHour: null}, day)).toEqual({free: false, label: 'Overlaps Gym and 1 more'});
    expect(conflictLine({all_day: true, starts_at: null, ends_at: null, startHour: null}, [day[2]!])).toEqual({free: true, label: 'Free that day'});
  });

  test.each([
    ['a free event over it', [{...day[1]!, transparency: 'transparent' as const}], {free: true, label: 'Free that evening'}],
    ['a free one and a busy one', [{...day[1]!, title: 'Workshop', transparency: 'transparent' as const}, {...day[1]!, transparency: 'opaque' as const}], {free: false, label: 'Overlaps Study group · 1h 30m'}],
  ])('SV-180: the conflict line leaves free events out: %s', (_, items, line) => expect(conflictLine(dinner, items)).toEqual(line));
  test('SV-180: an all-day proposal leaves free events out too', () => {
    expect(conflictLine({all_day: true, starts_at: null, ends_at: null, startHour: null}, [{...day[0]!, transparency: 'transparent'}, day[2]!])).toEqual({free: true, label: 'Free that day'});
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
const gmailOf = (w: World, subject: string) => {
  const row = w.store.db.select({address: t.accounts.address, providerId: t.messages.providerId}).from(t.messages)
    .innerJoin(t.accounts, eq(t.accounts.id, t.messages.accountId)).where(eq(t.messages.subject, subject)).get()!;
  return `https://mail.google.com/mail/?authuser=${encodeURIComponent(row.address)}#all/${encodeURIComponent(row.providerId)}`;
};
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
      source: {subject: 'Final exam schedule · CS 101', url: gmailOf(w, 'Final exam schedule · CS 101')},
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
    expect(dinner.conflict).toEqual({free: false, label: 'Overlaps Study group and 1 more · 1h 30m'});
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

  test('SV-263: each field is Alfred\'s when he gives one, else the invite\'s, else the text\'s', () => {
    const w = world({seed: true});
    const exam = idOf(w, 'Final exam schedule · CS 101');
    const invite = {title: 'CS 101 final', all_day: false, starts_at: '2026-12-10T02:00:00.000Z', ends_at: '2026-12-12T02:00:00.000Z', start_date: null, end_date: null, place: 'Hall B'};
    // The invite's instants as they are: an end two days later is kept.
    expect(proposeFromMessage(w.store, exam, 'event', {}, invite)).toMatchObject({item: {title: 'CS 101 final', starts_at: invite.starts_at, ends_at: invite.ends_at, place: 'Hall B'}, from_email: ['title', 'date', 'time', 'place']});
    // Alfred's own day and time stand over the invite's; the place he didn't give is still the invite's.
    expect(proposeFromMessage(w.store, exam, 'event', {date: '2026-12-20', start: '09:00', end: null}, invite))
      .toMatchObject({item: {starts_at: '2026-12-20T17:00:00.000Z', ends_at: '2026-12-20T18:00:00.000Z', place: 'Hall B'}, from_email: ['title', 'place']});
    expect(proposeFromMessage(w.store, exam, 'event', {place: 'Library', title: 'Study for the final'}, invite)).toMatchObject({item: {title: 'Study for the final', starts_at: invite.starts_at, place: 'Library'}, from_email: ['date', 'time']});
    const allDay = {title: '', all_day: true, starts_at: null, ends_at: null, start_date: '2026-12-14', end_date: '2026-12-16', place: null};
    // An invite with no title leaves the subject's.
    expect(proposeFromMessage(w.store, exam, 'event', {}, allDay)).toMatchObject({item: {title: 'CS 101 final exam', all_day: true, start_date: '2026-12-14', end_date: '2026-12-16', starts_at: null, place: 'Contoso University · Room 214'}, from_email: ['title', 'date', 'place']});
  });

  test('SV-270 (D553–D555): the description\'s From: line links to the email in Gmail, as Open in Gmail does; another provider\'s has no link', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const lease = idOf(w, 'Lease renewal terms');
    const open = (await c.send('GET', `/api/mail/messages/${lease}`)).body.open_url;
    expect(open).toMatch(/^https:\/\/mail\.google\.com\/mail\/\?authuser=.+#all\/.+$/);
    expect(proposeFromMessage(w.store, lease, 'task').source).toEqual({subject: 'Lease renewal terms', url: open});
    expect(proposeFromMessage(w.store, idOf(w, 'Bill is ready'), 'task').source).toEqual({subject: 'Bill is ready', url: null});
  });

  test('SV-270 (D555): a description\'s Gmail link is looked up by its account, in any case, and Gmail\'s id', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const lease = idOf(w, 'Lease renewal terms');
    const {address, providerId} = w.store.db.select({address: t.accounts.address, providerId: t.messages.providerId}).from(t.messages)
      .innerJoin(t.accounts, eq(t.accounts.id, t.messages.accountId)).where(eq(t.messages.id, lease)).get()!;
    const lookup = (account: string, id: string) => c.send('GET', `/api/mail/gmail-link?account=${encodeURIComponent(account)}&id=${encodeURIComponent(id)}`);
    expect((await lookup(address, providerId)).body).toEqual({message_id: lease});
    expect((await lookup(address.toUpperCase(), providerId)).body).toEqual({message_id: lease});
    expect((await lookup(address, 'FMfcgzQXJWvmnoLhBTsMlpwbz')).body).toEqual({message_id: null});
    expect((await lookup('someone@example.invalid', providerId)).body).toEqual({message_id: null});
    // An iCloud email isn't Gmail's, whatever its id; a trashed one is gone from Setpoint's reader.
    const bill = w.store.db.select().from(t.messages).where(eq(t.messages.subject, 'Bill is ready')).get()!;
    const icloud = w.store.db.select().from(t.accounts).where(eq(t.accounts.id, bill.accountId)).get()!;
    expect((await lookup(icloud.address, bill.providerId)).body).toEqual({message_id: null});
    w.store.db.update(t.messages).set({trashedAt: '2026-10-07T12:00:00.000Z'}).where(eq(t.messages.id, lease)).run();
    expect((await lookup(address, providerId)).body).toEqual({message_id: null});
    expect((await c.send('GET', '/api/mail/gmail-link?account=')).status).toBe(400);
  });

  test('refuses a missing email', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    expect((await c.send('POST', '/api/proposals/from-message', {body: {message_id: 9999, kind: 'event'}})).status).toBe(404);
  });
});
