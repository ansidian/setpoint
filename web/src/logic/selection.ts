// Selecting several emails or drafts. ⌘ or Ctrl-click adds a row or takes it out, and the first one
// takes the open one too. ⇧-click adds every row from the last one clicked (or the open one) to this
// one. ⌘A (Ctrl-A) selects every row the list holds now, and again after more load. This file also
// has what the selection's tools and menu offer, from its rows (Reply, Reply all and Forward on a few
// emails only), and how Drafts' Discard counts in its toasts.
import type {DraftRowOut, MessageRowOut} from '@setpoint/shared';
import type {Stop} from './inbox.ts';
import {readerActions} from './reader.ts';

export interface Selection {
  ids: number[];
  // The email a ⇧-click's range starts from: the last one clicked.
  anchor: number | null;
}

export const NO_SELECTION: Selection = {ids: [], anchor: null};

/** The list's emails in order, each once (a pinned email can show on the shelf and in its day). */
function rowIds(stops: Stop[]): number[] {
  return [...new Set(stops.flatMap(stop => (stop.kind === 'row' ? [stop.id] : [])))];
}

/** ⌘-click on `id`: in, or out if it was in. The first one takes the open email too. */
export function toggled(selection: Selection, id: number, open: number | null): Selection {
  if (!selection.ids.length) return {ids: open !== null && open !== id ? [open, id] : [id], anchor: id};
  const ids = selection.ids.includes(id) ? selection.ids.filter(one => one !== id) : [...selection.ids, id];
  return {ids, anchor: id};
}

/** ⇧-click on `id`: every email from the anchor (else the open email) to it, added to what's selected. */
export function ranged(selection: Selection, stops: Stop[], id: number, open: number | null): Selection {
  const rows = rowIds(stops);
  const to = rows.indexOf(id);
  if (to < 0) return selection;
  const start = selection.anchor ?? open;
  const from = start === null ? -1 : rows.indexOf(start);
  const span = from < 0 ? [id] : rows.slice(Math.min(from, to), Math.max(from, to) + 1);
  const ids = [...selection.ids, ...span.filter(one => !selection.ids.includes(one))];
  // The open email the range started from is selected too, as the first ⌘-click takes it.
  return {ids: open !== null && from >= 0 && start === open && !ids.includes(open) ? [open, ...ids] : ids, anchor: selection.anchor ?? start ?? id};
}

/** ⌘A: every email the list holds now, in its order; the anchor stays. A second ⌘A changes nothing. */
export function selectedAll(selection: Selection, stops: Stop[]): Selection {
  return {ids: rowIds(stops), anchor: selection.anchor};
}

/** What's selected and still in the list, in the list's order: Trash takes an email out, and a search swaps the list. */
export function inListOrder(ids: readonly number[], stops: Stop[]): number[] {
  if (!ids.length) return [];
  return rowIds(stops).filter(id => ids.includes(id));
}

// The most emails Reply, Reply all and Forward answer at once, a window each.
const ANSWER_MOST = 5;

/**
 * What the selection's tools and menu offer: Done for the emails that can be, and how many. Pin
 * unless every one is pinned already. Mark read while any is unread, else Mark unread. Reply, Reply
 * all and Forward on 2 to 5 emails, in the Inbox and Sent (Drafts' selection has its own offers).
 */
export function selectionOffers(rows: MessageRowOut[]): {done: number; pin: boolean; read: boolean; answer: boolean} {
  return {
    done: rows.filter(row => readerActions(row).done).length,
    pin: rows.some(row => !row.pinned),
    read: rows.some(row => row.unread),
    answer: rows.length >= 2 && rows.length <= ANSWER_MOST,
  };
}

/** "Moved 3 to Trash", or the one email's own words for one. */
export const counted = (n: number, one: string, many: (n: number) => string) => (n === 1 ? one : many(n));

/** Whether a draft can be discarded: not while its send is held or under way. One that failed can. */
export const discardable = (row: Pick<DraftRowOut, 'send_state'>) => row.send_state !== 'held' && row.send_state !== 'sending';

/** What a selection of drafts offers: Discard for those that can go, and how many ("Discard 2"). */
export const draftOffers = (rows: Pick<DraftRowOut, 'send_state'>[]): {discard: number} => ({discard: rows.filter(discardable).length});

/** Discard's toast: "Draft discarded", or "Discarded 3 drafts". */
export const discardedLine = (n: number) => counted(n, 'Draft discarded', m => `Discarded ${m} drafts`);

/** What the server refused to discard, before the reason. */
export const discardFailedLine = (n: number) => counted(n, 'Couldn\'t discard the draft', m => `Couldn't discard ${m} drafts`);

/** Undo, when not every draft came back: how many did, of how many it was starting again. */
export const broughtBackLine = (back: number, of: number) => (back > 0 ? `Brought back ${back} of ${of} drafts`
  : counted(of, 'Couldn\'t bring the draft back', () => 'Couldn\'t bring the drafts back'));
