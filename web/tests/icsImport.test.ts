// SV-181: the .ics import review's rules as tables (D437): ticks, each row's line and marks, the
// list's lines and copy, what's sent for an event (from the review or the editor), and a run's counts.
import type {IcsEventOut, IcsReadOut, ItemCreateInput} from '@setpoint/shared';
import {ICS_DROP_REASONS, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {alreadyLine, droppedLine, editedImport, importedLine, importLabel, importOf, initialTicks, isIcsFile, nothingLine, progressLine, refusedLine, rowMarks, rowTitle, rowWhen, runCounts} from '../src/logic/icsImport.ts';
import type {RowState} from '../src/logic/icsImport.ts';

const zone = SEED_TIME_ZONE;
const event = (fields: Partial<IcsEventOut>): IcsEventOut => ({
  ical_uid: 'uid@example.com', sequence: 0, title: 'Opening keynote', all_day: false, starts_at: '2026-10-15T16:00:00.000Z', ends_at: '2026-10-15T17:00:00.000Z',
  start_date: null, end_date: null, time_zone: null, place: 'Main Hall', address: 'Northwind Conference Center', description: 'A session.',
  url: 'https://devcon.example.com/sessions/101', transparency: 'transparent', reminders: [], recurrence: [], changes: [], past: false, existing: [], ...fields,
});
const none = Object.fromEntries(ICS_DROP_REASONS.map(reason => [reason, 0])) as IcsReadOut['dropped'];

describe('rows', () => {
  test.each([
    ['a timed event, in the user\'s zone', event({}), 'Thu, Oct 15 · 9:00 – 10:00 AM'],
    ['across noon', event({starts_at: '2026-10-15T17:00:00.000Z', ends_at: '2026-10-15T21:00:00.000Z'}), 'Thu, Oct 15 · 10:00 AM – 2:00 PM'],
    ['with no length', event({ends_at: '2026-10-15T16:00:00.000Z'}), 'Thu, Oct 15 · 9:00 AM'],
    ['all day', event({all_day: true, starts_at: null, ends_at: null, start_date: '2026-11-14', end_date: '2026-11-15'}), 'Sat, Nov 14 · All day'],
    ['all day across days (the end date is exclusive)', event({all_day: true, starts_at: null, ends_at: null, start_date: '2026-12-21', end_date: '2026-12-26'}), 'Mon, Dec 21 – Fri, Dec 25 · All day'],
    ['an evening in UTC that is the day before here', event({starts_at: '2026-10-01T01:00:00.000Z', ends_at: '2026-10-01T03:00:00.000Z'}), 'Wed, Sep 30 · 6:00 – 8:00 PM'],
  ])('%s', (_, row, line) => {
    expect(rowWhen(row, zone)).toBe(line);
  });

  test.each([
    ['nothing to mark', event({}), 2, []],
    ['repeats', event({recurrence: ['RRULE:FREQ=WEEKLY']}), 2, ['repeats']],
    ['past', event({past: true}), 2, ['past']],
    ['already on the chosen calendar', event({existing: [2, 3]}), 2, ['will update']],
    ['on another calendar only', event({existing: [3]}), 2, []],
    ['all three, in that order', event({recurrence: ['RRULE:FREQ=DAILY;COUNT=2'], past: true, existing: [2]}), 2, ['repeats', 'past', 'will update']],
  ])('marks: %s', (_, row, calendar, marks) => {
    expect(rowMarks(row, calendar)).toEqual(marks);
  });

  test('a row with no title reads as Google shows it', () => {
    expect([rowTitle(event({title: ''})), rowTitle(event({}))]).toEqual(['(No title)', 'Opening keynote']);
  });

  test('past events start unticked', () => {
    expect([...initialTicks([event({ical_uid: 'a', past: true}), event({ical_uid: 'b'}), event({ical_uid: 'c'})])]).toEqual(['b', 'c']);
  });

  test.each([
    [{name: 'devcon.ics', type: ''}, true],
    [{name: 'INVITE.ICS', type: 'application/octet-stream'}, true],
    [{name: 'invite', type: 'text/calendar'}, true],
    [{name: 'schedule.pdf', type: 'application/pdf'}, false],
  ])('an .ics file: %o', (file, ics) => {
    expect(isIcsFile(file)).toBe(ics);
  });
});

describe('the list\'s lines', () => {
  const list = [event({ical_uid: 'a', existing: [2]}), event({ical_uid: 'b', existing: [2, 3]}), event({ical_uid: 'c'})];
  test.each([
    ['two ticked on Jobs', new Set(['a', 'b', 'c']), 2, 'Jobs', '2 already on Jobs (will update)'],
    ['only the ticked count', new Set(['a', 'c']), 2, 'Jobs', '1 already on Jobs (will update)'],
    ['none on Personal', new Set(['a', 'b', 'c']), 1, 'Personal', null],
    ['no calendar yet', new Set(['a']), null, null, null],
  ])('already: %s', (_, ticked, calendar, name, line) => {
    expect(alreadyLine(list, ticked, calendar, name)).toBe(line);
  });

  test('the footer and the toast count events', () => {
    expect([importLabel(35), importLabel(1), importLabel(1200)]).toEqual(['Import 35 events', 'Import 1 event', 'Import 1,200 events']);
    expect([progressLine(0, 35), progressLine(11, 35), progressLine(35, 35)]).toEqual(['Importing 1 of 35', 'Importing 12 of 35', 'Importing 35 of 35']);
    expect([importedLine(35, 'Personal'), importedLine(1, 'Jobs')]).toEqual(['Imported 35 events to Personal', 'Imported 1 event to Jobs']);
    expect([refusedLine(1), refusedLine(2)]).toEqual(['1 event wasn\'t imported', '2 events weren\'t imported']);
  });

  test.each([
    ['nothing left out', {}, null],
    ['the conference schedule', {categories: 35}, 'Left out: categories on 35 events'],
    ['every reason, in the shared order', {
      cancelled: 2, not_an_event: 3, no_start: 1, alarm_after_start: 1, alarm_at_fixed_time: 2, alarm_over_limit: 1, categories: 1, duplicate: 2, occurrence_without_series: 1,
    }, 'Left out: 2 events cancelled · 3 to-dos and notes · 1 event with no start · a reminder after the start · 2 reminders at a set time · a reminder past Google\'s limit · categories on 1 event · 2 second copies of an event · a changed occurrence without its event'],
  ])('dropped: %s', (_, counts, line) => {
    expect(droppedLine({...none, ...counts})).toBe(line);
  });

  test('a file with nothing to import says what it had (D436: one that only cancels)', () => {
    expect([nothingLine({...none, cancelled: 1}), nothingLine(none)]).toEqual(['Nothing to import, the file has 1 event cancelled', 'Nothing to import, the file has no events']);
  });
});

describe('what goes to the server', () => {
  test('from the review: the draft as read, without its review fields', () => {
    const sent = importOf(event({past: true, existing: [2]}));
    expect(sent).not.toHaveProperty('past');
    expect(sent).not.toHaveProperty('existing');
    expect(sent).toMatchObject({ical_uid: 'uid@example.com', url: 'https://devcon.example.com/sessions/101', transparency: 'transparent', colour: null, leave_reminder: false});
  });

  const series = event({recurrence: ['RRULE:FREQ=WEEKLY;BYDAY=TU', 'EXDATE:20261124T180000Z'], changes: [{...event({}), original_start_at: '2026-11-10T18:00:00.000Z', original_start_date: null}], time_zone: 'America/New_York', reminders: [15]});
  const input = (fields: Partial<ItemCreateInput>): ItemCreateInput => ({
    kind: 'event', calendar_id: 2, title: 'Fabrikam sync', all_day: false, starts_at: '2026-11-03T18:00:00.000Z', ends_at: '2026-11-03T18:30:00.000Z', start_date: null, end_date: null,
    due_date: null, due_at: null, time_zone: null, recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=TU', place: 'Room 4', address: null, attendees: [], reminders: [15], leave_reminder: false,
    project: null, colour: null, labels: [], repeat: null, ...fields,
  });
  test.each([
    ['the repeat kept: the file\'s lines and changes stay', input({}), {recurrence: series.recurrence, changes: series.changes}],
    ['the repeat changed: its RRULE replaced, its EXDATE kept', input({recurrence: 'RRULE:FREQ=WEEKLY;BYDAY=WE'}), {recurrence: ['EXDATE:20261124T180000Z', 'RRULE:FREQ=WEEKLY;BYDAY=WE'], changes: series.changes}],
    ['the repeat taken off: no lines, no changes', input({recurrence: null}), {recurrence: [], changes: []}],
  ])('from the editor: %s', (_, edited, expected) => {
    expect(editedImport(series, edited)).toMatchObject({...expected, ical_uid: series.ical_uid, title: 'Fabrikam sync', place: 'Room 4', time_zone: 'America/New_York', description: 'A session.'});
  });

  test('from the editor: its reminders, before the start only and five at most; its colour and Time to Leave', () => {
    expect(editedImport(series, input({reminders: [-10, 5, 10, 15, 30, 60, 120], colour: 'violet', leave_reminder: true}))).toMatchObject({reminders: [5, 10, 15, 30, 60], colour: 'violet', leave_reminder: true});
  });
});

test('a run\'s counts: sent, refused and settled, of the events it takes', () => {
  const rows = new Map<string, RowState>([
    ['a', {state: 'done', created: true, itemId: 1}], ['b', {state: 'failed', message: 'Invalid start time. (400 Bad Request)', commandId: 4}], ['c', {state: 'sending'}],
  ]);
  expect(runCounts(['a', 'b', 'c', 'd'], rows)).toEqual({done: 1, failed: 1, settled: 2, total: 4});
});
