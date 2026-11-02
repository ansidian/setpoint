// The state lines' folds as a table (the polish audit's states-13): which lines fold in, which fold
// out, which show their last words first, and where the going ones stay.
import {describe, expect, test} from 'vitest';
import {lineMovesOn, nextLines} from '../src/logic/stateLines.ts';
import type {LinePhase, ShownLine} from '../src/logic/stateLines.ts';

// A line is its key and whether it has last words to show (the history pass) or not (the rest).
type Line = {holds: boolean};
const shown = (...entries: [string, LinePhase][]): ShownLine<Line>[] => entries.map(([key, phase]) => ({key, line: {holds: key === 'history'}, phase}));
const next = (...keys: string[]) => keys.map(key => ({key, line: {holds: key === 'history'}}));
const phases = (lines: ShownLine<Line>[]) => lines.map(line => `${line.key}:${line.phase}`);
const holds = (line: Line) => line.holds;

describe('state lines folding', () => {
  test.each([
    ['nothing changes', shown(['Work', 'here']), next('Work'), ['Work:here']],
    ['a line arrives: it folds in', shown(['Work', 'here']), next('Work', 'iCloud'), ['Work:here', 'iCloud:in']],
    ['one folding in settles on the next change', shown(['Work', 'in']), next('Work'), ['Work:here']],
    ['a failing line clears: it folds out at once, keeping its place', shown(['Work', 'here'], ['iCloud', 'here']), next('iCloud'), ['Work:out', 'iCloud:here']],
    ['the reconnect bar goes: it folds out at once', shown(['reconnect', 'here'], ['Work', 'here']), next('Work'), ['reconnect:out', 'Work:here']],
    ['the history pass ends: it keeps its place, done', shown(['history', 'here'], ['Work', 'here']), next('Work'), ['history:done', 'Work:here']],
    ['a done line stays done, after the line it followed', shown(['Work', 'here'], ['history', 'done']), next('Work'), ['Work:here', 'history:done']],
    ['one folding out goes on folding', shown(['Work', 'out']), next(), ['Work:out']],
    ['back while it showed its last words: it stays', shown(['history', 'done']), next('history'), ['history:here']],
    ['back while folding out: it folds in again', shown(['Work', 'out']), next('Work'), ['Work:in']],
    ['every line clears at once', shown(['Personal', 'here'], ['Work', 'here']), next(), ['Personal:out', 'Work:out']],
  ])('%s', (_name, before, after, expected) => expect(phases(nextLines(before, after, holds))).toEqual(expected));

  test('a moment on: done folds out, folded out goes, others stay', () => {
    const lines = shown(['history', 'done'], ['Work', 'out'], ['iCloud', 'here']);
    expect(phases(lineMovesOn(lines, 'history', 'done'))).toEqual(['history:out', 'Work:out', 'iCloud:here']);
    expect(phases(lineMovesOn(lines, 'Work', 'out'))).toEqual(['history:done', 'iCloud:here']);
    // A line that came back meanwhile isn't moved on by its old timer.
    expect(phases(lineMovesOn(shown(['history', 'here']), 'history', 'done'))).toEqual(['history:here']);
  });
});
