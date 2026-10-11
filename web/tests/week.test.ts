// The week view's rules as tables (DESIGN.md › Week view): the week and its title, the all-day row's
// bars, tasks and "+N", each day's blocks and lanes, the opening scroll, and what a drag makes of a
// pointer (create, move, resize), with the lines the toast and assistive tech read.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {
  allDayLayout, blockBox, blockLabel, blockLines, createRange, dayBlocks, dayRange, isAllDayBar, isShort, movedLine, movedTo, offersTop, openingScroll, rangeLabel, resizedDays,
  laneTime, resizedLine, resizedTo, segments, snap, startInWeek, taskTime, visibleItems, weekDays, weekMinutes, weekMonth, weekStart, weekTitle,
} from '../src/logic/week.ts';

const zone = SEED_TIME_ZONE;
const now = Date.parse(SEED_NOW);
const WEEK = '2026-10-04';

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
const event = (title: string, date: string, start: string, end: string, endDate = date) => item({title, starts_at: at(date, start), ends_at: at(endDate, end)});
const allDay = (title: string, first: string, endExclusive: string) => item({title, all_day: true, start_date: first, end_date: endExclusive});
const task = (title: string, due: string, fields: Partial<ItemOut> = {}) => item({kind: 'task', title, all_day: true, due_date: due, calendar_id: 4, ...fields});

