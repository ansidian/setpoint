// SV-23: calendar search (DESIGN.md › Decided while building #24). The rules as tables: the calendar
// and date chips, free text over each field, Upcoming then Past, and a recurring event as one row
// (its next occurrence, its last once ended) with a changed occurrence on its own only when the
// change is what matched. Then the search over the seed and its route.
import type {CalendarSearchChip, CalendarSearchOut} from '@setpoint/shared';
import {calendarSearchInput, SEED_NOW} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {parseCalendarQuery, searchItems, textReasons} from '../src/domain/calendarSearch.ts';
import type {SearchItem} from '../src/domain/calendarSearch.ts';
import {searchCalendar} from '../src/search/calendar.ts';
import {signedIn, world} from './helpers.ts';
import type {World} from './helpers.ts';

const TIME_ZONE = 'America/Los_Angeles';
const CLOCK = {now: SEED_NOW, timeZone: TIME_ZONE};
const CALENDAR_NAMES = ['Personal', 'Classes', 'Jobs', 'Todoist'];

const showChip = (chip: CalendarSearchChip) => (chip.kind === 'date' ? `Date ${chip.label} [${chip.from}, ${chip.to})` : `Calendar ${chip.label}`);

describe('parseCalendarQuery: date chips as mail\'s, calendar chips by name', () => {
  test.each<[string, string[], string]>([
    ['classes', ['Calendar Classes'], ''],
    ['todoist', ['Calendar Todoist'], ''],
    ['Personal dinner', ['Calendar Personal'], 'dinner'],
    ['classes march lab', ['Calendar Classes', 'Date Mar 2026 [2026-03-01, 2026-04-01)', 'Date Mar 2027 [2027-03-01, 2027-04-01)'], 'lab'],
    ['november', ['Date Nov 2025 [2025-11-01, 2025-12-01)', 'Date Nov 2026 [2026-11-01, 2026-12-01)'], ''],
    ['october', ['Date Oct 2026 [2026-10-01, 2026-11-01)'], ''],
    ['march 2026', ['Date Mar 2026 [2026-03-01, 2026-04-01)'], ''],
    ['gym last week', ['Date Sep 27 – Oct 3 [2026-09-27, 2026-10-04)'], 'gym'],
    ['class', [], 'class'],
    ['"classes"', [], '"classes"'],
    ['dinner with sam', [], 'dinner with sam'],
  ])('%s', (text, chips, rest) => {
    const parsed = parseCalendarQuery(text, CALENDAR_NAMES, CLOCK);
    expect(parsed.chips.map(showChip)).toEqual(chips);
    expect(parsed.text).toBe(rest);
  });
});

let nextId = 1;
/** A row as the database holds it: a timed event on the Personal calendar unless told otherwise. */
function row(fields: Partial<SearchItem>): SearchItem {
  return {
    id: nextId++, calendarId: 1, kind: 'event', title: 'Untitled', allDay: false, startsAt: null, endsAt: null, startDate: null, endDate: null, dueDate: null,
    timeZone: TIME_ZONE, recurrence: null, place: null, address: null, attendees: null, project: null, labels: null,
    recurringItemId: null, originalStart: null, cancelled: false, expanded: false, ...fields,
  };
}
/** A timed event: local day and times in Los Angeles (PDT, UTC−7, in the fall). */
const at = (date: string, time: string) => new Date(Date.parse(`${date}T${time}:00-07:00`)).toISOString();
const timed = (date: string, start: string, end: string, fields: Partial<SearchItem> = {}) => row({startsAt: at(date, start), endsAt: at(date, end), ...fields});

