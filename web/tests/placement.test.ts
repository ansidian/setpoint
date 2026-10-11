// Placement as tables (DESIGN.md › The floating detail › Placement, override 7): the side covering
// the fewest other items, right, left, above, below with right first on a tie, 8 px off the item,
// inside the month grid. The month is October 2026 on the seed as boards 12a and 12b draw it, so
// the boards' own counts ("right 5, left 3, above 4 and it doesn't fit, below 6") are the table.
import {describe, expect, test} from 'vitest';
import type {Rect} from '../src/logic/calendar.ts';
import {candidates, clampInto, placeBeside} from '../src/logic/placement.ts';
import type {Side} from '../src/logic/placement.ts';

// The month section at 1677 × 1050: 1029 wide, 994 high, the grid under the 30 px weekday row.
const GRID: Rect = {left: 0, top: 30, width: 1029, height: 964};
const COLUMN = 147;
const ROW = 176;

/** A chip's box in the section: column, row (Sep 28 – Oct 4 is row 0) and its place in the cell. */
const chip = (column: number, row: number, index: number): Rect => ({
  left: column * COLUMN + 6, top: 30 + row * ROW + 6 + 22 + 3 + index * 23, width: column === 6 ? 135 : 134, height: 20,
});

// The seed's October, by [column, row, how many items in the cell].
const DAYS: [number, number, number][] = [
  [0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1], [4, 0, 1],
  [0, 1, 2], [1, 1, 1], [2, 1, 4], [3, 1, 2], [4, 1, 3],
  [0, 2, 1], [1, 2, 1], [2, 2, 1], [3, 2, 2], [4, 2, 1],
  [0, 3, 1], [1, 3, 1], [2, 3, 1], [3, 3, 1], [4, 3, 1],
  [0, 4, 1], [1, 4, 1], [2, 4, 1], [3, 4, 1], [4, 4, 1],
  [0, 5, 1], [1, 5, 1], [2, 5, 1], [3, 5, 1], [4, 5, 1],
];
const ITEMS = DAYS.flatMap(([column, row, count]) => Array.from({length: count}, (_, index) => chip(column, row, index)));
const others = (anchor: Rect) => ITEMS.filter(item => item !== anchor && !(item.left === anchor.left && item.top === anchor.top));

const DENTIST = chip(2, 1, 1);
const DINNER = chip(4, 1, 2);
const CARD = (height: number) => ({width: 280, height});

describe('every side, counted as the boards count them', () => {
  test.each<[string, Rect, number, Record<Side, [covers: number, fits: boolean]>]>([
    // Board 12a: "right 5, left 3, above 4 (and it doesn't fit under the day row), below 6. Left wins."
    // Above counts 6 here (Sep 29 – Oct 1 and Oct 6 – 8 under it); it doesn't fit either way.
    ['Dentist (12a)', DENTIST, 252, {right: [5, true], left: [3, true], above: [6, false], below: [6, true]}],
    // Board 12b: "right 0 … Left would cover 8, below 5; above doesn't fit under the day row."
    ['Dinner with Sam (12b)', DINNER, 280, {right: [0, true], left: [8, true], above: [6, false], below: [5, true]}],
  ])('%s', (_, anchor, height, expected) => {
    const sides = Object.fromEntries(candidates(anchor, CARD(height), GRID, others(anchor)).map(one => [one.side, [one.covers, one.fits]]));
    expect(sides).toEqual(expected);
  });
});

