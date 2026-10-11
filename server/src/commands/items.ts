// Calendar changes as commands: create, change (with recurring scope), delete, and complete or
// reopen a task. Each goes to the calendar's source: its Google account's Calendar connection, or
// Todoist. SV-20 adds a Google calendar's colour, SV-25 a Todoist project's.
import type {Colour, TodoistColour, ItemCreateInput, ItemUpdateInput, ItemScopeInput} from '@setpoint/shared';
import {whenProblem} from '@setpoint/shared';
import {and, asc, eq} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {conflict, invalid, notFound} from '../errors.ts';
import {getSettings} from '../settings.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {createCommand} from './index.ts';
import type {CommandRow} from './index.ts';
import {repeatAfter} from '../providers/todoist/due.ts';
import {todoistCalendar} from '../providers/todoist/sync.ts';
import {changeItemInMirror, localProviderId, whenOf} from './itemMirror.ts';
import type {ItemRow} from './itemMirror.ts';

function calendar(store: Store, calendarId: number) {
  const row = store.db.select().from(t.calendars).where(eq(t.calendars.id, calendarId)).get();
  if (!row) throw notFound('No such calendar.');
  return row;
}

/** The source a calendar's changes go through. */
export function calendarSourceId(store: Store, calendarId: number): number | null {
  const row = calendar(store, calendarId);
  const source = row.provider === 'todoist'
    ? store.db.select().from(t.sources).where(eq(t.sources.provider, 'todoist')).orderBy(asc(t.sources.dev)).get()
    : row.accountId === null ? undefined : store.db.select().from(t.sources).where(and(eq(t.sources.provider, 'google_calendar'), eq(t.sources.accountId, row.accountId))).get();
  return source?.id ?? null;
}

function item(store: Store, itemId: number): ItemRow {
  const row = store.db.select().from(t.items).where(eq(t.items.id, itemId)).get();
  if (!row || row.cancelled) throw notFound('No such item.');
  return row;
}

export function createItem(store: Store, input: ItemCreateInput): CommandRow {
  const target = calendar(store, input.calendar_id);
  if ((target.provider === 'todoist') !== (input.kind === 'task')) throw invalid(input.kind === 'task' ? 'Tasks go in Todoist.' : 'Events go in a Google calendar.');
  if (input.kind === 'task' && input.colour) throw invalid('Todoist tasks have no colour of their own.');
  if (input.kind === 'event' && (input.labels.length || input.repeat)) throw invalid('Labels and a Todoist repeat are a task\'s; an event repeats by its rule.');
  const settings = getSettings(store);
  return createCommand(store, {
    target: 'item', kind: 'item_create', sourceId: calendarSourceId(store, input.calendar_id), payload: {input},
    prepare: () => {
      const id = store.db.insert(t.items).values({
        calendarId: input.calendar_id, providerId: localProviderId(), kind: input.kind, title: input.title, allDay: input.all_day,
        startsAt: input.starts_at, endsAt: input.ends_at, startDate: input.start_date, endDate: input.end_date, dueDate: input.due_date, dueAt: input.due_at,
        timeZone: input.time_zone ?? (input.recurrence ? store.timeZone : null), recurrence: input.recurrence, place: input.place, address: input.address,
        attendees: input.attendees, reminders: input.reminders ?? (input.kind === 'event' && settings.reminders.event_minutes_before !== null ? [settings.reminders.event_minutes_before] : []), leaveReminder: input.kind === 'event' && input.leave_reminder, project: input.project, colour: input.colour,
        labels: input.labels, dueString: input.repeat, dueRecurring: input.repeat !== null,
      }).returning({id: t.items.id}).get().id;
      return {targetId: id, previous: {created: [id]}, touched: {items: [id], calendars: [input.calendar_id]}};
    },
  });
}

