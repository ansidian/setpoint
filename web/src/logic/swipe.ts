// A row's swipe on the phone, as the iOS app's: right for the leading actions, left for the
// trailing ones. A short drag settles back; a drag past half a button rests open on the buttons;
// a drag past the full-swipe line runs the first action on that side when it's let go. A press
// that starts within EDGE of the screen's left edge is Safari's Back, never the row's. Which way a
// drag goes is decided once it has moved SLOP: sideways is the row's, up or down the list's scroll.
// The Inbox's rows: right marks read or unread, left offers Trash, Done (Attention mail not yet
// Done) and Pin or Unpin, Trash first.
import type {MessageRowOut} from '@setpoint/shared';
import {readerActions} from './reader.ts';

/** How close to the screen's left edge a press is Safari's Back. */
export const EDGE = 24;
/** How far a press moves before it's a drag one way or the other. */
export const SLOP = 10;
/** Each revealed action's width. */
export const BUTTON = 76;

export type SwipeSide = 'lead' | 'trail';

/** Whether a press at `x` (from the screen's left) can start a row's swipe. */
export const swipeStarts = (x: number) => x >= EDGE;

/** Which way a drag of (dx, dy) goes: undecided under SLOP, then sideways (the row's) or not (the scroll's). */
export function swipeAxis(dx: number, dy: number): 'x' | 'y' | null {
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return null;
  return Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
}

/** Where a full swipe runs the first action: past every button and half of one more, and at least 55% of the row. */
export const fullAt = (count: number, width: number) => Math.max(count * BUTTON + BUTTON / 2, width * 0.55);

/** The row's offset for a drag `dx` from `base` (where it rested): none toward a side with no actions, at most the row's width. */
export function swipeOffset(base: number, dx: number, counts: {lead: number; trail: number}, width: number): number {
  const at = base + dx;
  if (at > 0) return counts.lead ? Math.min(at, width) : 0;
  if (at < 0) return counts.trail ? Math.max(at, -width) : 0;
  return 0;
}

/** Whether a drag at `offset` has passed the full-swipe line, so letting go runs the first action. */
export function swipeArmed(offset: number, counts: {lead: number; trail: number}, width: number): boolean {
  const count = offset > 0 ? counts.lead : counts.trail;
  return offset !== 0 && count > 0 && Math.abs(offset) >= fullAt(count, width);
}

/** What letting go at `offset` does: run the first action on its side, or rest (0 closed, else open on the buttons). */
export function swipeRelease(offset: number, counts: {lead: number; trail: number}, width: number): {run: SwipeSide} | {rest: number} {
  if (offset === 0) return {rest: 0};
  const side: SwipeSide = offset > 0 ? 'lead' : 'trail';
  const count = counts[side];
  if (swipeArmed(offset, counts, width)) return {run: side};
  if (Math.abs(offset) < BUTTON / 2) return {rest: 0};
  return {rest: (side === 'lead' ? 1 : -1) * count * BUTTON};
}

export type RowSwipe = 'read' | 'unread' | 'trash' | 'done' | 'pin' | 'unpin';

/**
 * An Inbox row's swipes: leading Mark read (unread mail) or Mark unread; trailing Trash, then Done
 * on Attention mail not yet Done, then Pin or Unpin (none on snoozed or sent mail). The first of
 * each side is what a full swipe runs.
 */
export function rowSwipes(row: Pick<MessageRowOut, 'unread' | 'lane' | 'kind' | 'done' | 'pinned' | 'snoozed_until' | 'sent_only'>): {lead: RowSwipe[]; trail: RowSwipe[]} {
  const pins = !row.snoozed_until && !row.sent_only;
  return {
    lead: row.sent_only ? [] : [row.unread ? 'read' : 'unread'],
    trail: ['trash', ...(readerActions(row).done ? ['done' as const] : []), ...(pins ? [row.pinned ? 'unpin' as const : 'pin' as const] : [])],
  };
}
