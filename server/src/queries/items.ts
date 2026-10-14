// The calendar's read queries (SV-2 decision D4): items in a range with recurring events expanded,
// one item, the calendars and the weather. Events and Todoist tasks are one item model.
import type {CalendarOut, CommandOut, ItemOut, ItemsOut, RecentPlaceOut, TimeToLeaveOut, TodoistLabelOut, TodoistProjectOut, WeatherDayOut} from '@setpoint/shared';
import {isTodoistColour} from '@setpoint/shared';
import {and, asc, eq, gte, isNotNull, lt} from 'drizzle-orm';
import {activeCommands, commandPresenter} from '../commands/index.ts';
import * as t from '../db/schema.ts';
import {occurrenceDates, parseRule} from '../domain/recurrence.ts';
import {localDay, localTime, zonedInstant} from '../domain/time.ts';
import {notFound} from '../errors.ts';
import {recentPlaces} from '../domain/recentPlaces.ts';
import {repeatOf} from '../providers/todoist/due.ts';
import type {Store} from '../store.ts';

type ItemRow = typeof t.items.$inferSelect;

function present(row: ItemRow, command: CommandOut | null, occurrence?: {start: string; end: string}, leave: Map<string, TimeToLeaveOut> = new Map()): ItemOut {
  const start = occurrence?.start ?? row.startsAt;
  return {
    key: occurrence ? `${row.id}@${occurrence.start}` : String(row.id),
    id: row.id, calendar_id: row.calendarId, kind: row.kind, title: row.title,
    all_day: row.allDay, starts_at: occurrence?.start ?? row.startsAt, ends_at: occurrence?.end ?? row.endsAt,
    start_date: row.startDate, end_date: row.endDate, due_date: row.dueDate, due_at: row.dueAt,
    time_zone: row.timeZone, recurring: row.recurrence !== null || row.recurringItemId !== null || row.dueRecurring, recurrence: row.recurrence,
    occurrence_start: occurrence?.start ?? null,
    place: row.place, address: row.address, attendees: row.attendees ?? [], reminders: row.reminders ?? [], leave_reminder: row.leaveReminder, project: row.project,
    done: row.doneAt !== null, done_at: row.doneAt, command,
    read_only: row.readOnly, due_string: row.dueString, time_to_leave: (row.leaveReminder && start && leave.get(`${row.id}@${start}`)) || null, colour: row.colour,
    labels: row.labels ?? [], repeat: row.dueRecurring ? repeatOf(row.dueString) : null,
  };
}

/** Time to Leave's latest estimates, by occurrence ("12@2026-10-07T21:30:00.000Z"). */
function leaveTimes(store: Store): Map<string, TimeToLeaveOut> {
  const rows = store.db.select().from(t.travelEstimates).where(isNotNull(t.travelEstimates.leaveAt)).all();
  return new Map(rows.map(row => [`${row.itemId}@${row.occurrenceStart}`, {
    leave_at: row.leaveAt!, travel_minutes: Math.max(1, Math.ceil(row.durationSeconds! / 60)), checked_at: row.checkedAt!,
  }]));
}

function itemCommands(store: Store): Map<number, CommandOut> {
  const presentCommand = commandPresenter(store);
  return new Map(activeCommands(store, 'item').map(row => [row.targetId, presentCommand(row)]));
}

/** A recurring event's occurrences overlapping [fromAt, toAt), skipping those an exception replaces. */
function occurrences(row: ItemRow, from: string, to: string, fromAt: string, toAt: string, replaced: Set<string>, timeZone: string) {
  const zone = row.timeZone ?? timeZone;
  const duration = Date.parse(row.endsAt!) - Date.parse(row.startsAt!);
  const first = localDay(row.startsAt!, zone);
  const rule = parseRule(row.recurrence!, until => localDay(until, zone));
  // A rule this expander doesn't cover shows its first occurrence; B5's provider expansion takes over.
  const dates = rule ? occurrenceDates(rule, first, from < first ? first : addDayBefore(from), to) : [first];
  const time = localTime(row.startsAt!, zone);
  return dates
    .map(date => {
      const start = zonedInstant(date, time, zone);
      return {start, end: new Date(Date.parse(start) + duration).toISOString()};
    })
    // UNTIL is inclusive of an occurrence starting exactly then (RFC 5545).
    .filter(occurrence => occurrence.start < toAt && occurrence.end > fromAt && !replaced.has(occurrence.start) && (!rule?.untilAt || occurrence.start <= rule.untilAt));
}

