// The mail lists' overlay thumb as a table: its height, its place, and none when nothing scrolls.
import {describe, expect, test} from 'vitest';
import {thumbPlace} from '../src/app/ScrollThumb.tsx';

describe('the list\'s thumb', () => {
  test.each([
    ['nothing to scroll', 0, 600, 600, null],
    ['at the top, half in view', 0, 1200, 600, {size: 297, top: 3}],
    ['at the end, half in view', 600, 1200, 600, {size: 297, top: 300}],
    ['halfway', 300, 1200, 600, {size: 297, top: 151.5}],
    ['a long list keeps its least height', 0, 100_000, 600, {size: 32, top: 3}],
    ['scrolled past the end (a bounce)', 900, 1200, 600, {size: 297, top: 300}],
    ['scrolled above the top (a bounce)', -40, 1200, 600, {size: 297, top: 3}],
  ] as const)('%s', (_name, scrollTop, scrollHeight, clientHeight, expected) => expect(thumbPlace(scrollTop, scrollHeight, clientHeight)).toEqual(expected));
});
