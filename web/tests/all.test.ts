// The one list's rules (DESIGN.md › All, Copy) as tables: days at midnight Pacific, their headings,
// clock times, each day's lanes with the kind where an FYI run starts and its Noise folded (#48),
// pinned email on the shelf rather than its day (D105), Attention above the days and unread mail in
// its day (SV-199, D449), each row's text (codes, security facts, protected mail), and the views'
// parts with Unread's hold (SV-221).
import type {MessageRowOut} from '@setpoint/shared';
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import type {InboxGroupOut} from '@setpoint/shared';
import {allRowLine, attentionRows, dayHeading, dayStops, dayView, groupByDay, heldUnread, kindGroup, kindLabel, nextUnread, sameHold, viewList} from '../src/logic/all.ts';
import type {Stop} from '../src/logic/inbox.ts';

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
    ['last year', '2025-12-30', {label: 'Tue', date: 'Dec 30, 2025'}],
  ])('%s', (_name, date, heading) => {
    expect(dayHeading(date, '2026-10-07')).toEqual(heading);
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

describe('SV-199: Attention, the shelf, then the days, unread mail in its day', () => {
  const interview = row({organisation: 'Northwind', lane: 'attention', kind: null, received_at: '2026-10-07T16:00:00.000Z'});
  const recovery = row({organisation: 'Google', lane: 'attention', kind: null, unread: false, received_at: '2026-10-06T16:00:00.000Z'});
  const handled = row({organisation: 'Fabrikam', lane: 'attention', kind: null, unread: false, done: true, received_at: '2026-10-05T16:00:00.000Z'});
  const code = row({organisation: 'Contoso', kind: 'security', received_at: '2026-10-07T17:00:00.000Z'});
  const parcel = row({organisation: 'Consolidated', kind: 'deliveries', received_at: '2026-10-07T15:00:00.000Z'});
  const coffee = row({organisation: 'Contoso Coffee', lane: 'noise', kind: null, received_at: '2026-10-07T14:00:00.000Z'});
  const statement = row({organisation: 'Proseware', kind: 'money', unread: false, received_at: '2026-10-06T15:00:00.000Z'});
  const lease = row({organisation: 'Parkside', kind: 'other', pinned: true, received_at: '2026-09-30T15:00:00.000Z'});
  const pinnedAttention = row({organisation: 'Woodgrove', lane: 'attention', kind: null, pinned: true, received_at: '2026-10-07T12:00:00.000Z'});
  const group = (name: InboxGroupOut['group'], rows: MessageRowOut[]): InboxGroupOut => ({group: name, count: rows.length, unread: rows.filter(one => one.unread).length, rows});
  const groups = [group('pinned', [lease, pinnedAttention]), group('attention', [recovery, interview, pinnedAttention]), group('security', [code]), group('deliveries', [parcel]), group('noise', [coffee])];

  test('Attention is every Attention email not Done, unread or read, newest first; a pinned one is on the shelf only', () => {
    expect(attentionRows(groups).map(one => one.organisation)).toEqual(['Northwind', 'Google']);
    expect(attentionRows([group('attention', [interview, {...recovery, done: true}]), group('other', [handled])]).map(one => one.organisation)).toEqual(['Northwind']);
  });

  test('reading an Attention email keeps it there', () => {
    expect(attentionRows([group('attention', [{...interview, unread: false}])]).map(one => [one.organisation, one.unread])).toEqual([['Northwind', false]]);
  });

  test('unread mail stays in its day with the read, Attention and the shelf leave theirs; J and K go Attention, shelf, days', () => {
    const attention = attentionRows(groups);
    const days = groupByDay([interview, recovery, code, parcel, coffee, statement, lease], zone, new Set(attention.map(one => one.id)));
    expect(days.map(day => [day.date, day.rows.map(one => one.organisation)])).toEqual([['2026-10-07', ['Contoso', 'Consolidated', 'Contoso Coffee']], ['2026-10-06', ['Proseware']]]);
    const views = days.map(day => dayView(day, false));
    expect(dayStops(views, [lease], attention).map(stop => stop.key)).toEqual([
      `attention:${interview.id}`, `attention:${recovery.id}`, `pinned:${lease.id}`, `all:${code.id}`, `all:${parcel.id}`, 'noise:2026-10-07', `all:${statement.id}`,
    ]);
  });
});

describe('U: the next unread email', () => {
  const at = (key: string, id: number): Stop => ({key, kind: 'row', group: 'all', id});
  const stops: Stop[] = [at('attention:1', 1), at('pinned:2', 2), at('all:3', 3), {key: 'noise:2026-10-07', kind: 'noise', date: '2026-10-07'}, at('all:4', 4), at('all:5', 5)];
  test.each([
    ['no cursor: the first unread from the top', null, [1, 4], 'attention:1'],
    ['from a row: the next unread below it', 'attention:1', [1, 4], 'all:4'],
    ['past the last: from the top again', 'all:4', [1, 4], 'attention:1'],
    ['the only unread, under the cursor: itself', 'all:4', [4], 'all:4'],
    ['a cursor on a folded Noise line: the next below it', 'noise:2026-10-07', [3, 5], 'all:5'],
    ['a cursor no longer in the list: from the top', 'all:404', [5], 'all:5'],
    ['nothing unread: nowhere', 'all:3', [], null],
  ] as const)('%s', (_, cursor, unread, key) => {
    expect(nextUnread(stops, cursor, new Set(unread))).toBe(key);
  });
});

describe('SV-221: the views', () => {
  const interview = row({organisation: 'Northwind', lane: 'attention', kind: null, received_at: '2026-10-07T16:00:00.000Z'});
  const recovery = row({organisation: 'Google', lane: 'attention', kind: null, unread: false, received_at: '2026-10-06T16:00:00.000Z'});
  const parcel = row({organisation: 'Consolidated', kind: 'deliveries', received_at: '2026-10-07T15:00:00.000Z'});
  const statement = row({organisation: 'Proseware', kind: 'money', unread: false, received_at: '2026-10-06T15:00:00.000Z'});
  const coffee = row({organisation: 'Contoso Coffee', lane: 'noise', kind: null, received_at: '2026-10-07T14:00:00.000Z'});
  const toys = row({organisation: 'Tailspin Toys', lane: 'noise', kind: null, unread: false, received_at: '2026-10-06T14:00:00.000Z'});
  const lease = row({organisation: 'Parkside', kind: 'other', pinned: true, unread: false, received_at: '2026-10-07T12:00:00.000Z'});
  const pinnedAttention = row({organisation: 'Woodgrove', lane: 'attention', kind: null, pinned: true, received_at: '2026-10-07T13:00:00.000Z'});
  // An unread FYI email from weeks back that All's pages haven't reached.
  const old = row({organisation: 'Litware', kind: 'updates', received_at: '2026-09-01T15:00:00.000Z'});
  const group = (name: InboxGroupOut['group'], rows: MessageRowOut[]): InboxGroupOut => ({group: name, count: rows.length, unread: rows.filter(one => one.unread).length, rows});
  const groups = [group('pinned', [pinnedAttention, lease]), group('attention', [interview, pinnedAttention, recovery]), group('deliveries', [parcel]), group('updates', [old]), group('noise', [coffee])];
  const rows = [interview, recovery, parcel, statement, coffee, toys, lease, pinnedAttention];
  const unread = [interview, pinnedAttention, parcel, coffee, old];
  const names = (list: MessageRowOut[]) => list.map(one => one.organisation);
  const dayNames = (list: ReturnType<typeof viewList>) => list.days.map(day => [day.date, day.lanes.map(lane => [lane.label, names(lane.rows.map(({row: one}) => one))]), day.noise?.count ?? null]);

  test.each([
    ['All: Attention, the shelf, then the days with their Noise folded', 'all', ['Northwind', 'Google'], ['Woodgrove', 'Parkside'], [
      ['2026-10-07', [['FYI', ['Consolidated']]], 1], ['2026-10-06', [['FYI', ['Proseware']]], 1]], true],
    ['Unread: its Attention, then its days, a pinned one in its place and Noise in full (D472)', 'unread', ['Northwind', 'Woodgrove'], [], [
      ['2026-10-07', [['FYI', ['Consolidated']], ['Noise', ['Contoso Coffee']]], null], ['2026-09-01', [['FYI', ['Litware']]], null]], true],
    ['Attention: every Attention email not Done, a pinned one too, newest first', 'attention', ['Northwind', 'Woodgrove', 'Google'], [], [], false],
    ['FYI: its mail by day, read or not, the Inbox\'s older unread included', 'fyi', [], [], [
      ['2026-10-07', [['FYI', ['Consolidated', 'Parkside']]], null], ['2026-10-06', [['FYI', ['Proseware']]], null], ['2026-09-01', [['FYI', ['Litware']]], null]], false],
    ['Noise: its mail by day, in full', 'noise', [], [], [
      ['2026-10-07', [['Noise', ['Contoso Coffee']]], null], ['2026-10-06', [['Noise', ['Tailspin Toys']]], null]], false],
  ] as const)('%s', (_name, view, attention, shelf, days, lanes) => {
    const list = viewList(view, {groups, rows, unread}, zone, new Set());
    expect([names(list.attention), names(list.shelf), dayNames(list), list.lanes]).toEqual([attention, shelf, days, lanes]);
  });

  test('FYI\'s kinds show as subheadings where a run starts', () => {
    const list = viewList('fyi', {groups, rows, unread}, zone, new Set());
    expect(list.days[0]!.lanes[0]!.rows.map(({kind}) => kind)).toEqual(['deliveries', 'other']);
  });

  describe('Unread holds what it showed until the user leaves it', () => {
    const latest = (...list: MessageRowOut[]) => new Map(list.map(one => [one.id, one]));
    const none: ReadonlySet<number> = new Set();
    const first = heldUnread(new Map(), [interview, recovery, parcel, coffee], latest(interview, recovery, parcel, coffee), none);

    test('it takes every unread email not Done from the Inbox', () => {
      expect(names([...first.values()])).toEqual(['Northwind', 'Consolidated', 'Contoso Coffee']);
    });

    test.each([
      ['an email read here stays, read, as the lists now have it', [interview, recovery, coffee], [interview, recovery, {...parcel, unread: false}, coffee], none,
        [['Northwind', true], ['Consolidated', false], ['Contoso Coffee', true]]],
      ['one no list has any more stays, read', [interview, recovery, coffee], [interview, recovery, coffee], none,
        [['Northwind', true], ['Consolidated', false], ['Contoso Coffee', true]]],
      ['an Attention email no list has went Done, and leaves', [recovery, parcel, coffee], [recovery, parcel, coffee], none,
        [['Consolidated', true], ['Contoso Coffee', true]]],
      ['one Done leaves', [recovery, parcel, coffee], [{...interview, done: true}, recovery, parcel, coffee], none,
        [['Consolidated', true], ['Contoso Coffee', true]]],
      ['one in Trash leaves', [interview, recovery, parcel], [interview, recovery, parcel], new Set([coffee.id]),
        [['Northwind', true], ['Consolidated', true]]],
      ['new unread mail joins', [interview, recovery, parcel, coffee, old], [interview, recovery, parcel, coffee, old], none,
        [['Northwind', true], ['Consolidated', true], ['Contoso Coffee', true], ['Litware', true]]],
    ] as const)('%s', (_name, inbox, now, gone, expected) => {
      const next = heldUnread(first, [...inbox], latest(...now), gone);
      // The hold's order is no one's: the view sorts its rows.
      expect([...next.values()].map(one => [one.organisation, one.unread]).sort()).toEqual([...expected].sort());
    });

    test('an answer that changes nothing gives back the same rows', () => {
      const gone = heldUnread(first, [interview, recovery, coffee], latest(interview, recovery, coffee), none);
      expect(sameHold(heldUnread(gone, [interview, recovery, coffee], latest(interview, recovery, coffee), none), gone)).toBe(true);
      expect(sameHold(gone, first)).toBe(false);
    });
  });
});

