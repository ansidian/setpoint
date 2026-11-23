// The phone's rules as tables (board 21): the day the agenda opens on and what it loads, when it
// stops loading by itself, its header's month, its days with empty runs collapsed and today's
// Overdue group, how long a task is overdue and when its snooze ends.
import type {ItemOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {itemsByDay} from '../src/logic/calendar.ts';
import {agendaAnchor, agendaChunks, agendaMonth, agendaNowAt, loadsOn, overdueFor, phoneAgenda, phoneSlide, snoozeEnd} from '../src/logic/phone.ts';

const now = Date.parse(SEED_NOW);
const zone = SEED_TIME_ZONE;

// Opened on Oct 7 with 2 weeks loaded: Sep 30 through Oct 20.
test.each([
  ['no link: it stays', null, false, '2026-10-07'],
  ['a link inside the week before', '2026-09-30', false, '2026-10-07'],
  ['a link to the last day loaded', '2026-10-20', false, '2026-10-07'],
  ['a link past what\'s loaded opens there', '2026-10-21', false, '2026-10-21'],
  ['a link before the week before opens there', '2026-09-29', false, '2026-09-29'],
  ['while a search shows, nothing moves it', '2026-12-25', true, '2026-10-07'],
])('the day the agenda opens on: %s', (_name, linked, searching, expected) => {
  expect(agendaAnchor('2026-10-07', 2, linked, searching)).toBe(expected);
});

test('what\'s loaded: the week before, then each week from the day it opens on', () => {
  expect(agendaChunks('2026-10-07', 2)).toEqual([
    {from: '2026-09-30', to: '2026-10-07'}, {from: '2026-10-07', to: '2026-10-14'}, {from: '2026-10-14', to: '2026-10-21'},
  ]);
});

test.each([
  ['fewer than four weeks in', [0, 0, 0], true],
  ['four empty weeks in a row', [3, 0, 0, 0, 0], false],
  ['an empty run broken by a week with items', [0, 0, 0, 2], true],
  ['items in the last four', [0, 0, 0, 0, 1], true],
])('loads on by itself: %s', (_name, counts, expected) => {
  expect(loadsOn(counts)).toBe(expected);
});

test.each([
  ['this year', '2026-10-20', 'October'],
  ['another year', '2027-02-15', 'February 2027'],
  ['an earlier year', '2025-12-31', 'December 2025'],
])('the header\'s month: %s', (_name, date, expected) => {
  expect(agendaMonth(date, '2026-10-07')).toBe(expected);
});

let nextId = 1;
function item(fields: Partial<ItemOut>): ItemOut {
  const id = nextId++;
  return {
    key: String(id), id, calendar_id: 1, kind: 'event', title: 'Item', time_zone: zone, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, can_reopen: false, command: null,
    all_day: false, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: null, due_at: null, read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, link: null, transparency: 'opaque', description: null, subtasks: [], parent_id: null, ...fields,
  };
}
const at = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00-07:00`)).toISOString();
const event = (title: string, date: string, start: string, end: string) => item({title, starts_at: at(date, start), ends_at: at(date, end)});
const task = (title: string, due: string, fields: Partial<ItemOut> = {}) => item({kind: 'task', title, all_day: true, due_date: due, ...fields});

describe('the agenda (board 21)', () => {
  // The seed's week: Gym Mon/Wed/Fri, the lecture Tue/Thu, Dentist, Dinner and Study group, three tasks.
  const items = [
    event('Gym', '2026-10-07', '07:00', '08:00'), event('Dentist', '2026-10-07', '14:30', '15:30'), task('CS 101 lab report', '2026-10-07'), task('Pay rent', '2026-10-07'),
    event('CS 101 lecture', '2026-10-08', '18:00', '19:15'), task('Renew car registration', '2026-10-08'),
    event('Gym', '2026-10-09', '07:00', '08:00'), event('Study group', '2026-10-09', '18:30', '20:30'), event('Dinner with Sam', '2026-10-09', '19:00', '21:00'),
    event('Gym', '2026-10-12', '07:00', '08:00'), event('CS 101 lecture', '2026-10-13', '18:00', '19:15'), event('Gym', '2026-10-14', '07:00', '08:00'),
    event('Career fair', '2026-10-15', '10:00', '14:00'),
  ];
  const sections = phoneAgenda('2026-10-07', '2026-10-07', itemsByDay(items, undefined, zone), now, zone);

  test('days with their items, the weekend folded into one line, nothing past the 8th day', () => {
    expect(sections.map(section => (section.kind === 'day' ? [section.title, section.lines.map(line => `${line.when}|${line.item.title}${line.past ? ' (past)' : ''}`)] : [section.title, 'No events']))).toEqual([
      ['Today · Wed, Oct 7', ['7:00 – 8:00 AM|Gym (past)', '2:30 – 3:30 PM|Dentist', '|CS 101 lab report', '|Pay rent']],
      ['Thu, Oct 8', ['6:00 – 7:15 PM|CS 101 lecture', '|Renew car registration']],
      ['Fri, Oct 9', ['7:00 – 8:00 AM|Gym', '6:30 – 8:30 PM|Study group', '7:00 – 9:00 PM|Dinner with Sam']],
      ['Sat, Oct 10 – Sun, Oct 11', 'No events'],
      ['Mon, Oct 12', ['7:00 – 8:00 AM|Gym']],
      ['Tue, Oct 13', ['6:00 – 7:15 PM|CS 101 lecture']],
      ['Wed, Oct 14', ['7:00 – 8:00 AM|Gym']],
    ]);
  });

  test.each([
    ['a single empty day keeps its own title', [event('A', '2026-10-07', '10:00', '11:00'), event('B', '2026-10-09', '10:00', '11:00')], ['Today · Wed, Oct 7', 'Thu, Oct 8 (empty)', 'Fri, Oct 9', 'Sat, Oct 10 – Wed, Oct 14 (empty)']],
    ['an empty today stays on its own', [event('B', '2026-10-09', '10:00', '11:00')], ['Today · Wed, Oct 7 (empty)', 'Thu, Oct 8 (empty)', 'Fri, Oct 9', 'Sat, Oct 10 – Wed, Oct 14 (empty)']],
    ['nothing at all', [], ['Today · Wed, Oct 7 (empty)', 'Thu, Oct 8 – Wed, Oct 14 (empty)']],
  ])('%s', (_name, list, expected) => {
    const found = phoneAgenda('2026-10-07', '2026-10-07', itemsByDay(list, undefined, zone), now, zone);
    expect(found.map(section => `${section.title}${section.kind === 'empty' ? ' (empty)' : ''}`)).toEqual(expected);
  });

  test.each([
    ['a forecast keeps an empty day on its own line', ['2026-10-11'], ['Today · Wed, Oct 7', 'Thu, Oct 8', 'Fri, Oct 9', 'Sat, Oct 10 (empty)', 'Sun, Oct 11 (empty)', 'Mon, Oct 12']],
    ['each forecast day apart', ['2026-10-10', '2026-10-11'], ['Today · Wed, Oct 7', 'Thu, Oct 8', 'Fri, Oct 9', 'Sat, Oct 10 (empty)', 'Sun, Oct 11 (empty)', 'Mon, Oct 12']],
    ['a forecast on a day with items changes nothing', ['2026-10-09'], ['Today · Wed, Oct 7', 'Thu, Oct 8', 'Fri, Oct 9', 'Sat, Oct 10 – Sun, Oct 11 (empty)', 'Mon, Oct 12']],
  ])('%s', (_name, dates, expected) => {
    const found = phoneAgenda('2026-10-07', '2026-10-07', itemsByDay(items, undefined, zone), now, zone, new Set(dates));
    expect(found.slice(0, expected.length).map(section => `${section.title}${section.kind === 'empty' ? ' (empty)' : ''}`)).toEqual(expected);
  });

  test('a run without forecasts still folds beside a day with one', () => {
    const found = phoneAgenda('2026-10-07', '2026-10-07', itemsByDay([event('A', '2026-10-07', '10:00', '11:00')], undefined, zone), now, zone, new Set(['2026-10-10']));
    expect(found.map(section => section.title)).toEqual(['Today · Wed, Oct 7', 'Thu, Oct 8 – Fri, Oct 9', 'Sat, Oct 10', 'Sun, Oct 11 – Wed, Oct 14']);
  });

  test.each([
    ['an all-day event', item({all_day: true, start_date: '2026-10-08', end_date: '2026-10-09'}), 'All day'],
    ['a timed task', task('Call', '2026-10-08', {all_day: false, due_at: at('2026-10-08', '09:00')}), '9:00 AM'],
    ['a task due on the day', task('Call', '2026-10-08'), ''],
  ])('when: %s', (_name, one, expected) => {
    const [, day] = phoneAgenda('2026-10-07', '2026-10-07', itemsByDay([one], undefined, zone), now, zone);
    expect(day?.kind === 'day' ? day.lines[0]!.when : null).toBe(expected);
  });

  test('a later start has no Today', () => {
    const [first] = phoneAgenda('2026-10-15', '2026-10-07', new Map(), now, zone);
    expect([first!.title, first!.today]).toEqual(['Thu, Oct 15 – Thu, Oct 22', false]);
  });

  test('today is marked, with its now-line between the past Gym and the Dentist; other days have none', () => {
    expect(sections.map(section => [section.today, section.kind === 'day' ? section.nowAt : 'empty'])).toEqual([
      [true, 1], [false, null], [false, null], [false, 'empty'], [false, null], [false, null], [false, null],
    ]);
  });
});

// Today's now-line, the seed's 9:12 AM: before the first timed event not over, else after the last
// timed one. All-day events and tasks never place it, and a day with no timed event has none.
test.each([
  ['the seed: after the past Gym, before the Dentist', [event('Gym', '2026-10-07', '07:00', '08:00'), event('Dentist', '2026-10-07', '14:30', '15:30'), task('Pay rent', '2026-10-07')], 1],
  ['an event under way: before it', [event('Standup', '2026-10-07', '09:00', '09:30'), task('Pay rent', '2026-10-07')], 0],
  ['everything later: at the top', [event('Dentist', '2026-10-07', '14:30', '15:30')], 0],
  ['every event over: after the last, before the tasks', [event('Gym', '2026-10-07', '07:00', '08:00'), task('Pay rent', '2026-10-07')], 1],
  ['every event over, no tasks: at the end', [event('Gym', '2026-10-07', '07:00', '08:00')], 1],
  ['an all-day event leads: after it', [item({all_day: true, start_date: '2026-10-07', end_date: '2026-10-08'}), event('Dentist', '2026-10-07', '14:30', '15:30')], 1],
  ['only tasks: none', [task('Pay rent', '2026-10-07'), task('Call', '2026-10-07', {all_day: false, due_at: at('2026-10-07', '08:00')})], null],
  ['only an all-day event: none', [item({all_day: true, start_date: '2026-10-07', end_date: '2026-10-08'})], null],
])('today\'s now-line: %s', (_name, list, expected) => {
  const [today] = phoneAgenda('2026-10-07', '2026-10-07', itemsByDay(list, undefined, zone), now, zone);
  expect(today?.kind === 'day' ? [today.nowAt, agendaNowAt(today.lines)] : null).toEqual([expected, expected]);
});

// The seed's now is 9:12 AM on Oct 7.
test.each([
  ['a timed task 25 minutes late', task('Call', '2026-10-07', {all_day: false, due_at: at('2026-10-07', '08:47')}), '25 min'],
  ['a timed task under a minute late', task('Call', '2026-10-07', {all_day: false, due_at: at('2026-10-07', '09:12')}), '1 min'],
  ['a timed task hours late', task('Call', '2026-10-07', {all_day: false, due_at: at('2026-10-07', '06:00')}), '3 hr'],
  ['a timed task from yesterday evening', task('Call', '2026-10-06', {all_day: false, due_at: at('2026-10-06', '20:00')}), '13 hr'],
  ['a timed task from two days back', task('Call', '2026-10-05', {all_day: false, due_at: at('2026-10-05', '08:00')}), '2 days'],
  ['an untimed task due yesterday, its day over 9 hours ago', task('Pay rent', '2026-10-06'), '9 hr'],
  ['an untimed task due two days back', task('Pay rent', '2026-10-05'), '2 days'],
  ['an untimed task due 13 days back', task('Renew the library card', '2026-09-24'), '13 days'],
])('how long it\'s overdue: %s', (_name, one, expected) => {
  expect(overdueFor(one, now, zone)).toBe(expected);
});

test.each([
  ['later today', at('2026-10-07', '10:12'), '10:12 AM'],
  ['tomorrow', at('2026-10-08', '09:00'), 'Thu 9:00 AM'],
])('when a snooze ends: %s', (_name, until, expected) => {
  expect(snoozeEnd(Date.parse(until), now, zone)).toBe(expected);
});

describe('the agenda past its first days', () => {
  test('the week before folds up to today, and today stays on its own line', () => {
    const found = phoneAgenda('2026-09-30', '2026-10-07', new Map(), now, zone, new Set(), {days: 14});
    expect(found.map(section => section.title)).toEqual(['Wed, Sep 30 – Tue, Oct 6', 'Today · Wed, Oct 7', 'Thu, Oct 8 – Tue, Oct 13']);
  });

  test('the day it opens on keeps its own line among empty days', () => {
    const found = phoneAgenda('2027-02-22', '2026-10-07', new Map(), now, zone, new Set(), {days: 14, opens: '2027-03-01'});
    expect(found.map(section => section.title)).toEqual(['Mon, Feb 22 – Sun, Feb 28', 'Mon, Mar 1', 'Tue, Mar 2 – Sun, Mar 7']);
  });

  test('today leaves out its Overdue group\'s tasks; another day keeps them', () => {
    const late = task('Call the landlord', '2026-10-07', {all_day: false, due_at: at('2026-10-07', '08:00')});
    const earlier = task('Return library books', '2026-10-05');
    const list = [earlier, event('Gym', '2026-10-07', '07:00', '08:00'), late];
    const found = phoneAgenda('2026-10-05', '2026-10-07', itemsByDay(list, undefined, zone), now, zone, new Set(), {days: 3, overdue: new Set([late.key, earlier.key])});
    expect(found.map(section => (section.kind === 'day' ? [section.title, section.lines.map(line => line.item.title)] : [section.title]))).toEqual([
      ['Mon, Oct 5', ['Return library books']], ['Tue, Oct 6'], ['Today · Wed, Oct 7', ['Gym']],
    ]);
  });
});

// One email to another doesn't slide on the phone, after an Undo too.
test('the phone\'s reader doesn\'t slide from one email to another', () => expect(phoneSlide(true, 4, 5)).toBe(null));
