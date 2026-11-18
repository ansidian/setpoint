// Selecting several emails or drafts. ⌘ or Ctrl-click adds a row or takes it out, and the first one
// takes the open one too. ⇧-click adds every row from the last one clicked (or the open one) to this
// one. ⌘A (Ctrl-A) selects every row the list holds now, and again after more load. The selection
// pane stacks them as reader cards, one in front (`stacked`). This file also
// has what the selection's tools and menu offer, from its rows (Reply, Reply all and Forward on a few
// emails only), and how Drafts' Discard counts in its toasts.
import type {DraftRowOut, MessageRowOut} from '@setpoint/shared';
import type {Stop} from './inbox.ts';
import {readerActions} from './reader.ts';

export interface Selection {
  ids: number[];
  // The email a ⇧-click's range starts from: the last one clicked.
  anchor: number | null;
  // The pane's stack, front first, as the user has made it: what's selected joins at the front and a
  // strip clicked swaps places with the front card. Selected ones it lacks follow in `ids`' order.
  stack?: number[];
}

export const NO_SELECTION: Selection = {ids: [], anchor: null};

/** The list's emails in order, each once (a pinned email can show on the shelf and in its day). */
function rowIds(stops: Stop[]): number[] {
  return [...new Set(stops.flatMap(stop => (stop.kind === 'row' ? [stop.id] : [])))];
}

/** The stack as it stands: its own order for what it has, then the rest of `ids` in their order. */
function order(selection: Selection): number[] {
  const kept = (selection.stack ?? []).filter(id => selection.ids.includes(id));
  return [...kept, ...selection.ids.filter(id => !kept.includes(id))];
}

/** `front` ahead of the stack, each once, only what `ids` holds. */
const restacked = (front: number[], selection: Selection, ids: number[]) => [...new Set([...front, ...order(selection)])].filter(id => ids.includes(id));

/** ⌘-click on `id`: in (at the stack's front), or out if it was in. The first one takes the open email too. */
export function toggled(selection: Selection, id: number, open: number | null): Selection {
  if (!selection.ids.length) {
    const ids = open !== null && open !== id ? [open, id] : [id];
    return {ids, anchor: id, stack: restacked([id], selection, ids)};
  }
  const ids = selection.ids.includes(id) ? selection.ids.filter(one => one !== id) : [...selection.ids, id];
  return {ids, anchor: id, stack: restacked(ids.includes(id) ? [id] : [], selection, ids)};
}

/** ⇧-click on `id`: every email from the anchor (else the open email) to it, added to what's selected, `id` in front and the rest of the range behind it in the list's order. */
export function ranged(selection: Selection, stops: Stop[], id: number, open: number | null): Selection {
  const rows = rowIds(stops);
  const to = rows.indexOf(id);
  if (to < 0) return selection;
  const start = selection.anchor ?? open;
  const from = start === null ? -1 : rows.indexOf(start);
  const span = from < 0 ? [id] : rows.slice(Math.min(from, to), Math.max(from, to) + 1);
  const added = span.filter(one => !selection.ids.includes(one));
  const listed = [...selection.ids, ...added];
  // The open email the range started from is selected too, as the first ⌘-click takes it.
  const ids = open !== null && from >= 0 && start === open && !listed.includes(open) ? [open, ...listed] : listed;
  return {ids, anchor: selection.anchor ?? start ?? id, stack: restacked([id, ...added], selection, ids)};
}

/** ⌘A: every email the list holds now, in its order; the anchor and the stack stay, the rest behind it. A second ⌘A changes nothing. */
export function selectedAll(selection: Selection, stops: Stop[]): Selection {
  const ids = rowIds(stops);
  return {ids, anchor: selection.anchor, stack: restacked([], selection, ids)};
}

/** A strip in the pane's stack, clicked: its card and the front card swap places, and the selection stays. */
export function broughtForward(selection: Selection, id: number): Selection {
  const stack = order(selection);
  const at = stack.indexOf(id);
  if (at <= 0) return selection;
  [stack[0], stack[at]] = [id, stack[0] as number];
  return {...selection, stack};
}

/**
 * The pane's stack, front first: the email last selected, or a strip's swapped forward. After ⌘A
 * from nothing, the list's order, its top-most in front. `selected` is the selection in the list's order.
 */
export const stacked = (selection: Selection, selected: readonly number[]): number[] => order({...selection, ids: [...selected]});

/** An × in the pane's stack: that email leaves the selection and the rest stay in place; the front one's makes way for the card behind it. */
export function dropped(selection: Selection, selected: readonly number[], id: number): Selection {
  const ids = selected.filter(one => one !== id);
  return {...selection, ids, stack: stacked(selection, selected).filter(one => one !== id)};
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
export const discardFailedLine = (n: number) => counted(n, 'Failed to discard', m => `Failed to discard ${m}`);

/** Undo, when not every draft came back: how many did, of how many it was starting again. */
export const broughtBackLine = (back: number, of: number) => (back > 0 ? `Brought back ${back} of ${of} drafts`
  : counted(of, 'Failed to bring it back', () => 'Failed to bring them back'));
