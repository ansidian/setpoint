// Where an overlay anchored to a calendar item goes (DESIGN.md › The floating detail › Placement,
// #348): 8 px off its item, beside it on the side away from the grid's nearer edge, an item in the
// grid's left half (the first four columns in month) getting it on its right and one in the right half on its left,
// level with it and slid inside the grid. The side never depends on what's around the item, so it can
// be told before the click. The floating detail uses it, and so does every overlay anchored to an item.
// Rewritten from v1's `calendarFloatingDetailPlacement` through the harvest gate (darma SV-14).
import {placement} from '../tokens.ts';
import type {Rect} from './calendar.ts';

export type Side = (typeof placement.sides)[number];

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  left: number;
  top: number;
}

export interface Placement extends Point {
  side: Side;
  // How many other items the card would cover there.
  covers: number;
  // Whether it fits inside the grid on that side; when no side does, the least-overflowing one is
  // slid inside and `fits` is false.
  fits: boolean;
}

/** How close an overlay may come to the grid's edges when it slides along them. */
export const EDGE_MARGIN = placement.gapPx;

const clamp = (value: number, min: number, max: number) => (max < min ? min : Math.min(Math.max(value, min), max));

const intersects = (a: Rect, b: Rect) => a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

/**
 * Slides a box of `size` at `position` inside `bounds` (less `margin`): a dragged card is dropped
 * inside the grid, and a card beside an item slides along its edge to stay in. When the bounds are
 * too small, it keeps to their top left.
 */
export function clampInto(position: Point, size: Size, bounds: Rect, margin: number = EDGE_MARGIN): Point {
  return {
    left: clamp(position.left, bounds.left + margin, bounds.left + bounds.width - margin - size.width),
    top: clamp(position.top, bounds.top + margin, bounds.top + bounds.height - margin - size.height),
  };
}

/** How far a box on a side reaches past the bounds (less `margin`), in px; 0 when it fits. */
function overflow(box: Rect, bounds: Rect, margin: number): number {
  return Math.max(0, bounds.left + margin - box.left) + Math.max(0, box.left + box.width - (bounds.left + bounds.width - margin))
    + Math.max(0, bounds.top + margin - box.top) + Math.max(0, box.top + box.height - (bounds.top + bounds.height - margin));
}

/**
 * The card's place on one side: `gap` off the anchor, centred on it along that edge and slid along
 * the edge to stay inside the bounds. Off the bounds across the edge, it doesn't fit there.
 */
export function onSide(side: Side, anchor: Rect, size: Size, bounds: Rect, gap: number = placement.gapPx, margin: number = EDGE_MARGIN): {box: Rect; overflow: number} {
  const centreX = anchor.left + anchor.width / 2 - size.width / 2;
  const centreY = anchor.top + anchor.height / 2 - size.height / 2;
  const across = {
    right: {left: anchor.left + anchor.width + gap, top: centreY},
    left: {left: anchor.left - gap - size.width, top: centreY},
    above: {left: centreX, top: anchor.top - gap - size.height},
    below: {left: centreX, top: anchor.top + anchor.height + gap},
  }[side];
  const slid = clampInto(across, size, bounds, margin);
  // Along the edge it slides; across it, it stays `gap` off the anchor (or it doesn't fit).
  const point = side === 'right' || side === 'left' ? {left: across.left, top: slid.top} : {left: slid.left, top: across.top};
  const box = {left: Math.round(point.left), top: Math.round(point.top), width: size.width, height: size.height};
  return {box, overflow: overflow(box, bounds, margin)};
}

/** Every side's candidate, in the order tried: for the table tests and for the debugging eye. */
export function candidates(anchor: Rect, size: Size, bounds: Rect, others: Rect[], gap: number = placement.gapPx): Placement[] {
  return placement.sides.map(side => {
    const {box, overflow: over} = onSide(side, anchor, size, bounds, gap);
    return {side, left: box.left, top: box.top, covers: others.filter(other => intersects(box, other)).length, fits: over === 0};
  });
}

/**
 * Where the floating detail goes for an item in the open "+N" popover (#324): beside the popover,
 * right then left, level with the item, so the list stays readable. Where neither side has room,
 * the one short of it least, slid inside the grid over the popover's edge.
 */
export function besidePopover(chip: Rect, popover: Rect, size: Size, bounds: Rect, gap: number = placement.gapPx): Placement {
  const slice = {left: popover.left, width: popover.width, top: chip.top, height: chip.height};
  const [right, left] = (['right', 'left'] as const).map(side => ({side, ...onSide(side, slice, size, bounds, gap)}));
  const best = right!.overflow === 0 || right!.overflow <= left!.overflow ? right! : left!;
  const inside = clampInto(best.box, size, bounds);
  return {side: best.side, left: Math.round(inside.left), top: Math.round(inside.top), covers: 0, fits: best.overflow === 0};
}

/**
 * Where the floating detail goes for a right-pane row (#322): 8 px left of the row, over the grid,
 * its top level with the row's, slid inside the grid along that edge.
 */
export function besideRow(anchor: Rect, size: Size, bounds: Rect, gap: number = placement.gapPx): Placement {
  const at = clampInto({left: anchor.left - gap - size.width, top: anchor.top}, size, bounds);
  const box = {left: Math.round(at.left), top: Math.round(at.top)};
  return {side: 'left', ...box, covers: 0, fits: box.left + size.width <= anchor.left - gap + 0.5};
}

/**
 * Where an overlay anchored to `anchor` goes (#348): right of an item whose centre is in the left
 * half of `bounds` (the middle column with them), left of one in the right half, the other of the
 * two when that side has no room. Short of room on both, the nearer of the two slides inside over
 * the item's edge, as long as it hides no more than half the item or a quarter of the card; past
 * that (a bar across the week, a very narrow grid) it goes below, then above, and failing all, the least-overflowing side
 * slides inside. `others` only counts what the card covers.
 */
export function placeBeside(anchor: Rect, size: Size, bounds: Rect, others: Rect[], gap: number = placement.gapPx): Placement {
  const centre = anchor.left + anchor.width / 2;
  // A pixel's leeway keeps the middle column on the right through fractional widths.
  const leftHalf = centre <= bounds.left + bounds.width / 2 + 1;
  const tried = (leftHalf ? ['right', 'left', 'below', 'above'] as const : ['left', 'right', 'below', 'above'] as const)
    .map(side => ({side, ...onSide(side, anchor, size, bounds, gap)}));
  const result = (chosen: (typeof tried)[number], fits: boolean): Placement => {
    const inside = fits ? chosen.box : {...chosen.box, ...clampInto(chosen.box, size, bounds)};
    const box = {...inside, left: Math.round(inside.left), top: Math.round(inside.top)};
    return {side: chosen.side, left: box.left, top: box.top, covers: others.filter(other => intersects(box, other)).length, fits};
  };
  const [first, second] = tried as [(typeof tried)[number], (typeof tried)[number]];
  if (first.overflow === 0) return result(first, true);
  if (second.overflow === 0) return result(second, true);
  const nearer = second.overflow < first.overflow ? second : first;
  const slid = clampInto(nearer.box, size, bounds);
  const hidden = Math.max(0, Math.min(slid.left + size.width, anchor.left + anchor.width) - Math.max(slid.left, anchor.left));
  if (hidden <= Math.min(anchor.width / 2, size.width / 4)) return result(nearer, false);
  const vertical = tried.slice(2).find(one => one.overflow === 0);
  if (vertical) return result(vertical, true);
  return result(tried.reduce((best, one) => (one.overflow < best.overflow ? one : best)), false);
}
