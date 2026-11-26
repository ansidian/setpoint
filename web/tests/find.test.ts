// Find in email's rules (src/logic/find.ts) as tables: the scope a key opens on each page with and
// without an email open, where the words fall in a text (case, accents and spaces aside, never
// across a line), how stepping wraps, and how the field's count reads.
import {describe, expect, test} from 'vitest';
import {countFinds, findCount, findRuns, findScope, stepFind} from '../src/logic/find.ts';
import type {Route} from '../src/logic/route.ts';

describe('the scope a key opens', () => {
  test.each<[Route['page'], boolean, 'find' | 'slash', 'email' | 'page']>([
    ['inbox', true, 'find', 'email'],
    ['inbox', true, 'slash', 'page'],
    ['inbox', false, 'find', 'page'],
    ['inbox', false, 'slash', 'page'],
    ['sent', true, 'find', 'email'],
    ['sent', true, 'slash', 'page'],
    ['sent', false, 'find', 'page'],
    ['snoozed', true, 'find', 'email'],
    ['snoozed', false, 'find', 'page'],
    ['drafts', true, 'find', 'page'],
    ['jobs', true, 'find', 'page'],
    ['calendar', false, 'find', 'page'],
    ['news', false, 'slash', 'page'],
  ])('%s, an email open: %s, %s searches the %s', (page, open, key, scope) => {
    expect(findScope(page, open, key)).toBe(scope);
  });
});

describe('how many times the words fall in a text', () => {
  test.each([
    ['each time, not overlapping', 'Cooler? A cooler.', 'cooler', 2],
    ['whatever the case', 'BRING THE COOLER', 'Cooler', 1],
    ['accents aside, both ways', 'Café crème', 'cafe creme', 1],
    ['accents typed', 'cafe', 'café', 1],
    ['inside a longer word', 'Coolers', 'cool', 1],
    ['several words as one phrase, spaces aside', 'board   games', ' board games ', 1],
    ['a phrase in another order', 'games board', 'board games', 0],
    ['never across a line', 'board\ngames', 'board games', 0],
    ['runs that would overlap, once each', 'aaaa', 'aa', 2],
    ['no words', 'anything', '   ', 0],
    ['not there', 'cabin', 'cooler', 0],
  ])('%s', (_, text, query, count) => {
    expect(countFinds(text, query)).toBe(count);
  });

  test.each([
    ['plain text', 'Bring the cooler.', 'cooler', [{start: 10, end: 16}]],
    ['after an accent folded away', 'Crème brûlée', 'brulee', [{start: 6, end: 12}]],
    ['after a wide character', '😀 cooler', 'cooler', [{start: 3, end: 9}]],
    ['across a run of spaces', 'a  b', 'a b', [{start: 0, end: 4}]],
  ])('where they fall, in the text\'s own places: %s', (_, text, query, runs) => {
    expect(findRuns(text, query)).toEqual(runs);
  });
});

describe('stepping wraps at either end', () => {
  test.each([
    [0, 3, 1, 1],
    [2, 3, 1, 0],
    [0, 3, -1, 2],
    [1, 3, -1, 0],
    [0, 1, 1, 0],
    [0, 0, 1, 0],
  ] as const)('from %i of %i by %i: %i', (current, total, delta, next) => {
    expect(stepFind(current, total, delta)).toBe(next);
  });
});

describe('the field\'s count', () => {
  test.each([
    [0, 12, 'cooler', '1 of 12'],
    [2, 12, 'cooler', '3 of 12'],
    [5, 3, 'cooler', '3 of 3'],
    [0, 0, 'cooler', 'No matches'],
    [0, 0, '', null],
    [0, 4, '  ', null],
  ])('%i of %i for "%s": %s', (current, total, query, line) => {
    expect(findCount(current, total, query)).toBe(line);
  });
});
