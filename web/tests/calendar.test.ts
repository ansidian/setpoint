// The month grid's and the day agenda's rules as tables (DESIGN.md › Calendar): weeks and months,
// scrolling, which items fit before "+N", chip times and spans, past items, the agenda with its
// now-line, the mini-month, and where the "+N" popover hangs.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {
  addMonths, agenda, chipTime, dayCounts, dayHead, dayOfWeek, dayTitle, fitDay, FIRST_WEEK, hangFrom, isPast, monthEdges, isWeekend, itemDays, itemKey,
  itemsByDay, miniMonth, monthAtScroll, monthTopRow, monthWeeks, rangePick, rowsInView, tasksHeading, timeRange, weatherOf, weekday, weekIndex,
} from '../src/logic/calendar.ts';

const now = Date.parse(SEED_NOW);
const zone = SEED_TIME_ZONE;
const ROW = 176;

let nextId = 1;
function item(fields: Partial<ItemOut>): ItemOut {
  const id = nextId++;
  return {
    key: String(id), id, calendar_id: 1, kind: 'event', title: 'Item', time_zone: zone, recurring: false, recurrence: null, occurrence_start: null,
    place: null, address: null, attendees: [], reminders: [], leave_reminder: false, project: null, done: false, done_at: null, command: null,
    all_day: false, starts_at: null, ends_at: null, start_date: null, end_date: null, due_date: null, due_at: null, read_only: false, due_string: null, time_to_leave: null, colour: null, labels: [], repeat: null, ...fields,
  };
}
// Pacific daylight time in October: 7 AM is 14:00Z.
const at = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00-07:00`)).toISOString();
const event = (title: string, date: string, start: string, end: string, fields: Partial<ItemOut> = {}) => item({title, starts_at: at(date, start), ends_at: at(date, end), ...fields});
const task = (title: string, due: string, fields: Partial<ItemOut> = {}) => item({kind: 'task', title, all_day: true, due_date: due, calendar_id: 4, ...fields});

const calendars: CalendarOut[] = [
  {id: 1, provider: 'google', account_id: 2, name: 'Personal', colour: 'cool', position: 0, visible: true, command: null},
  {id: 2, provider: 'google', account_id: 2, name: 'Classes', colour: 'cyan', position: 1, visible: true, command: null},
  {id: 4, provider: 'todoist', account_id: null, name: 'Todoist', colour: null, position: 3, visible: true, command: null},
];

describe('weeks and months', () => {
  test.each([
    ['2026-10-04', 0], ['2026-10-05', 1], ['2026-10-07', 3], ['2026-10-10', 6], ['2026-10-11', 0], ['2026-11-01', 0],
  ])('%s is weekday %i (Sunday 0, SV-29)', (date, day) => expect(weekday(date)).toBe(day));

  test('a week index and its days agree', () => {
    const week = weekIndex('2026-10-07');
    expect([dayOfWeek(week, 0), dayOfWeek(week, 6)]).toEqual(['2026-10-04', '2026-10-10']);
    expect(weekIndex('2026-10-04')).toBe(week);
    expect(weekIndex('2026-10-03')).toBe(week - 1);
  });

  test.each([
    ['2026-10', 1, '2026-11'], ['2026-12', 1, '2027-01'], ['2026-01', -1, '2025-12'], ['2026-10', -10, '2025-12'], ['2026-10', 0, '2026-10'],
  ])('%s %+i → %s', (month, delta, expected) => expect(addMonths(month, delta)).toBe(expected));

  test.each([
    ['October 2026: Sep 27 – Oct 31, five rows', '2026-10', 5, '2026-09-27', '2026-10-31'],
    ['August 2026 starts on a Saturday: six rows', '2026-08', 6, '2026-07-26', '2026-09-05'],
    ['November 2026 starts on a Sunday: no days before it', '2026-11', 5, '2026-11-01', '2026-12-05'],
    ['February 2015 fills four rows exactly', '2015-02', 4, '2015-02-01', '2015-02-28'],
  ])('%s', (_name, month, rows, first, last) => {
    const weeks = monthWeeks(month);
    expect([weeks.length, weeks[0]![0], weeks.at(-1)![6]]).toEqual([rows, first, last]);
  });
});

describe('scrolling through months', () => {
  const top = (month: string) => monthTopRow(month) * ROW;
  // The target's grid is 964 px: five rows and a part. Its middle is 482 px down.
  const GRID = 964;
  test.each([
    ['paged to October: the row of Oct 1 at the top', top('2026-10'), GRID, '2026-10'],
    ['paged to November: Nov 1 – 7 at the top reads November', top('2026-11'), GRID, '2026-11'],
    ['a row further: still November', top('2026-11') + ROW, GRID, '2026-11'],
    ['October nudged up 242 px: Sep 20 – 26 and a sliver above at the top, October\'s rows fill the rest', top('2026-10') - 242, GRID, '2026-10'],
    ['October nudged up a whole row: Sep 20 – 26 at the top', top('2026-10') - ROW, GRID, '2026-10'],
    ['Oct 4 – 10 at the middle: October', top('2026-10') + ROW - GRID / 2, GRID, '2026-10'],
    ['a pixel more and Sep 27 – Oct 3 is at the middle: September (it\'s mostly September)', top('2026-10') + ROW - GRID / 2 - 1, GRID, '2026-09'],
    ['scrolling down, Oct 25 – 31 at the middle is October', top('2026-11') - GRID / 2 - 1, GRID, '2026-10'],
    ['Nov 1 – 7 reaches the middle: November', top('2026-11') - GRID / 2, GRID, '2026-11'],
    ['a grid under two rows tall paged to October still reads it: a row down, not Sep 27 – Oct 3', top('2026-10'), 300, '2026-10'],
    ['the very top', 0, GRID, '2000-01'],
  ])('%s', (_name, scrollTop, height, month) => expect(monthAtScroll(scrollTop, height, ROW)).toBe(month));

  test('the top row of a month holds its 1st', () => {
    expect(dayOfWeek(FIRST_WEEK + monthTopRow('2026-10'), 4)).toBe('2026-10-01');
    expect(dayOfWeek(FIRST_WEEK + monthTopRow('2026-11'), 0)).toBe('2026-11-01');
  });

  test.each([
    ['the target\'s grid (964 px) at October: five rows and a part, two more each side', top('2026-10'), 964, [monthTopRow('2026-10') - 2, monthTopRow('2026-10') + 7]],
    ['at the very top nothing before row 0', 0, 964, [0, 7]],
    ['mid-row', top('2026-10') + 100, 964, [monthTopRow('2026-10') - 2, monthTopRow('2026-10') + 8]],
  ])('%s', (_name, scrollTop, height, [first, last]) => expect(rowsInView(scrollTop, height, ROW)).toEqual({first, last}));
});

describe('a day cell', () => {
  test.each([
    ['2026-10-07', '7', false], ['2026-10-01', 'Oct 1', true], ['2026-11-01', 'Nov 1', true], ['2027-01-01', 'Jan 1', true], ['2026-10-31', '31', false],
  ])('%s heads as %s', (date, label, monthStart) => expect(dayHead(date)).toEqual({label, monthStart}));

  test.each([['2026-10-10', true], ['2026-10-11', true], ['2026-10-09', false], ['2026-10-12', false]])('%s weekend: %s', (date, weekend) => expect(isWeekend(date)).toBe(weekend));

  test.each([
    ['nothing', 0, 176, {shown: 0, more: 0}],
    ['Oct 9\'s three events', 3, 176, {shown: 3, more: 0}],
    ['six fit a 176 px row exactly', 6, 176, {shown: 6, more: 0}],
    ['seven: five and "+2"', 7, 176, {shown: 5, more: 2}],
    ['board 11b\'s Sat 17, eight items: five and "+3"', 8, 176, {shown: 5, more: 3}],
    ['twenty: five and "+15"', 20, 176, {shown: 5, more: 15}],
    ['a shorter row fits fewer', 4, 120, {shown: 2, more: 2}],
  ])('%s', (_name, count, row, expected) => expect(fitDay(count, row)).toEqual(expected));
});

describe('items on days', () => {
  test('a timed event its start\'s day, an all-day event each day, a task its due day', () => {
    expect(itemDays(event('Late show', '2026-10-09', '23:00', '23:59'), zone)).toEqual(['2026-10-09']);
    expect(itemDays(item({all_day: true, start_date: '2026-10-09', end_date: '2026-10-12'}), zone)).toEqual(['2026-10-09', '2026-10-10', '2026-10-11']);
    expect(itemDays(task('Pay rent', '2026-10-07'), zone)).toEqual(['2026-10-07']);
  });

  test('within a day: all-day events, then events by time, then tasks; calendars toggled off are left out', () => {
    const items = [
      task('Pay rent', '2026-10-07'), task('CS 101 lab report', '2026-10-07'),
      event('Dentist', '2026-10-07', '14:30', '15:30'), event('Gym', '2026-10-07', '07:00', '08:00'),
      item({title: 'Fall break', all_day: true, start_date: '2026-10-07', end_date: '2026-10-08'}),
      event('Lecture', '2026-10-07', '18:00', '19:15', {calendar_id: 2}),
    ];
    const titles = (cals: CalendarOut[]) => itemsByDay(items, cals, zone).get('2026-10-07')!.map(one => one.title);
    expect(titles(calendars)).toEqual(['Fall break', 'Gym', 'Dentist', 'Lecture', 'CS 101 lab report', 'Pay rent']);
    expect(titles(calendars.map(cal => (cal.name === 'Personal' || cal.name === 'Todoist' ? {...cal, visible: false} : cal)))).toEqual(['Lecture']);
  });

  test('an item loaded twice (two months\' ranges) shows once', () => {
    const gym = event('Gym', '2026-10-07', '07:00', '08:00');
    expect(itemsByDay([gym, {...gym}], calendars, zone).get('2026-10-07')).toHaveLength(1);
  });

  test.each([
    ['Gym this morning has ended', event('Gym', '2026-10-07', '07:00', '08:00'), true],
    ['an event under way isn\'t past', event('Standup', '2026-10-07', '09:00', '09:30'), false],
    ['Dentist this afternoon', event('Dentist', '2026-10-07', '14:30', '15:30'), false],
    ['yesterday\'s all-day event', item({all_day: true, start_date: '2026-10-06', end_date: '2026-10-07'}), true],
    ['today\'s all-day event', item({all_day: true, start_date: '2026-10-07', end_date: '2026-10-08'}), false],
    ['tasks are never past, done or overdue', task('Return library books', '2026-10-05', {done: true}), false],
  ])('%s: %s', (_name, one, past) => expect(isPast(one, now, zone)).toBe(past));

  test.each([
    ['on the hour', event('Gym', '2026-10-07', '07:00', '08:00'), '7 AM', '7:00 – 8:00 AM'],
    ['with minutes', event('Dentist', '2026-10-07', '14:30', '15:30'), '2:30 PM', '2:30 – 3:30 PM'],
    ['noon', event('Lunch with Jo', '2026-10-17', '12:30', '13:30'), '12:30 PM', '12:30 – 1:30 PM'],
    ['across noon', event('Career fair', '2026-10-15', '10:00', '14:00'), '10 AM', '10:00 AM – 2:00 PM'],
    ['all day', item({all_day: true, start_date: '2026-10-07', end_date: '2026-10-08'}), null, 'All day'],
  ])('%s: chip %s, span %s', (_name, one, chip, span) => {
    expect(chipTime(one, zone)).toBe(chip);
    expect(timeRange(one, zone)).toBe(span);
  });
});

describe('the right pane', () => {
  const gym = event('Gym', '2026-10-07', '07:00', '08:00', {recurring: true});
  const dentist = event('Dentist', '2026-10-07', '14:30', '15:30', {place: 'Smile Dental'});
  const tasks = [task('CS 101 lab report', '2026-10-07', {project: 'School'}), task('Pay rent', '2026-10-07', {project: 'Home'})];

  test('board 11, Wed Oct 7 at 9:12 AM: Gym past, the now-line, Dentist in 5h, two tasks', () => {
    const day = agenda('2026-10-07', [gym, dentist, ...tasks], calendars, now, zone);
    expect(day.events.map(one => [one.when, one.item.title, one.line, one.past, one.startsIn])).toEqual([
      ['7:00 AM', 'Gym', '7:00 – 8:00 AM · Personal', true, null],
      ['2:30 PM', 'Dentist', '2:30 – 3:30 PM · Smile Dental', false, 'in 5h'],
    ]);
    expect(day.nowAt).toBe(1);
    expect(day.tasks.map(one => one.title)).toEqual(['CS 101 lab report', 'Pay rent']);
  });

  test('an event at a street address: its street, not its calendar', () => {
    const lunch = event('Lunch', '2026-10-07', '12:00', '13:00', {address: '1420 Elm St, Los Angeles, CA 90026'});
    expect(agenda('2026-10-07', [lunch], calendars, now, zone).events.map(one => one.line)).toEqual(['12:00 – 1:00 PM · 1420 Elm St']);
  });

  test.each([
    ['before anything: the now-line first', Date.parse(at('2026-10-07', '06:00')), 0, 'in 1h'],
    ['during Gym: after it, and Gym is "now"', Date.parse(at('2026-10-07', '07:30')), 1, 'now'],
    ['after everything: last, and no next', Date.parse(at('2026-10-07', '18:00')), 2, null],
  ])('%s', (_name, when, nowAt, first) => {
    const day = agenda('2026-10-07', [gym, dentist], calendars, when, zone);
    expect(day.nowAt).toBe(nowAt);
    expect(day.events.find(one => one.startsIn)?.startsIn ?? null).toBe(first);
  });

  test('another day: no now-line, no "in"', () => {
    const day = agenda('2026-10-17', [event('Farmers market', '2026-10-17', '09:00', '10:30')], calendars, now, zone);
    expect([day.nowAt, day.events[0]!.startsIn, day.events[0]!.line]).toEqual([null, null, '9:00 – 10:30 AM · Personal']);
  });

  test.each([
    ['2026-10-07', 'Tasks · due today'], ['2026-10-08', 'Tasks · due tomorrow'], ['2026-10-06', 'Tasks · due yesterday'], ['2026-10-17', 'Tasks · due Sat'],
  ])('%s: %s', (date, heading) => expect(tasksHeading(date, '2026-10-07')).toBe(heading));

  test.each([
    ['board 11b', [...Array(6)].map(() => event('E', '2026-10-17', '09:00', '10:00')).concat(tasks), '6 events · 2 tasks'],
    ['one of each', [gym, tasks[0]!], '1 event · 1 task'],
    ['only tasks', tasks, '2 tasks'],
    ['nothing', [], 'Nothing planned'],
  ])('%s: %s', (_name, items, line) => expect(dayCounts(items)).toBe(line));

  test.each([
    [{date: '2026-10-07', condition: 'sun', high_f: 78, low_f: 61}, 'sunny', 'sun', 'Sunny · 78° / 61°'],
    [{date: '2026-10-08', condition: 'cloud', high_f: 72, low_f: 59}, 'cloud', 'cloud', 'Cloudy · 72° / 59°'],
    [{date: '2026-10-13', condition: 'rain', high_f: 64.4, low_f: 55}, 'rainy', 'rain', 'Rain · 64° / 55°'],
    [{date: '2026-10-14', condition: 'partly_cloudy', high_f: 70, low_f: 58}, 'partly_cloudy_day', 'cloud', 'Partly cloudy · 70° / 58°'],
  ] as const)('%o', (day, icon, tone, line) => expect(weatherOf(day)).toEqual({icon, tone, temps: line.split(' · ')[1], line}));

  test('dates and keys', () => {
    expect([dayTitle('2026-10-07'), dayTitle('2026-10-17')]).toEqual(['Wed, Oct 7', 'Sat, Oct 17']);
    expect([itemKey(3, null), itemKey(1, '2026-10-07T14:00:00.000Z')]).toEqual(['3', '1@2026-10-07T14:00:00.000Z']);
  });
});

describe('month boundaries', () => {
  // October 2026 starts on a Thursday and ends on a Saturday; today is Oct 7.
  test.each([
    ['Oct 1, the first: top and left', '2026-10-01', {top: true, left: true, now: true}],
    ['Oct 3, first row: top only', '2026-10-03', {top: true, left: false, now: true}],
    ['Oct 4, under Sep 27: top, no left at Sunday', '2026-10-04', {top: true, left: false, now: true}],
    ['Oct 8, under Oct 1: none', '2026-10-08', {top: false, left: false, now: false}],
    ['Sep 27, Sunday edge: none in its own row', '2026-09-27', {top: false, left: false, now: false}],
    ['Nov 1, Sunday under Oct 25: top, no left at Sunday', '2026-11-01', {top: true, left: false, now: true}],
    ['Nov 2, Monday under Oct 26: top, no left', '2026-11-02', {top: true, left: false, now: true}],
    ['Nov 9, inside November: none', '2026-11-09', {top: false, left: false, now: false}],
    ['Dec 1, between two other months: faint', '2026-12-01', {top: true, left: true, now: false}],
    ['Sep 1, faint', '2026-09-01', {top: true, left: true, now: false}],
  ])('%s', (_name, date, edges) => expect(monthEdges(date, '2026-10-07')).toEqual(edges));
});

describe('the mini-month', () => {
  const marks = (month: string, today: string, selected: string | null) => miniMonth(month, today, selected).flat()
    .filter(day => day.out || day.today || day.selected).map(day => `${day.day}${day.out ? ' out' : ''}${day.today ? ' today' : ''}${day.selected ? ' selected' : ''}`);

  test('board 11: today a disc, Sep 27–30 outside, the selected day (today) unmarked', () => {
    expect(marks('2026-10', '2026-10-07', '2026-10-07')).toEqual(['27 out', '28 out', '29 out', '30 out', '7 today']);
  });

  test('board 11b: Sat 17 selected', () => {
    expect(marks('2026-10', '2026-10-07', '2026-10-17')).toContain('17 selected');
  });

  test('SV-29: a range is a band from its first day to its last, the selection left unmarked', () => {
    const band = miniMonth('2026-10', '2026-10-07', '2026-10-13', {from: '2026-10-13', to: '2026-10-17'}).flat()
      .filter(day => day.inRange).map(day => `${day.day}${day.rangeStart ? ' first' : ''}${day.rangeEnd ? ' last' : ''}${day.selected ? ' selected' : ''}`);
    expect(band).toEqual(['13 first', '14', '15', '16', '17 last']);
  });

  test('board 16: the week view marks its shown week, today keeping its disc', () => {
    const week = miniMonth('2026-10', '2026-10-07', '2026-10-07', null, '2026-10-04').flat().filter(day => day.selected || day.today)
      .map(day => `${day.day}${day.today ? ' today' : ''}`);
    expect(week).toEqual(['4', '5', '6', '7 today', '8', '9', '10']);
  });

  test('stepped to November: today and the selection elsewhere leave no mark', () => {
    expect(marks('2026-11', '2026-10-07', '2026-10-17')).toEqual(['1 out', '2 out', '3 out', '4 out', '5 out']);
  });
});

describe('the "+N" popover', () => {
  const grid = {left: 0, top: 0, width: 1029, height: 994};
  test.each([
    ['board 11b: under Sat 17\'s "+3", 2 px left and below', {left: 741, top: 528, width: 135, height: 18}, 280, {left: 739, top: 548}],
    ['near the right edge it stays inside', {left: 888, top: 528, width: 135, height: 18}, 280, {left: 1029 - 8 - 280, top: 548}],
    ['near the bottom it opens above', {left: 300, top: 880, width: 135, height: 18}, 280, {left: 298, top: 880 - 2 - 280}],
    ['no room either way: as low as fits', {left: 300, top: 200, width: 135, height: 18}, 800, {left: 298, top: 994 - 8 - 800}],
  ])('%s', (_name, anchor, height, expected) => expect(hangFrom(anchor, {width: 280, height}, grid)).toEqual(expected));
});

describe('SV-29: picking an event\'s days in one month', () => {
  test.each([
    ['the first click starts it, one day', 'start', '2026-10-08', '2026-10-13', {from: '2026-10-13', to: '2026-10-13', done: false}],
    ['the next, on or after it, ends it', 'end', '2026-10-13', '2026-10-23', {from: '2026-10-13', to: '2026-10-23', done: true}],
    ['the same day again: one day', 'end', '2026-10-13', '2026-10-13', {from: '2026-10-13', to: '2026-10-13', done: true}],
    ['a day before the first starts it there and ends it on the first (#103)', 'end', '2026-10-13', '2026-10-06', {from: '2026-10-06', to: '2026-10-13', done: true}],
  ] as const)('%s', (_, phase, from, day, picked) => expect(rangePick(phase, from, day)).toEqual(picked));
});
