// ⌘K's list as a table: what typing finds, in which sections, and the keyboard cursor.
import {describe, expect, test} from 'vitest';
import {matchedRuns, matches, paletteList, stepCursor} from '../src/logic/palette.ts';
import type {Matchable} from '../src/logic/palette.ts';

const COMMANDS: Matchable[] = [
  {section: 'email', label: 'Done'}, {section: 'email', label: 'Mark unread'},
  {section: 'goto', label: 'Inbox'}, {section: 'goto', label: 'Calendar'},
  {section: 'appearance', label: 'Light', keywords: 'theme'}, {section: 'appearance', label: 'Night', keywords: 'theme dark'},
  {section: 'more', label: 'New event'}, {section: 'more', label: 'New task'}, {section: 'more', label: 'Mark all as read'}, {section: 'more', label: 'Sign out'},
];
const shown = (query: string) => paletteList(COMMANDS, query).map(group => `${group.section}: ${group.items.map(item => item.label).join(', ')}`);

describe('⌘K', () => {
  test.each([
    ['', ['email: Done, Mark unread', 'goto: Inbox, Calendar', 'appearance: Light, Night']],
    ['   ', ['email: Done, Mark unread', 'goto: Inbox, Calendar', 'appearance: Light, Night']],
    ['new', ['more: New event, New task']],
    ['new ev', ['more: New event']],
    ['mark', ['email: Mark unread', 'more: Mark all as read']],
    ['MARK ALL', ['more: Mark all as read']],
    ['dark', ['appearance: Night']],
    ['theme', ['appearance: Light, Night']],
    ['out', ['more: Sign out']],
    ['xyz', []],
  ])('typing %j shows %j', (query, sections) => expect(shown(query)).toEqual(sections));

  test.each([
    ['ark', false], ['a', true], ['all read', true], ['read all', true], ['reads', false],
  ])('"Mark all as read" answers %j: %s', (query, found) => expect(matches({section: 'more', label: 'Mark all as read'}, query)).toBe(found));

  test.each([
    [0, 1, 3, 1], [2, 1, 3, 0], [0, -1, 3, 2], [1, -1, 3, 0], [0, 1, 0, 0],
  ] as const)('the cursor at %i moved %i among %i lands on %i', (cursor, delta, count, at) => expect(stepCursor(cursor, delta, count)).toBe(at));
});

// shell-13: the word prefixes a query matched, marked in its label.
test.each([
  ['News', 'ne', [[0, 2]]],
  ['New event', 'new ev', [[0, 3], [4, 6]]],
  ['Settings › News', 'ne', [[11, 13]]],
  ['Mark all as read', 'MA', [[0, 2]]],
  ['Night', 'dark', []],
  ['Inbox · Jobs', '', []],
] as const)('%s matched by "%s"', (label, query, runs) => {
  expect(matchedRuns(label, query).map(run => [run.start, run.end])).toEqual(runs);
});
