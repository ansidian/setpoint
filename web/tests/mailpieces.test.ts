// SV-274 (D564): the agenda rail's USPS Informed Delivery row, as tables: how many thumbnails fit
// and what the "+N" tile holds, the viewer's steps stopping at the ends, and the section's line.
import {expect, test} from 'vitest';
import {MAIL_GAP, MAIL_TILE, mailLine, mailStrip, stepScan} from '../src/logic/mailpieces.ts';

// Room for exactly `n` tiles.
const room = (n: number) => n * MAIL_TILE + (n - 1) * MAIL_GAP;

test.each([
  ['all fit', room(5), 3, {shown: 3, more: 0}],
  ['exactly as many as fit', room(5), 5, {shown: 5, more: 0}],
  ['one more than fits: four, then "+2"', room(5), 6, {shown: 4, more: 2}],
  ['many more: four, then "+8"', room(5), 12, {shown: 4, more: 8}],
  ['a pixel short of five', room(5) - 1, 5, {shown: 3, more: 2}],
  ['room for one: just "+N"', room(1), 3, {shown: 0, more: 3}],
  ['no room measured yet', 0, 2, {shown: 0, more: 2}],
  ['nothing to show', room(5), 0, {shown: 0, more: 0}],
])('the row: %s', (_name, width, count, expected) => {
  expect(mailStrip(width, count)).toEqual(expected);
});

test.each([
  ['forward', 2, 1, 5, 3],
  ['back', 2, -1, 5, 1],
  ['stops at the last', 4, 1, 5, 4],
  ['stops at the first', 0, -1, 5, 0],
  ['one scan stays put', 0, 1, 1, 0],
])('the viewer steps %s', (_name, at, step, count, expected) => {
  expect(stepScan(at, step, count)).toBe(expected);
});

test.each([
  [4, 4, '4 pieces'],
  [1, 1, '1 piece'],
  [3, 2, '3 pieces · 1 without a picture'],
])('%s pieces with %s pictures read "%s"', (pieces, scans, expected) => {
  expect(mailLine(pieces, scans)).toBe(expected);
});
