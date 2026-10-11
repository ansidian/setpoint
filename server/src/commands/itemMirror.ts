// Calendar changes as the mirror shows them, including recurring scope (This event, This and
// following, All events), in Google's model: a recurring item with an RFC 5545 rule, and exceptions
// for single occurrences (`recurring_item_id` + `original_start`; a deleted occurrence is a
// cancelled exception). The command layer applies these up front (or, for deletes, on
// confirmation); a provider adapter makes the same change at the provider.
import {randomBytes} from 'node:crypto';
import type {ItemChanges, ItemWhen, RecurringScope} from '@setpoint/shared';
import {and, eq, inArray} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {localDay, weekday} from '../domain/time.ts';
import {invalid} from '../errors.ts';
import {transaction} from '../store.ts';
import type {Store} from '../store.ts';

export type ItemRow = typeof t.items.$inferSelect;
export type ItemSnapshot = ItemRow;

const RRULE_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export const localProviderId = () => `local-${randomBytes(9).toString('base64url')}`;

export function whenOf(row: Pick<ItemRow, 'allDay' | 'startsAt' | 'endsAt' | 'startDate' | 'endDate' | 'dueDate' | 'dueAt'>): ItemWhen {
  return {all_day: row.allDay, starts_at: row.startsAt, ends_at: row.endsAt, start_date: row.startDate, end_date: row.endDate, due_date: row.dueDate, due_at: row.dueAt};
}

/** API changes as columns. */
export function changeColumns(changes: ItemChanges): Partial<ItemRow> {
  const columns: Partial<ItemRow> = {};
  const map: [keyof ItemChanges, keyof ItemRow][] = [
    ['calendar_id', 'calendarId'], ['title', 'title'], ['all_day', 'allDay'], ['starts_at', 'startsAt'], ['ends_at', 'endsAt'],
    ['start_date', 'startDate'], ['end_date', 'endDate'], ['due_date', 'dueDate'], ['due_at', 'dueAt'], ['time_zone', 'timeZone'],
    ['recurrence', 'recurrence'], ['place', 'place'], ['address', 'address'], ['attendees', 'attendees'], ['reminders', 'reminders'], ['leave_reminder', 'leaveReminder'], ['project', 'project'], ['colour', 'colour'], ['labels', 'labels'],
  ];
  for (const [from, to] of map) if (changes[from] !== undefined) (columns as Record<string, unknown>)[to] = changes[from];
  // A task's repeat is its due words until Todoist answers with its own (F6b).
  if (changes.repeat !== undefined) Object.assign(columns, {dueString: changes.repeat, dueRecurring: changes.repeat !== null});
  return columns;
}

