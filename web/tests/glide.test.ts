// The glide as tables (DESIGN.md › The glide; design-export/motion/glide.json; board 12c): its
// duration by distance, the curve's keyframes, the overshoot clamped at the grid's edges (decision
// 47, override 1), a retarget keeping position and velocity, and the content's 6 px slide.
import {describe, expect, test} from 'vitest';
import type {Rect} from '../src/logic/calendar.ts';
import {
  contentSlideFrom, cubicBezier, edgeOvershoot, GLIDE_PEAK, glideDuration, glideEase, glidePosition, glideSegment, glideVelocity, parseCubicBezier, roomPast,
} from '../src/logic/glide.ts';
import {glide} from '../src/tokens.ts';

const GRID: Rect = {left: 0, top: 30, width: 1029, height: 964};
const CARD = {width: 280, height: 280};

describe('duration: min(380, 280 + 40 × distance / 400) ms', () => {
  test.each([
    [0, 280], [100, 290], [454, 325], [600, 340], [724, 352], [1000, 380], [1400, 380], [-454, 325],
  ])('%i px → %i ms', (distance, ms) => expect(glideDuration(distance)).toBe(ms));
});

describe('the curve, cubic-bezier(.22, 1.3, .36, 1), against board 12c\'s keyframes at 352 ms', () => {
  test('it parses from the token module', () => expect(parseCubicBezier(glide.easing)).toEqual([0.22, 1.3, 0.36, 1]));
  test.each([
    // 60 ms: "74% of the travel done"; 185 ms: "22 px past B, the peak (+3%)"; 220 ms: "18 px past B".
    [60, 0.736, 0.01], [185, 1.03, 0.002], [220, 1.025, 0.002], [352, 1, 0],
  ])('at %i ms it is at %f of the travel', (ms, share, within) => expect(Math.abs(glideEase(ms / 352) - share)).toBeLessThanOrEqual(within));
  test('the peak is about 3% (22 px of 724)', () => {
    expect(GLIDE_PEAK).toBeGreaterThan(0.029);
    expect(GLIDE_PEAK).toBeLessThan(0.031);
    expect(Math.round(GLIDE_PEAK * 724)).toBe(22);
  });
  test('the standard curve never overshoots', () => {
    const ease = cubicBezier(parseCubicBezier('cubic-bezier(.2,0,0,1)'));
    for (let step = 0; step <= 100; step += 1) expect(ease(step / 100)).toBeLessThanOrEqual(1);
  });
});

describe('the overshoot clamps at the grid\'s edges (decision 47): near one it shrinks to the room left', () => {
  test.each([
    ['plenty of room: the full 3%', 724, 100, 21.66],
    ['12b: 13 px left before the right pane', 724, 13, 13],
    ['9 px left', 454, 9, 9],
    ['flush with the edge: none', 724, 0, 0],
    ['already past it: none', 724, -4, 0],
    ['travel left or up counts the same', -724, 5, 5],
    ['a short hop near an edge keeps its own small bounce', 100, 50, 2.99],
    ['no travel, no overshoot', 0, 50, 0],
  ])('%s', (_, travel, room, overshoot) => expect(edgeOvershoot(travel, room)).toBeCloseTo(overshoot, 1));

  test.each([
    ['to the right: up to the grid\'s right edge', {left: 12, top: 144}, {left: 736, top: 153}, {x: 13, y: 561}],
    ['to the left: up to its left edge', {left: 736, top: 153}, {left: 12, top: 144}, {x: 12, y: 114}],
    ['straight up: no room across', {left: 742, top: 607}, {left: 742, top: 153}, {x: 0, y: 123}],
  ])('the room past the target %s', (_, from, to, room) => expect(roomPast(from, to, CARD, GRID)).toEqual(room));

  test('12b\'s glide from Dentist to Dinner with Sam never crosses into the right pane', () => {
    const segment = glideSegment({left: 12, top: 144}, {left: 736, top: 153}, CARD, GRID);
    expect(segment.duration).toBe(352);
    let furthest = 0;
    for (let ms = 0; ms <= segment.duration; ms += 1) furthest = Math.max(furthest, glidePosition(segment, ms).left + CARD.width);
    expect(furthest).toBeLessThanOrEqual(1029);
    // It still bounces: it passes its rest and comes back.
    expect(furthest).toBeGreaterThan(1016 + 10);
  });

  test('with room, the bounce is the curve\'s whole 3%', () => {
    const segment = glideSegment({left: 600, top: 600}, {left: 300, top: 600}, CARD, GRID);
    let least = Infinity;
    for (let ms = 0; ms <= segment.duration; ms += 1) least = Math.min(least, glidePosition(segment, ms).left);
    expect(least).toBeCloseTo(300 - 300 * GLIDE_PEAK, 0);
  });
});

describe('position, velocity and retargeting', () => {
  const segment = glideSegment({left: 12, top: 144}, {left: 736, top: 153}, CARD, GRID);
  test('it starts where the card is and rests exactly at the target', () => {
    expect(glidePosition(segment, 0)).toEqual({left: 12, top: 144});
    expect(glidePosition(segment, 352)).toEqual({left: 736, top: 153});
    expect(glidePosition(segment, 9999)).toEqual({left: 736, top: 153});
  });

  test('it moves fastest at the start and is still at rest', () => {
    expect(glideVelocity(segment, 1).x).toBeGreaterThan(glideVelocity(segment, 100).x);
    expect(glideVelocity(segment, 352)).toEqual({x: 0, y: 0});
  });

  test('a retarget mid-glide starts from the current position with the current velocity', () => {
    const at = 100;
    const here = glidePosition(segment, at);
    const velocity = glideVelocity(segment, at);
    // A third item below and to the left (Career fair, Thu Oct 15).
    const next = glideSegment(here, {left: 589, top: 300}, CARD, GRID, velocity);
    expect(glidePosition(next, 0)).toEqual(here);
    // Its first frames carry the old velocity on (plus its own pull toward the new target).
    const early = glideVelocity(next, 0.5);
    const own = glideVelocity(glideSegment(here, {left: 589, top: 300}, CARD, GRID), 0.5);
    expect(Math.abs(early.x - own.x - velocity.x)).toBeLessThan(0.1 * Math.abs(velocity.x) + 0.01);
    expect(Math.abs(early.y - own.y - velocity.y)).toBeLessThan(0.1 * Math.abs(velocity.y) + 0.01);
    expect(glidePosition(next, next.duration)).toEqual({left: 589, top: 300});
    expect(next.duration).toBe(glideDuration(Math.hypot(589 - here.left, 300 - here.top)));
  });
});

describe('the new content slides 6 px in the direction of travel', () => {
  test.each([
    ['right', {left: 12, top: 144}, {left: 736, top: 144}, {x: -6, y: 0}],
    ['up', {left: 742, top: 607}, {left: 742, top: 153}, {x: 0, y: 6}],
    ['down and left', {left: 300, top: 100}, {left: 0, top: 500}, {x: 3.6, y: -4.8}],
    ['nowhere', {left: 5, top: 5}, {left: 5, top: 5}, {x: 0, y: 0}],
  ])('%s', (_, from, to, start) => {
    const slide = contentSlideFrom(from, to);
    expect(slide.x).toBeCloseTo(start.x, 5);
    expect(slide.y).toBeCloseTo(start.y, 5);
  });
});
