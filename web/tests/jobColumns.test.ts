// The Jobs table's column widths (DESIGN.md › The table, #353; SV-246, D508) as tables: a width
// kept in bounds, the widths a browser kept, a drag or key stopping at Role's floor, and a fit.
import {describe, expect, test} from 'vitest';
import {columnWidth, fitWidth, resizeTo, ROLE_MIN, START_WIDTHS, storedWidths} from '../src/logic/jobColumns.ts';

describe('a column\'s width', () => {
  test.each([
    ['dragged inside the bounds', 'company', 200.4, 200],
    ['narrower than its sorted heading', 'applied', 40, 76],
    ['Status at its floor', 'status', 10, 70],
    ['far too wide', 'company', 5000, 640],
    ['as stored', 'status', '250', 250],
    ['nothing', 'applied', null, 80],
    ['an empty value', 'company', '', 156],
    ['junk', 'status', 'wide', 214],
  ] as const)('%s', (_name, column, width, expected) => expect(columnWidth(column, width)).toBe(expected));
});

describe('the widths this browser kept', () => {
  test.each([
    ['nothing kept: each starts', null, START_WIDTHS],
    ['all three', '{"company":200,"applied":90,"status":300}', {company: 200, applied: 90, status: 300}],
    ['one kept, the rest start', '{"applied":100}', {company: 156, applied: 100, status: 214}],
    ['one unreadable, the others kept', '{"company":"x","applied":100,"status":20}', {company: 156, applied: 100, status: 70}],
    ['not JSON', '{oops', START_WIDTHS],
    ['not an object', '[1,2,3]', START_WIDTHS],
  ] as const)('%s', (_name, text, expected) => expect(storedWidths(text)).toEqual(expected));
});

describe('a drag, a key or a fit stops where Role would go under its floor', () => {
  test.each([
    ['room to spare: as asked', 'company', 220, 156, 400, 220],
    ['Role at its floor plus 30: 30 more at most', 'status', 400, 214, ROLE_MIN + 30, 244],
    ['Role already at its floor: no wider', 'applied', 120, 80, ROLE_MIN, 80],
    ['Role squeezed under its floor: no wider, but it may narrow', 'applied', 77, 80, 90, 77],
    ['narrowing never goes under the heading', 'company', 10, 156, 400, 86],
  ] as const)('%s', (_name, column, wanted, now, role, expected) => expect(resizeTo(column, wanted, now, role)).toBe(expected));
});

describe('a fit', () => {
  test.each([
    ['the widest cell, a pixel over', 'company', [120, 237.2, 98], 85, 239],
    ['the heading, when it is wider than every cell', 'applied', [42, 38], 75, 76],
    ['no rows: the heading', 'status', [], 69, 70],
    ['a cell past the most a fit gives', 'status', [900], 69, 640],
  ] as const)('%s', (_name, column, cells, heading, expected) => expect(fitWidth(column, [...cells], heading)).toBe(expected));
});
