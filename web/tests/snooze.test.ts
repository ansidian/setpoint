// An email's snooze, as tables: the menu's choices on each day of the week with Settings' task time
// or 9:00 AM, Pick's time read as it's typed and the moment it makes, a snoozed email's words; and
// what the Inbox does with it: a snoozed email out of the days, Attention, the shelf and Unread's
// hold, a returned one in the day it returned by the time it did, and Snooze's at-once counts.
import type {InboxGroupOut, InboxOut, MessageRowOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {attentionRows, groupByDay, heldUnread, viewList} from '../src/logic/all.ts';
import {inboxAfterSnooze} from '../src/logic/inbox.ts';
import {nextWeekday, pickOutcome, pickStart, readPickTime, scheduledWhen, snoozeable, snoozedLine, snoozeOptions, snoozeWhen} from '../src/logic/snooze.ts';

const zone = SEED_TIME_ZONE;
// The seed's clock: 9:12 AM Pacific on Wed, Oct 7 (UTC−7).
const now = Date.parse(SEED_NOW);
const at = (iso: string) => Date.parse(iso);

describe('the menu: Tomorrow, Next weekday only when it isn\'t tomorrow, then Pick', () => {
  test.each([
    ['Wednesday morning', '2026-10-07T16:12:00.000Z', null, [['Tomorrow', 'Thu 9:00 AM', '2026-10-08T16:00:00.000Z'], ['Pick a date and time', null, null]]],
    ['Thursday night', '2026-10-09T05:30:00.000Z', null, [['Tomorrow', 'Fri 9:00 AM', '2026-10-09T16:00:00.000Z'], ['Pick a date and time', null, null]]],
    ['Friday evening, Monday too', '2026-10-10T02:00:00.000Z', null,
      [['Tomorrow', 'Sat 9:00 AM', '2026-10-10T16:00:00.000Z'], ['Next weekday', 'Mon 9:00 AM', '2026-10-12T16:00:00.000Z'], ['Pick a date and time', null, null]]],
    ['Saturday', '2026-10-10T18:00:00.000Z', null,
      [['Tomorrow', 'Sun 9:00 AM', '2026-10-11T16:00:00.000Z'], ['Next weekday', 'Mon 9:00 AM', '2026-10-12T16:00:00.000Z'], ['Pick a date and time', null, null]]],
    ['Sunday: tomorrow is the weekday', '2026-10-11T18:00:00.000Z', null, [['Tomorrow', 'Mon 9:00 AM', '2026-10-12T16:00:00.000Z'], ['Pick a date and time', null, null]]],
    ['Settings\' task time', '2026-10-10T18:00:00.000Z', '07:30',
      [['Tomorrow', 'Sun 7:30 AM', '2026-10-11T14:30:00.000Z'], ['Next weekday', 'Mon 7:30 AM', '2026-10-12T14:30:00.000Z'], ['Pick a date and time', null, null]]],
    // The clocks go back on Nov 1: Monday's 9:00 AM is UTC−8.
    ['across the change of clocks', '2026-10-31T18:00:00.000Z', null,
      [['Tomorrow', 'Sun 9:00 AM', '2026-11-01T17:00:00.000Z'], ['Next weekday', 'Mon 9:00 AM', '2026-11-02T17:00:00.000Z'], ['Pick a date and time', null, null]]],
  ] as const)('%s', (_name, when, taskTime, expected) => {
    const options = snoozeOptions(at(when), taskTime, zone);
    expect(options.map(option => [option.label, option.when, option.until === null ? null : new Date(option.until).toISOString()])).toEqual(expected);
  });

  test.each([
    ['2026-10-07', '2026-10-08'], ['2026-10-09', '2026-10-12'], ['2026-10-10', '2026-10-12'], ['2026-10-11', '2026-10-12'],
  ])('the weekday after %s is %s', (today, expected) => expect(nextWeekday(today)).toBe(expected));
});

describe('Pick reads its time as it\'s typed', () => {
  test.each([
    ['2pm', {minutes: 840, label: '2:00 PM'}], ['2 pm', {minutes: 840, label: '2:00 PM'}], ['2:30p', {minutes: 870, label: '2:30 PM'}],
    ['230p', {minutes: 870, label: '2:30 PM'}], ['9a', {minutes: 540, label: '9:00 AM'}], ['9:00 AM', {minutes: 540, label: '9:00 AM'}],
    ['14:00', {minutes: 840, label: '2:00 PM'}], ['noon', {minutes: 720, label: '12:00 PM'}],
    // An hour that could be either half isn't guessed.
    ['2', {problem: 'Add AM or PM'}], ['230', {problem: 'Add AM or PM'}], ['2:30', {problem: 'Add AM or PM'}], ['12', {problem: 'Add AM or PM'}],
    ['abc', {problem: 'Not a time'}], ['', {problem: 'Type a time'}], ['  ', {problem: 'Type a time'}],
  ])('"%s"', (text, expected) => expect(readPickTime(text)).toEqual(expected));

  test.each([
    ['a day ahead', '2026-10-12', '2pm', {until: at('2026-10-12T21:00:00.000Z'), line: 'Mon, Oct 12, 2:00 PM'}],
    ['later today', '2026-10-07', '5pm', {until: at('2026-10-08T00:00:00.000Z'), line: 'Wed, Oct 7, 5:00 PM'}],
    ['earlier today', '2026-10-07', '8am', {problem: 'That time has passed'}],
    ['a time it can\'t read', '2026-10-12', '2', {problem: 'Add AM or PM'}],
  ])('%s', (_name, date, text, expected) => expect(pickOutcome(date, text, now, zone)).toEqual(expected));

  test('it starts tomorrow, at the task time', () => {
    expect(pickStart(now, null, zone)).toEqual({date: '2026-10-08', text: '9:00 AM'});
    expect(pickStart(now, '08:30', zone)).toEqual({date: '2026-10-08', text: '8:30 AM'});
  });
});

describe('a snoozed email\'s words', () => {
  test.each([
    ['today', '2026-10-07T23:00:00.000Z', '4:00 PM'], ['tomorrow', '2026-10-08T16:00:00.000Z', 'Tomorrow 9:00 AM'],
    ['this week', '2026-10-12T16:00:00.000Z', 'Mon 9:00 AM'], ['further', '2026-10-20T16:00:00.000Z', 'Oct 20, 9:00 AM'],
    ['next year', '2027-01-04T17:00:00.000Z', 'Jan 4, 2027, 9:00 AM'],
  ])('%s', (_name, until, expected) => expect(snoozeWhen(until, now, zone)).toBe(expected));

  test('the toast and the tip', () => expect(snoozedLine('2026-10-12T16:00:00.000Z', now, zone)).toBe('Snoozed until Mon 9:00 AM'));
});

describe('a scheduled send\'s moment inside a sentence: tomorrow lower-cased, the rest as a snooze\'s', () => {
  test.each([
    ['today', '2026-10-07T23:00:00.000Z', '4:00 PM'], ['tomorrow', '2026-10-08T16:00:00.000Z', 'tomorrow 9:00 AM'],
    ['this week', '2026-10-12T16:00:00.000Z', 'Mon 9:00 AM'], ['further', '2026-10-20T16:00:00.000Z', 'Oct 20, 9:00 AM'],
  ])('%s', (_name, at, expected) => expect(scheduledWhen(at, now, zone)).toBe(expected));
});

let nextId = 500;
function row(fields: Partial<MessageRowOut>): MessageRowOut {
  return {
    id: nextId++, account_id: 1, from_name: 'Sender', from_address: 'sender@example.com', organisation: null, via: null, subject: 'Subject',
    summary: null, received_at: SEED_NOW, unread: true, lane: 'fyi', kind: 'other', type: null, protected: false,
    pinned: false, done: false, fact: null, code: null, trash_due_at: null, attachment_count: 0, command: null, ...fields,
  };
}
const group = (name: InboxGroupOut['group'], rows: MessageRowOut[]): InboxGroupOut => ({group: name, count: rows.length, unread: rows.filter(one => one.unread).length, rows});
const SNOOZED = {snoozed_until: '2026-10-12T16:00:00.000Z'};

test.each([
  ['received mail', {}, true], ['sent-only mail', {sent_only: true as const}, false], ['mail snoozed already', SNOOZED, false],
] as [string, Partial<MessageRowOut>, boolean][])('Snooze is offered on %s', (_name, fields, expected) => expect(snoozeable(row(fields))).toBe(expected));

describe('the Inbox with snoozed and returned mail', () => {
  test('a snoozed email is in no day; a returned one is in the day it returned, by the time it did, newest first', () => {
    const today = row({received_at: '2026-10-07T15:00:00.000Z'});
    const snoozed = row({received_at: '2026-10-07T14:00:00.000Z', ...SNOOZED});
    // Came Saturday, back this morning at 9:05.
    const returned = row({received_at: '2026-10-03T18:00:00.000Z', returned_at: '2026-10-07T16:05:00.000Z'});
    const older = row({received_at: '2026-10-03T17:00:00.000Z'});
    expect(groupByDay([today, snoozed, returned, older], zone).map(day => [day.date, day.rows.map(one => one.id)]))
      .toEqual([['2026-10-07', [returned.id, today.id]], ['2026-10-03', [older.id]]]);
  });

  test('All brings a returned email from the Inbox\'s groups when its pages haven\'t got to its first day', () => {
    const returned = row({received_at: '2026-09-01T18:00:00.000Z', returned_at: '2026-10-07T16:05:00.000Z'});
    const list = viewList('all', {groups: [group('other', [returned])], rows: [row({})], unread: []}, zone, new Set());
    expect(list.days[0]!.lanes.flatMap(lane => lane.rows.map(one => one.row.id))).toContain(returned.id);
  });

  test('a snoozed email leaves Attention, the shelf and Unread\'s hold', () => {
    const attention = row({lane: 'attention', ...SNOOZED});
    const pinned = row({pinned: true, ...SNOOZED});
    expect(attentionRows([group('attention', [attention])])).toEqual([]);
    expect(viewList('all', {groups: [group('pinned', [pinned])], rows: [], unread: []}, zone, new Set()).shelf).toEqual([]);
    const held = row({});
    const later = {...held, ...SNOOZED};
    expect([...heldUnread(new Map([[held.id, held]]), [], new Map([[held.id, later]]), new Set()).keys()]).toEqual([]);
  });

  test.each([
    ['an unread FYI email', {lane: 'fyi', unread: true}, 'other', {attention: 3, unread: 7, unread_fyi: 4}],
    ['a read FYI email', {lane: 'fyi', unread: false}, 'other', {attention: 3, unread: 8, unread_fyi: 5}],
    ['an unread Attention email', {lane: 'attention', unread: true}, 'attention', {attention: 2, unread: 7, unread_fyi: 5}],
  ] as const)('Snooze takes %s out of its group and the counts at once', (_name, fields, name, expected) => {
    const email = row(fields);
    const inbox = {groups: [group(name, [email]), group('pinned', [{...email, pinned: true}])], counts: {attention: 3, unread: 8, unread_fyi: 5, accounts: [{account_id: 1, unread: 8}]}} as unknown as InboxOut;
    const after = inboxAfterSnooze(inbox, email.id);
    expect(after.groups).toEqual([]);
    expect({attention: after.counts.attention, unread: after.counts.unread, unread_fyi: after.counts.unread_fyi}).toEqual(expected);
  });
});
