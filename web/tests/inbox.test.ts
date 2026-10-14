// The Inbox's rules (DESIGN.md › The list, Interaction rules) as tables over a small Inbox shaped
// like the seed's: held rows, each row's line, the cursor, and the counts' at-once changes (opening
// drops unread; only Done drops the pill).
import type {InboxGroupOut, InboxOut, MailCountsOut, MessageRowOut} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {
  accountColumn, GROUP_GLYPHS, codeExpired, countsAfterOpen, keepShown, withHeld, withoutEmails, inboxAfterDone, inboxAfterMarkAllRead, inboxAfterOpen, inboxAfterPin, inboxAfterUnread, keepCursor, markAllReadIds, markAllReads, moveCursor, neighbour, nextAfterLeaving,
  nextCodeChange, promptText, rowLine, showsPending, visiblePrompt, withoutExpiredCodes,
} from '../src/logic/inbox.ts';
import type {PatternPrompt} from '../src/logic/inbox.ts';
import type {Stop} from '../src/logic/inbox.ts';

let nextId = 1;
function row(fields: Partial<MessageRowOut>): MessageRowOut {
  return {
    id: nextId++, account_id: 1, from_name: 'Sender', from_address: 'sender@example.com', organisation: null, via: null, subject: 'Subject',
    summary: null, received_at: '2026-10-07T15:00:00.000Z', unread: true, lane: 'fyi', kind: 'other', type: null, protected: false,
    pinned: false, done: false, fact: null, code: null, attachment_count: 0, command: null, ...fields,
  };
}
const group = (name: InboxGroupOut['group'], rows: MessageRowOut[], fields: Partial<InboxGroupOut> = {}): InboxGroupOut => ({
  group: name, count: rows.length, unread: rows.filter(item => item.unread).length, rows, ...fields,
});

const parkside = row({id: 27, account_id: 2, organisation: 'Parkside Apartments', from_name: 'Dana Whitfield', subject: 'Lease renewal terms', unread: false, pinned: true, lane: 'fyi', kind: 'people', summary: 'Renewal offer'});
const google = row({id: 2, account_id: 2, organisation: 'Google', subject: 'Your recovery email was changed', lane: 'attention', protected: true});
const northwind = row({id: 5, account_id: 4, organisation: 'Northwind Talent', from_name: 'Priya Raman', via: 'Greenhouse', subject: 'Interview availability', lane: 'attention'});
const exams = row({id: 22, account_id: 2, organisation: 'Contoso University', subject: 'Final exam schedule', lane: 'attention', unread: false});
const code = row({id: 1, account_id: 2, organisation: 'Contoso Insurance', subject: 'Your code is 482913', kind: 'security', code: {value: '482913', expires_at: '2026-10-07T16:23:00.000Z'}});
const signIn = row({id: 3, account_id: 1, organisation: 'Google', subject: 'Security alert', kind: 'security', fact: 'New sign-in · MacBook Pro · Los Angeles'});
const ups = row({id: 6, account_id: 2, organisation: 'Consolidated Messenger', subject: 'Out for delivery', kind: 'deliveries'});
const amazon = row({id: 11, account_id: 1, organisation: 'Wingtip Toys', subject: 'Arriving today', kind: 'deliveries'});
const fabrikam = row({id: 12, account_id: 4, organisation: 'Fabrikam', from_name: 'Fabrikam Recruiting', via: 'Workday', subject: 'Application received', summary: 'Data Analyst', kind: 'career'});
const tailspin = row({id: 4, account_id: 2, organisation: 'Tailspin Toys', lane: 'noise', kind: null});

const counts: MailCountsOut = {attention: 3, unread: 8, unread_fyi: 5, accounts: [{account_id: 1, unread: 2}, {account_id: 2, unread: 4}, {account_id: 4, unread: 2}]};
const groups: InboxGroupOut[] = [
  group('pinned', [parkside]),
  group('attention', [google, northwind, exams]),
  group('security', [code, signIn]),
  group('deliveries', [ups, amazon]),
  group('career', [fabrikam]),
  group('noise', [tailspin]),
];
const inbox: InboxOut = {account_id: null, groups, counts, next_change_at: null};
// Where J and K stop in a list like the seed's: its rows, and a folded Noise line in place of Deliveries'.
const rowStop = (name: InboxGroupOut['group'], id: number): Stop => ({key: `${name}:${id}`, kind: 'row', group: name, id});
const stops: Stop[] = [
  rowStop('pinned', 27), rowStop('attention', 2), rowStop('attention', 5), rowStop('attention', 22), rowStop('security', 1), rowStop('security', 3),
  {key: 'noise:a', kind: 'noise', date: 'a'}, rowStop('career', 12), {key: 'noise:b', kind: 'noise', date: 'b'},
];