// An occurrence that started the day before can still run into the range.
const addDayBefore = (date: string) => new Date(Date.parse(`${date}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);

/** Items in [from, to) (local dates), recurring events expanded, ordered by when they happen. */
export function itemsInRange(store: Store, from: string, to: string): ItemsOut {
  const fromAt = zonedInstant(from, '00:00', store.timeZone);
  const toAt = zonedInstant(to, '00:00', store.timeZone);
  const commands = itemCommands(store);
  const rows = store.db.select().from(t.items).all();
  const replaced = new Map<number, Set<string>>();
  for (const row of rows) {
    if (row.recurringItemId !== null) replaced.set(row.recurringItemId, (replaced.get(row.recurringItemId) ?? new Set()).add(row.originalStart!));
  }
  const items: ItemOut[] = [];
  const leave = leaveTimes(store);
  for (const row of rows) {
    if (row.cancelled) continue;
    const command = commands.get(row.id) ?? null;
    if (row.kind === 'task') {
      // A repeating task done on this day is its completed occurrence's row, not the task's.
      const doneHere = row.recurringItemId === null && replaced.get(row.id)?.has(row.dueDate!);
      if (row.dueDate! >= from && row.dueDate! < to && !doneHere) items.push(present(row, command));
    } else if (row.expanded && row.recurringItemId === null) {
      // Google expands this series: its occurrences are rows.
      continue;
    } else if (row.allDay) {
      if (row.startDate! < to && row.endDate! > from) items.push(present(row, command));
    } else if (row.recurrence && row.recurringItemId === null) {
      for (const occurrence of occurrences(row, from, to, fromAt, toAt, replaced.get(row.id) ?? new Set(), store.timeZone)) items.push(present(row, command, occurrence, leave));
    } else if (row.startsAt! < toAt && row.endsAt! > fromAt) {
      items.push(present(row, command, undefined, leave));
    }
  }
  const when = (item: ItemOut) => item.starts_at ?? zonedInstant(item.start_date ?? item.due_date!, '00:00', store.timeZone);
  // All-day items and tasks first on their day, then by time.
  items.sort((a, b) => when(a).localeCompare(when(b)) || Number(b.all_day) - Number(a.all_day) || a.title.localeCompare(b.title));
  return {from, to, items};
}

/** SV-23: rows presented as the range read presents them, with their commands and Time to Leave. */
export function itemPresenter(store: Store): (row: ItemRow, occurrence?: {start: string; end: string}) => ItemOut {
  const commands = itemCommands(store);
  const leave = leaveTimes(store);
  return (row, occurrence) => present(row, commands.get(row.id) ?? null, occurrence, leave);
}

export function itemDetail(store: Store, itemId: number): ItemOut {
  const row = store.db.select().from(t.items).where(eq(t.items.id, itemId)).get();
  if (!row || row.cancelled) throw notFound('No such item.');
  return present(row, itemCommands(store).get(row.id) ?? null);
}

export function calendarList(store: Store): CalendarOut[] {
  const presentCommand = commandPresenter(store);
  const commands = new Map(activeCommands(store, 'calendar').map(row => [row.targetId, presentCommand(row)]));
  return store.db.select().from(t.calendars).orderBy(asc(t.calendars.position)).all().map(row => ({
    id: row.id, provider: row.provider, account_id: row.accountId, name: row.name, colour: row.colour, position: row.position, visible: row.visible,
    command: commands.get(row.id) ?? null,
  }));
}

export function setCalendarVisible(store: Store, calendarId: number, visible: boolean): CalendarOut {
  const updated = store.db.update(t.calendars).set({visible}).where(eq(t.calendars.id, calendarId)).returning().get();
  if (!updated) throw notFound('No such calendar.');
  return calendarList(store).find(calendar => calendar.id === calendarId)!;
}

/** Day forecasts in [from, to), when Settings › Calendar has weather on. */
export function weatherDays(store: Store, from: string, to: string, enabled: boolean): WeatherDayOut[] {
  if (!enabled) return [];
  return store.db.select().from(t.weatherDays).where(and(gte(t.weatherDays.date, from), lt(t.weatherDays.date, to), isNotNull(t.weatherDays.condition)))
    .orderBy(t.weatherDays.date).all().map(row => ({date: row.date, condition: row.condition, high_f: row.highF, low_f: row.lowF}));
}

/** Todoist's projects with their colours, and SV-25's colour change waiting for Todoist or failed. */
export function todoistProjects(store: Store): TodoistProjectOut[] {
  const presentCommand = commandPresenter(store);
  const commands = new Map(activeCommands(store, 'project').map(row => [row.targetId, presentCommand(row)]));
  return store.db.select().from(t.todoistProjects).orderBy(asc(t.todoistProjects.position)).all()
    .map(row => ({id: row.providerId, name: row.name, inbox: row.inbox, colour: isTodoistColour(row.colour) ? row.colour : null, command: commands.get(row.id) ?? null}));
}

/** The places events have used, for a bare "@" and an empty Place field (SV-71). */
export function recentPlaceList(store: Store): RecentPlaceOut[] {
  const rows = store.db.select({place: t.items.place, address: t.items.address, startsAt: t.items.startsAt, startDate: t.items.startDate}).from(t.items)
    .where(and(eq(t.items.kind, 'event'), isNotNull(t.items.place), eq(t.items.cancelled, false))).all();
  return recentPlaces(rows.map(row => ({place: row.place!, address: row.address, at: row.startsAt ?? row.startDate})));
}

/** Todoist's labels, for a task's labels picker (F6b). */
export function todoistLabels(store: Store): TodoistLabelOut[] {
  return store.db.select().from(t.todoistLabels).orderBy(asc(t.todoistLabels.position), asc(t.todoistLabels.name)).all()
    .map(row => ({id: row.providerId, name: row.name}));
}
