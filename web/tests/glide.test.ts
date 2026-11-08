// The glide as tables (DESIGN.md › The glide; board 12c): the overshoot clamped at the grid's edges
// (decision 47, override 1), and where the card starts, how it moves and where it rests.
import {describe, expect, test} from 'vitest';
import type {Rect} from '../src/logic/calendar.ts';
import {edgeOvershoot, GLIDE_PEAK, glidePosition, glideSegment, glideVelocity, roomPast} from '../src/logic/glide.ts';

const GRID: Rect = {left: 0, top: 30, width: 1029, height: 964};
const CARD = {width: 280, height: 280};

describe('the overshoot clamps at the grid\'s edges (decision 47): near one it shrinks to the room left', () => {
  test.each([
    ['plenty of room: the full 3%', 724, 100, 21.66],
    ['12b: 13 px left before the right pane', 724, 13, 13],
    ['already past it: none', 724, -4, 0],
    ['travel left or up counts the same', -724, 5, 5],
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

describe('position and velocity', () => {
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
});
