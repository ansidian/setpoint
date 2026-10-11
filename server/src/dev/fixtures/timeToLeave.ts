// Time to Leave as boards 11, 12a and 12b draw it: "Leave by 2:05 PM · 18 min" for Dentist and
// "Leave by 6:35 PM · 21 min" for Dinner with Sam. Live routes from Home make these (B5); the dev
// seed has no Home and reaches no provider, so this fixture writes the estimates the scheduler
// would have kept (SV decision D3).
import {and, eq} from 'drizzle-orm';
import type {OpenDatabase} from '../../db/open.ts';
import * as t from '../../db/schema.ts';
import {zoned} from '../sample.ts';

const ESTIMATES: [title: string, date: string, leave: string, minutes: number][] = [
  ['Dentist', '2026-10-07', '14:05', 18],
  ['Dinner with Sam', '2026-10-09', '18:35', 21],
];

export function timeToLeave({db}: OpenDatabase) {
  const checked = zoned('2026-10-07', '09:10');
  db.transaction(tx => {
    for (const [title, date, leave, minutes] of ESTIMATES) {
      const item = tx.select({id: t.items.id, startsAt: t.items.startsAt}).from(t.items).where(and(eq(t.items.title, title), eq(t.items.kind, 'event'))).get();
      if (!item?.startsAt) throw new Error(`The time-to-leave fixture needs the seed's ${title}: run \`npm run seed\` first.`);
      tx.insert(t.travelEstimates).values({
        itemId: item.id, occurrenceStart: item.startsAt, inputs: 'fixture: time-to-leave',
        durationSeconds: minutes * 60, distanceMeters: minutes * 800, leaveAt: zoned(date, leave), checkedAt: checked, nextCheckAt: null, error: null,
      }).run();
    }
  });
}
