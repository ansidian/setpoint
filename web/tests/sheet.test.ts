// How far a bottom sheet is dragged down before letting go closes it (logic/sheet.ts), as a table.
import {expect, test} from 'vitest';
import {dragCloses} from '../src/logic/sheet.ts';

test.each([
  // A third of its height…
  [60, 180, true],
  [59, 180, false],
  // … at least 48 px, so a short sheet isn't closed by a wobble…
  [47, 90, false],
  [48, 90, true],
  // … and at most 120 px, so a tall one closes without a long drag.
  [119, 600, false],
  [120, 600, true],
  [0, 300, false],
])('dragged %i px on a %i px sheet closes it: %s', (distance, height, closes) => {
  expect(dragCloses(distance, height)).toBe(closes);
});
