// The health lines' folds as a table (the polish audit's states-13): which lines fold in, which
// clear with their check, which fold out, and where the going ones stay.
import {describe, expect, test} from 'vitest';
import {CLEARED_MS, lineMovesOn, nextLines} from '../src/logic/stateLines.ts';
import type {LinePhase, ShownLine} from '../src/logic/stateLines.ts';

// A line is its key and whether its going is a recovery (a stale or failing line) or not (the reconnect bar).
type Line = {recovers: boolean};
const shown = (...entries: [string, LinePhase][]): ShownLine<Line>[] => entries.map(([key, phase]) => ({key, line: {recovers: key !== 'reconnect'}, phase}));
const next = (...keys: string[]) => keys.map(key => ({key, line: {recovers: key !== 'reconnect'}}));
const phases = (lines: ShownLine<Line>[]) => lines.map(line => `${line.key}:${line.phase}`);
const clears = (line: Line) => line.recovers;

describe('health lines folding', () => {
  test('a cleared line shows its check for 1.2 s', () => expect(CLEARED_MS).toBe(1200));

  test.each([
    ['nothing changes', shown(['Work', 'here']), next('Work'), ['Work:here']],
    ['a line arrives: it folds in', shown(['Work', 'here']), next('Work', 'iCloud'), ['Work:here', 'iCloud:in']],
    ['one folding in settles on the next change', shown(['Work', 'in']), next('Work'), ['Work:here']],
    ['a failing line clears: it keeps its place, cleared', shown(['Work', 'here'], ['iCloud', 'here']), next('iCloud'), ['Work:cleared', 'iCloud:here']],
    ['the reconnect bar goes: it folds out at once', shown(['reconnect', 'here'], ['Work', 'here']), next('Work'), ['reconnect:out', 'Work:here']],
    ['a cleared line stays cleared, after the line it followed', shown(['Work', 'here'], ['iCloud', 'cleared']), next('Work'), ['Work:here', 'iCloud:cleared']],
    ['one folding out goes on folding', shown(['Work', 'out']), next(), ['Work:out']],
    ['back while it showed its check: it stays', shown(['Work', 'cleared']), next('Work'), ['Work:here']],
    ['back while folding out: it folds in again', shown(['Work', 'out']), next('Work'), ['Work:in']],
    ['every line clears at once', shown(['Personal', 'here'], ['Work', 'here']), next(), ['Personal:cleared', 'Work:cleared']],
  ])('%s', (_name, before, after, expected) => expect(phases(nextLines(before, after, clears))).toEqual(expected));

  test('a moment on: cleared folds out, folded out goes, others stay', () => {
    const lines = shown(['Personal', 'cleared'], ['Work', 'out'], ['iCloud', 'here']);
    expect(phases(lineMovesOn(lines, 'Personal', 'cleared'))).toEqual(['Personal:out', 'Work:out', 'iCloud:here']);
    expect(phases(lineMovesOn(lines, 'Work', 'out'))).toEqual(['Personal:cleared', 'iCloud:here']);
    // A line that came back meanwhile isn't moved on by its old timer.
    expect(phases(lineMovesOn(shown(['Work', 'here']), 'Work', 'cleared'))).toEqual(['Work:here']);
  });
});
