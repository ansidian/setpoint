// Selecting several emails (DESIGN.md #249): ⌘ or Ctrl-click adds a row or takes it out, the first
// one taking the open email too; ⇧-click adds every email from the last one clicked (or the open one)
// to this one; and what the selection's tools and menu offer, from its rows.
import type {MessageRowOut} from '@setpoint/shared';
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

/** ⌘-click on `id`: in, or out if it was in; the first one takes the open email too. */
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

/** What's selected and still in the list, in the list's order: Trash takes an email out, and a search swaps the list. */
export function inListOrder(ids: readonly number[], stops: Stop[]): number[] {
  if (!ids.length) return [];
  return rowIds(stops).filter(id => ids.includes(id));
}

/**
 * What the selection's tools and menu offer: Done for the emails that can be (#93), how many; Pin
 * unless every one is pinned already; Mark read while any is unread, else Mark unread.
 */
export function selectionOffers(rows: MessageRowOut[]): {done: number; pin: boolean; read: boolean} {
  return {
    done: rows.filter(row => readerActions(row).done).length,
    pin: rows.some(row => !row.pinned),
    read: rows.some(row => row.unread),
  };
}

/** "Moved 3 to Trash", or the one email's own words for one. */
export const counted = (n: number, one: string, many: (n: number) => string) => (n === 1 ? one : many(n));
