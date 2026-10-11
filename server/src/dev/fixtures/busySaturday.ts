// Board 11b's busy Sat, Oct 17: six Personal events and two Todoist tasks, so five rows fit the
// cell and the rest fold into "+3" (SV decision D3: the seed keeps the brief's calendar).
import {SEED_TIME_ZONE} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import type {OpenDatabase} from '../../db/open.ts';
import * as t from '../../db/schema.ts';
import {zoned} from '../sample.ts';

const DAY = '2026-10-17';

const EVENTS: [title: string, start: string, end: string][] = [
  ['Farmers market', '09:00', '10:30'],
  ['Haircut', '11:00', '11:45'],
  ['Lunch with Jo', '12:30', '13:30'],
  ['Volunteer shift', '14:00', '16:30'],
  ['Call Mom', '17:00', '17:30'],
  ['Movie night', '20:00', '22:30'],
];

const TASKS: [title: string, project: string][] = [
  ['Laundry', 'Home'],
  ['Grocery run', 'Home'],
];

export function busySaturday({db}: OpenDatabase) {
  const calendar = (providerId: string) => {
    const row = db.select({id: t.calendars.id}).from(t.calendars).where(eq(t.calendars.providerId, providerId)).get();
    if (!row) throw new Error(`The busy-saturday fixture needs the seed's ${providerId} calendar: run \`npm run seed\` first.`);
    return row.id;
  };
  const personal = calendar('seed-personal');
  const todoist = calendar('seed-todoist');
  db.transaction(tx => {
    EVENTS.forEach(([title, start, end], index) => {
      tx.insert(t.items).values({
        calendarId: personal, providerId: `fixture-11b-event-${index + 1}`, kind: 'event', title, allDay: false,
        startsAt: zoned(DAY, start), endsAt: zoned(DAY, end), timeZone: SEED_TIME_ZONE, reminders: [10],
      }).run();
    });
    TASKS.forEach(([title, project], index) => {
      tx.insert(t.items).values({calendarId: todoist, providerId: `fixture-11b-task-${index + 1}`, kind: 'task', title, allDay: true, dueDate: DAY, project}).run();
    });
  });
}
