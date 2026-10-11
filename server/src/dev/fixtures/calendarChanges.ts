// Calendar boards whose state the seed doesn't hold (SV decision D3):
// - board 13 drafts "Dinner with Sam fri 7-9pm @Blue Door" as a new event, so Dinner with Sam isn't
//   on the calendar yet (`no-dinner`);
// - board 19b shows a change that failed and one still waiting (`failed-change`): Dinner with Sam
//   moved to Sat, Oct 10 and refused with Google Calendar's 409, and Pay rent's completion pending.
//   The rows are the command layer's own (commands/index.ts writes the same), left without a job, so
//   the failure stays in place and the completion waits for its provider as long as the board needs.
import {and, eq} from 'drizzle-orm';
import type {OpenDatabase} from '../../db/open.ts';
import * as t from '../../db/schema.ts';
import {zoned} from '../sample.ts';

function find(db: OpenDatabase['db'], title: string, fixture: string) {
  const row = db.select().from(t.items).where(eq(t.items.title, title)).get();
  if (!row) throw new Error(`The ${fixture} fixture needs the seed's ${title}: run \`npm run seed\` first.`);
  return row;
}

const sourceOf = (db: OpenDatabase['db'], calendarId: number) => {
  const calendar = db.select().from(t.calendars).where(eq(t.calendars.id, calendarId)).get()!;
  const source = calendar.provider === 'todoist'
    ? db.select().from(t.sources).where(eq(t.sources.provider, 'todoist')).get()
    : db.select().from(t.sources).where(and(eq(t.sources.provider, 'google_calendar'), eq(t.sources.accountId, calendar.accountId!))).get();
  return source?.id ?? null;
};

export function noDinner({db}: OpenDatabase) {
  const dinner = find(db, 'Dinner with Sam', 'no-dinner');
  db.delete(t.items).where(eq(t.items.id, dinner.id)).run();
}

export function failedChange({db}: OpenDatabase) {
  const dinner = find(db, 'Dinner with Sam', 'failed-change');
  const rent = find(db, 'Pay rent', 'failed-change');
  const at = zoned('2026-10-07', '09:05');
  const changes = {starts_at: zoned('2026-10-10', '19:00'), ends_at: zoned('2026-10-10', '21:00')};
  db.transaction(tx => {
    tx.update(t.items).set({startsAt: changes.starts_at, endsAt: changes.ends_at}).where(eq(t.items.id, dinner.id)).run();
    tx.insert(t.commands).values({
      target: 'item', targetId: dinner.id, kind: 'item_update', sourceId: sourceOf(db, dinner.calendarId), state: 'failed',
      payload: {item_id: dinner.id, changes, scope: 'this', occurrence_start: null, touched: {items: [dinner.id], calendars: [dinner.calendarId]}},
      previous: {items: [dinner], created: []},
      previousWhen: {all_day: false, starts_at: dinner.startsAt, ends_at: dinner.endsAt, start_date: null, end_date: null, due_date: null, due_at: null},
      providerMessage: 'The requested event was modified by another client. (409 Conflict)', attempts: 1, createdAt: at, settledAt: zoned('2026-10-07', '09:06'),
    }).run();
    tx.update(t.items).set({doneAt: zoned('2026-10-07', '09:11')}).where(eq(t.items.id, rent.id)).run();
    tx.insert(t.commands).values({
      target: 'item', targetId: rent.id, kind: 'item_complete', sourceId: sourceOf(db, rent.calendarId), state: 'pending',
      payload: {item_id: rent.id, done: true, touched: {items: [rent.id], calendars: [rent.calendarId]}}, previous: {items: [rent]}, createdAt: zoned('2026-10-07', '09:11'),
    }).run();
  });
}
