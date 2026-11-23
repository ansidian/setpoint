// A phone row's swipe as tables: where a press can start one, which way a drag goes, how far it
// follows, where letting go rests it or what it runs, and what an Inbox row offers on each side.
import type {MessageRowOut} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {BUTTON, fullAt, rowSwipes, swipeArmed, swipeAxis, swipeOffset, swipeRelease, swipeStarts} from '../src/logic/swipe.ts';

const WIDTH = 375;
const THREE = {lead: 1, trail: 3};

test.each([
  ['at the screen\'s edge: Safari\'s Back', 0, false],
  ['a little way in, still Back\'s', 23, false],
  ['24 px in: the row\'s', 24, true],
  ['the middle of the row', 200, true],
])('a press %s', (_name, x, starts) => {
  expect(swipeStarts(x)).toBe(starts);
});

test.each<[string, number, number, 'x' | 'y' | null]>([
  ['still inside the slop', 6, 6, null],
  ['sideways past the slop', -12, 4, 'x'],
  ['down past the slop: the scroll\'s', 3, 14, 'y'],
  ['as much down as sideways: the scroll\'s', 12, 12, 'y'],
])('a drag %s', (_name, dx, dy, axis) => {
  expect(swipeAxis(dx, dy)).toBe(axis);
});

test.each([
  ['three trailing actions on a phone: past them and half one more', 3, WIDTH, 3 * BUTTON + BUTTON / 2],
  ['one leading action: 55% of the row', 1, WIDTH, WIDTH * 0.55],
])('the full-swipe line, %s', (_name, count, width, at) => {
  expect(fullAt(count, width)).toBe(at);
});

test.each([
  ['left from closed', 0, -100, THREE, -100],
  ['right from closed', 0, 60, THREE, 60],
  ['right with nothing leading: it stays', 0, 60, {lead: 0, trail: 3}, 0],
  ['left with nothing trailing: it stays', 0, -60, {lead: 1, trail: 0}, 0],
  ['past the row\'s width: held at it', 0, -500, THREE, -WIDTH],
  ['back right from resting open', -3 * BUTTON, 100, THREE, -3 * BUTTON + 100],
  ['from open past closed: over to the other side', -3 * BUTTON, 300, THREE, -3 * BUTTON + 300],
])('the row follows a drag %s', (_name, base, dx, counts, offset) => {
  expect(swipeOffset(base, dx, counts, WIDTH)).toBe(offset);
});

test.each([
  ['closed', 0, false],
  ['short of the line', -265, false],
  ['on the trailing line', -fullAt(3, WIDTH), true],
  ['past the leading line', 210, true],
])('a full swipe is armed: %s', (_name, offset, armed) => {
  expect(swipeArmed(offset, THREE, WIDTH)).toBe(armed);
});

test.each([
  ['not moved: closed', 0, {rest: 0}],
  ['a short pull left settles back', -30, {rest: 0}],
  ['half a button left rests open on the three', -BUTTON / 2, {rest: -3 * BUTTON}],
  ['most of the way left still rests open', -260, {rest: -3 * BUTTON}],
  ['past the trailing line runs Trash, the first', -270, {run: 'trail'}],
  ['a short pull right settles back', 20, {rest: 0}],
  ['half a button right rests open on Read', 40, {rest: BUTTON}],
  ['past the leading line marks it read', 220, {run: 'lead'}],
])('letting go: %s', (_name, offset, outcome) => {
  expect(swipeRelease(offset, THREE, WIDTH)).toEqual(outcome);
});

function row(fields: Partial<MessageRowOut>): MessageRowOut {
  return {
    id: 1, account_id: 1, from_name: 'Sender', from_address: 'sender@example.com', organisation: null, via: null, subject: 'Subject',
    summary: null, received_at: '2026-10-07T15:00:00.000Z', unread: false, lane: 'fyi', kind: 'other', type: null, protected: false,
    pinned: false, done: false, fact: null, code: null, trash_due_at: null, attachment_count: 0, command: null, ...fields,
  };
}

describe('rowSwipes', () => {
  test.each<[string, Partial<MessageRowOut>, ReturnType<typeof rowSwipes>]>([
    ['unread FYI: Read, then Trash and Pin', {unread: true}, {lead: ['read'], trail: ['trash', 'pin']}],
    ['read FYI: Unread', {}, {lead: ['unread'], trail: ['trash', 'pin']}],
    ['Attention not yet Done: Done between Trash and Pin', {lane: 'attention', unread: true}, {lead: ['read'], trail: ['trash', 'done', 'pin']}],
    ['Attention already Done: no Done', {lane: 'attention', done: true}, {lead: ['unread'], trail: ['trash', 'pin']}],
    ['pinned: Unpin', {pinned: true}, {lead: ['unread'], trail: ['trash', 'unpin']}],
    ['snoozed (found by search): no Pin', {snoozed_until: '2026-10-08T16:00:00.000Z'}, {lead: ['unread'], trail: ['trash']}],
    ['sent mail: no read state, no Pin', {sent_only: true}, {lead: [], trail: ['trash']}],
  ])('%s', (_name, fields, offered) => {
    expect(rowSwipes(row(fields))).toEqual(offered);
  });
});
