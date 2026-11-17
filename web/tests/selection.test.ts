// Selecting several emails as tables: ⌘-click in and out, the first taking the open email,
// ⇧-click's range from the anchor, ⌘A's every row, the selection in list order, and what its tools
// offer. Then drafts: which can be discarded, and how Discard's toasts count them.
import type {DraftRowOut, MessageRowOut} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import type {Stop} from '../src/logic/inbox.ts';
import {broughtBackLine, discardable, discardedLine, discardFailedLine, draftOffers, inListOrder, NO_SELECTION, ranged, selectedAll, selectionOffers, toggled} from '../src/logic/selection.ts';
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
const sel = (ids: number[], anchor: number | null, front: number | null = null): Selection => ({ids, anchor, front});

describe('toggled (⌘-click)', () => {
  test.each([
    ['the first, nothing open: that one', NO_SELECTION, 4, null, sel([4], 4, 4)],
    ['the first, an email open: it and the open one', NO_SELECTION, 4, 2, sel([2, 4], 4, 4)],
    ['the first, on the open email: just it', NO_SELECTION, 2, 2, sel([2], 2, 2)],
    ['another: added', sel([2, 4], 4), 5, null, sel([2, 4, 5], 5, 5)],
    ['a selected one: taken out', sel([2, 4, 5], 5), 4, null, sel([2, 5], 4)],
    ['the last one: none left', sel([4], 4), 4, null, sel([], 4)],
  ])('%s', (_, selection, id, open, after) => {
    expect(toggled(selection, id, open)).toEqual(after);
  });
});

describe('ranged (⇧-click)', () => {
  test.each([
    ['down from the anchor', sel([1], 1), 4, null, sel([1, 2, 3, 4], 1, 4)],
    ['up from the anchor', sel([5], 5), 2, null, sel([5, 2, 3, 4], 5, 2)],
    ['from the open email, nothing selected: it too', NO_SELECTION, 4, 2, sel([2, 3, 4], 2, 4)],
    ['nothing selected or open: that one', NO_SELECTION, 4, null, sel([4], 4, 4)],
    ['an email no longer listed as anchor: that one', sel([9], 9), 4, null, sel([9, 4], 9, 4)],
    ['onto an email not in the list: unchanged', sel([1], 1), 9, null, sel([1], 1)],
  ])('%s', (_, selection, id, open, after) => {
    expect(ranged(selection, stops, id, open)).toEqual(after);
  });
});

describe('selectedAll (⌘A)', () => {
  // More rows loaded: the list's own rows, then 6 and 7 after them.
  const more: Stop[] = [...stops, {key: 'all:6', kind: 'row', group: 'all', id: 6}, {key: 'all:7', kind: 'row', group: 'all', id: 7}];
  test.each([
    ['nothing selected: every row, each once, the fold left out', NO_SELECTION, stops, sel([1, 2, 3, 4, 5], null)],
    ['some selected: every row, the anchor kept', sel([4, 2], 4), stops, sel([1, 2, 3, 4, 5], 4)],
    ['a second time: the same', sel([1, 2, 3, 4, 5], null), stops, sel([1, 2, 3, 4, 5], null)],
    ['after more rows load: those too', sel([1, 2, 3, 4, 5], null), more, sel([1, 2, 3, 4, 5, 6, 7], null)],
    ['an empty list: none', NO_SELECTION, [], sel([], null)],
  ])('%s', (_, selection, list, after) => {
    expect(selectedAll(selection, list)).toEqual(after);
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
    pinned: false, done: false, fact: null, code: null, trash_due_at: null, attachment_count: 0, command: null, ...fields,
  };
}

describe('selectionOffers', () => {
  test.each([
    ['Done counts Attention mail not yet Done; Pin while any is unpinned; Mark read while any is unread',
      [row({lane: 'attention'}), row({lane: 'attention', done: true}), row({unread: true, pinned: true})], {done: 1, pin: true, read: true, answer: true}],
    ['every one pinned and read, none Attention: Unpin, Mark unread, no Done',
      [row({pinned: true}), row({pinned: true, lane: 'noise'})], {done: 0, pin: false, read: false, answer: true}],
  ])('%s', (_, rows, offers) => {
    expect(selectionOffers(rows)).toEqual(offers);
  });
});

describe('Reply, Reply all and Forward on a selection: from 2 to 5 emails, in the Inbox and Sent, never in Drafts', () => {
  const emails = (n: number, fields: Partial<MessageRowOut> = {}) => Array.from({length: n}, (_, at) => row({id: at + 1, ...fields}));
  test.each<[string, MessageRowOut[], boolean]>([
    ['one left selected in the Inbox', emails(1), false],
    ['two in the Inbox', emails(2), true],
    ['five in the Inbox', emails(5), true],
    ['six in the Inbox', emails(6), false],
    ['two in Sent', emails(2, {sent_only: true}), true],
    ['five in Sent', emails(5, {sent_only: true}), true],
    ['six in Sent', emails(6, {sent_only: true}), false],
  ])('%s', (_, rows, answer) => {
    expect(selectionOffers(rows).answer).toBe(answer);
  });
  test.each([2, 5, 6])('%i drafts: Discard only', n => {
    expect(Object.keys(draftOffers(Array.from({length: n}, () => ({send_state: null}))))).toEqual(['discard']);
  });
});

describe('drafts: Discard', () => {
  const state = (send_state: DraftRowOut['send_state']) => ({send_state});
  test.each<[string, DraftRowOut['send_state'], boolean]>([
    ['an ordinary draft', null, true],
    ['one whose send failed', 'failed', true],
    ['one held after Send', 'held', false],
    ['one being sent', 'sending', false],
  ])('%s: %s', (_, sendState, can) => {
    expect(discardable(state(sendState))).toBe(can);
  });

  test.each<[string, DraftRowOut['send_state'][], number]>([
    ['every one can go', [null, 'failed', null], 3],
    ['2 of 3, one sending', [null, 'sending', null], 2],
    ['none, all held or sending', ['held', 'sending'], 0],
  ])('a selection offers Discard for those that can go: %s', (_, states, discard) => {
    expect(draftOffers(states.map(state))).toEqual({discard});
  });

  test.each<[string, string, string]>([
    ['one', discardedLine(1), 'Draft discarded'],
    ['several', discardedLine(3), 'Discarded 3 drafts'],
    ['one refused', discardFailedLine(1), 'Couldn\'t discard the draft'],
    ['several refused', discardFailedLine(2), 'Couldn\'t discard 2 drafts'],
    ['Undo, the one not back', broughtBackLine(0, 1), 'Couldn\'t bring the draft back'],
    ['Undo, none of several back', broughtBackLine(0, 3), 'Couldn\'t bring the drafts back'],
    ['Undo, some back', broughtBackLine(2, 3), 'Brought back 2 of 3 drafts'],
  ])('the toast: %s', (_, line, reads) => {
    expect(line).toBe(reads);
  });
});
