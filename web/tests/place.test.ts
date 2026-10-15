// Where an item is, as the floating detail, the failed card, the agenda and search lines show it.
import {describe, expect, test} from 'vitest';
import {placeLines, placeLink} from '../src/logic/place.ts';

describe('the place and its address', () => {
  test.each([
    ['nothing', null, null, null],
    ['blank', '  ', '', null],
    ['a place alone', 'University Student Union', null, {name: 'University Student Union', address: null}],
    ['a place and its full address (12a)', 'Smile Dental', '1420 Elm St, Los Angeles, CA 90026, USA', {name: 'Smile Dental', address: '1420 Elm St, Los Angeles, CA 90026, USA'}],
    ['an address alone leads with its street', null, '1420 Elm St, Los Angeles, CA 90026, USA', {name: '1420 Elm St', address: 'Los Angeles, CA 90026, USA'}],
    ['a street alone', null, '1420 Elm St', {name: '1420 Elm St', address: null}],
    ['a street picked as the place isn\'t said twice', '1420 Elm St', '1420 Elm St, Los Angeles, CA 90026, USA', {name: '1420 Elm St', address: 'Los Angeles, CA 90026, USA'}],
    ['the place and address the same', '1420 Elm St', '1420 Elm St', {name: '1420 Elm St', address: null}],
    ['a place that only starts like its address', 'Blue Door', 'Blue Door Plaza, 9 Main St', {name: 'Blue Door', address: 'Blue Door Plaza, 9 Main St'}],
  ])('%s', (_, place, address, lines) => expect(placeLines(place, address)).toEqual(lines));
});

describe('a link in the place (SV-77)', () => {
  test.each([
    ['nothing', null, null, null],
    ['a place with no link', 'Smile Dental', '1420 Elm St', null],
    ['a link alone', 'https://zoom.us/j/81234567890', null, {url: 'https://zoom.us/j/81234567890', host: 'zoom.us', only: true}],
    ['www. alone gets https and loses its www', 'www.zoom.us/j/1', null, {url: 'https://www.zoom.us/j/1', host: 'zoom.us', only: true}],
    ['a link among words', 'Room 204 or https://meet.example.com/j/1?pwd=abc', null, {url: 'https://meet.example.com/j/1?pwd=abc', host: 'meet.example.com', only: false}],
    ['punctuation after it stays out', 'Zoom (https://zoom.us/j/1).', null, {url: 'https://zoom.us/j/1', host: 'zoom.us', only: false}],
    ['a link split into the address by its comma', 'Zoom', 'https://zoom.us/j/1', {url: 'https://zoom.us/j/1', host: 'zoom.us', only: false}],
    ['the first of two', 'https://a.example/1 or https://b.example/2', null, {url: 'https://a.example/1', host: 'a.example', only: false}],
    ['a bare domain isn\'t taken for one', 'meet.example.com', null, null],
    ['a link with no host', 'https://', null, null],
  ])('%s', (_, place, address, link) => expect(placeLink({place, address})).toEqual(link));
});