describe('textReasons: each word under the first field it\'s in, every word or none', () => {
  const dinner = row({title: 'Dinner with Sam', place: 'Blue Door', address: '2118 Sunset Blvd', attendees: ['Sam Lee', 'Ana Ruiz']});
  const task = row({kind: 'task', title: 'Pay rent', dueDate: '2026-10-07', project: 'Home', labels: ['errand', 'waiting']});
  const show = (item: SearchItem, terms: string[], mode: 'and' | 'or' = 'and') => textReasons(item, item.kind === 'task' ? 'Todoist' : 'Personal', terms, mode)
    ?.map(reason => `${reason.key} ${reason.value}${reason.runs.length ? ` [${reason.runs.map(run => reason.value.slice(run.start, run.end)).join(', ')}]` : ''}`);
  test.each<[string, SearchItem, string[], 'and' | 'or', string[] | undefined]>([
    ['a title word, as the title writes it', dinner, ['din'], 'and', ['Title Dinner [Din]']],
    ['the place', dinner, ['blue'], 'and', ['Place Blue Door [Blue]']],
    ['the address', dinner, ['sunset'], 'and', ['Address 2118 Sunset Blvd [Sunset]']],
    ['an attendee, only the ones that match', dinner, ['ana'], 'and', ['With Ana Ruiz [Ana]']],
    ['a word in the title is told there, not again under attendees', dinner, ['sam'], 'and', ['Title Sam [Sam]']],
    ['the calendar\'s name', dinner, ['personal'], 'and', ['Calendar Personal [Personal]']],
    ['a task\'s project and labels', task, ['home', 'errands'], 'and', ['Project Home [Home]', 'Label errand [errand]']],
    ['every word must match', dinner, ['blue', 'zebra'], 'and', undefined],
    ['or any of them', dinner, ['blue', 'zebra'], 'or', ['Place Blue Door [Blue]']],
  ])('%s', (_name, item, terms, mode, expected) => {
    expect(show(item, terms, mode) ?? undefined).toEqual(expected);
  });
});

