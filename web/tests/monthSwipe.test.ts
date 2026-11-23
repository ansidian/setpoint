// The phone month picker's sideways swipe as a table: which month a drag turns to, and when it's
// Safari's Back, the sheet's or a tap's instead.
import {expect, test} from 'vitest';
import {MONTH_SWIPE, monthSwipe} from '../src/logic/monthSwipe.ts';

test.each<[string, number, number, number, -1 | 0 | 1]>([
  ['left: the next month', 300, -80, 6, 1],
  ['right: the month before', 60, 80, -6, -1],
  ['left just far enough', 300, -MONTH_SWIPE, 0, 1],
  ['left not far enough: a tap\'s', 300, -MONTH_SWIPE + 1, 0, 0],
  ['inside the slop', 200, 6, 2, 0],
  ['down: the sheet\'s', 200, 30, 90, 0],
  ['as much down as sideways: the sheet\'s', 200, -60, 60, 0],
  ['right from the screen\'s edge: Safari\'s Back', 10, 200, 0, 0],
  ['right from 24 px in: the picker\'s', 24, 200, 0, -1],
])('a drag %s', (_name, startX, dx, dy, turn) => {
  expect(monthSwipe(startX, dx, dy)).toBe(turn);
});
