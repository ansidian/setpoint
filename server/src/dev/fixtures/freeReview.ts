// Not a board: a free event during the CS 101 final's evening (SV-180). The registrar's email
// proposes the exam for Wed, Dec 9, 7 – 9 PM; Exam review drop-in, 7 – 8 PM that evening, is marked
// free, so the proposal card's conflict line still reads "Free that evening".
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import type {OpenDatabase} from '../../db/open.ts';
import * as t from '../../db/schema.ts';
import {zoned} from '../sample.ts';

export function freeReview({db}: OpenDatabase) {
  const classes = db.select({id: t.calendars.id}).from(t.calendars).where(eq(t.calendars.providerId, 'seed-classes')).get();
  if (!classes) throw new Error('The free-review fixture needs the seed\'s seed-classes calendar: run `npm run seed` first.');
  db.insert(t.items).values({
    calendarId: classes.id, providerId: 'fixture-free-review', kind: 'event', title: 'Exam review drop-in', allDay: false,
    startsAt: zoned('2026-12-09', '19:00'), endsAt: zoned('2026-12-09', '20:00'), timeZone: SEED_TIME_ZONE, reminders: [], transparency: 'transparent',
  }).run();
}
