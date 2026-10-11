// Where an item is, as the floating detail, the failed card, the agenda and search lines show it.
import {describe, expect, test} from 'vitest';
import {placeLines} from '../src/logic/place.ts';

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
