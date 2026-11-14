// SV-272: Todoist's order keys, as tables: a key between two others, the one subtask a reorder
// moved, and siblings sorted by their keys.
import {describe, expect, test} from 'vitest';
import {bySiblingOrder, orderKeyBetween, singleMove} from '../src/domain/orderKey.ts';

describe('a key between two keys', () => {
  test.each<[string | null, string | null, string | null]>([
    [null, null, 'a0'],
    ['a0', null, 'a1'],
    [null, 'a0', 'Zz'],
    ['a0', 'a1', 'a0V'],
    ['a0V', 'a1', 'a0l'],
    ['Zz', 'a0', 'ZzV'],
    ['az', null, 'b00'],
    // Keys read from Todoist (2026-11-13): it kept "a3" as sent, between these two.
    ['a27Gt', 'a3JDF', 'a3'],
    // Out of order, the same, or not keys at all: nothing to offer.
    ['a1', 'a0', null],
    ['a0', 'a0', null],
    ['not a key', null, null],
    [null, '7', null],
  ])('after %j and before %j is %j', (before, after, key) => expect(orderKeyBetween(before, after)).toBe(key));

  test('a list filled in anywhere stays in order, with no two keys the same', () => {
    const list: string[] = [];
    let seed = 7;
    for (let count = 0; count < 2000; count += 1) {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      const at = seed % (list.length + 1);
      list.splice(at, 0, orderKeyBetween(list[at - 1] ?? null, list[at] ?? null)!);
    }
    expect(list.every((key, at) => at === 0 || list[at - 1]! < key)).toBe(true);
  });
});

describe('the one that moved', () => {
  test.each<[number[], number[], number | null]>([
    [[1, 2, 3, 4], [2, 3, 1, 4], 1],
    [[1, 2, 3, 4], [1, 2, 4, 3], 4],
    [[1, 2, 3, 4], [4, 1, 2, 3], 4],
    [[1, 2, 3, 4], [4, 3, 2, 1], null],
    [[1, 2, 3, 4], [2, 1, 4, 3], null],
  ])('%j to %j moved %j', (from, to, moved) => expect(singleMove(from, to)).toBe(moved));
});

test('siblings sort by their keys as text, and by child_order where one has none', () => {
  const rows = [
    {id: 1, orderKey: 'a3JDF', childOrder: 0},
    {id: 2, orderKey: 'a27Gt', childOrder: 1},
    {id: 3, orderKey: 'a3', childOrder: 2},
  ];
  expect([...rows].sort(bySiblingOrder).map(row => row.id)).toEqual([2, 3, 1]);
  expect([{id: 1, orderKey: null, childOrder: 2}, {id: 2, orderKey: 'a0', childOrder: 1}, {id: 3, orderKey: null, childOrder: 0}].sort(bySiblingOrder).map(row => row.id)).toEqual([3, 2, 1]);
});