// Each lane's glyph, one per group and no two alike (#119): its header and All's kind column draw it.
test.each([
  ['pinned', 'keep'], ['attention', 'flag'], ['unsorted', 'pending'], ['security', 'lock'], ['deliveries', 'local_shipping'], ['money', 'payments'],
  ['career', 'work'], ['people', 'person'], ['updates', 'notifications'], ['other', 'mail'], ['noise', 'campaign'],
] as const)('%s\'s glyph is %s', (name, glyph) => expect(GROUP_GLYPHS[name]).toBe(glyph));
test('no two groups share a glyph', () => expect(new Set(Object.values(GROUP_GLYPHS)).size).toBe(Object.keys(GROUP_GLYPHS).length));

describe('the Inbox keeps what it showed until the user leaves it', () => {
  const ids = (list: InboxGroupOut[], name: string) => list.find(item => item.group === name)?.rows.map(item => [item.id, item.unread]);
  const security = (rows: MessageRowOut[]) => groups.map(item => (item.group === 'security' ? group('security', rows) : item));

  test('an email read here, then another, both keep their places', () => {
    const first = keepShown(groups, security([code]), [], new Set());
    expect(first).toEqual([{group: 'security', index: 1, row: {...signIn, unread: false}}]);
    const shown = withHeld(security([code]), first);
    const second = keepShown(shown, security([]).filter(item => item.group !== 'security'), first, new Set());
    expect(ids(withHeld(security([]).filter(item => item.group !== 'security'), second), 'security')).toEqual([[1, false], [3, false]]);
  });
  test('one read elsewhere stays too; its group with it', () => {
    const after = groups.filter(item => item.group !== 'career');
    const held = keepShown(groups, after, [], new Set());
    expect(held.map(one => [one.group, one.row.id, one.row.unread])).toEqual([['career', 12, false]]);
  });
  test('Done, Trash or Mark all as read here take it out', () => {
    expect(keepShown(groups, security([code]), [], new Set([3]))).toEqual([]);
    expect(keepShown(withHeld(security([code]), [{group: 'security', index: 1, row: signIn}]), security([code]), [{group: 'security', index: 1, row: signIn}], new Set([3]))).toEqual([]);
  });
  test('a held email back in the list is let go', () => {
    expect(keepShown(security([code]), groups, [{group: 'security', index: 1, row: signIn}], new Set())).toEqual([]);
  });
  test('unpinning leaves it in its lane: nothing held', () => {
    const pinned = groups[0]!.rows[0]!;
    const after = groups.filter(item => item.group !== 'pinned').map(item => (item.group === 'career' ? group('career', [fabrikam, pinned]) : item));
    expect(keepShown(groups, after, [], new Set())).toEqual([]);
  });
  test('pinning a held email and unpinning it keeps its place in its group (SV-24)', () => {
    const read = groups.filter(item => item.group !== 'career');
    const held = keepShown(groups, read, [], new Set());
    const shelf = read.map(item => (item.group === 'pinned' ? group('pinned', [{...fabrikam, unread: false, pinned: true}, parkside]) : item));
    const pinned = keepShown(withHeld(read, held), shelf, held, new Set());
    expect(pinned.map(one => [one.group, one.row.id])).toEqual([['career', 12]]);
    const unpinned = keepShown(withHeld(shelf, pinned), read, pinned, new Set());
    expect(unpinned.map(one => [one.group, one.row.id])).toEqual([['career', 12]]);
  });
  test('Trash takes an email out at once, its group too when it was the only one', () => {
    const after = withoutEmails(groups, new Set([3, 12]));
    expect(ids(after, 'security')).toEqual([[1, true]]);
    expect(after.find(item => item.group === 'security')).toMatchObject({count: 1});
    expect(after.some(item => item.group === 'career')).toBe(false);
    expect(withoutEmails(groups, new Set())).toBe(groups);
  });
});

