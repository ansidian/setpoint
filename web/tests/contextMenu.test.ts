// Where a right-click's menu opens, as a table: down and right from the pointer, to its left past
// the window's right, upward past its bottom, and always 8 px inside the window.
import {describe, expect, test} from 'vitest';
import {menuInside, opensUp, placeMenuAt} from '../src/logic/contextMenu.ts';

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

// Once its side is chosen, an anchored menu that would still run out of its room is kept 16 px
// inside it: moved right past the left edge, held shorter (scrolling) past the top or the bottom.
describe('menuInside', () => {
  const ROOM = {top: 100, bottom: 667, left: 0};
  const ANCHOR = {top: 380, bottom: 412};
  test.each([
    ['it fits: as it is', {left: 40, top: 416, height: 200}, false, {shift: 0, maxHeight: null}],
    ['lined up past the left: moved 16 px in', {left: -24, top: 416, height: 200}, false, {shift: 40, maxHeight: null}],
    ['down past the bottom: held 16 px short of it', {left: 40, top: 416, height: 303}, false, {shift: 0, maxHeight: 235}],
    ['up past the top: held 16 px short of it', {left: 40, top: 416, height: 300}, true, {shift: 0, maxHeight: 260}],
    ['ending exactly at the room\'s foot: as it is', {left: 40, top: 416, height: 251}, false, {shift: 0, maxHeight: null}],
  ])('%s', (_, menu, up, inside) => expect(menuInside(menu, up, ANCHOR, ROOM)).toEqual(inside));
});