describe('searchItems: Upcoming soonest first, then Past most recent first', () => {
  const calendars = new Map([[1, 'Personal'], [2, 'Classes'], [4, 'Todoist']]);
  const search = (rows: SearchItem[], text: string, chips: CalendarSearchChip[] = [], shown = calendars) => searchItems(rows, shown, chips, text, CLOCK)
    .map(hit => `${hit.upcoming ? 'Upcoming' : 'Past'} ${hit.day} ${hit.row.title}${hit.occurrence ? ` @${hit.occurrence.start}` : ''}${hit.rule ? ' (series)' : ''}`);

  test('single items in order, tasks by their due day, hidden calendars and deleted occurrences left out', () => {
    const rows = [
      timed('2026-10-01', '10:00', '11:00', {title: 'Review A'}),
      timed('2026-10-20', '10:00', '11:00', {title: 'Review B'}),
      timed('2026-09-15', '10:00', '11:00', {title: 'Review C'}),
      timed('2026-10-09', '10:00', '11:00', {title: 'Review D'}),
      // Today: started before now (9:12 AM) and still on, so not over yet.
      timed('2026-10-07', '09:00', '10:00', {title: 'Review E'}),
      row({kind: 'task', calendarId: 4, title: 'Review notes', dueDate: '2026-10-06'}),
      row({kind: 'event', allDay: true, title: 'Review week', startDate: '2026-10-12', endDate: '2026-10-17'}),
      timed('2026-10-10', '10:00', '11:00', {title: 'Review hidden', calendarId: 3}),
    ];
    expect(search(rows, 'review')).toEqual([
      'Upcoming 2026-10-07 Review E', 'Upcoming 2026-10-09 Review D', 'Upcoming 2026-10-12 Review week', 'Upcoming 2026-10-20 Review B',
      'Past 2026-10-06 Review notes', 'Past 2026-10-01 Review A', 'Past 2026-09-15 Review C',
    ]);
  });

  test('a recurring event is one row: its next occurrence, or its last once it has ended', () => {
    const gym = timed('2026-08-31', '07:00', '08:00', {title: 'Gym', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'});
    const summer = timed('2026-06-01', '07:00', '08:00', {title: 'Gym summer', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20260831T235959Z'});
    // Today's 7 AM is over at 9:12, so Gym's next is Friday's.
    expect(search([gym, summer], 'gym')).toEqual([
      `Upcoming 2026-10-09 Gym @${at('2026-10-09', '07:00')} (series)`,
      `Past 2026-08-31 Gym summer @${at('2026-08-31', '07:00')} (series)`,
    ]);
    // A date chip: the series' next occurrence within it, else its last there.
    const september: CalendarSearchChip = {kind: 'date', from: '2026-09-01', to: '2026-10-01', label: 'Sep 2026'};
    expect(search([gym], 'gym', [september])).toEqual([`Past 2026-09-30 Gym @${at('2026-09-30', '07:00')} (series)`]);
    const november: CalendarSearchChip = {kind: 'date', from: '2026-11-01', to: '2026-12-01', label: 'Nov 2026'};
    // After the change back to PST, still at 7 AM.
    expect(search([gym], 'gym', [november])).toEqual(['Upcoming 2026-11-02 Gym @2026-11-02T15:00:00.000Z (series)']);
  });

  test('a changed occurrence has its own row only when the change is what matched', () => {
    const gym = timed('2026-08-31', '07:00', '08:00', {title: 'Gym', place: 'Campus gym', recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR'});
    const moved = timed('2026-10-16', '09:00', '10:00', {title: 'Gym', place: 'Riverside pool', recurringItemId: gym.id, originalStart: at('2026-10-16', '07:00')});
    const dropped = timed('2026-10-09', '07:00', '08:00', {title: 'Gym', recurringItemId: gym.id, originalStart: at('2026-10-09', '07:00'), cancelled: true});
    const rows = [gym, moved, dropped];
    // "gym" matches the series: one row, its next occurrence (Friday's was deleted, so Monday's).
    expect(search(rows, 'gym')).toEqual([`Upcoming 2026-10-12 Gym @${at('2026-10-12', '07:00')} (series)`]);
    // "pool" is what changed on the 16th: that occurrence alone.
    expect(search(rows, 'pool')).toEqual(['Upcoming 2026-10-16 Gym']);
    // A date chip on the changed day finds it through the series.
    const day: CalendarSearchChip = {kind: 'date', from: '2026-10-16', to: '2026-10-17', label: 'Oct 16'};
    expect(search(rows, 'gym', [day])).toEqual(['Upcoming 2026-10-16 Gym (series)']);
  });

  test('a series Google expands is one row too, from its occurrences\' rows', () => {
    const master = row({title: 'Standup', allDay: true, startDate: '2026-10-01', endDate: '2026-10-02', recurrence: 'RRULE:FREQ=DAILY;COUNT=10', expanded: true});
    const days = ['2026-10-05', '2026-10-06', '2026-10-08', '2026-10-09'].map(date => row({
      title: 'Standup', allDay: true, startDate: date, endDate: `2026-10-${String(Number(date.slice(8)) + 1).padStart(2, '0')}`, recurringItemId: master.id, originalStart: date,
    }));
    const renamed = row({title: 'Standup and retro', allDay: true, startDate: '2026-10-12', endDate: '2026-10-13', recurringItemId: master.id, originalStart: '2026-10-12'});
    expect(search([master, ...days, renamed], 'standup')).toEqual(['Upcoming 2026-10-08 Standup (series)']);
    expect(search([master, ...days, renamed], 'retro')).toEqual(['Upcoming 2026-10-12 Standup and retro']);
  });

  test('chips alone: a calendar (Todoist is every task), a date; nothing without chips or words', () => {
    const rows = [
      timed('2026-10-09', '18:30', '20:30', {title: 'Study group', calendarId: 2}),
      row({kind: 'task', calendarId: 4, title: 'Pay rent', dueDate: '2026-10-07'}),
      timed('2026-10-09', '19:00', '21:00', {title: 'Dinner'}),
    ];
    expect(search(rows, '', [{kind: 'calendar', value: 'Todoist', label: 'Todoist'}])).toEqual(['Upcoming 2026-10-07 Pay rent']);
    expect(search(rows, '', [{kind: 'calendar', value: 'Classes', label: 'Classes'}, {kind: 'calendar', value: 'Personal', label: 'Personal'}]))
      .toEqual(['Upcoming 2026-10-09 Study group', 'Upcoming 2026-10-09 Dinner']);
    expect(search(rows, '')).toEqual([]);
  });

  test('every word, then any word but filler, as mail\'s ladder', () => {
    const rows = [timed('2026-10-09', '19:00', '21:00', {title: 'Dinner with Sam'}), timed('2026-10-10', '19:00', '21:00', {title: 'Lunch'})];
    expect(search(rows, 'dinner lunch')).toEqual(['Upcoming 2026-10-09 Dinner with Sam', 'Upcoming 2026-10-10 Lunch']);
    expect(search(rows, 'zebra')).toEqual([]);
  });
});

describe('calendar search over the seed', () => {
  const find = (w: World, text: string, extra: Record<string, unknown> = {}) => searchCalendar(w.store, calendarSearchInput.parse({text, ...extra}));
  const rows = (out: CalendarSearchOut) => out.results.map(result => `${result.upcoming ? 'Upcoming' : 'Past'} ${result.date} ${result.item.title} · ${result.reasons.map(reason => `${reason.key} ${reason.value}`).join(' · ')}`);

  test('a series is one row with its rule, keyed as the grid keys its occurrence', () => {
    const w = world({seed: true});
    const out = find(w, 'lecture');
    expect(out).toMatchObject({chips: [], text: 'lecture', total: 1, next_offset: null});
    const [lecture] = out.results;
    expect(lecture).toMatchObject({date: '2026-10-08', upcoming: true, rule: 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261204T075959Z', highlights: [{start: 7, end: 14}]});
    expect(lecture!.item).toMatchObject({key: `${lecture!.item.id}@2026-10-09T01:00:00.000Z`, occurrence_start: '2026-10-09T01:00:00.000Z', recurring: true});
  });

  test('Todoist is every task; a place, an attendee; a month with a calendar', () => {
    const w = world({seed: true});
    expect(rows(find(w, 'todoist'))).toEqual([
      'Upcoming 2026-10-07 CS 101 lab report · Calendar Todoist', 'Upcoming 2026-10-07 Pay rent · Calendar Todoist',
      'Upcoming 2026-10-08 Renew car registration · Calendar Todoist', 'Past 2026-10-05 Return library books · Calendar Todoist',
    ]);
    // A chip's reason isn't highlighted (every row would be); a free word's is.
    expect(find(w, 'todoist').results[0]!.reasons).toEqual([{field: 'calendar', key: 'Calendar', value: 'Todoist', runs: []}]);
    expect(rows(find(w, 'blue door'))).toEqual(['Upcoming 2026-10-09 Dinner with Sam · Place Blue Door']);
    expect(find(w, 'blue door').results[0]!.reasons[0]!.runs).toEqual([{start: 0, end: 4}, {start: 5, end: 9}]);
    expect(rows(find(w, 'lee'))).toEqual(['Upcoming 2026-10-09 Dinner with Sam · With Sam Lee']);
    const out = find(w, 'classes october');
    expect(out.chips.map(chip => chip.label)).toEqual(['Classes', 'Oct 2026']);
    expect(rows(out)).toEqual(['Upcoming 2026-10-08 CS 101 lecture · Calendar Classes · Date Oct 8', 'Upcoming 2026-10-09 Study group · Calendar Classes · Date Oct 9']);
    expect(find(w, 'zebra')).toMatchObject({total: 0, results: []});
  });

  test('a hidden calendar is left out', () => {
    const w = world({seed: true});
    w.store.db.update(t.calendars).set({visible: false}).where(eq(t.calendars.name, 'Classes')).run();
    expect(find(w, 'classes').total).toBe(0);
    expect(find(w, 'cs 101').results.map(result => result.item.title)).toEqual(['CS 101 lab report']);
  });

  test('pages: 50 at a time, then the next page from `next_offset`', () => {
    const w = world({seed: true});
    const first = find(w, 'october', {limit: 4});
    expect(first).toMatchObject({total: 10, next_offset: 4});
    const second = find(w, 'october', {limit: 4, offset: 4});
    expect(second.next_offset).toBe(8);
    expect(find(w, 'october', {limit: 4, offset: 8}).next_offset).toBeNull();
    expect(new Set([...first.results, ...second.results].map(result => result.item.key)).size).toBe(8);
  });

  test('the route answers, refuses a malformed chip and needs a session', async () => {
    const w = world({seed: true});
    const c = await signedIn(w);
    const out = (await c.send('POST', '/api/calendar/search', {body: {text: 'dinner', chips: [{kind: 'calendar', value: 'Personal', label: 'Personal'}]}})).body as CalendarSearchOut;
    expect(out.results.map(result => result.item.title)).toEqual(['Dinner with Sam']);
    expect((await c.send('POST', '/api/calendar/search', {body: {text: 'x', chips: [{kind: 'type', value: 'rejection', label: 'Rejection'}]}})).status).toBe(400);
    c.cookie = null;
    expect((await c.send('POST', '/api/calendar/search', {body: {text: 'gym'}})).status).toBe(401);
  });
});
