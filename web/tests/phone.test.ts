// The phone's rules as tables (DESIGN.md › Phone; board 21): the Inbox's group order, where the
// agenda starts, its range, and its days with empty runs collapsed.
import type {InboxGroup, ItemOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {itemsByDay} from '../src/logic/calendar.ts';
import {agendaNowAt, agendaRange, agendaStart, phoneAgenda, phoneGroups} from '../src/logic/phone.ts';

const now = Date.parse(SEED_NOW);
const zone = SEED_TIME_ZONE;

test.each([
  ['the seed: Attention before Pinned', ['pinned', 'attention', 'security', 'deliveries', 'noise'], ['attention', 'pinned', 'security', 'deliveries', 'noise']],
  ['Unsorted stays under Attention', ['pinned', 'attention', 'unsorted', 'security'], ['attention', 'unsorted', 'pinned', 'security']],
  ['no pins', ['attention', 'security'], ['attention', 'security']],
  ['no Attention: Pinned leads', ['pinned', 'security', 'noise'], ['pinned', 'security', 'noise']],
  ['only Attention and Pinned', ['pinned', 'attention'], ['attention', 'pinned']],
  ['nothing', [], []],
] as [string, InboxGroup[], InboxGroup[]][])('the phone\'s group order: %s', (_name, groups, expected) => {
  expect(phoneGroups(groups.map(group => ({group}))).map(view => view.group)).toEqual(expected);
});

test.each([
  ['no link: today', null, '2026-10-07'],
  ['a link to today', '2026-10-07', '2026-10-07'],
  ['a link within the 8 days keeps today first', '2026-10-14', '2026-10-07'],
  ['a link past them starts there', '2026-10-15', '2026-10-15'],
  ['a link to an earlier day starts there', '2026-10-05', '2026-10-05'],
])('the agenda starts: %s', (_name, linked, expected) => {
  expect(agendaStart('2026-10-07', linked)).toBe(expected);
});

test.each([
  ['2026-10-07', 'Oct 7 – 14'],
  ['2026-10-28', 'Oct 28 – Nov 4'],
  ['2026-12-28', 'Dec 28 – Jan 4'],
])('the agenda\'s range from %s: %s', (start, expected) => {
  expect(agendaRange(start)).toBe(expected);
});

let nextId = 1;
function item(fields: Partial<ItemOut>): ItemOut {
  const id = nextId++;
  return {
    key: String(id), id, calendar_id: 1, kind: 'event', title: 'Item', time_zone: zone, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, command: null,
    all_day: false, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: null, due_at: null, read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, ...fields,
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

// Today's now-line (#138), the seed's 9:12 AM: before the first timed event not over, else after the
// last timed one; all-day events and tasks never place it, and a day with no timed event has none.
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
