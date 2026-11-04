// The toolbar badge's rule (SV-174): a jobs page that stays unread past the grace says so, and one
// that reads takes it away.
import {describe, expect, test} from 'vitest';
import {badgeOf, GRACE_MS, NAME, watch} from '../src/watch.ts';

describe('the badge', () => {
  test.each([
    {was: 'a page that reads', since: null, unread: null, now: 1_000, expected: {since: null, badge: null, again: null}},
    {was: 'unread just now', since: null, unread: 'pane', now: 1_000, expected: {since: 1_000, badge: null, again: GRACE_MS}},
    {was: 'unread for 3 s', since: 1_000, unread: 'pane', now: 4_000, expected: {since: 1_000, badge: null, again: 2_000}},
    {was: 'unread for the grace', since: 1_000, unread: 'pane', now: 1_000 + GRACE_MS, expected: {since: 1_000, badge: 'pane', again: null}},
    {was: 'unread longer, the cards now too', since: 1_000, unread: 'both', now: 9_000, expected: {since: 1_000, badge: 'both', again: null}},
    {was: 'read again', since: 1_000, unread: null, now: 9_000, expected: {since: null, badge: null, again: null}},
  ] as const)('$was', ({since, unread, now, expected}) => {
    expect(watch(since, unread, now)).toEqual(expected);
  });

  test('waits out the grace once more after the page reads', () => {
    const read = watch(1_000, null, 2_000);
    expect(watch(read.since, 'cards', 3_000)).toEqual({since: 3_000, badge: null, again: GRACE_MS});
  });

  test.each([
    ['pane', {text: '!', title: 'Setpoint couldn\'t read this LinkedIn page, its job pane'}],
    ['cards', {text: '!', title: 'Setpoint couldn\'t read this LinkedIn page, its job cards'}],
    ['both', {text: '!', title: 'Setpoint couldn\'t read this LinkedIn page, its job pane and cards'}],
    [null, {text: '', title: NAME}],
  ] as const)('%s says %o', (unread, expected) => {
    expect(badgeOf(unread)).toEqual(expected);
  });
});