/** A change, with its recurring scope when it's an occurrence of a recurring event. */
export function updateItem(store: Store, itemId: number, input: ItemUpdateInput): CommandRow {
  const row = item(store, itemId);
  if (row.readOnly) throw invalid('Google Calendar doesn\'t let this kind of event be changed here.');
  if (row.kind === 'task' && row.recurringItemId !== null) throw invalid('A completed occurrence can\'t be changed.');
  if (row.kind === 'event' && ((input.changes.labels?.length ?? 0) > 0 || input.changes.repeat)) throw invalid('Labels and a Todoist repeat are a task\'s; an event repeats by its rule.');
  const changes = {...input.changes};
  if (row.kind === 'task' && (changes.due_date !== undefined || changes.due_at !== undefined || changes.repeat !== undefined)) {
    // A new date goes to Todoist with the repeat in one due string, or Todoist would drop the repeat (D16).
    const repeat = repeatAfter(row, changes.repeat);
    if (repeat === undefined) throw invalid('Todoist didn\'t say how this task repeats, so its date changes in Todoist.');
    changes.repeat = repeat;
  }
  const problem = whenProblem({kind: row.kind, ...whenOf(row), ...changes});
  if (problem && !(row.recurrence && row.recurringItemId === null)) throw invalid(problem);
  if (row.kind === 'task' && changes.colour) throw invalid('Todoist tasks have no colour of their own.');
  const moving = changes.calendar_id !== undefined && changes.calendar_id !== row.calendarId;
  if (moving) {
    const from = calendar(store, row.calendarId);
    const to = calendar(store, changes.calendar_id!);
    if (to.provider !== from.provider) throw invalid('An item stays an event or a task.');
    // Google's events.move: within one Google account, and a series as a whole (it refuses an
    // occurrence, "cannotChangeOrganizerOfInstance"); This and following starts a new series there.
    if (row.kind === 'event' && to.accountId !== from.accountId) throw invalid('An event moves only between calendars of the same Google account.');
    if (row.kind === 'event' && (row.recurrence || row.recurringItemId !== null) && input.scope === 'this') {
      throw invalid('Google Calendar moves a repeating event to another calendar only as a series: choose This and following or All events.');
    }
  }
  return createCommand(store, {
    target: 'item', kind: 'item_update', sourceId: calendarSourceId(store, row.calendarId),
    payload: {item_id: row.id, changes, scope: input.scope, occurrence_start: input.occurrence_start, ...(moving ? {from_calendar_id: row.calendarId} : {})},
    prepare: () => {
      const result = changeItemInMirror(store, row, changes, input.scope, input.occurrence_start, store.timeZone);
      return {targetId: result.targetId, previous: result.previous, previousWhen: result.previousWhen, touched: {items: result.touched, calendars: [row.calendarId]}};
    },
  });
}

/** Deletes once the provider confirms; until then the item shows pending. */
export function deleteItem(store: Store, itemId: number, input: ItemScopeInput): CommandRow {
  const row = item(store, itemId);
  if (row.readOnly) throw invalid('Google Calendar doesn\'t let this kind of event be deleted here.');
  if (row.kind === 'task' && row.recurringItemId !== null) throw invalid('A completed occurrence can\'t be deleted.');
  if (row.recurrence && row.recurringItemId === null && input.scope !== 'all' && !input.occurrence_start) throw invalid('Name the occurrence (occurrence_start) to delete part of a recurring event.');
  return createCommand(store, {
    target: 'item', kind: 'item_delete', sourceId: calendarSourceId(store, row.calendarId),
    payload: {item_id: row.id, scope: input.scope, occurrence_start: input.occurrence_start},
    prepare: () => ({targetId: row.id, previousWhen: whenOf(row), touched: {items: [row.id], calendars: [row.calendarId]}}),
  });
}

/**
 * Completes or reopens a task. A repeating task completes one occurrence, named by its due date
 * (v1's tasks-service): only the one Todoist has open now, and only once. The completed occurrence
 * becomes a row of its own, done on its day, which stays after Todoist moves the task on (the
 * tombstone); the task itself is hidden on that day meanwhile.
 */