describe('Pin, Mark all as read and Mark unread show at once', () => {
  const shape = (after: InboxOut) => after.groups.map(item => [item.group, item.rows.map(one => [one.id, one.unread, one.pinned])]);

  test('Pin puts it first on the shelf and leaves it in its group, pinned', () => {
    const after = inboxAfterPin(inbox, fabrikam.id, true);
    expect(shape(after).slice(0, 1)).toEqual([['pinned', [[12, true, true], [27, false, true]]]]);
    expect(after.groups.find(item => item.group === 'career')!.rows[0]!.pinned).toBe(true);
  });
  test('Unpin takes the last one off, and the shelf goes', () => {
    expect(inboxAfterPin(inbox, parkside.id, false).groups.map(item => item.group)).toEqual(['attention', 'security', 'deliveries', 'career', 'noise']);
  });
  test('Pin with no shelf yet makes one at the top', () => {
    const none = {...inbox, groups: groups.filter(item => item.group !== 'pinned')};
    expect(inboxAfterPin(none, ups.id, true).groups[0]).toMatchObject({group: 'pinned', count: 1, unread: 1});
  });
  test.each([
    ['every account\'s Inbox', null, [[30, 27]]],
    ['its own account\'s', 4, [[30, 27]]],
    ['not another account\'s', 2, [[27]]],
  ])('Pin from All, on an email the Inbox doesn\'t hold, reaches the shelf of %s', (_name, account, shelf) => {
    const old = row({id: 30, account_id: 4, organisation: 'Woodgrove Bank', unread: false, lane: 'fyi', kind: 'money'});
    const after = inboxAfterPin({...inbox, account_id: account}, old.id, true, old);
    expect(after.groups.filter(item => item.group === 'pinned').map(item => item.rows.map(one => one.id))).toEqual(shelf);
    expect(after.groups.filter(item => item.group !== 'pinned').some(item => item.rows.some(one => one.id === old.id))).toBe(false);
  });
  test('Mark all as read: Attention and Security stay as they are, the rest reads and leaves, and the counts drop by each (UX #4)', () => {
    const after = inboxAfterMarkAllRead(inbox, null);
    expect(shape(after)).toEqual([
      ['pinned', [[27, false, true]]], ['attention', [[2, true, false], [5, true, false], [22, false, false]]], ['security', [[1, true, false], [3, true, false]]],
    ]);
    expect(after.counts).toEqual({attention: 3, unread: 4, unread_fyi: 2, accounts: [{account_id: 1, unread: 1}, {account_id: 2, unread: 2}, {account_id: 4, unread: 1}]});
  });
  test('a pinned security email keeps its dot on the shelf too', () => {
    const pinnedCode = {...code, pinned: true};
    const after = inboxAfterMarkAllRead({...inbox, groups: [group('pinned', [pinnedCode]), group('security', [pinnedCode])]}, null);
    expect(shape(after)).toEqual([['pinned', [[1, true, true]]], ['security', [[1, true, true]]]]);
  });
  test('for one account, only its mail', () => {
    const after = inboxAfterMarkAllRead(inbox, 1);
    expect(after.groups.flatMap(item => item.rows.map(one => one.id))).toEqual([27, 2, 5, 22, 1, 3, 6, 12, 4]);
    expect(after.counts.unread).toBe(7);
  });
  test('Mark unread brings the dot back and counts it', () => {
    const after = inboxAfterUnread(inbox, exams.id);
    expect(after.groups.find(item => item.group === 'attention')).toMatchObject({unread: 3});
    expect(after.counts).toMatchObject({unread: 9, unread_fyi: 5, accounts: [{account_id: 1, unread: 2}, {account_id: 2, unread: 5}, {account_id: 4, unread: 2}]});
    expect(inboxAfterUnread(inbox, google.id)).toBe(inbox);
  });
});

