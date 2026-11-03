// Where a right-click's menu opens, as a table (DESIGN.md #248): down and right from the pointer;
// to its left past the window's right, upward past its bottom, and 8 px inside the window always.
import {describe, expect, test} from 'vitest';
import {opensUp, placeMenuAt} from '../src/logic/contextMenu.ts';

const WINDOW = {width: 1677, height: 1050};
const MENU = {width: 220, height: 380};

describe('placeMenuAt', () => {
  test.each([
    ['room on both sides: from the pointer', {x: 400, y: 300}, {left: 400, top: 300, right: false, up: false}],
    ['near the right: to the pointer\'s left', {x: 1600, y: 300}, {left: 1380, top: 300, right: true, up: false}],
    ['near the bottom: upward', {x: 400, y: 900}, {left: 400, top: 520, right: false, up: true}],
    ['the bottom right corner: both', {x: 1600, y: 900}, {left: 1380, top: 520, right: true, up: true}],
    ['at the left edge: kept 8 px in', {x: 2, y: 300}, {left: 8, top: 300, right: false, up: false}],
  ])('%s', (_, point, place) => {
    expect(placeMenuAt(point, MENU, WINDOW)).toEqual(place);
  });

  test('a menu taller than the room above and below: down from the pointer, held inside the bottom', () => {
    expect(placeMenuAt({x: 400, y: 200}, {width: 220, height: 900}, WINDOW)).toEqual({left: 400, top: 142, right: false, up: false});
  });
});

// An anchored menu (a button's, ui/popover.ts) opens upward only when it runs past the room below and
// there's more room above its anchor than below it.
describe('opensUp', () => {
  const ROOM = {top: 0, bottom: 640};
  test.each([
    ['it fits below: down', 400, {top: 200, bottom: 228}, false],
    ['ending exactly at the room\'s foot: down', 640, {top: 200, bottom: 228}, false],
    ['past the foot, more room above: up', 700, {top: 560, bottom: 588}, true],
    ['past the foot, but more room below than above: down', 700, {top: 260, bottom: 288}, false],
  ])('%s', (_, bottom, anchor, up) => expect(opensUp(bottom, anchor, ROOM)).toBe(up));
});
