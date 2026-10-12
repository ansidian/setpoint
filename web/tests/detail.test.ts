// The floating detail's lines as tables (boards 12a and 12b; DESIGN.md › Right pane for Time to Leave,
// and when its line turns `caution` and when it goes, SV-56).
import type {ItemOut} from '@setpoint/shared';
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {attendeesLine, detailWhen, leaveLine, leaveState, remindersLine, repeatLine, travelTime} from '../src/logic/detail.ts';

const zone = SEED_TIME_ZONE;
const at = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00-07:00`)).toISOString();
const item = (fields: Partial<ItemOut>): ItemOut => ({
  key: '1', id: 1, calendar_id: 1, kind: 'event', title: 'Item', time_zone: zone, recurring: false, recurrence: null, occurrence_start: null,
  place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, command: null,
  all_day: false, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: null, due_at: null, read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, ...fields,
});

describe('date and time', () => {
  test.each([
    ['Dentist (12a)', item({starts_at: at('2026-10-07', '14:30'), ends_at: at('2026-10-07', '15:30')}), 'Wed, Oct 7 · 2:30 – 3:30 PM'],
    ['Dinner with Sam (12b)', item({starts_at: at('2026-10-09', '19:00'), ends_at: at('2026-10-09', '21:00')}), 'Fri, Oct 9 · 7:00 – 9:00 PM'],
    ['across noon', item({starts_at: at('2026-10-15', '10:00'), ends_at: at('2026-10-15', '14:00')}), 'Thu, Oct 15 · 10:00 AM – 2:00 PM'],
    ['past midnight', item({starts_at: at('2026-10-09', '22:00'), ends_at: at('2026-10-10', '01:00')}), 'Fri, Oct 9, 10:00 PM – Sat, Oct 10, 1:00 AM'],
    ['all day', item({all_day: true, start_date: '2026-10-17', end_date: '2026-10-18'}), 'Sat, Oct 17 · All day'],
    ['several days', item({all_day: true, start_date: '2026-10-17', end_date: '2026-10-20'}), 'Sat, Oct 17 – Mon, Oct 19'],
    ['a task', item({kind: 'task', all_day: true, due_date: '2026-10-07'}), 'Wed, Oct 7'],
    ['a task with a time', item({kind: 'task', due_date: '2026-10-07', due_at: at('2026-10-07', '17:00')}), 'Wed, Oct 7 · 5:00 PM'],
  ])('%s', (_, one, line) => expect(detailWhen(one, zone)).toBe(line));
});

describe('Time to Leave', () => {
  // The seed's moment, Wed Oct 7 at 9:12 AM.
  const morning = Date.parse(at('2026-10-07', '09:12'));
  test.each([
    ['Dentist', {leave_at: at('2026-10-07', '14:05'), travel_minutes: 18, checked_at: at('2026-10-07', '09:00')}, 'Leave by 2:05 PM · 18 min'],
    ['Dinner with Sam', {leave_at: at('2026-10-09', '18:35'), travel_minutes: 21, checked_at: at('2026-10-07', '09:00')}, 'Leave by 6:35 PM · 21 min'],
    ['a long drive', {leave_at: at('2026-10-09', '08:00'), travel_minutes: 65, checked_at: at('2026-10-07', '09:00')}, 'Leave by 8:00 AM · 1 hr 5 min'],
    ['none', null, null],
  ])('%s', (_, leave, line) => expect(leaveLine(item({time_to_leave: leave}), zone, morning)?.text ?? null).toBe(line));

  // SV-56: Dentist at 2:30 PM, leave by 2:05 PM. The line turns `caution` 15 minutes before
  // leaving and stays so until the event starts; from then it's gone.
  const dentist = item({starts_at: at('2026-10-07', '14:30'), ends_at: at('2026-10-07', '15:30'),
    time_to_leave: {leave_at: at('2026-10-07', '14:05'), travel_minutes: 18, checked_at: at('2026-10-07', '09:00')}});
  test.each([
    ['9:12 AM, the morning', '09:12', 'later'],
    ['1:49 PM, 16 min before leaving', '13:49', 'later'],
    ['1:50 PM, 15 min before leaving', '13:50', 'due'],
    ['2:05 PM, time to leave', '14:05', 'due'],
    ['2:10 PM, 5 min late', '14:10', 'due'],
    ['2:29 PM, a minute before it starts', '14:29', 'due'],
    ['2:30 PM, it starts', '14:30', 'gone'],
    ['2:45 PM, under way', '14:45', 'gone'],
    ['4:00 PM, over', '16:00', 'gone'],
  ])('at %s: %s', (_, time, state) => {
    const when = Date.parse(at('2026-10-07', time));
    expect(leaveState(dentist, when)).toBe(state);
    expect(leaveLine(dentist, zone, when)).toEqual(state === 'gone' ? null : {text: 'Leave by 2:05 PM · 18 min', state});
  });
  test('without Time to Leave there is no state', () => expect(leaveState(item({starts_at: at('2026-10-07', '14:30')}), morning)).toBeNull());
  test.each([[1, '1 min'], [59, '59 min'], [60, '1 hr'], [125, '2 hr 5 min']])('%i min of travel reads "%s"', (minutes, text) => expect(travelTime(minutes)).toBe(text));
});

describe('reminders', () => {
  test.each<[number[], string | null]>([
    [[30], '30 min before'],
    [[60], '1 hour before'],
    [[120], '2 hours before'],
    [[90], '1 hour 30 min before'],
    [[1440], '1 day before'],
    [[60, 10], '10 min, 1 hour before'],
    [[0], 'At the start'],
    [[0, 10], 'At the start, 10 min before'],
    [[], null],
  ])('%j → %s', (minutes, line) => expect(remindersLine(minutes)).toBe(line));
});

// A recurring event's card says it's a series, as the repeat field words it (#126).
describe('repeat', () => {
  test.each<[string, Partial<ItemOut>, string | null]>([
    ['Gym, weekly on three days', {recurring: true, recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR', starts_at: at('2026-10-07', '07:00')}, 'Weekly on Mon, Wed, Fri'],
    ['weekly on its own day, from the occurrence', {recurring: true, recurrence: 'RRULE:FREQ=WEEKLY', starts_at: at('2026-10-08', '18:00')}, 'Weekly on Thursday'],
    ['an all-day one, from its first day', {recurring: true, recurrence: 'RRULE:FREQ=MONTHLY', all_day: true, start_date: '2026-10-15', end_date: '2026-10-16'}, 'Monthly on day 15'],
    ['every weekday', {recurring: true, recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', starts_at: at('2026-10-07', '09:00')}, 'Every weekday'],
    ['a one-off event', {starts_at: at('2026-10-07', '14:30')}, null],
    ['a repeating task: its own line, not this one', {kind: 'task', recurring: true, recurrence: null, due_string: 'every mon', due_date: '2026-10-12'}, null],
  ])('%s', (_name, fields, line) => expect(repeatLine(item(fields), zone)).toBe(line));
});

describe('attendees', () => {
  test.each<[string[], string | null]>([
    [['Sam Lee'], 'Sam Lee'],
    [['Sam Lee', 'Jo Park'], 'Sam Lee, Jo Park'],
    [['Sam Lee', 'Jo Park', 'Ana Ruiz'], 'Sam Lee, Jo Park, Ana Ruiz'],
    [['Sam Lee', 'Jo Park', 'Ana Ruiz', 'Kai Chen', 'Lu Wang'], 'Sam Lee, Jo Park and 3 more'],
    [[], null],
  ])('%j', (list, line) => expect(attendeesLine(list)).toBe(line));
});
