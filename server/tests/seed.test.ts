// The dev seed holds BRIEF.md › Sample data: its counts, its calendar and its weather.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {SEED_NOW} from '@setpoint/shared';
import {and, count, eq, isNotNull, isNull} from 'drizzle-orm';
import {describe, expect, onTestFinished, test} from 'vitest';
import {openDatabase} from '../src/db/open.ts';
import * as t from '../src/db/schema.ts';
import {seedSampleData, zoned} from '../src/dev/sample.ts';
import {seedFile} from '../src/dev/seedFile.ts';

function seeded() {
  const database = openDatabase(':memory:');
  onTestFinished(() => {
    database.sqlite.close();
  });
  seedSampleData(database);
  return database.db;
}

const pacific = (iso: string) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(iso));

describe('the Inbox counts', () => {
  test('3 attention not Done, the Contoso University one read', () => {
    const db = seeded();
    const attention = db.select({subject: t.messages.subject, unread: t.messages.unread, protected: t.messages.protected})
      .from(t.messages).where(and(eq(t.messages.lane, 'attention'), isNull(t.messages.doneAt))).all();
    expect(attention).toEqual(expect.arrayContaining([
      {subject: 'Your recovery email was changed', unread: true, protected: true},
      {subject: 'Interview availability for Software Engineer I', unread: true, protected: false},
      {subject: 'Final exam schedule · CS 101', unread: false, protected: false},
    ]));
    expect(attention).toHaveLength(3);
  });

  test('11 unread FYI: Security 3, Deliveries 4, Money 3, Career 1', () => {
    const db = seeded();
    const rows = db.select({kind: t.messages.kind, n: count()}).from(t.messages)
      .where(and(eq(t.messages.lane, 'fyi'), eq(t.messages.unread, true))).groupBy(t.messages.kind).all();
    expect(Object.fromEntries(rows.map(row => [row.kind, row.n]))).toEqual({security: 3, deliveries: 4, money: 3, career: 1});
  });

  test('19 unread in all, Noise 6 of them (Business 2, Personal 4)', () => {
    const db = seeded();
    const unread = (lane?: 'noise') => db.select({account: t.accounts.label, n: count()}).from(t.messages)
      .innerJoin(t.accounts, eq(t.messages.accountId, t.accounts.id))
      .where(and(eq(t.messages.unread, true), lane ? eq(t.messages.lane, lane) : undefined))
      .groupBy(t.accounts.label).all();
    const byAccount = Object.fromEntries(unread().map(row => [row.account, row.n]));
    expect(byAccount).toEqual({Business: 7, Personal: 8, Work: 1, Jobs: 2, iCloud: 1});
    expect(Object.values(byAccount).reduce((sum, n) => sum + n, 0)).toBe(19);
    expect(Object.fromEntries(unread('noise').map(row => [row.account, row.n]))).toEqual({Business: 2, Personal: 4});
  });

  test('every email has a lane, so nothing is Unsorted', () => {
    const db = seeded();
    expect(db.select({n: count()}).from(t.messages).where(isNull(t.messages.lane)).get()!.n).toBe(0);
  });

  test('the pinned Parkside email is read, from Dana Whitfield, with its agreement attached', () => {
    const db = seeded();
    const pinned = db.select().from(t.messages).where(isNotNull(t.messages.pinnedAt)).all();
    expect(pinned.map(message => message.subject)).toEqual(['Lease renewal terms']);
    expect(pinned[0]).toMatchObject({unread: false, fromName: 'Dana Whitfield', organisation: 'Parkside Apartments', keyDate: '2026-10-31'});
    expect(pinned[0]!.bodyText).toContain('$2,140 (currently $2,060)');
    expect(db.select().from(t.attachments).where(eq(t.attachments.messageId, pinned[0]!.id)).all())
      .toMatchObject([{filename: 'Renewal agreement.pdf', mimeType: 'application/pdf'}]);
  });

  test('the code expires 11 minutes after now, and the protected email is 20 minutes old', () => {
    const db = seeded();
    const code = db.select().from(t.messages).where(eq(t.messages.code, '482913')).get()!;
    expect(Date.parse(code.codeExpiresAt!) - Date.parse(SEED_NOW)).toBe(11 * 60_000);
    const recovery = db.select().from(t.messages).where(eq(t.messages.protected, true)).get()!;
    expect(Date.parse(SEED_NOW) - Date.parse(recovery.receivedAt)).toBe(20 * 60_000);
    expect(recovery.securityFacts).toEqual({what: 'Recovery email changed', device: 'Windows · Chrome', location: 'Phoenix, AZ', unfamiliar: true});
  });

  test('search\'s example is there: Northwind rejections in March, newest Mar 14', () => {
    const db = seeded();
    const rejections = db.select().from(t.messages).where(eq(t.messages.type, 'rejection')).all()
      .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    expect(rejections.map(message => [message.subject, message.organisation, pacific(message.receivedAt).slice(0, 11)])).toEqual([
      ['Update on your application', 'Northwind Talent', 'Sat, Mar 14'],
      ['Your application for Data Engineer Intern', 'Northwind Talent', 'Tue, Mar 3,'],
    ]);
  });
});

