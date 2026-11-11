// SV-181: an .ics file into one of the user's Google calendars, reviewed first (D436, D437).
// - readImport: the file read into drafts (src/domain/icsImport.ts, SV-178), in start order, each
//   saying whether it's over and which calendars already hold its iCalUID. Nothing goes to Google.
// - importEvent: one draft as a command, carried out by Google's events.import
//   (src/providers/gcal/mutations.ts): `item_create` with a new row for an event the calendar doesn't
//   hold, `item_update` of the row it does (Google updates it in place). The mirror shows it at once,
//   pending, as any change; Move back takes a new one off and puts an updated one back.
// SV-182's Add to calendar on an email's .ics reads the attachment's bytes through readImport too.
import type {IcsEventOut, IcsImportEvent, IcsImportInput, IcsReadOut} from '@setpoint/shared';
import {and, eq, inArray, isNull} from 'drizzle-orm';
import {createCommand} from '../commands/index.ts';
import type {CommandRow} from '../commands/index.ts';
import {calendarSourceId, refuseReadOnlyCalendar} from '../commands/items.ts';
import {localProviderId, whenOf} from '../commands/itemMirror.ts';
import type {ItemRow} from '../commands/itemMirror.ts';
import * as t from '../db/schema.ts';
import {readIcs} from '../domain/icsImport.ts';
import type {IcsChange, IcsEvent} from '../domain/icsImport.ts';
import {importPast} from '../domain/icsReview.ts';
import {invalid, notFound} from '../errors.ts';
import {splitLocation} from '../providers/gcal/normalize.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';

const fieldsOf = (event: IcsEvent) => {
  const {place, address} = splitLocation(event.location ?? undefined);
  return {
    title: event.title, all_day: event.all_day, starts_at: event.starts_at, ends_at: event.ends_at, start_date: event.start_date, end_date: event.end_date,
    time_zone: event.time_zone, place, address, description: event.description, url: event.url, transparency: event.transparency, reminders: event.reminders,
  };
};
const changeOf = (change: IcsChange) => ({...fieldsOf(change), original_start_at: change.original_start_at, original_start_date: change.original_start_date});
const startOf = (event: Pick<IcsEventOut, 'starts_at' | 'start_date'>) => event.starts_at ?? `${event.start_date}T00:00`;

/** Reads a file into the review's drafts, or refuses it with readIcs's one line. */
export function readImport(store: Store, file: string | Uint8Array): IcsReadOut {
  const read = readIcs(file, {timeZone: store.timeZone});
  if (!read.ok) throw invalid(read.error);
  const uids = [...new Set(read.drafts.map(draft => draft.ical_uid))];
  const held = new Map<string, number[]>();
  // SQLite's parameter limit: the file's UIDs a few hundred at a time.
  for (let at = 0; at < uids.length; at += 500) {
    const rows = store.db.select({uid: t.items.icalUid, calendarId: t.items.calendarId}).from(t.items)
      .innerJoin(t.calendars, eq(t.calendars.id, t.items.calendarId))
      .where(and(inArray(t.items.icalUid, uids.slice(at, at + 500)), isNull(t.items.recurringItemId), eq(t.items.cancelled, false), eq(t.calendars.provider, 'google'))).all();
    for (const row of rows) held.set(row.uid!, [...new Set([...(held.get(row.uid!) ?? []), row.calendarId])].sort((a, b) => a - b));
  }
  const now = isoNow(store);
  const events: IcsEventOut[] = read.drafts.map(draft => ({
    ...fieldsOf(draft), ical_uid: draft.ical_uid, sequence: draft.sequence, recurrence: draft.recurrence, changes: draft.changes.map(changeOf),
    past: importPast(draft, now, store.timeZone), existing: held.get(draft.ical_uid) ?? [],
  }));
  // In start order (the file's is any), so the review reads as a schedule.
  events.sort((a, b) => startOf(a).localeCompare(startOf(b)));
  return {events, dropped: read.dropped};
}

/** The series row a calendar holds for an iCalUID, if any. */
function heldRow(store: Store, calendarId: number, uid: string): ItemRow | null {
  return store.db.select().from(t.items).where(and(eq(t.items.calendarId, calendarId), eq(t.items.icalUid, uid), isNull(t.items.recurringItemId), eq(t.items.cancelled, false))).get() ?? null;
}

/** The mirror's columns for an imported event, as it will read once Google has it. */
function columnsOf(store: Store, event: IcsImportEvent): Partial<ItemRow> {
  const rule = event.recurrence.find(line => line.startsWith('RRULE:')) ?? null;
  return {
    kind: 'event', title: event.title || '(No title)', allDay: event.all_day, startsAt: event.starts_at, endsAt: event.ends_at, startDate: event.start_date, endDate: event.end_date,
    dueDate: null, dueAt: null,
    // A series keeps its wall-clock time in a zone: the file's, else the user's.
    timeZone: event.all_day ? null : event.time_zone ?? (rule ? store.timeZone : null),
    // Until Google answers, the mirror expands the rule itself; the sync after brings its EXDATEs and changes.
    recurrence: rule, expanded: false, place: event.place, address: event.address, attendees: [],
    reminders: event.reminders, leaveReminder: event.leave_reminder, colour: event.colour, sourceUrl: event.url, transparency: event.transparency,
    icalUid: event.ical_uid, readOnly: false, description: event.description,
  };
}

/**
 * One event into a Google calendar by its iCalUID. Refused, changing nothing, for a calendar that
 * isn't Google's or that the user can only read (SV-191), or while the event the calendar holds for it has a change of its own on its way.
 */
export function importEvent(store: Store, input: IcsImportInput): CommandRow {
  const calendar = store.db.select().from(t.calendars).where(eq(t.calendars.id, input.calendar_id)).get();
  if (!calendar) throw notFound('No such calendar.');
  if (calendar.provider !== 'google') throw invalid('An .ics file imports into a Google calendar.');
  refuseReadOnlyCalendar(calendar);
  const {event} = input;
  const held = heldRow(store, calendar.id, event.ical_uid);
  const payload = {import: {calendar_id: calendar.id, event}};
  if (held) {
    return createCommand(store, {
      target: 'item', kind: 'item_update', sourceId: calendarSourceId(store, calendar.id), payload: {...payload, item_id: held.id},
      prepare: () => {
        // A series Google expands keeps its rows until the sync after the import, rather than drawn twice.
        store.db.update(t.items).set({...columnsOf(store, event), expanded: held.expanded}).where(eq(t.items.id, held.id)).run();
        return {targetId: held.id, previous: {items: [held]}, previousWhen: whenOf(held), touched: {items: [held.id], calendars: [calendar.id]}};
      },
    });
  }
  return createCommand(store, {
    target: 'item', kind: 'item_create', sourceId: calendarSourceId(store, calendar.id), payload,
    prepare: () => {
      const id = store.db.insert(t.items).values({...columnsOf(store, event), calendarId: calendar.id, providerId: localProviderId()} as typeof t.items.$inferInsert)
        .returning({id: t.items.id}).get().id;
      return {targetId: id, previous: {created: [id]}, touched: {items: [id], calendars: [calendar.id]}};
    },
  });
}

/** What an import command carries, for the adapter (null for any other command). */
export const importOf = (command: CommandRow): {calendar_id: number; event: IcsImportEvent} | null =>
  (command.payload.import as {calendar_id: number; event: IcsImportEvent} | undefined) ?? null;
