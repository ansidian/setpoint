// The list while it changes (logic/fold.ts) as a table. Entries are written "group:career" (a header)
// or "career:4" (email 4's row in Career); after a change "career:4-" folds out and "pinned:4+" folds in.
import {describe, expect, test} from 'vitest';
import {foldList} from '../src/logic/fold.ts';
import type {Entry, Fold, Folded} from '../src/logic/fold.ts';

const entry = (key: string): Entry<string> => ({key, id: key.startsWith('group:') ? null : Number(key.split(':')[1]), item: key});
const written = (key: string): Folded<string> => {
  const fold: Fold = key.endsWith('-') ? 'out' : key.endsWith('+') ? 'in' : null;
  return {...entry(key.replace(/[-+]$/, '')), fold};
};
const shown = (list: Folded<string>[]) => list.map(item => `${item.key}${item.fold === 'out' ? '-' : item.fold === 'in' ? '+' : ''}`);

// Rows of a collapsed group just go; a row may fold in unless its group was collapsed before.
const collapsedAfter = new Set(['noise']);
const rules = {
  folds: (gone: Folded<string>) => !collapsedAfter.has(gone.key.split(':')[gone.id === null ? 1 : 0]!),
  arrives: (item: Entry<string>, was: (key: string) => Folded<string> | undefined) => was(`group:${item.key.split(':')[0]}`)?.item !== 'collapsed',
};

describe('the list while it changes', () => {
  test.each<[string, string[], string[], number[], string[]]>([
    ['nothing changes', ['group:attention', 'attention:1', 'attention:2'], ['group:attention', 'attention:1', 'attention:2'], [],
      ['group:attention', 'attention:1', 'attention:2']],
    ['Done: the row folds out where it was', ['group:attention', 'attention:1', 'attention:2', 'attention:3'], ['group:attention', 'attention:1', 'attention:3'], [],
      ['group:attention', 'attention:1', 'attention:2-', 'attention:3']],
    ['the first row leaves', ['group:attention', 'attention:1', 'attention:2'], ['group:attention', 'attention:2'], [],
      ['group:attention', 'attention:1-', 'attention:2']],
    ['the last row of a group takes its header with it', ['group:attention', 'attention:1', 'group:career', 'career:4'], ['group:attention', 'attention:1'], [],
      ['group:attention', 'attention:1', 'group:career-', 'career:4-']],
    ['the list\'s first header leaves', ['group:pinned', 'pinned:4', 'group:career', 'career:4'], ['group:career', 'career:4'], [],
      ['group:pinned-', 'pinned:4-', 'group:career', 'career:4']],
    ['Mark all as read: rows in several groups', ['group:career', 'career:4', 'career:5', 'group:updates', 'updates:6', 'updates:7'], ['group:career', 'career:4'], [],
      ['group:career', 'career:4', 'career:5-', 'group:updates-', 'updates:6-', 'updates:7-']],
    ['a row still folding stays until the list drops it', ['group:attention', 'attention:1', 'attention:2-', 'attention:3'], ['group:attention', 'attention:3'], [],
      ['group:attention', 'attention:1-', 'attention:2-', 'attention:3']],
    ['Pin: onto a new shelf, header and all, and its row stays in its group', ['group:career', 'career:4', 'career:5'], ['group:pinned', 'pinned:5', 'group:career', 'career:4', 'career:5'], [],
      ['group:pinned+', 'pinned:5+', 'group:career', 'career:4', 'career:5']],
    ['Unpin: off the shelf', ['group:pinned', 'pinned:5', 'pinned:6', 'group:career', 'career:5'], ['group:pinned', 'pinned:6', 'group:career', 'career:5'], [],
      ['group:pinned', 'pinned:5-', 'pinned:6', 'group:career', 'career:5']],
    ['Undo: the email that left comes back', ['group:attention', 'attention:1', 'attention:3'], ['group:attention', 'attention:1', 'attention:2', 'attention:3'], [2],
      ['group:attention', 'attention:1', 'attention:2+', 'attention:3']],
    ['Undo while it still folds out', ['group:attention', 'attention:1', 'attention:2-', 'attention:3'], ['group:attention', 'attention:1', 'attention:2', 'attention:3'], [2],
      ['group:attention', 'attention:1', 'attention:2+', 'attention:3']],
    // An entry back before its fold out ends opens again, rather than staying closed (SV-25).
    ['a row back while it still folds out, by a refresh', ['group:attention', 'attention:1', 'attention:2-'], ['group:attention', 'attention:1', 'attention:2'], [],
      ['group:attention', 'attention:1', 'attention:2+']],
    ['a collapsed group\'s header back while it still folds out', ['group:attention', 'attention:1', 'group:noise-'], ['group:attention', 'attention:1', 'group:noise'], [],
      ['group:attention', 'attention:1', 'group:noise+']],
    ['new mail just shows', ['group:attention', 'attention:1'], ['group:attention', 'attention:9', 'attention:1'], [],
      ['group:attention', 'attention:9', 'attention:1']],
    ['collapsing a group: its rows just go', ['group:noise', 'noise:7', 'noise:8'], ['group:noise'], [],
      ['group:noise']],
  ])('%s', (_, before, next, returning, expected) => {
    expect(shown(foldList(before.map(written), next.map(entry), rules, new Set(returning)))).toEqual(expected);
  });

  test('expanding a collapsed group: its rows just show, even one on the shelf', () => {
    const before = [{...written('group:career'), item: 'collapsed'}, written('group:pinned'), written('pinned:4')];
    expect(shown(foldList(before, ['group:career', 'career:4', 'career:5', 'group:pinned', 'pinned:4'].map(entry), rules, new Set([5]))))
      .toEqual(['group:career', 'career:4', 'career:5', 'group:pinned', 'pinned:4']);
  });

  // inbox-14: a group opens and closes like a drawer, its rows folding, never shown before or not.
  const drawer = {
    folds: () => true,
    arrives: () => true,
    opens: (item: Entry<string>, was: (key: string) => Folded<string> | undefined) => was(`group:${item.key.split(':')[0]}`)?.item === 'collapsed',
  };
  test('closing a group folds its rows out; opening one folds in rows it never showed, and only its own', () => {
    expect(shown(foldList(['group:noise', 'noise:7', 'noise:8'].map(written), ['group:noise'].map(entry), drawer, new Set())))
      .toEqual(['group:noise', 'noise:7-', 'noise:8-']);
    const before = [{...written('group:noise'), item: 'collapsed'}, written('group:people'), written('people:3')];
    expect(shown(foldList(before, ['group:noise', 'noise:7', 'noise:8', 'group:people', 'people:3', 'people:9'].map(entry), drawer, new Set())))
      .toEqual(['group:noise', 'noise:7+', 'noise:8+', 'group:people', 'people:3', 'people:9']);
  });
});
