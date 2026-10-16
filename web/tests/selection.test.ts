// Selecting several emails (DESIGN.md #249) as tables: ⌘-click in and out, the first taking the open
// email; ⇧-click's range from the anchor; the selection in list order; and what its tools offer.
import type {MessageRowOut} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import type {Stop} from '../src/logic/inbox.ts';
import {inListOrder, NO_SELECTION, ranged, selectionOffers, toggled} from '../src/logic/selection.ts';
import type {Selection} from '../src/logic/selection.ts';

// New's 1 and 2, the shelf's 3, then a day's 4, 3 again (pinned, in its day too), 5, and a Noise fold.
const stops: Stop[] = [
  {key: 'new:1', kind: 'row', group: 'attention', id: 1},
  {key: 'new:2', kind: 'row', group: 'people', id: 2},
  {key: 'pinned:3', kind: 'row', group: 'pinned', id: 3},
  {key: 'all:4', kind: 'row', group: 'all', id: 4},
  {key: 'all:3', kind: 'row', group: 'all', id: 3},
  {key: 'noise:2026-10-07', kind: 'noise', date: '2026-10-07'},
  {key: 'all:5', kind: 'row', group: 'all', id: 5},
];
const sel = (ids: number[], anchor: number | null): Selection => ({ids, anchor});

describe('toggled (⌘-click)', () => {
  test.each([
    ['the first, nothing open: that one', NO_SELECTION, 4, null, sel([4], 4)],
    ['the first, an email open: it and the open one', NO_SELECTION, 4, 2, sel([2, 4], 4)],
    ['the first, on the open email: just it', NO_SELECTION, 2, 2, sel([2], 2)],
    ['another: added', sel([2, 4], 4), 5, null, sel([2, 4, 5], 5)],
    ['a selected one: taken out', sel([2, 4, 5], 5), 4, null, sel([2, 5], 4)],
    ['the last one: none left', sel([4], 4), 4, null, sel([], 4)],
  ])('%s', (_, selection, id, open, after) => {
    expect(toggled(selection, id, open)).toEqual(after);
  });
});

describe('ranged (⇧-click)', () => {
  test.each([
    ['down from the anchor', sel([1], 1), 4, null, sel([1, 2, 3, 4], 1)],
    ['up from the anchor', sel([5], 5), 2, null, sel([5, 2, 3, 4], 5)],
    ['from the open email, nothing selected: it too', NO_SELECTION, 4, 2, sel([2, 3, 4], 2)],
    ['nothing selected or open: that one', NO_SELECTION, 4, null, sel([4], 4)],
    ['an email no longer listed as anchor: that one', sel([9], 9), 4, null, sel([9, 4], 9)],
    ['onto an email not in the list: unchanged', sel([1], 1), 9, null, sel([1], 1)],
  ])('%s', (_, selection, id, open, after) => {
    expect(ranged(selection, stops, id, open)).toEqual(after);
  });
});

describe('inListOrder', () => {
  test.each([
    ['in the list\'s order, each once', [5, 3, 1], [1, 3, 5]],
    ['what left the list is gone', [4, 9], [4]],
    ['nothing selected', [], []],
  ])('%s', (_, ids, after) => {
    expect(inListOrder(ids, stops)).toEqual(after);
  });
});

function row(fields: Partial<MessageRowOut>): MessageRowOut {
  return {
    id: 1, account_id: 1, from_name: 'Sender', from_address: 'sender@example.com', organisation: null, via: null, subject: 'Subject',
    summary: null, received_at: '2026-10-07T15:00:00.000Z', unread: false, lane: 'fyi', kind: 'other', type: null, protected: false,
    pinned: false, done: false, fact: null, code: null, attachment_count: 0, command: null, ...fields,
  };
}

describe('selectionOffers', () => {
  test.each([
    ['Done counts Attention mail not yet Done; Pin while any is unpinned; Mark read while any is unread',
      [row({lane: 'attention'}), row({lane: 'attention', done: true}), row({unread: true, pinned: true})], {done: 1, pin: true, read: true}],
    ['every one pinned and read, none Attention: Unpin, Mark unread, no Done',
      [row({pinned: true}), row({pinned: true, lane: 'noise'})], {done: 0, pin: false, read: false}],
  ])('%s', (_, rows, offers) => {
    expect(selectionOffers(rows)).toEqual(offers);
  });
});
