// Where an overlay anchored to a calendar item goes (DESIGN.md › The floating detail › Placement,
// and override 7): 8 px off its item, on the side covering the fewest other items, trying right,
// left, above and below in that order (right first on a tie), inside the month grid. The floating
// detail uses it, and so will every overlay anchored to an item (F6's recurring-drop prompt).
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
 * Where an overlay anchored to `anchor` goes: of the sides it fits on inside `bounds`, the one
 * covering the fewest of `others` (the anchor itself left out), the earlier side in
 * right, left, above, below winning a tie. If it fits on no side, the side it overflows least,
 * slid inside the bounds.
 */
export function placeBeside(anchor: Rect, size: Size, bounds: Rect, others: Rect[], gap: number = placement.gapPx): Placement {
  const all = candidates(anchor, size, bounds, others, gap);
  const fitting = all.filter(candidate => candidate.fits);
  if (fitting.length) return fitting.reduce((best, candidate) => (candidate.covers < best.covers ? candidate : best));
  const least = placement.sides
    .map(side => ({side, ...onSide(side, anchor, size, bounds, gap)}))
    .reduce((best, candidate) => (candidate.overflow < best.overflow ? candidate : best));
  const inside = clampInto(least.box, size, bounds);
  const box = {...least.box, left: Math.round(inside.left), top: Math.round(inside.top)};
  return {side: least.side, left: box.left, top: box.top, covers: others.filter(other => intersects(box, other)).length, fits: false};
}