describe('the calendar', () => {
  const events = () => {
    const db = seeded();
    return db.select({item: t.items, calendar: t.calendars.name}).from(t.items)
      .innerJoin(t.calendars, eq(t.items.calendarId, t.calendars.id)).all()
      .map(({item, calendar}) => ({...item, calendar}));
  };
  const when = (item: {startsAt: string | null; endsAt: string | null}) => `${pacific(item.startsAt!)} – ${pacific(item.endsAt!).split(', ').at(-1)}`;

  test('the events, with Gym and CS 101 recurring', () => {
    const byTitle = Object.fromEntries(events().filter(item => item.kind === 'event').map(item => [item.title, item]));
    expect(Object.keys(byTitle).sort()).toEqual(['CS 101 lecture', 'Career fair', 'Dentist', 'Dinner with Sam', 'Gym', 'Study group']);
    expect(byTitle.Gym).toMatchObject({calendar: 'Personal', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'});
    expect(when(byTitle.Gym!)).toMatch(/, 7:00 AM – 8:00 AM$/);
    expect(byTitle['CS 101 lecture']).toMatchObject({calendar: 'Classes', recurrence: expect.stringMatching(/^RRULE:FREQ=WEEKLY;BYDAY=TU,TH;/)});
    expect(when(byTitle['CS 101 lecture']!)).toMatch(/, 6:00 PM – 7:15 PM$/);
    expect(byTitle.Dentist).toMatchObject({calendar: 'Personal', place: 'Smile Dental'});
    expect(when(byTitle.Dentist!)).toBe('Wed, Oct 7, 2:30 PM – 3:30 PM');
    expect(byTitle['Dinner with Sam']).toMatchObject({calendar: 'Personal', place: 'Blue Door', address: '2118 Sunset Blvd'});
    expect(when(byTitle['Dinner with Sam']!)).toBe('Fri, Oct 9, 7:00 PM – 9:00 PM');
    expect(byTitle['Career fair']).toMatchObject({calendar: 'Jobs', place: 'University Student Union'});
    expect(when(byTitle['Career fair']!)).toBe('Thu, Oct 15, 10:00 AM – 2:00 PM');
    expect(byTitle['Study group']).toMatchObject({calendar: 'Classes'});
    expect(when(byTitle['Study group']!)).toBe('Fri, Oct 9, 6:30 PM – 8:30 PM');
    // Study group overlaps Dinner with Sam.
    expect(byTitle['Study group']!.endsAt! > byTitle['Dinner with Sam']!.startsAt!).toBe(true);
  });

  test('the four Todoist tasks, Return library books done', () => {
    const tasks = events().filter(item => item.kind === 'task')
      .map(item => ({title: item.title, due: item.dueDate, done: item.doneAt !== null, calendar: item.calendar}));
    expect(tasks).toEqual([
      {title: 'CS 101 lab report', due: '2026-10-07', done: false, calendar: 'Todoist'},
      {title: 'Pay rent', due: '2026-10-07', done: false, calendar: 'Todoist'},
      {title: 'Renew car registration', due: '2026-10-08', done: false, calendar: 'Todoist'},
      {title: 'Return library books', due: '2026-10-05', done: true, calendar: 'Todoist'},
    ]);
  });

  test('the weather: sun on the 7th, clouds on the 8th, rain on the 13th', () => {
    const db = seeded();
    expect(db.select({date: t.weatherDays.date, condition: t.weatherDays.condition}).from(t.weatherDays).orderBy(t.weatherDays.date).all()).toEqual([
      {date: '2026-10-07', condition: 'sun'},
      {date: '2026-10-08', condition: 'cloud'},
      {date: '2026-10-13', condition: 'rain'},
    ]);
  });
});

describe('seeding', () => {
  test('SEED_NOW is Wed, Oct 7, 2026, 9:12 AM Pacific', () => {
    expect(zoned('2026-10-07', '09:12')).toBe(SEED_NOW);
    expect(zoned('2026-03-03', '09:41')).toBe('2026-03-03T17:41:00.000Z');
  });

  test('a database that isn\'t empty is refused, unless reset', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-seed-'));
    onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
    const file = path.join(dir, 'setpoint.sqlite');
    seedFile(file);
    expect(() => seedFile(file)).toThrow(/isn't empty/);
    expect(seedFile(file, {reset: true}).emails).toBeGreaterThan(19);
    const {sqlite, db} = openDatabase(file);
    expect(db.select({n: count()}).from(t.accounts).get()!.n).toBe(5);
    sqlite.close();
  });
});
