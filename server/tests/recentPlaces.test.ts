// SV-71: the places a bare "@" and an empty Place field offer. The rule as a table: most used
// first, then most recent; spellings counted together under the latest; the latest address; no
// links; six at most. Then the route over the seed.
import type {RecentPlaceOut} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {recentPlaces} from '../src/domain/recentPlaces.ts';
import type {PlaceUse} from '../src/domain/recentPlaces.ts';
import {signedIn, world} from './helpers.ts';

const use = (place: string, at: string | null, address: string | null = null): PlaceUse => ({place, address, at});
const shown = (places: RecentPlaceOut[]) => places.map(one => (one.address ? `${one.name} (${one.address})` : one.name));

describe('recentPlaces', () => {
  test.each<[string, PlaceUse[], string[]]>([
    ['nothing used', [], []],
    ['most used first', [use('Gym', '2026-10-01'), use('Cafe', '2026-10-05'), use('Gym', '2026-09-01')], ['Gym', 'Cafe']],
    ['then most recent', [use('Library', '2026-09-01'), use('Cafe', '2026-10-05')], ['Cafe', 'Library']],
    ['a day sorts with instants', [use('Library', '2026-10-06'), use('Cafe', '2026-10-05T17:00:00.000Z')], ['Library', 'Cafe']],
    ['no start sorts last', [use('Library', null), use('Cafe', '2026-10-05')], ['Cafe', 'Library']],
    ['spellings count together, shown as the latest', [use('blue door', '2026-09-01'), use('Blue Door ', '2026-10-01'), use('Cafe', '2026-10-05')], ['Blue Door', 'Cafe']],
    ['the latest address', [use('Gym', '2026-09-01', '1 Old St'), use('Gym', '2026-10-01', '2 New St'), use('Gym', '2026-10-02')], ['Gym (2 New St)']],
    ['an address from any use', [use('Gym', '2026-10-01'), use('Gym', '2026-09-01', '1 Old St')], ['Gym (1 Old St)']],
    ['no links or blanks', [use('https://zoom.us/j/1', '2026-10-01'), use('www.example.com/meet', '2026-10-01'), use('  ', '2026-10-01'), use('Cafe', '2026-09-01')], ['Cafe']],
    ['six at most', ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((name, index) => use(name, `2026-10-0${index + 1}`)), ['G', 'F', 'E', 'D', 'C', 'B']],
  ])('%s', (_name, uses, expected) => {
    expect(shown(recentPlaces(uses))).toEqual(expected);
  });
});

describe('GET /api/places/recent', () => {
  test('the seed\'s events\' places, each used once, so the latest first, with their addresses', async () => {
    const c = await signedIn(world({seed: true}));
    const response = await c.send('GET', '/api/places/recent');
    expect(response.status).toBe(200);
    expect(shown(response.body as RecentPlaceOut[])).toEqual(['University Student Union', 'Blue Door (2118 Sunset Blvd)', 'Smile Dental (1420 Elm St)']);
    c.cookie = null;
    expect((await c.send('GET', '/api/places/recent')).status).toBe(401);
  });
});
