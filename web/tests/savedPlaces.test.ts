// Saved places: which names a place can take, and which saved place a place's text names.
import {allSavedPlaces, placeNameProblem, savedPlaceFor, savedPlacesSchema} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {placeChoices} from '../src/logic/search.ts';

describe('a saved place\'s name', () => {
  test.each([
    ['a new name', 'Work', ['Gym'], null],
    ['with spaces', 'Friend\'s House', [], null],
    ['80 characters', 'a'.repeat(80), [], null],
    ['81 characters', 'a'.repeat(81), [], 'Up to 80 characters'],
    ['blank', '   ', [], 'Give it a name'],
    ['Home is Home\'s', 'Home', [], 'Home is already a saved place'],
    ['in any case', 'hOME', [], 'Home is already a saved place'],
    ['another place\'s, in any case', 'work', ['Work'], 'Work is already a saved place'],
    ['another place\'s, spaces around it', '  Work ', ['Work'], 'Work is already a saved place'],
    ['one that only starts like another\'s', 'Workshop', ['Work'], null],
  ])('%s', (_, name, others, problem) => expect(placeNameProblem(name, others)).toBe(problem));

  test('the kept list refuses a clash', () => {
    expect(savedPlacesSchema.safeParse([{name: 'Work', address: '1 Main St'}, {name: 'work', address: '2 Main St'}]).success).toBe(false);
    expect(savedPlacesSchema.safeParse([{name: 'home', address: '1 Main St'}]).success).toBe(false);
    expect(savedPlacesSchema.safeParse([{name: 'Work', address: '1 Main St'}, {name: 'Gym', address: '2 Main St'}]).success).toBe(true);
  });
});

describe('the saved place a place\'s text names', () => {
  const places = allSavedPlaces({address: '845 Example St'}, [{name: 'Work', address: '1 Main St'}, {name: 'Friend\'s House', address: '9 Oak Ave'}]);
  test.each([
    ['Home first', 'Home', '845 Example St'],
    ['in any case', 'wORK', '1 Main St'],
    ['spaces in the name', 'friend\'s house', '9 Oak Ave'],
    ['spaces around it', ' Work ', '1 Main St'],
    ['only the whole name', 'Workshop', null],
    ['nothing', '', null],
    ['null', null, null],
  ])('%s', (_, text, address) => expect(savedPlaceFor(text, places)?.address ?? null).toBe(address));

  test('Home first, then the others by name, in any case', () => expect(allSavedPlaces({address: '845 Example St'}, [{name: 'work', address: '1'}, {name: 'Blue Door', address: '2'}, {name: 'Aunt\'s', address: '3'}]).map(one => one.name))
    .toEqual(['Home', 'Aunt\'s', 'Blue Door', 'work']));
  test('no Home while it isn\'t set', () => expect(allSavedPlaces(null, [{name: 'Work', address: '1 Main St'}]).map(one => one.name)).toEqual(['Work']));
});

describe('the place menu', () => {
  const saved = [{name: 'Home', address: '845 Example St'}, {name: 'Work', address: '1 Main St'}, {name: 'Blue Door Studio', address: '9 Oak Ave'}];
  const google = {query: 'blue', list: [{place_id: 'g1', name: 'Blue Door Coffee', address: '2118 Sunset Blvd'}]};
  const rows = (menu: ReturnType<typeof placeChoices>) => menu && menu.list.map(one => `${one.name}${one.saved ? ' (saved)' : ''}`);
  test.each<[string, string | null, string, typeof google | null, string[] | null]>([
    ['an empty field or a bare "@": every saved place', '', '', null, ['Home (saved)', 'Work (saved)', 'Blue Door Studio (saved)']],
    ['"@" and a letter narrows them', 'w', '', null, ['Work (saved)']],
    ['a letter none starts', 'z', '', null, []],
    ['from two letters, saved matches before Google\'s', null, 'blue', google, ['Blue Door Studio (saved)', 'Blue Door Coffee']],
    ['saved matches while Google hasn\'t answered', null, 'blue', null, ['Blue Door Studio (saved)']],
    ['Google\'s answer for another query isn\'t shown', null, 'blu', google, ['Blue Door Studio (saved)']],
    ['nothing asked', null, '', google, null],
  ])('%s', (_, short, query, found, list) => expect(rows(placeChoices(short, query, saved, found))).toEqual(list));
  test('nothing saved: nothing to show before two letters', () => expect(placeChoices('', '', [], null)!.list).toEqual([]));
});
