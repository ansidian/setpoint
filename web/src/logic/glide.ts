// The floating detail's glide as pure rules (DESIGN.md › The glide; design-export/motion/glide.json;
// board 12c): its duration by distance, the position curve with its ~3% overshoot, the overshoot
// shrinking to the room left at the grid's edges (decision 47, override 1), a retarget that keeps
// the card's position and velocity, and the new content's 6 px slide in the direction of travel.
// Every figure comes from the token module; the motion itself runs in app/calendar/detail/.
import {glide} from '../tokens.ts';
import type {Rect} from './calendar.ts';
import type {Point, Size} from './placement.ts';

/** `min(380, 280 + 40 × distance / 400)` ms, to the nearest ms: 454 px → 325, 1,000 → 380. */
export function glideDuration(distance: number): number {
  return Math.round(Math.min(glide.capMs, glide.baseMs + glide.perStepMs * Math.abs(distance) / glide.stepPx));
}

/** The four numbers of a CSS `cubic-bezier(x1, y1, x2, y2)`. */
export function parseCubicBezier(css: string): [number, number, number, number] {
  const match = /^cubic-bezier\(([^)]*)\)$/.exec(css.replace(/\s/g, ''));
  const numbers = match?.[1]!.split(',').map(Number) ?? [];
  if (numbers.length !== 4 || numbers.some(Number.isNaN)) throw new Error(`Not a cubic-bezier(): ${css}`);
  return numbers as [number, number, number, number];
}

/** A CSS timing function as `progress(time)`, both 0–1, as the browser draws it. */
export function cubicBezier([x1, y1, x2, y2]: [number, number, number, number]): (time: number) => number {
  const bez = (a: number, b: number, s: number) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  const slope = (a: number, b: number, s: number) => 3 * (1 - s) * (1 - s) * a + 6 * (1 - s) * s * (b - a) + 3 * s * s * (1 - b);
  return time => {
    if (time <= 0) return 0;
    if (time >= 1) return 1;
    // Newton's method on x(s) = time, then bisection if it strays.
    let s = time;
    for (let step = 0; step < 8; step += 1) {
      const error = bez(x1, x2, s) - time;
      if (Math.abs(error) < 1e-7) return bez(y1, y2, s);
      const d = slope(x1, x2, s);
      if (Math.abs(d) < 1e-6) break;
      s -= error / d;
    }
    let low = 0;
    let high = 1;
    s = time;
    for (let step = 0; step < 40; step += 1) {
      const x = bez(x1, x2, s);
      if (Math.abs(x - time) < 1e-7) break;
      if (x < time) low = s;
      else high = s;
      s = (low + high) / 2;
    }
    return bez(y1, y2, s);
  };
}

/** The glide's position curve, `cubic-bezier(.22, 1.3, .36, 1)`. */
export const glideEase = cubicBezier(parseCubicBezier(glide.easing));
/** The standard curve, for height and content. */
export const standardEase = (css: string) => cubicBezier(parseCubicBezier(css));

/** How far past the target the curve carries the card at its peak, as a share of the travel (≈3%). */
export const GLIDE_PEAK = (() => {
  let peak = 1;
  for (let step = 0; step <= 1000; step += 1) peak = Math.max(peak, glideEase(step / 1000));
  return peak - 1;
})();

/**
 * The overshoot an axis is allowed near an edge (decision 47): the curve's own (≈3% of `travel`)
 * where there's room, else only the `room` left between the card at rest and the grid's edge in
 * the direction of travel, so it settles there with less bounce. Never negative.
 */
export function edgeOvershoot(travel: number, room: number): number {
  return Math.max(0, Math.min(GLIDE_PEAK * Math.abs(travel), room));
}

/** The room past the target before the grid's edge, per axis, in the direction of travel. */
export function roomPast(from: Point, to: Point, size: Size, bounds: Rect): {x: number; y: number} {
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  return {
    x: dx > 0 ? bounds.left + bounds.width - (to.left + size.width) : dx < 0 ? to.left - bounds.left : 0,
    y: dy > 0 ? bounds.top + bounds.height - (to.top + size.height) : dy < 0 ? to.top - bounds.top : 0,
  };
}

/** One glide from where the card is (and how fast it's moving) to where it rests. */
export interface GlideSegment {
  from: Point;
  to: Point;
  // px per ms when it starts: a retarget carries the card's velocity on.
  velocity: {x: number; y: number};
  duration: number;
  // The share of the curve's overshoot each axis keeps at the edges (0–1).
  overshoot: {x: number; y: number};
}

/** A glide from `from` to `to`, its duration by distance and its overshoot clamped at the grid's edges. */
export function glideSegment(from: Point, to: Point, size: Size, bounds: Rect, velocity = {x: 0, y: 0}): GlideSegment {
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const room = roomPast(from, to, size, bounds);
  const share = (travel: number, space: number) => (travel === 0 || GLIDE_PEAK === 0 ? 0 : edgeOvershoot(travel, space) / (GLIDE_PEAK * Math.abs(travel)));
  return {from, to, velocity, duration: glideDuration(Math.hypot(dx, dy)), overshoot: {x: share(dx, room.x), y: share(dy, room.y)}};
}

/**
 * The card's place `elapsed` ms into a glide: along the curve from `from` to `to`, the part past
 * the target scaled to its edge's share, plus the velocity it started with, fading out so it rests
 * exactly at `to`.
 */
export function glidePosition(segment: GlideSegment, elapsed: number): Point {
  const {from, to, velocity, duration, overshoot} = segment;
  if (elapsed >= duration) return {...to};
  const u = Math.max(0, elapsed) / duration;
  const eased = glideEase(u);
  const along = (share: number) => Math.min(eased, 1) + share * Math.max(eased - 1, 0);
  // Momentum: starts at the carried velocity, decays over a few frames and is gone at rest.
  const tau = glide.retargetMomentumMs;
  const carry = tau * (1 - Math.exp(-Math.max(0, elapsed) / tau)) * (1 - u) * (1 - u);
  return {
    left: from.left + (to.left - from.left) * along(overshoot.x) + velocity.x * carry,
    top: from.top + (to.top - from.top) * along(overshoot.y) + velocity.y * carry,
  };
}

/** The card's velocity (px per ms) `elapsed` ms into a glide, for a retarget to carry on. */
export function glideVelocity(segment: GlideSegment, elapsed: number): {x: number; y: number} {
  if (elapsed >= segment.duration) return {x: 0, y: 0};
  const step = 1;
  const before = glidePosition(segment, Math.max(0, elapsed - step));
  const after = glidePosition(segment, elapsed + step);
  const span = elapsed + step - Math.max(0, elapsed - step);
  return {x: (after.left - before.left) / span, y: (after.top - before.top) / span};
}

/** Where the new content starts its 6 px slide: behind it, against the direction of travel. */
export function contentSlideFrom(from: Point, to: Point): {x: number; y: number} {
  const dx = to.left - from.left;
  const dy = to.top - from.top;
  const length = Math.hypot(dx, dy);
  if (length === 0) return {x: 0, y: 0};
  return {x: -dx / length * glide.newContentSlidePx, y: -dy / length * glide.newContentSlidePx};
}
