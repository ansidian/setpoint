// Overdue Todoist tasks for the overdue banner, at the seed's 9:12 AM on Wed, Oct 7: one due at
// 8:00 AM today, one from Monday and one from Sunday, inside the 3 days Settings › Tasks looks back
// by default, and one from Sep 24, outside them, which nothing lists. Kept out of the seed itself, which the browser
// checks start from, so only the dev Setpoint (`npm run seed`,
// `npm run try`) and the banner's own check have them. A timed task is all-day with a time, as
// Todoist's sync writes one (providers/todoist/sync.ts).
import {eq} from 'drizzle-orm';
import type {OpenDatabase} from '../../db/open.ts';
import * as t from '../../db/schema.ts';
import {zoned} from '../sample.ts';

const TASKS: {title: string; project: string; due: string; time?: string}[] = [
  {title: 'Call the landlord about the heater', project: 'Home', due: '2026-10-07', time: '08:00'},
  {title: 'Submit the parking permit form', project: 'School', due: '2026-10-05'},
  {title: 'Renew the library card', project: 'Inbox', due: '2026-10-04'},
  {title: 'Return the borrowed drill', project: 'Home', due: '2026-09-24'},
];

export function overdueTasks({db}: OpenDatabase) {
  const todoist = db.select({id: t.calendars.id}).from(t.calendars).where(eq(t.calendars.providerId, 'seed-todoist')).get();
  if (!todoist) throw new Error('The overdue-tasks fixture needs the seed\'s Todoist calendar: run `npm run seed` first.');
  db.transaction(tx => {
    TASKS.forEach(({title, project, due, time}, index) => {
      tx.insert(t.items).values({
        calendarId: todoist.id, providerId: `fixture-overdue-${index + 1}`, kind: 'task', title, allDay: true,
        dueDate: due, dueAt: time ? zoned(due, time) : null, project,
      }).run();
    });
  });
}