export function completeItem(store: Store, itemId: number, done: boolean, occurrenceDate: string | null = null): CommandRow {
  const row = item(store, itemId);
  if (row.kind !== 'task') throw invalid('Only tasks are completed.');
  if (row.dueRecurring && row.recurringItemId === null) {
    if (!done) throw invalid('A repeating task reopens in Todoist.');
    const date = occurrenceDate ?? row.dueDate!;
    if (date !== row.dueDate) throw conflict('occurrence_not_open', `This task isn't open on ${date} in Todoist.`);
    const already = store.db.select({id: t.items.id}).from(t.items).where(and(eq(t.items.recurringItemId, row.id), eq(t.items.originalStart, date))).get();
    if (already) throw conflict('unchanged', 'That occurrence is already done.');
    return createCommand(store, {
      target: 'item', kind: 'item_complete', sourceId: calendarSourceId(store, row.calendarId), payload: {item_id: row.id, done, occurrence_date: date},
      prepare: () => {
        const {id: _id, ...base} = row;
        const id = store.db.insert(t.items).values({
          ...base, providerId: `${row.providerId}@${date}`, recurringItemId: row.id, originalStart: date, dueDate: date, doneAt: isoNow(store), cancelled: false,
        }).returning({id: t.items.id}).get().id;
        return {targetId: id, previous: {created: [id]}, touched: {items: [id, row.id], calendars: [row.calendarId]}};
      },
    });
  }
  if (row.recurringItemId !== null && !done) throw invalid('A repeating task reopens in Todoist.');
  if ((row.doneAt !== null) === done) throw conflict('unchanged', done ? 'That task is already done.' : 'That task is already open.');
  return createCommand(store, {
    target: 'item', kind: done ? 'item_complete' : 'item_reopen', sourceId: calendarSourceId(store, row.calendarId), payload: {item_id: row.id, done},
    prepare: () => {
      store.db.update(t.items).set({doneAt: done ? isoNow(store) : null}).where(eq(t.items.id, row.id)).run();
      return {targetId: row.id, previous: {items: [row]}, touched: {items: [row.id], calendars: [row.calendarId]}};
    },
  });
}

/**
 * SV-20 (D33): a Google calendar's colour, picked from the swatches and written to the user's calendar
 * list at Google, so Google's own app matches. It shows at once, pending until Google confirms.
 */
export function setCalendarColour(store: Store, calendarId: number, colour: Colour): CommandRow {
  const row = calendar(store, calendarId);
  if (row.provider !== 'google') throw invalid('Todoist has no calendar colour; it shows its ring.');
  if (row.colour === colour) throw conflict('unchanged', 'That calendar already has that colour.');
  return createCommand(store, {
    target: 'calendar', kind: 'calendar_colour', sourceId: calendarSourceId(store, row.id), payload: {colour},
    prepare: () => {
      store.db.update(t.calendars).set({colour}).where(eq(t.calendars.id, row.id)).run();
      return {targetId: row.id, previous: {calendars: [{id: row.id, colour: row.colour}]}, touched: {calendars: [row.id]}};
    },
  });
}

/**
 * SV-25 (D54): a Todoist project's colour, picked from Todoist's own and written to Todoist, so its
 * apps match; its tasks' rings take it. It shows at once, pending until Todoist confirms.
 */
export function setProjectColour(store: Store, providerId: string, colour: TodoistColour): CommandRow {
  const row = store.db.select().from(t.todoistProjects).where(eq(t.todoistProjects.providerId, providerId)).get();
  if (!row) throw notFound('No such Todoist project.');
  if (row.colour === colour) throw conflict('unchanged', 'That project already has that colour.');
  // Todoist's calendar row stands for its tasks in the live event, so the rings redraw.
  const calendarId = todoistCalendar(store).id;
  return createCommand(store, {
    target: 'project', kind: 'project_colour', sourceId: calendarSourceId(store, calendarId), payload: {colour},
    prepare: () => {
      store.db.update(t.todoistProjects).set({colour}).where(eq(t.todoistProjects.id, row.id)).run();
      return {targetId: row.id, previous: {projects: [{id: row.id, colour: row.colour as TodoistColour | null}]}, touched: {calendars: [calendarId]}};
    },
  });
}