describe('the week', () => {
  test.each([
    ['2026-10-04', '2026-10-04'], ['2026-10-07', '2026-10-04'], ['2026-10-10', '2026-10-04'], ['2026-10-11', '2026-10-11'], ['2026-01-01', '2025-12-28'],
  ])('%s is in the week starting Sunday %s (#52)', (date, start) => expect(weekStart(date)).toBe(start));

  test('its days run Sunday to Saturday', () => expect(weekDays(WEEK)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']));

  test.each([
    ['one month', '2026-10-04', 'Oct 4 – 10, 2026'],
    ['across months', '2026-09-27', 'Sep 27 – Oct 3, 2026'],
    ['across years', '2026-12-27', 'Dec 27, 2026 – Jan 2, 2027'],
  ])('its title, %s', (_name, start, title) => expect(weekTitle(start)).toBe(title));

  test.each([['2026-09-27', '2026-09'], ['2026-11-29', '2026-12'], [WEEK, '2026-10']])('the week of %s is mostly in %s', (start, month) => expect(weekMonth(start)).toBe(month));

  test('calendars toggled off and repeated keys are left out', () => {
    const shown = item({key: 'a', calendar_id: 1});
    const off = item({key: 'b', calendar_id: 2});
    const calendars = [{id: 1, visible: true}, {id: 2, visible: false}] as CalendarOut[];
    expect(visibleItems([shown, off, {...shown}], calendars).map(one => one.key)).toEqual(['a']);
  });
});

describe('the all-day row', () => {
  test.each([
    ['an all-day event', allDay('Trip', '2026-10-05', '2026-10-07'), true],
    ['a timed event of a day or more', event('Retreat', '2026-10-05', '09:00', '09:00', '2026-10-06'), true],
    ['a timed event under a day', event('Late show', '2026-10-05', '22:00', '01:00', '2026-10-06'), false],
    ['a task', task('Pay rent', '2026-10-07'), false],
  ])('%s is a bar: %s', (_name, one, bar) => expect(isAllDayBar(one)).toBe(bar));

  test('bars take lanes, earliest first and longest on a tie; tasks go under their day\'s lowest bar', () => {
    const trip = allDay('Trip', '2026-10-05', '2026-10-08');
    const fair = allDay('Fair', '2026-10-06', '2026-10-07');
    const rent = task('Pay rent', '2026-10-06');
    const books = task('Return library books', '2026-10-04');
    const layout = allDayLayout([rent, fair, trip, books], WEEK, zone);
    expect(layout.pieces.map(piece => [piece.item.title, piece.from, piece.to, piece.lane])).toEqual([['Trip', 1, 3, 0], ['Fair', 2, 2, 1]]);
    expect(layout.tasks.map(line => [line.item.title, line.column, line.line])).toEqual([['Return library books', 0, 0], ['Pay rent', 2, 2]]);
    expect(layout.more).toEqual([]);
    expect(layout.lines).toBe(3);
  });

  test('two lines at least, even with nothing', () => expect(allDayLayout([], WEEK, zone).lines).toBe(2));

  test('a day needing more than three lines shows two and "+N" on the third', () => {
    const list = ['A', 'B', 'C', 'D'].map(title => task(title, '2026-10-07'));
    const layout = allDayLayout(list, WEEK, zone);
    expect(layout.tasks.map(line => line.item.title)).toEqual(['A', 'B']);
    expect(layout.more).toEqual([{date: '2026-10-07', column: 3, line: 2, count: 2}]);
    expect(layout.lines).toBe(3);
  });

  test('a bar shows only where its lane is drawn, in pieces around a crowded day', () => {
    // Equal bars take lanes by title: A, B, then C in the third.
    const one = allDay('A', '2026-10-04', '2026-10-11');
    const two = allDay('B', '2026-10-04', '2026-10-11');
    const three = allDay('C', '2026-10-04', '2026-10-11');
    const extra = task('Extra', '2026-10-07');
    const layout = allDayLayout([one, two, three, extra], WEEK, zone);
    expect(layout.pieces.filter(piece => piece.item.title === 'C').map(piece => [piece.from, piece.to, piece.date, piece.before, piece.after]))
      .toEqual([[0, 2, '2026-10-04', false, true], [4, 6, '2026-10-08', true, false]]);
    expect(layout.more).toEqual([{date: '2026-10-07', column: 3, line: 2, count: 2}]);
  });

  test('a bar running past the week is clipped and says so', () => {
    const long = allDay('Leave', '2026-10-01', '2026-10-14');
    expect(allDayLayout([long], WEEK, zone).pieces.map(piece => [piece.from, piece.to, piece.before, piece.after])).toEqual([[0, 6, true, true]]);
  });

  test('done tasks go last, timed ones in time order', () => {
    const done = task('Done', '2026-10-07', {done: true});
    const later = task('Later', '2026-10-07', {due_at: at('2026-10-07', '15:00')});
    const sooner = task('Sooner', '2026-10-07', {due_at: at('2026-10-07', '09:00')});
    const untimed = task('Untimed', '2026-10-07');
    const layout = allDayLayout([done, untimed, later, sooner], WEEK, zone);
    expect(layout.tasks.map(line => line.item.title)).toEqual(['Sooner', 'Later']);
    expect(taskTime(sooner, zone)).toBe('9:00 AM');
    expect(taskTime(untimed, zone)).toBeNull();
  });
});

describe('the hours', () => {
  test('a timed event is a segment on its day; one crossing midnight draws in both days', () => {
    const dentist = event('Dentist', '2026-10-07', '14:30', '15:30');
    const late = event('Late show', '2026-10-09', '22:00', '01:30', '2026-10-10');
    const atMidnight = event('Until midnight', '2026-10-08', '23:00', '00:00', '2026-10-09');
    const list = segments([dentist, late, atMidnight, task('Pay rent', '2026-10-07')], WEEK, zone);
    expect(list.map(one => [one.item.title, one.date, one.start, one.end, one.continued, one.continues])).toEqual([
      ['Dentist', '2026-10-07', 870, 930, false, false],
      ['Late show', '2026-10-09', 1320, 1440, false, true],
      ['Late show', '2026-10-10', 0, 90, true, false],
      ['Until midnight', '2026-10-08', 1380, 1440, false, false],
    ]);
  });

  test('a piece outside the week is left out', () => {
    const saturday = event('Late show', '2026-10-10', '22:00', '01:00', '2026-10-11');
    expect(segments([saturday], WEEK, zone).map(one => one.date)).toEqual(['2026-10-10']);
  });

  const day = (...list: ItemOut[]) => dayBlocks(segments(list, WEEK, zone));

  test('board 16: Study group and Dinner with Sam side by side', () => {
    const {blocks, more} = day(event('Study group', '2026-10-09', '18:30', '20:30'), event('Dinner with Sam', '2026-10-09', '19:00', '21:00'), event('Gym', '2026-10-09', '07:00', '08:00'));
    expect(blocks.map(block => [block.item.title, block.lane, block.lanes])).toEqual([['Gym', 0, 1], ['Study group', 0, 2], ['Dinner with Sam', 1, 2]]);
    expect(more).toEqual([]);
  });

  test('a lane frees once its block ends', () => {
    const {blocks} = day(event('A', '2026-10-07', '09:00', '11:00'), event('B', '2026-10-07', '09:30', '10:00'), event('C', '2026-10-07', '10:00', '10:30'));
    expect(blocks.map(block => [block.item.title, block.lane, block.lanes])).toEqual([['A', 0, 2], ['B', 1, 2], ['C', 1, 2]]);
  });

  test('three lanes at most: a fourth folds into "+N" in the third', () => {
    const {blocks, more} = day(...['A', 'B', 'C', 'D'].map(title => event(title, '2026-10-07', '09:00', '10:00')));
    expect(blocks.map(block => [block.item.title, block.lane, block.lanes])).toEqual([['A', 0, 3], ['B', 1, 3]]);
    expect(more).toEqual([{date: '2026-10-07', start: 540, lane: 2, lanes: 3, count: 2}]);
  });

  test('a short block\'s 20 px counts as its length for overlap', () => {
    const {blocks} = day(event('Standup', '2026-10-07', '09:00', '09:15'), event('Next', '2026-10-07', '09:15', '10:00'));
    expect(blocks.map(block => block.lanes)).toEqual([2, 2]);
  });

  test.each([
    ['an hour (board 16\'s Gym)', 420, 480, {top: 309, height: 42}],
    ['an hour and a quarter (CS 101 lecture)', 1080, 1155, {top: 793, height: 53}],
    ['ten minutes, held at 20 px', 540, 550, {top: 397, height: 20}],
  ])('%s', (_name, start, end, box) => expect(blockBox(start, end)).toEqual(box));

  test.each([[540, 570, true], [540, 589, true], [540, 590, false]])('%i–%i is short: %s', (start, end, short) => expect(isShort(start, end)).toBe(short));

  test.each([
    ['this week: now (9:12 AM) a third down', WEEK, [], 400, 271],
    ['another week: an hour before its first item', '2026-10-11', [event('Early', '2026-10-12', '06:00', '07:00')], 400, 220],
    ['another week, nothing early: 7 AM', '2026-10-11', [event('Late', '2026-10-12', '19:00', '20:00')], 400, 308],
    ['another week, empty: 7 AM', '2026-10-11', [], 400, 308],
    ['never past the evening\'s end (board 16: 164 px of scroll)', '2026-10-11', [], 892, 164],
  ])('the opening scroll, %s', (_name, start, list, height, top) => expect(openingScroll(start, '2026-10-07', now, segments(list, start, zone), zone, height)).toBe(top));
});

describe('drags', () => {
  test.each([[0, 0], [7, 0], [8, 15], [607, 600], [1439, 1440], [1500, 1440], [-20, 0]])('%i snaps to %i', (minutes, snapped) => expect(snap(minutes)).toBe(snapped));

  test.each([
    ['down from 12:00 to 1:22 PM', 720, 802, {start: 720, end: 810}],
    ['up from 1:30 to 12:10 PM', 810, 730, {start: 720, end: 810}],
    ['barely moved: 15 minutes', 727, 729, {start: 720, end: 735}],
    ['at the day\'s end', 1435, 1440, {start: 1425, end: 1440}],
  ])('a create range, %s', (_name, pressed, pointer, range) => expect(createRange(pressed, pointer)).toEqual(range));

  test('a move keeps the length, in 15-minute steps, onto any day', () => {
    const dentist = event('Dentist', '2026-10-07', '14:30', '15:30');
    expect(startInWeek(dentist, WEEK, zone)).toBe(weekMinutes(3, 870));
    expect(movedTo(dentist, WEEK, weekMinutes(4, 905), zone)).toEqual({starts_at: at('2026-10-08', '15:00'), ends_at: at('2026-10-08', '16:00')});
    expect(movedTo(dentist, WEEK, weekMinutes(3, 868), zone)).toBeNull();
  });

  test('a move across the fall\'s daylight-saving change keeps the wall clock', () => {
    const gym = item({title: 'Gym', starts_at: at('2026-10-31', '07:00'), ends_at: at('2026-10-31', '08:00')});
    expect(movedTo(gym, '2026-11-01', weekMinutes(0, 420), zone)).toEqual({starts_at: '2026-11-01T15:00:00.000Z', ends_at: '2026-11-01T16:00:00.000Z'});
  });

  test.each([
    ['the end later', 'end', weekMinutes(3, 960), {ends_at: at('2026-10-07', '16:00')}],
    ['the start earlier', 'start', weekMinutes(3, 840), {starts_at: at('2026-10-07', '14:00')}],
    ['the start past the end stops 15 minutes short', 'start', weekMinutes(3, 1000), {starts_at: at('2026-10-07', '15:15')}],
    ['the end before the start stops 15 minutes after', 'end', weekMinutes(3, 600), {ends_at: at('2026-10-07', '14:45')}],
    ['the end onto the next day', 'end', weekMinutes(4, 60), {ends_at: at('2026-10-08', '01:00')}],
    ['where it was', 'end', weekMinutes(3, 935), null],
  ] as const)('a resize: %s', (_name, edge, minutes, changes) => {
    const dentist = event('Dentist', '2026-10-07', '14:30', '15:30');
    expect(resizedTo(dentist, edge, WEEK, minutes, zone)).toEqual(changes);
  });

  test.each([
    ['its last day later', 'end', '2026-10-08', {end_date: '2026-10-09'}],
    ['its first day earlier', 'start', '2026-10-04', {start_date: '2026-10-04'}],
    ['its first day past its last stops on its last', 'start', '2026-10-09', {start_date: '2026-10-06'}],
    ['its last day before its first stops on its first', 'end', '2026-10-04', {end_date: '2026-10-06'}],
    ['where it was', 'end', '2026-10-06', null],
  ] as const)('an all-day resize: %s', (_name, edge, dayTo, changes) => {
    const trip = allDay('Trip', '2026-10-05', '2026-10-07');
    expect(resizedDays(trip, edge, dayTo)).toEqual(changes);
  });

  test('only a block of 30 minutes or more, starting that day, offers its top edge', () => {
    const [half, short] = segments([event('Half', '2026-10-07', '09:00', '09:30'), event('Short', '2026-10-07', '11:00', '11:20')], WEEK, zone);
    const [, next] = segments([event('Late', '2026-10-09', '22:00', '01:30', '2026-10-10')], WEEK, zone);
    expect([offersTop(half!), offersTop(short!), offersTop(next!)]).toEqual([true, false, false]);
  });

  test('a drag across the all-day row covers its days either way', () => {
    expect(dayRange('2026-10-08', '2026-10-05')).toEqual({from: '2026-10-05', to: '2026-10-08'});
    expect(dayRange('2026-10-05', '2026-10-05')).toEqual({from: '2026-10-05', to: '2026-10-05'});
  });
});

describe('words', () => {
  const dentist = event('Dentist', '2026-10-07', '14:30', '15:30');

  test.each([
    ['a timed move', dentist, {starts_at: at('2026-10-08', '15:00'), ends_at: at('2026-10-08', '16:00')}, 'Moved Dentist to Thu, Oct 8, 3:00 PM'],
    ['an all-day move', allDay('Trip', '2026-10-05', '2026-10-07'), {start_date: '2026-10-08', end_date: '2026-10-10'}, 'Moved Trip to Thu, Oct 8'],
    ['a task', task('Pay rent', '2026-10-07'), {due_date: '2026-10-08'}, 'Moved Pay rent to Thu, Oct 8'],
  ])('%s says where it went', (_name, one, changes, line) => expect(movedLine(one, changes, zone)).toBe(line));

  test.each([
    ['a longer event', dentist, {ends_at: at('2026-10-07', '16:00')}, 'Changed Dentist to 2:30 – 4:00 PM'],
    ['a longer trip', allDay('Trip', '2026-10-04', '2026-10-05'), {end_date: '2026-10-07'}, 'Changed Trip to Sun, Oct 4 – Tue, Oct 6'],
    ['a trip down to a day', allDay('Trip', '2026-10-04', '2026-10-07'), {end_date: '2026-10-05'}, 'Changed Trip to Sun, Oct 4'],
  ])('a resize of %s says its new span', (_name, one, changes, line) => expect(resizedLine(one, changes, zone)).toBe(line));

  test.each([
    ['on the hour', event('Dinner', '2026-10-09', '19:00', '21:00'), '7 PM'],
    ['on the half hour', event('Study group', '2026-10-09', '18:30', '20:30'), '6:30 PM'],
  ])('a shared column\'s time, %s, is its start', (_name, one, time) => expect(laneTime(one, zone)).toBe(time));

  test.each([
    ['board 16\'s Dinner with Sam, two hours beside Study group', 86, true, {title: 2, place: true}],
    ['an hour beside another', 42, true, {title: 1, place: false}],
    ['an hour and a quarter alone', 53, false, {title: 1, place: true}],
    ['an hour alone', 42, false, {title: 1, place: false}],
    ['an hour and a half beside another', 64, true, {title: 1, place: true}],
  ])('a block\'s lines: %s', (_name, height, narrow, lines) => expect(blockLines(height, narrow)).toEqual(lines));

  test('the drag\'s range', () => {
    expect(rangeLabel('2026-10-08', 720, 810, zone)).toBe('12:00 – 1:30 PM');
    expect(rangeLabel('2026-10-08', 600, 780, zone)).toBe('10:00 AM – 1:00 PM');
  });

  test.each([
    ['an event', dentist, 'Personal', 'Dentist, Wed, Oct 7, 2:30 – 3:30 PM, Personal'],
    ['a task', task('Pay rent', '2026-10-07', {project: 'Home'}), undefined, 'Pay rent, Wed, Oct 7, Due, Home'],
  ])('%s reads to assistive tech', (_name, one, calendar, label) => expect(blockLabel(one, '2026-10-07', calendar, zone)).toBe(label));
});