/** Replaces UNTIL (and any COUNT) so the series ends before `before`. */
export function endRuleBefore(rule: string, before: string): string {
  const until = new Date(Date.parse(before) - 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const parts = rule.replace(/^RRULE:/, '').split(';').filter(part => part && !/^(UNTIL|COUNT)=/.test(part));
  return `RRULE:${[...parts, `UNTIL=${until}`].join(';')}`;
}

/** Moves a weekly rule's day: Gym on Wednesdays moved to Thursday for all events is MO,TH,FR. */
export function swapRuleDay(rule: string, from: number, to: number): string {
  if (from === to) return rule;
  return rule.replace(/BYDAY=([A-Z,]+)/, (_, days: string) => {
    const list = days.split(',').map(day => (day === RRULE_DAYS[from] ? RRULE_DAYS[to]! : day));
    return `BYDAY=${[...new Set(list)].sort((a, b) => ((RRULE_DAYS.indexOf(a) + 6) % 7) - ((RRULE_DAYS.indexOf(b) + 6) % 7)).join(',')}`;
  });
}

function snapshot(store: Store, ids: number[]): ItemSnapshot[] {
  return ids.length ? store.db.select().from(t.items).where(inArray(t.items.id, ids)).all() : [];
}

/** Move back: deletes what the change created and puts the changed rows back as they were. */
export function restoreItems(store: Store, rows: ItemSnapshot[], created: number[]) {
  if (created.length) store.db.delete(t.items).where(inArray(t.items.id, created)).run();
  for (const row of rows) {
    const {id, ...rest} = row;
    const updated = store.db.update(t.items).set(rest).where(eq(t.items.id, id)).run();
    if (!updated.changes) store.db.insert(t.items).values(row).run();
  }
}

/** One occurrence of a recurring item: its start and end. */
function occurrenceOf(master: ItemRow, occurrenceStart: string) {
  const duration = Date.parse(master.endsAt!) - Date.parse(master.startsAt!);
  return {startsAt: occurrenceStart, endsAt: new Date(Date.parse(occurrenceStart) + duration).toISOString()};
}

function newRow(store: Store, values: Omit<ItemRow, 'id'>): number {
  return store.db.insert(t.items).values(values).returning({id: t.items.id}).get().id;
}

export interface ItemChangeResult {
  // The item the change is about: the one changed, or the exception made for one occurrence.
  targetId: number;
  previous: {items: ItemSnapshot[]; created: number[]};
  previousWhen: ItemWhen;
  touched: number[];
}

/**
 * Applies a change to the mirror. A recurring item's occurrence (`occurrenceStart`) changes alone
 * (an exception), with the ones after it (the series splits), or with every one (the series moves,
 * past ones too, and a weekly rule follows the day).
 */
export function changeItemInMirror(store: Store, item: ItemRow, changes: ItemChanges, scope: RecurringScope, occurrenceStart: string | null, timeZone: string): ItemChangeResult {
  const columns = changeColumns(changes);
  // An exception changed on its own is a plain change; with following or all, its series changes.
  if (item.recurringItemId !== null && scope !== 'this') {
    const master = store.db.select().from(t.items).where(eq(t.items.id, item.recurringItemId)).get()!;
    return changeItemInMirror(store, master, changes, scope, item.originalStart, timeZone);
  }
  if (!item.recurrence || item.recurringItemId !== null) {
    const previous = snapshot(store, [item.id]);
    store.db.update(t.items).set(columns).where(eq(t.items.id, item.id)).run();
    return {targetId: item.id, previous: {items: previous, created: []}, previousWhen: whenOf(item), touched: [item.id]};
  }
  if (!occurrenceStart) throw invalid('Name the occurrence (occurrence_start) to change a recurring event.');
  if (item.allDay || !item.startsAt) throw invalid('Changing one occurrence of a recurring all-day event isn\'t supported yet.');
  const occurrence = occurrenceOf(item, occurrenceStart);
  const previousWhen = {...whenOf(item), starts_at: occurrence.startsAt, ends_at: occurrence.endsAt};
  const {id: _id, ...base} = item;

  if (scope === 'this') {
    const id = newRow(store, {
      ...base, startsAt: occurrence.startsAt, endsAt: occurrence.endsAt, recurrence: null, providerId: localProviderId(),
      recurringItemId: item.id, originalStart: occurrenceStart, cancelled: false, ...columns,
    });
    return {targetId: id, previous: {items: [], created: [id]}, previousWhen, touched: [id, item.id]};
  }

  // Following or all: the occurrence's new time sets the series' shift.
  const newStart = columns.startsAt ?? occurrence.startsAt;
  const newEnd = columns.endsAt ?? new Date(Date.parse(occurrence.endsAt) + Date.parse(newStart) - Date.parse(occurrence.startsAt)).toISOString();
  const shift = Date.parse(newStart) - Date.parse(occurrence.startsAt);
  const duration = Date.parse(newEnd) - Date.parse(newStart);
  const fromDay = weekday(localDay(occurrence.startsAt, timeZone));
  const toDay = weekday(localDay(newStart, timeZone));
  const rule = swapRuleDay(columns.recurrence ?? item.recurrence, fromDay, toDay);
  const previous = snapshot(store, [item.id]);

  if (scope === 'all' || occurrenceStart === item.startsAt) {
    const startsAt = new Date(Date.parse(item.startsAt) + shift).toISOString();
    store.db.update(t.items).set({...columns, startsAt, endsAt: new Date(Date.parse(startsAt) + duration).toISOString(), recurrence: rule}).where(eq(t.items.id, item.id)).run();
    // A series moved to another calendar takes its occurrences with it, as Google's events.move does.
    const exceptions = columns.calendarId === undefined ? [] : store.db.select().from(t.items).where(eq(t.items.recurringItemId, item.id)).all();
    if (exceptions.length) store.db.update(t.items).set({calendarId: columns.calendarId}).where(eq(t.items.recurringItemId, item.id)).run();
    return {targetId: item.id, previous: {items: [...previous, ...exceptions], created: []}, previousWhen, touched: [item.id, ...exceptions.map(row => row.id)]};
  }
  store.db.update(t.items).set({recurrence: endRuleBefore(item.recurrence, occurrenceStart)}).where(eq(t.items.id, item.id)).run();
  const id = newRow(store, {
    ...base, ...columns, startsAt: newStart, endsAt: newEnd, recurrence: rule.replace(/;?COUNT=\d+/, ''), providerId: localProviderId(),
    recurringItemId: null, originalStart: null, cancelled: false,
  });
  return {targetId: item.id, previous: {items: previous, created: [id]}, previousWhen, touched: [item.id, id]};
}

export interface ItemDeletion {
  item_id: number;
  scope: RecurringScope;
  occurrence_start: string | null;
}

/** Deletes in the mirror, once the provider confirms: an occurrence, it and the ones after, or the series. */
export function deleteItemInMirror(store: Store, deletion: ItemDeletion) {
  const item = store.db.select().from(t.items).where(eq(t.items.id, deletion.item_id)).get();
  if (!item) return;
  if (item.recurringItemId !== null) {
    if (deletion.scope === 'this') {
      store.db.update(t.items).set({cancelled: true}).where(eq(t.items.id, item.id)).run();
      return;
    }
    deleteItemInMirror(store, {item_id: item.recurringItemId, scope: deletion.scope, occurrence_start: item.originalStart});
    return;
  }
  if (!item.recurrence || deletion.scope === 'all' || !deletion.occurrence_start || deletion.occurrence_start === item.startsAt) {
    if (item.recurrence && deletion.scope === 'this' && deletion.occurrence_start) {
      // The first occurrence alone.
      const {id: _id, ...base} = item;
      newRow(store, {...base, ...occurrenceOf(item, deletion.occurrence_start), recurrence: null, providerId: localProviderId(), recurringItemId: item.id, originalStart: deletion.occurrence_start, cancelled: true});
      return;
    }
    store.db.delete(t.items).where(eq(t.items.id, item.id)).run();
    return;
  }
  if (deletion.scope === 'following') {
    store.db.update(t.items).set({recurrence: endRuleBefore(item.recurrence, deletion.occurrence_start)}).where(eq(t.items.id, item.id)).run();
    return;
  }
  const {id: _id, ...base} = item;
  newRow(store, {...base, ...occurrenceOf(item, deletion.occurrence_start), recurrence: null, providerId: localProviderId(), recurringItemId: item.id, originalStart: deletion.occurrence_start, cancelled: true});
}

/** Gives a mirror row the provider's id, taking it from a row a racing sync made for the same event. */
export function claimProviderId(store: Store, itemId: number, providerId: string, etag?: string | null) {
  transaction(store, () => {
    const row = store.db.select().from(t.items).where(eq(t.items.id, itemId)).get();
    if (!row) return;
    const twin = store.db.select().from(t.items).where(and(eq(t.items.calendarId, row.calendarId), eq(t.items.providerId, providerId))).get();
    if (twin && twin.id !== itemId) store.db.delete(t.items).where(eq(t.items.id, twin.id)).run();
    store.db.update(t.items).set({providerId, ...(etag === undefined ? {} : {etag})}).where(eq(t.items.id, itemId)).run();
  });
}