describe('rowLine', () => {
  test.each([
    ['the summary in the subject\'s place, the subject in the tooltip', parkside, {from: 'Parkside Apartments', subject: 'Renewal offer', summary: null, code: null, title: 'Lease renewal terms'}],
    ['a security row\'s fact as its subject', signIn, {from: 'Google', subject: 'New sign-in', summary: 'MacBook Pro · Los Angeles', code: null, title: null}],
    ['a code row', code, {from: 'Contoso Insurance', subject: 'Your code is 482913', summary: null, code: code.code, title: null}],
    ['the platform after the summary', fabrikam, {from: 'Fabrikam', subject: 'Data Analyst', summary: 'via Workday', code: null, title: 'Application received'}],
    ['the platform after the subject, with no summary', row({organisation: 'Northwind', via: 'Greenhouse', subject: 'Interview'}), {from: 'Northwind', subject: 'Interview', summary: 'via Greenhouse', code: null, title: null}],
    ['the sender without an organisation', row({from_name: 'Sam Lee', subject: 'Dinner Friday?'}), {from: 'Sam Lee', subject: 'Dinner Friday?', summary: null, code: null, title: null}],
    ['a fact with nothing after it', row({organisation: 'Google', fact: 'Password changed'}), {from: 'Google', subject: 'Password changed', summary: null, code: null, title: null}],
    ['a security row keeps its fact over a summary', row({organisation: 'Google', fact: 'New sign-in · Pixel', summary: 'A new phone signed in'}), {from: 'Google', subject: 'New sign-in', summary: 'Pixel', code: null, title: null}],
  ])('%s', (_name, item, expected) => {
    expect(rowLine(item)).toEqual(expected);
  });
});

describe('the cursor', () => {
  test.each([
    ['J with no cursor starts at the top', null, 1, 'pinned:27'],
    ['K with no cursor starts at the top too', null, -1, 'pinned:27'],
    ['J moves down', 'attention:2', 1, 'attention:5'],
    ['K moves up', 'attention:2', -1, 'pinned:27'],
    ['onto a folded Noise line', 'security:3', 1, 'noise:a'],
    ['stays at the bottom', 'noise:b', 1, 'noise:b'],
    ['stays at the top', 'pinned:27', -1, 'pinned:27'],
    ['a cursor that left starts again at the top', 'money:99', 1, 'pinned:27'],
  ] as const)('%s', (_name, current, delta, expected) => {
    expect(moveCursor(stops, current, delta)).toBe(expected);
  });

  test('nothing to stop at', () => {
    expect(moveCursor([], null, 1)).toBeNull();
  });

  const keys = (...names: string[]): Stop[] => names.map(key => ({key, kind: 'noise', date: key}));
  test.each([
    ['still there', keys('a', 'b', 'c'), keys('a', 'b', 'c'), 'b', 'b'],
    ['Done takes it: the next one', keys('a', 'b', 'c'), keys('a', 'c'), 'b', 'c'],
    ['the last one goes: the one before', keys('a', 'b', 'c'), keys('a', 'b'), 'c', 'b'],
    ['several go: the next that remains', keys('a', 'b', 'c', 'd'), keys('a', 'd'), 'b', 'd'],
    ['everything goes', keys('a'), [], 'a', null],
    ['no cursor stays none', keys('a'), keys('a'), null, null],
  ])('keepCursor: %s', (_name, before, after, current, expected) => {
    expect(keepCursor(before, after, current)).toBe(expected);
  });

  test('the reader\'s previous and next skip folded Noise', () => {
    expect([neighbour(stops, 3, 1), neighbour(stops, 3, -1), neighbour(stops, 27, -1), neighbour(stops, 404, 1)]).toEqual([12, 1, null, null]);
  });
});

