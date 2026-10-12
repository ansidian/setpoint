// The sidebar's last-known shape (logic/shape.ts; DESIGN.md #175): what's kept, and what's read back.
import type {AccountOut, MailCountsOut} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {parseShape, shapeOf, todayLines} from '../src/logic/shape.ts';
import type {SidebarShape} from '../src/logic/shape.ts';

const account = (id: number, label: string, position: number, reconnect = false) => ({
  id, label, position, provider: 'gmail', address: `${label.toLowerCase()}@example.com`, colour: 'cool', icon: 'mail', source_id: null,
  health: {state: reconnect ? 'needs_reconnect' : 'healthy', reason: null, last_success_at: null, as_of: null},
}) as unknown as AccountOut;

const shape: SidebarShape = {
  accounts: [{id: 2, label: 'Business', colour: 'cool', reconnect: true}, {id: 1, label: 'Personal', colour: 'cool', reconnect: false}],
  counts: {attention: 3, unread: 19, accounts: [{account_id: 1, unread: 8}]},
  today: {date: '2026-10-07', lines: 4},
};

describe('shapeOf', () => {
  test('the accounts in their order with whether each needs sign-in, and the counts the sidebar shows', () => {
    const counts: MailCountsOut = {attention: 3, unread: 19, unread_fyi: 11, accounts: [{account_id: 1, unread: 8}]};
    expect(shapeOf([account(1, 'Personal', 2), account(2, 'Business', 1, true)], counts, {date: '2026-10-07', lines: 4})).toEqual(shape);
  });

  test('no counts yet: none kept', () => {
    expect(shapeOf([], undefined, null)).toEqual({accounts: [], counts: null, today: null});
  });
});

describe('parseShape', () => {
  test.each<[string, string | null, SidebarShape | null]>([
    ['what was kept', JSON.stringify(shape), shape],
    ['nothing kept', null, null],
    ['not JSON', '{accounts', null],
    ['not a shape', '[]', null],
    ['an account without its colour', JSON.stringify({...shape, accounts: [{id: 1, label: 'Personal', reconnect: false}]}), null],
    ['a colour that isn\'t a swatch', JSON.stringify({...shape, accounts: [{id: 1, label: 'Personal', colour: 'red', reconnect: false}]}), null],
    ['a count that isn\'t one', JSON.stringify({...shape, counts: {...shape.counts, unread: -1}}), null],
    ['Today\'s day not a date', JSON.stringify({...shape, today: {date: 'Wed', lines: 2}}), null],
    ['no counts or Today yet', JSON.stringify({...shape, counts: null, today: null}), {...shape, counts: null, today: null}],
  ])('%s', (_name, text, expected) => expect(parseShape(text)).toEqual(expected));
});

describe('todayLines', () => {
  test.each<[string, SidebarShape | null, number]>([
    ['as many as it showed today', shape, 4],
    ['another day\'s: three', {...shape, today: {date: '2026-10-06', lines: 1}}, 3],
    ['none kept: three', null, 3],
    ['nothing today: none', {...shape, today: {date: '2026-10-07', lines: 0}}, 0],
  ])('%s', (_name, kept, lines) => expect(todayLines(kept, '2026-10-07')).toBe(lines));
});
