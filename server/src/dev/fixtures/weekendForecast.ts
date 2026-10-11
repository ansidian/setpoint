// Not a board: forecasts for the seed's empty weekend, Sat, Oct 10 and Sun, Oct 11, so the phone
// checks see an empty day keep its own line to show its weather (DESIGN.md #83).
import * as t from '../../db/schema.ts';
import type {OpenDatabase} from '../../db/open.ts';
import {zoned} from '../sample.ts';

export function weekendForecast({db}: OpenDatabase) {
  const fetchedAt = zoned('2026-10-07', '09:00');
  db.insert(t.weatherDays).values([
    {date: '2026-10-10', condition: 'partly_cloudy', highF: 74, lowF: 58, fetchedAt},
    {date: '2026-10-11', condition: 'sun', highF: 77, lowF: 60, fetchedAt},
  ]).run();
}