describe('counts follow at once', () => {
  test('opening an unread email drops the unread counts, its account\'s too, and not the pill', () => {
    const after = inboxAfterOpen(inbox, northwind.id);
    expect(after.counts).toEqual({attention: 3, unread: 7, unread_fyi: 5, accounts: [{account_id: 1, unread: 2}, {account_id: 2, unread: 4}, {account_id: 4, unread: 1}]});
    expect(after.groups.find(item => item.group === 'attention')!.rows.map(item => [item.id, item.unread])).toEqual([[2, true], [5, false], [22, false]]);
  });

  test('opening an unread FYI email drops unread FYI too, and keeps its row', () => {
    const after = inboxAfterOpen(inbox, signIn.id);
    expect([after.counts.unread, after.counts.unread_fyi, after.counts.accounts[0]!.unread]).toEqual([7, 4, 1]);
    expect(after.groups.find(item => item.group === 'security')!.rows.map(item => item.id)).toEqual([1, 3]);
  });

  test('opening a read email changes nothing', () => {
    expect(inboxAfterOpen(inbox, exams.id)).toBe(inbox);
    expect(countsAfterOpen(counts, {...signIn, unread: false})).toEqual(counts);
  });

  test.each([
    ['Done on an unread attention email: the pill and the unread counts drop', northwind.id, {attention: 2, unread: 7}, ['google', 'exams']],
    ['Done on a read attention email: only the pill drops', exams.id, {attention: 2, unread: 8}, ['google', 'northwind']],
    ['Done on an unread FYI email leaves the pill', signIn.id, {attention: 3, unread: 7}, ['google', 'northwind', 'exams']],
  ])('%s', (_name, id, expected, attention) => {
    const after = inboxAfterDone(inbox, id);
    expect({attention: after.counts.attention, unread: after.counts.unread}).toEqual(expected);
    const names = new Map([[google.id, 'google'], [northwind.id, 'northwind'], [exams.id, 'exams']]);
    expect(after.groups.find(item => item.group === 'attention')!.rows.map(item => names.get(item.id))).toEqual(attention);
  });

  test('Done keeps a pinned email on the shelf, and an emptied group goes', () => {
    const pinnedCareer = {...fabrikam, pinned: true};
    const both: InboxOut = {...inbox, groups: [group('pinned', [pinnedCareer]), group('career', [pinnedCareer])]};
    expect(inboxAfterDone(both, fabrikam.id).groups.map(item => [item.group, item.rows.length])).toEqual([['pinned', 1]]);
  });
});

test.each([
  ['the seed\'s morning: unread outside Attention and Security (UX #4)', groups, [6, 11, 12, 4]],
  ['a pinned security email stays unread', [group('pinned', [{...signIn, pinned: true}]), group('security', [{...signIn, pinned: true}])], []],
  ['a pinned unread email once, shelf and group', [group('pinned', [{...ups, pinned: true}]), group('deliveries', [{...ups, pinned: true}])], [6]],
  ['attention mail Done is read too', [group('attention', [{...northwind, done: true}, google])], [5]],
  ['nothing unread', [group('pinned', [parkside]), group('attention', [exams])], []],
])('markAllReadIds: %s', (_name, list, expected) => {
  expect(markAllReadIds(list)).toEqual(expected);
});

// All's rows take it at once too, so a Security row in its day keeps its dot (#243).
test.each([
  ['an unread delivery', ups, null, true],
  ['a Security alert stays unread (UX #4)', signIn, null, false],
  ['unread Attention waits on Done', northwind, null, false],
  ['Attention mail Done is read', {...northwind, done: true}, null, true],
  ['already read', {...ups, unread: false}, null, false],
  ['for its own account', ups, 2, true],
  ['for another account', ups, 1, false],
] as const)('markAllReads: %s', (_name, one, account, expected) => {
  expect(markAllReads(one, account)).toBe(expected);
});

test.each([
  ['nothing waiting', null, false],
  ['opening it reads it quietly', {state: 'pending', kind: 'open'}, false],
  ['Trash waiting for Gmail', {state: 'pending', kind: 'trash'}, true],
  ['Mark all as read waiting', {state: 'pending', kind: 'mark_all_read'}, true],
  ['a failed change shows failed, not pending', {state: 'failed', kind: 'trash'}, false],
])('showsPending: %s', (_name, command, expected) => {
  expect(showsPending({command: command as MessageRowOut['command']})).toBe(expected);
});

describe('Done or Trash on the open email opens the next', () => {
  test.each([
    ['Northwind: Contoso University takes its place', 'attention:5', 5, 22],
    ['the last in Attention: the next group\'s first row', 'attention:22', 22, 1],
    ['a folded Noise line is skipped', 'security:3', 3, 12],
    ['the last row shown: none, the reader closes', 'career:12', 12, null],
    ['the pinned shelf\'s email: the next email, not itself again', 'pinned:27', 27, 2],
    ['no key: by its id', null, 2, 5],
    ['a key from before the list changed: by its id', 'attention:404', 5, 22],
    ['an email the list doesn\'t show', null, 404, null],
  ])('%s', (_name, key, id, next) => {
    expect(nextAfterLeaving(stops, key, id)).toBe(next);
  });

  test('a pinned email shown again in its group is skipped', () => {
    const pinnedFabrikam = {...fabrikam, pinned: true};
    const both = [rowStop('pinned', pinnedFabrikam.id), rowStop('career', pinnedFabrikam.id), rowStop('career', 77)];
    expect(nextAfterLeaving(both, 'pinned:12', 12)).toBe(77);
  });
});

