// The one list's rules (DESIGN.md › All, Copy) as tables: days at midnight Pacific, their headings,
// clock times, each day's lanes with the kind where an FYI run starts and its Noise folded (#48),
// pinned email on the shelf rather than its day (D105), New and Attention above the days (SV-70), and
// each row's text (codes, security facts, protected mail).
import type {MessageRowOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import type {InboxGroupOut} from '@setpoint/shared';
import {allRowLine, clearNew, dayHeading, dayStops, dayView, groupByDay, kindGroup, kindLabel, NEW, placeRows, splitInbox} from '../src/logic/all.ts';
import type {Place} from '../src/logic/all.ts';
import {clockTime} from '../src/logic/format.ts';

let nextId = 100;
function row(fields: Partial<MessageRowOut>): MessageRowOut {
  return {
    id: nextId++, account_id: 1, from_name: 'Sender', from_address: 'sender@example.com', organisation: null, via: null, subject: 'Subject',
    summary: null, received_at: SEED_NOW, unread: true, lane: 'fyi', kind: 'other', type: null, protected: false,
    pinned: false, done: false, fact: null, code: null, attachment_count: 0, command: null, ...fields,
  };
}

const zone = SEED_TIME_ZONE;

describe('groupByDay', () => {
  test.each([
    // Pacific is UTC−7 in October: 07:00Z is midnight.
    ['a minute after midnight Pacific is that day', '2026-10-07T07:01:00.000Z', '2026-10-07'],
    ['midnight itself starts the day', '2026-10-07T07:00:00.000Z', '2026-10-07'],
    ['a minute before midnight is the day before', '2026-10-07T06:59:00.000Z', '2026-10-06'],
    ['late evening in UTC terms is still the Pacific day', '2026-10-08T05:30:00.000Z', '2026-10-07'],
    // In winter Pacific is UTC−8: 08:00Z is midnight.
    ['standard time moves midnight to 08:00Z', '2026-12-09T07:59:00.000Z', '2026-12-08'],
    ['… and 08:00Z is the next day', '2026-12-09T08:00:00.000Z', '2026-12-09'],
  ])('%s', (_name, at, date) => {
    expect(groupByDay([row({received_at: at})], zone).map(day => day.date)).toEqual([date]);
  });

  test('newest day first, newest first within a day, whatever order the pages came in', () => {
    const a = row({id: 1, received_at: '2026-10-07T16:08:00.000Z'});
    const b = row({id: 2, received_at: '2026-10-07T15:52:00.000Z'});
    const c = row({id: 3, received_at: '2026-10-06T21:15:00.000Z'});
    const d = row({id: 4, received_at: '2026-09-30T21:15:00.000Z'});
    expect(groupByDay([c, a, d, b], zone).map(day => [day.date, day.rows.map(item => item.id)])).toEqual([
      ['2026-10-07', [1, 2]], ['2026-10-06', [3]], ['2026-09-30', [4]],
    ]);
  });

  test('a day split between two pages shows once, and a row in both pages once', () => {
    const late = row({id: 10, received_at: '2026-10-06T20:00:00.000Z'});
    const early = row({id: 11, received_at: '2026-10-06T16:00:00.000Z'});
    expect(groupByDay([late, early, early], zone).map(day => [day.date, day.rows.length])).toEqual([['2026-10-06', 2]]);
  });

  test('equal times keep the newer id first', () => {
    const one = row({id: 20, received_at: SEED_NOW});
    const two = row({id: 21, received_at: SEED_NOW});
    expect(groupByDay([one, two], zone)[0]!.rows.map(item => item.id)).toEqual([21, 20]);
  });

  test('a pinned email leaves its day for the shelf, and a day left empty goes (D105)', () => {
    const lease = row({id: 30, received_at: '2026-10-06T20:00:00.000Z', pinned: true});
    const ups = row({id: 31, received_at: '2026-10-07T16:00:00.000Z'});
    expect(groupByDay([lease, ups], zone).map(day => [day.date, day.rows.map(item => item.id)])).toEqual([['2026-10-07', [31]]]);
  });
});

describe('dayHeading', () => {
  test.each([
    ['today', '2026-10-07', {label: 'Today', date: 'Wed, Oct 7'}],
    ['yesterday', '2026-10-06', {label: 'Yesterday', date: 'Tue, Oct 6'}],
    ['Monday', '2026-10-05', {label: 'Mon', date: 'Oct 5'}],
    ['Sunday', '2026-10-04', {label: 'Sun', date: 'Oct 4'}],
    ['a week back', '2026-09-30', {label: 'Wed', date: 'Sep 30'}],
    ['March', '2026-03-14', {label: 'Sat', date: 'Mar 14'}],
    ['last year', '2025-12-30', {label: 'Tue', date: 'Dec 30, 2025'}],
  ])('%s', (_name, date, heading) => {
    expect(dayHeading(date, '2026-10-07')).toEqual(heading);
  });
});

describe('clock times under the headings', () => {
  test.each([
    ['Contoso\'s code', '2026-10-07T16:08:00.000Z', '9:08 AM'],
    ['Woodgrove Pay, last evening', '2026-10-07T03:15:00.000Z', '8:15 PM'],
    ['Sam, at noon-ish', '2026-10-05T19:40:00.000Z', '12:40 PM'],
    ['just after midnight', '2026-10-07T07:05:00.000Z', '12:05 AM'],
  ])('%s → %s', (_name, at, time) => {
    expect(clockTime(at, zone)).toBe(time);
  });
});

describe('dayView', () => {
  // A day newest first, as groupByDay leaves it.
  const coffee = row({organisation: 'Contoso Coffee', lane: 'noise', kind: null});
  const interview = row({organisation: 'Northwind', lane: 'attention', kind: 'career'});
  const hub = row({organisation: 'Wingtip Toys', kind: 'deliveries'});
  const statement = row({organisation: 'Fabrikam', kind: 'money'});
  const digest = row({organisation: 'Tailspin', lane: 'noise', kind: null});
  const signIn = row({organisation: 'Google', kind: 'security'});
  const ups = row({organisation: 'Consolidated Messenger', kind: 'deliveries'});
  const unsorted = row({organisation: 'Litware', lane: null, kind: null});
  const other = row({organisation: 'Adatum', kind: null});
  const morePromo = row({organisation: 'Contoso Coffee', lane: 'noise', kind: null});
  const news = row({organisation: 'Litware', lane: 'noise', kind: null});
  const ads = row({organisation: 'Woodgrove', lane: 'noise', kind: null});
  const day = {date: '2026-10-07', rows: [coffee, interview, hub, statement, digest, signIn, ups, unsorted, other, morePromo, news, ads]};

  test('lanes in Unread\'s order, FYI by kind then newest, the kind once where its run starts', () => {
    expect(dayView(day, false).lanes.map(lane => [lane.label, lane.rows.map(({row: one, kind}) => [one.id, kind])])).toEqual([
      ['Attention', [[interview.id, null]]],
      ['Unsorted', [[unsorted.id, null]]],
      ['FYI', [[signIn.id, 'security'], [hub.id, 'deliveries'], [ups.id, null], [statement.id, 'money'], [other.id, 'other']]],
    ]);
  });

  test.each([
    ['folded: its count and first three organisations, no rows', false, {count: 5, preview: 'Contoso Coffee · Tailspin · Litware', open: false, rows: []}],
    ['open: its rows newest first', true, {count: 5, preview: 'Contoso Coffee · Tailspin · Litware', open: true, rows: [coffee, digest, morePromo, news, ads]}],
  ])('Noise %s', (_name, open, noise) => {
    expect(dayView(day, open).noise).toEqual(noise);
  });

  test('a day without Noise or a lane leaves them out', () => {
    expect(dayView({date: '2026-10-07', rows: [hub]}, false)).toEqual({date: '2026-10-07', lanes: [{lane: 'fyi', label: 'FYI', rows: [{row: hub, kind: 'deliveries'}]}], noise: null});
  });

  test('J and K stop on each row as shown, and on a folded Noise line instead of its rows', () => {
    const today = {date: '2026-10-07', rows: [digest, hub, interview]};
    const yesterday = {date: '2026-10-06', rows: [statement, news]};
    expect(dayStops([dayView(today, false), dayView(yesterday, true)]).map(stop => stop.key)).toEqual([
      `all:${interview.id}`, `all:${hub.id}`, 'noise:2026-10-07', `all:${statement.id}`, `all:${news.id}`,
    ]);
  });

  test('J and K stop on the Pinned shelf\'s rows first, newest pin first, then the days', () => {
    const lease = row({organisation: 'Parkside', pinned: true});
    const receipt = row({organisation: 'Woodgrove', pinned: true});
    expect(dayStops([dayView({date: '2026-10-07', rows: [hub]}, false)], [receipt, lease]).map(stop => [stop.key, stop.kind === 'row' && stop.group])).toEqual([
      [`pinned:${receipt.id}`, 'pinned'], [`pinned:${lease.id}`, 'pinned'], [`all:${hub.id}`, 'all'],
    ]);
  });
});

describe('kindGroup and kindLabel', () => {
  test.each([
    ['an FYI kind', {lane: 'fyi', kind: 'deliveries'}, 'deliveries', 'Deliveries'],
    ['Attention keeps its kind', {lane: 'attention', kind: 'career'}, 'career', 'Career'],
    ['security', {lane: 'fyi', kind: 'security'}, 'security', 'Security'],
    ['no kind is Other', {lane: 'fyi', kind: null}, 'other', 'Other'],
    ['Noise', {lane: 'noise', kind: null}, 'noise', 'Noise'],
    ['Unsorted', {lane: null, kind: null}, 'unsorted', 'Unsorted'],
  ] as const)('%s', (_name, fields, group, label) => {
    expect([kindGroup(fields), kindLabel(fields)]).toEqual([group, label]);
  });
});

describe('allRowLine', () => {
  test.each([
    ['a code in its subject, in two groups',
      row({organisation: 'Contoso Insurance', subject: 'Your code is 482913', code: {value: '482913', expires_at: SEED_NOW}}),
      {from: 'Contoso Insurance', subject: 'Your code is 482913', code: {before: 'Your code is ', value: '482 913', after: ''}, summary: null, alert: false, title: null}],
    ['a code the subject doesn\'t hold goes after it',
      row({subject: 'Sign-in code', code: {value: '12345678', expires_at: SEED_NOW}}),
      {from: 'Sender', subject: 'Sign-in code', code: {before: 'Sign-in code ', value: '1234 5678', after: ''}, summary: null, alert: false, title: null}],
    ['a security row\'s fact as its subject',
      row({organisation: 'Google', subject: 'Security alert', fact: 'New sign-in · MacBook Pro · Los Angeles'}),
      {from: 'Google', subject: 'New sign-in', code: null, summary: 'MacBook Pro · Los Angeles', alert: false, title: null}],
    ['a protected email keeps its subject, in alert, with the fact\'s details',
      row({organisation: 'Google', subject: 'Your recovery email was changed', protected: true, lane: 'attention', fact: 'Recovery email changed · Windows · Chrome · Phoenix, AZ'}),
      {from: 'Google', subject: 'Your recovery email was changed', code: null, summary: 'Windows · Chrome · Phoenix, AZ', alert: true, title: null}],
    ['the summary in the subject\'s place, then the platform; the subject is the tooltip (as the Inbox, #35)',
      row({organisation: 'Fabrikam', from_name: 'Fabrikam Recruiting', subject: 'Application received', summary: 'Data Analyst', via: 'Workday'}),
      {from: 'Fabrikam', subject: 'Data Analyst', code: null, summary: 'via Workday', alert: false, title: 'Application received'}],
    ['a protected email with a summary keeps its subject',
      row({organisation: 'Google', subject: 'Critical security alert', protected: true, lane: 'attention', summary: 'Someone has your password'}),
      {from: 'Google', subject: 'Critical security alert', code: null, summary: 'Someone has your password', alert: true, title: null}],
    ['no summary', row({organisation: 'Woodgrove Pay', subject: 'You sent $42.00 to Sam Lee'}),
      {from: 'Woodgrove Pay', subject: 'You sent $42.00 to Sam Lee', code: null, summary: null, alert: false, title: null}],
    ['a person, by name', row({from_name: 'Sam Lee', subject: 'Dinner Friday?', summary: 'Blue Door at 7?'}),
      {from: 'Sam Lee', subject: 'Blue Door at 7?', code: null, summary: null, alert: false, title: 'Dinner Friday?'}],
  ])('%s', (_name, input, line) => {
    expect(allRowLine(input)).toEqual(line);
  });
});

describe('SV-70: New, Attention and the days, one list', () => {
  const interview = row({organisation: 'Northwind', lane: 'attention', kind: null, received_at: '2026-10-07T16:00:00.000Z'});
  const recovery = row({organisation: 'Google', lane: 'attention', kind: null, unread: false, received_at: '2026-10-06T16:00:00.000Z'});
  const handled = row({organisation: 'Fabrikam', lane: 'attention', kind: null, unread: false, done: true, received_at: '2026-10-05T16:00:00.000Z'});
  const code = row({organisation: 'Contoso', kind: 'security', received_at: '2026-10-07T17:00:00.000Z'});
  const parcel = row({organisation: 'Consolidated', kind: 'deliveries', received_at: '2026-10-07T15:00:00.000Z'});
  const coffee = row({organisation: 'Contoso Coffee', lane: 'noise', kind: null, received_at: '2026-10-07T14:00:00.000Z'});
  const statement = row({organisation: 'Proseware', kind: 'money', unread: false, received_at: '2026-10-06T15:00:00.000Z'});
  const lease = row({organisation: 'Parkside', kind: 'other', pinned: true, received_at: '2026-09-30T15:00:00.000Z'});
  const group = (name: InboxGroupOut['group'], rows: MessageRowOut[]): InboxGroupOut => ({group: name, count: rows.length, unread: rows.filter(one => one.unread).length, rows});
  const groups = [group('pinned', [lease]), group('attention', [interview, recovery]), group('security', [code]), group('deliveries', [parcel]), group('noise', [coffee]), group('other', [lease])];
  const places = (placed: ReadonlyMap<number, Place>) => [...placed].map(([id, place]) => `${id}:${place}`).sort();

  test('the first sight places each: unread in New, Attention waiting on Done, the rest in its day', () => {
    const placed = placeRows(new Map(), [interview, recovery, handled, code, statement]);
    expect(places(placed)).toEqual([`${interview.id}:new`, `${recovery.id}:attention`, `${handled.id}:day`, `${code.id}:new`, `${statement.id}:day`].sort());
  });

  test('a place is kept for the visit: read in New stays in New; marked unread in its day stays there', () => {
    const placed = placeRows(new Map(), [parcel, statement]);
    expect(placeRows(placed, [{...parcel, unread: false}, {...statement, unread: true}])).toBe(placed);
    expect(places(placeRows(placed, [code]))).toEqual([`${parcel.id}:new`, `${statement.id}:day`, `${code.id}:new`].sort());
  });

  test('Mark all as read empties New: Attention it leaves unread goes to Attention, the rest to their days', () => {
    const placed = placeRows(new Map(), [interview, code, parcel, recovery]);
    expect(places(clearNew(placed, [interview, code, parcel, recovery]))).toEqual([`${interview.id}:attention`, `${code.id}:day`, `${parcel.id}:day`, `${recovery.id}:attention`].sort());
  });

  test('splitInbox: New newest first, Attention newest first, a pinned email on the shelf only', () => {
    const placed = placeRows(new Map(), groups.flatMap(one => one.rows));
    const {fresh, attention} = splitInbox(groups, placed);
    expect(fresh.map(one => one.organisation)).toEqual(['Contoso', 'Northwind', 'Consolidated', 'Contoso Coffee']);
    expect(attention.map(one => one.organisation)).toEqual(['Google']);
  });

  test('splitInbox: an Attention email read during the visit stays in New; one Done leaves Attention', () => {
    const placed = placeRows(new Map(), [interview, recovery]);
    const later = [group('attention', [{...interview, unread: false}, {...recovery, done: true}])];
    expect(splitInbox(later, placed)).toEqual({fresh: [{...interview, unread: false}], attention: []});
  });

  test('New draws as a day does under its band: lanes, kinds, Noise folded; J and K go New, Attention, shelf, days', () => {
    const placed = placeRows(new Map(), groups.flatMap(one => one.rows));
    const {fresh, attention} = splitInbox(groups, placed);
    const freshView = dayView({date: NEW, rows: fresh}, false);
    expect(freshView.lanes.map(lane => [lane.label, lane.rows.map(({row: one, kind}) => `${one.organisation}${kind ? ` (${kind})` : ''}`)])).toEqual([
      ['Attention', ['Northwind']], ['FYI', ['Contoso (security)', 'Consolidated (deliveries)']],
    ]);
    const days = groupByDay([interview, recovery, code, parcel, statement, lease], zone, new Set([...fresh, ...attention].map(one => one.id)));
    expect(days.map(day => [day.date, day.rows.map(one => one.organisation)])).toEqual([['2026-10-06', ['Proseware']]]);
    expect(dayStops(days.map(day => dayView(day, false)), [lease], {fresh: freshView, attention}).map(stop => stop.key)).toEqual([
      `new:${interview.id}`, `new:${code.id}`, `new:${parcel.id}`, 'noise:new', `attention:${recovery.id}`, `pinned:${lease.id}`, `all:${statement.id}`,
    ]);
  });
});