describe('the chosen side', () => {
  test.each<[string, Rect, {width: number; height: number}, Rect[] | null, {side: Side; left: number; top: number; fits?: boolean}]>([
    // 12a: left of Dentist, 8 px off its chip and centred on it, at 12, 144.
    ['Dentist: left beats right, and above doesn\'t fit (override 7)', DENTIST, CARD(252), null, {side: 'left', left: 12, top: 144}],
    // As the card is drawn (254 tall, not the 252 the board's comment assumes), centred it's at 143.
    ['Dentist with the card as drawn', DENTIST, CARD(254), null, {side: 'left', left: 12, top: 143}],
    // 12b: right of Dinner over the empty weekend, at 736, 153 (152 for the 282 px card as drawn).
    ['Dinner with Sam: right, covering nothing', DINNER, CARD(280), null, {side: 'right', left: 736, top: 153}],
    ['a tie goes to the earlier side: right first', chip(1, 3, 0), CARD(200), [], {side: 'right', left: 153 + 134 + 8, top: 0}],
    ['an item in the Sunday column has no room right: left', chip(6, 2, 0), CARD(200), [], {side: 'left', left: 888 - 8 - 280, top: 0}],
    ['a Monday item with the column beside it full: above', chip(0, 1, 0),
      CARD(120), [chip(1, 1, 0), chip(1, 1, 1), chip(1, 1, 2), chip(1, 1, 3)], {side: 'above', left: 8, top: 237 - 8 - 120}],
    ['… and in the first row, with no room above: below', chip(0, 0, 0),
      CARD(120), [chip(1, 0, 0), chip(1, 0, 1), chip(1, 0, 2), chip(1, 0, 3)], {side: 'below', left: 8, top: 61 + 20 + 8}],
    ['near the bottom, a card beside the item slides up to stay inside', chip(3, 5, 0), CARD(300), [], {side: 'right', left: 0, top: 994 - 8 - 300}],
    ['near the top, it slides down below the weekday row', chip(3, 0, 0), CARD(300), [], {side: 'right', left: 0, top: 30 + 8}],
  ])('%s', (_, anchor, size, list, expected) => {
    const place = placeBeside(anchor, size, GRID, list ?? others(anchor));
    expect(place.side).toBe(expected.side);
    if (expected.left) expect(place.left).toBe(expected.left);
    if (expected.top) expect(place.top).toBe(expected.top);
    expect(place.fits).toBe(expected.fits ?? true);
  });

  test('right is 8 px off the chip\'s right edge, left 8 px off its left edge, centred on it', () => {
    const anchor = {left: 300, top: 400, width: 134, height: 20};
    const all = Object.fromEntries(candidates(anchor, CARD(100), GRID, []).map(one => [one.side, one]));
    expect([all.right!.left, all.right!.top]).toEqual([442, 360]);
    expect([all.left!.left, all.left!.top]).toEqual([12, 360]);
    expect([all.above!.left, all.above!.top]).toEqual([227, 292]);
    expect([all.below!.left, all.below!.top]).toEqual([227, 428]);
  });

  test('in a grid too small for any side, the least-overflowing side is slid inside', () => {
    const small: Rect = {left: 0, top: 0, width: 300, height: 200};
    const place = placeBeside({left: 100, top: 90, width: 100, height: 20}, CARD(150), small, []);
    expect(place.fits).toBe(false);
    expect(place.left).toBeGreaterThanOrEqual(8);
    expect(place.top).toBeGreaterThanOrEqual(8);
    expect(place.top + 150).toBeLessThanOrEqual(192);
  });
});

describe('a dragged card is dropped inside the grid, up to its edges', () => {
  test.each([
    ['where it is, when inside (12d\'s drop)', {left: 742, top: 607}, {left: 742, top: 607}],
    ['off the left edge', {left: -40, top: 300}, {left: 0, top: 300}],
    ['into the right pane', {left: 900, top: 300}, {left: 1029 - 280, top: 300}],
    ['over the weekday row', {left: 300, top: 0}, {left: 300, top: 30}],
    ['off the bottom', {left: 300, top: 900}, {left: 300, top: 994 - 252}],
  ])('%s', (_, position, expected) => expect(clampInto(position, CARD(252), GRID, 0)).toEqual(expected));

  test('the same drop clamps differently as the grid narrows (v1\'s live-rect rule)', () => {
    expect(clampInto({left: 1000, top: 300}, CARD(252), GRID, 0).left).toBe(749);
    expect(clampInto({left: 1000, top: 300}, CARD(252), {...GRID, width: 900}, 0).left).toBe(620);
  });

  test('beside an item it keeps 8 px from the edges as it slides', () => {
    expect(clampInto({left: -40, top: 0}, CARD(252), GRID)).toEqual({left: 8, top: 38});
  });
});