describe('a code leaves the Inbox at its expiry', () => {
  // The code expires at 9:23 AM (16:23Z).
  test.each([
    ['11 minutes before', Date.parse('2026-10-07T16:12:00.000Z'), false],
    ['a second before', Date.parse('2026-10-07T16:22:59.000Z'), false],
    ['at its expiry', Date.parse('2026-10-07T16:23:00.000Z'), true],
    ['after', Date.parse('2026-10-07T16:40:00.000Z'), true],
  ])('%s', (_name, now, expired) => {
    expect(codeExpired(code, now)).toBe(expired);
    const security = withoutExpiredCodes(groups, now).find(item => item.group === 'security')!;
    expect(security.rows.map(item => item.id)).toEqual(expired ? [3] : [1, 3]);
    expect(security.count).toBe(expired ? 1 : 2);
  });

  test('a row without a code never expires', () => {
    expect(codeExpired(signIn, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  test('the list moves on when the soonest code changes its words or leaves, not on the next tick', () => {
    const later = row({code: {value: '111222', expires_at: '2026-10-07T16:40:40.000Z'}});
    // 9:12 AM: the 9:23 code next reads "Expires in 10 min" at 9:13.
    expect(nextCodeChange([signIn, code], Date.parse('2026-10-07T16:12:00.000Z'))).toBe(Date.parse('2026-10-07T16:13:00.000Z'));
    // 9:22:50: it leaves at 9:23, before the other's next minute at 9:23:40.
    expect(nextCodeChange([later, code], Date.parse('2026-10-07T16:22:50.000Z'))).toBe(Date.parse('2026-10-07T16:23:00.000Z'));
    expect(nextCodeChange([signIn], Date.parse('2026-10-07T16:12:00.000Z'))).toBeNull();
  });

  test('a group the code leaves empty goes, and nothing else changes', () => {
    const onlyCode = [group('attention', [google]), group('security', [code])];
    expect(withoutExpiredCodes(onlyCode, Date.parse('2026-10-07T16:30:00.000Z')).map(item => item.group)).toEqual(['attention']);
    expect(withoutExpiredCodes(groups, 0)).toBe(groups);
  });
});

describe('the pattern prompt', () => {
  const prompt = (fields: Partial<PatternPrompt>): PatternPrompt => ({id: 1, organisation: 'Northwind', type: 'newsletter', count: 4, ...fields});
  test.each([
    ['board 09', prompt({}), 'You\'ve cleared 4 Northwind newsletters without opening them. Send these to FYI from now on?'],
    ['receipts', prompt({organisation: 'Fourth Coffee', type: 'receipt', count: 3}), 'You\'ve cleared 3 Fourth Coffee receipts without opening them. Send these to FYI from now on?'],
    ['no type', prompt({type: null, count: 5}), 'You\'ve cleared 5 Northwind emails without opening them. Send these to FYI from now on?'],
  ])('%s', (_name, input, text) => {
    expect(promptText(input)).toBe(text);
  });

  test.each([
    ['none offered', undefined, [], null],
    ['the first offered', [prompt({id: 1}), prompt({id: 2})], [], 1],
    ['an answered one goes', [prompt({id: 1}), prompt({id: 2})], [1], 2],
    ['never for protected mail', [prompt({id: 1, protected: true}), prompt({id: 2})], [], 2],
    ['nothing cleared, nothing to ask', [prompt({id: 1, count: 0})], [], null],
  ])('visiblePrompt: %s', (_name, prompts, answered, id) => {
    expect(visiblePrompt(prompts, new Set(answered))?.id ?? null).toBe(id);
  });
});

describe('the account column', () => {
  // The labels' widths at 12 px; the column adds the 7 px dot, its 6 px gap and a pixel for rounding.
  test.each([
    ['short labels keep the 76 px column', [42, 50, 30], 76],
    ['no accounts yet', [], 76],
    ['the longest label sets it, "Business (Studio)"', [98, 64], 112],
    ['a fraction rounds up', [70.2], 85],
    ['a 40-character label stops at 160 px, cut with an ellipsis', [231], 160],
  ])('accountColumn: %s', (_name, widths, px) => {
    expect(accountColumn(widths)).toBe(px);
  });
});
