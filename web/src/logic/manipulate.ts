// Direct manipulation on the month grid (DESIGN.md › Drag; BRIEF.md › Calendar): dropping an item on
// another day, cloning it, copying and pasting, and selecting several. Rewritten from v1's
// `calendarQuickActionModel` and `calendarDeadlineRescheduleModel` through the harvest gate (darma
// SV-15): days move by calendar days and keep the wall-clock time in the owner's zone, so a drag
// across a daylight-saving change keeps 7 AM at 7 AM (v1's DST fix); a drop on the same day does
// nothing; a task moves by whole days, keeping its time if it has one; a repeating task, a done task,
// Google's own kinds of event and an item whose last change hasn't settled don't move.
import type {CommandOut, ItemChanges, ItemCreateInput, ItemOut, RecurringScope} from '@setpoint/shared';
import {dayTitle, itemDays, timeRange} from './calendar.ts';
import {addDays, clockTime, daysBetween, instantAt, localDate, minutesOf} from './format.ts';

/** Whether an item can be dragged to another day. */
export function canMove(item: ItemOut): boolean {
  if (item.read_only || item.command) return false;
  if (item.kind === 'task') return !item.recurring && !item.done;
  return true;
}

/** An instant moved by whole local days, keeping its wall-clock time. */
const shiftInstant = (at: string, days: number, timeZone: string) => instantAt(addDays(localDate(at, timeZone), days), minutesOf(at, timeZone), timeZone);

/** An item's time fields moved `days` days, as a change. */
export function shiftedBy(item: ItemOut, days: number, timeZone: string): ItemChanges {
  if (item.kind === 'task') {
    return {due_date: item.due_date ? addDays(item.due_date, days) : null, ...(item.due_at ? {due_at: shiftInstant(item.due_at, days, timeZone)} : {})};
  }
  if (item.all_day) return {start_date: addDays(item.start_date!, days), end_date: addDays(item.end_date!, days)};
  return {starts_at: shiftInstant(item.starts_at!, days, timeZone), ends_at: shiftInstant(item.ends_at!, days, timeZone)};
}

/** The day an item is on (its first, for an all-day event over several). */
export const dayOf = (item: ItemOut, timeZone: string) => itemDays(item, timeZone)[0] ?? null;

/** The change a drop on `to` makes, or null when it lands on its own day (v1: a same-day drop does nothing). */
export function dropChange(item: ItemOut, to: string, timeZone: string): ItemChanges | null {
  const from = dayOf(item, timeZone);
  if (!from || from === to) return null;
  return shiftedBy(item, daysBetween(from, to), timeZone);
}

/** The drag's tooltip (board 15): "Thu, Oct 8 · 7:00 AM"; an all-day event "Thu, Oct 8 · All day"; a task "Thu, Oct 8". */
export function dropLabel(item: ItemOut, to: string, timeZone: string): string {
  if (item.kind === 'task') return item.due_at ? `${dayTitle(to)} · ${clockTime(item.due_at, timeZone)}` : dayTitle(to);
  if (item.all_day || !item.starts_at) return `${dayTitle(to)} · All day`;
  return `${dayTitle(to)} · ${clockTime(item.starts_at, timeZone)}`;
}

/** The band at the month grid's top and bottom edges where a held drag scrolls it, and its fastest step. */
export const EDGE_SCROLL = {bandPx: 48, maxStepPx: 18} as const;

/**
 * How far the month grid scrolls each frame while a drag is held near its top or bottom edge (F6b):
 * up near the top, down near the bottom, faster the nearer the edge (and at full speed past it), and
 * not at all elsewhere. Measured in the month section's CSS pixels (geometry.ts), so the 1.25 zoom
 * from 2200 px changes nothing.
 */
export function edgeScroll(pointer: number, top: number, bottom: number): number {
  const {bandPx, maxStepPx} = EDGE_SCROLL;
  const into = (depth: number) => Math.ceil(maxStepPx * Math.min(1, depth / bandPx));
  if (pointer < top + bandPx) return -into(top + bandPx - pointer);
  if (pointer > bottom - bandPx) return into(pointer - (bottom - bandPx));
  return 0;
}

/** An item as it would be once moved: what the grid draws while a drop waits on its scope. */
export function movedItem(item: ItemOut, changes: ItemChanges): ItemOut {
  return {...item, ...changes} as ItemOut;
}

/**
 * A new item as the grid draws it the moment it's asked for (a create, Clone, Paste): pending, with
 * a negative id so it can't be selected or dragged, until the server's own item takes its place.
 */
export function pendingItem(input: ItemCreateInput, id: number, at: string): ItemOut {
  const command: CommandOut = {id: 0, target: 'item', target_id: id, kind: 'item_create', state: 'pending', provider: null, provider_message: null,
    can_retry: false, can_move_back: false, previous: null, created_at: at, settled_at: null};
  return {
    // copyOf and the editor leave the server's defaults out (no repeat, no labels).
    ...input, key: `new:${-id}`, id, recurring: !!input.recurrence || !!input.repeat, occurrence_start: null, reminders: input.reminders ?? [],
    labels: input.labels ?? [], repeat: input.repeat ?? null, done: false, done_at: null, command, read_only: false, due_string: input.repeat ?? null, time_to_leave: null,
  };
}

/**
 * A create asked for here: its drafts, the ids of the items listed when it was asked for, and once
 * it has answered, the ids of the items it made.
 */
export interface Creating {
  drafts: ItemOut[];
  listed: ReadonlySet<number>;
  made?: number[];
}

/** Where an item starts, as the grid places it. */
const startOf = (item: ItemOut) => [item.starts_at && Date.parse(item.starts_at), item.start_date, item.due_date, item.due_at && Date.parse(item.due_at)].join();

/**
 * The items to draw while creates are on their way. A live load can list the server's copy of a new
 * item before its create has answered, and the provider may have confirmed it by then: while any
 * create waits, an item that wasn't listed when it was asked for, isn't one an answered create made,
 * and is one of its drafts (its title, calendar and start) is that copy, and the draft is drawn
 * instead. An answered create's items are the server's own.
 */
export function withCreating(items: ItemOut[], creating: Creating[]): ItemOut[] {
  const waiting = creating.filter(one => !one.made);
  if (!waiting.length) return items;
  const made = new Set(creating.flatMap(one => one.made ?? []));
  const copy = (item: ItemOut) => !made.has(item.id) && waiting.some(one => !one.listed.has(item.id)
    && one.drafts.some(draft => draft.title === item.title && draft.calendar_id === item.calendar_id && startOf(draft) === startOf(item)));
  return [...items.filter(item => !copy(item)), ...waiting.flatMap(one => one.drafts)];
}

/**
 * An item as drawn after Try again on its failed change: pending at once (SV-42), until the server
 * lists that change as anything but the failure that was retried. `retried` holds each retried
 * change's id and when it had failed.
 */
export function asRetried(item: ItemOut, retried: ReadonlyMap<number, string | null>): ItemOut {
  const command = item.command;
  if (command?.state !== 'failed' || !retried.has(command.id) || retried.get(command.id) !== command.settled_at) return item;
  return {...item, command: {...command, state: 'pending', provider_message: null, settled_at: null, can_retry: false, can_move_back: false}};
}

/** A delete asked for here: the item, and for a recurring event the occurrence and its scope. */
export interface Deleting {
  id: number;
  scope: RecurringScope;
  occurrence_start: string | null;
}

/**
 * Whether a delete asked for here takes `item` off the grid at once, before the provider confirms:
 * the occurrence itself, every later one (This and following) or the whole series (All).
 */
export function deletes(entry: Deleting, item: ItemOut): boolean {
  if (item.id !== entry.id) return false;
  if (entry.scope === 'all' || !entry.occurrence_start || !item.occurrence_start) return true;
  return entry.scope === 'following' ? item.occurrence_start >= entry.occurrence_start : item.occurrence_start === entry.occurrence_start;
}

/** The change that puts back what `changes` changed on `item`: ⌘Z after a move, a colour or an edit. */
export function inverseOf(item: ItemOut, changes: ItemChanges): ItemChanges {
  return Object.fromEntries(Object.keys(changes).map(key => [key, item[key as keyof ItemChanges]])) as ItemChanges;
}

/**
 * A new item like `item`, `days` days later (Clone is 0; Paste is the distance to the day pasted
 * on). A copy of one occurrence is an event of its own: it doesn't repeat (v1 did the same).
 */
export function copyOf(item: ItemOut, days: number, timeZone: string): ItemCreateInput {
  const when = {all_day: item.all_day, starts_at: item.starts_at, ends_at: item.ends_at, start_date: item.start_date, end_date: item.end_date, due_date: item.due_date, due_at: item.due_at};
  return {
    kind: item.kind, calendar_id: item.calendar_id, title: item.title, ...when, ...(days ? shiftedBy(item, days, timeZone) : {}),
    time_zone: item.time_zone, recurrence: null, place: item.place, address: item.address, attendees: [], reminders: item.reminders,
    leave_reminder: item.leave_reminder, project: item.project, colour: item.colour,
  } as ItemCreateInput;
}

/** Pasting copied items on `to`: the first one's day lands there, and the others keep their distance from it. */
export function pasteOn(items: ItemOut[], to: string, timeZone: string): ItemCreateInput[] {
  const days = items.map(item => dayOf(item, timeZone));
  const first = days.filter((day): day is string => day !== null).sort()[0];
  if (!first) return [];
  return items.flatMap((item, index) => (days[index] ? [copyOf(item, daysBetween(first, to), timeZone)] : []));
}

/**
 * The selection after a click: a plain click selects the item alone; ⌘, Ctrl or ⇧ adds it, or takes
 * it out if it was in (multi-select).
 */
export function selectWith(selected: string[], key: string, additive: boolean): string[] {
  if (!additive) return [key];
  return selected.includes(key) ? selected.filter(one => one !== key) : [...selected, key];
}

/** What the failed card says (board 19b): "Couldn't move Dinner with Sam". */
export function failedTitle(item: ItemOut): string {
  const kind = item.command?.kind;
  const previous = item.command?.previous;
  const moved = previous && (previous.starts_at !== item.starts_at || previous.start_date !== item.start_date || previous.due_date !== item.due_date);
  const verb = kind === 'item_create' ? 'create' : kind === 'item_delete' ? 'delete' : kind === 'item_complete' ? 'complete' : kind === 'item_reopen' ? 'reopen' : moved ? 'move' : 'change';
  return `Couldn't ${verb} ${item.title}`;
}

/** The failed card's "From Fri, Oct 9" (another day) or "From 7:00 – 9:00 PM" (the same day); null when it didn't move. */
export function failedFrom(item: ItemOut, timeZone: string): string | null {
  const previous = item.command?.previous;
  if (!previous || item.command?.kind !== 'item_update') return null;
  const before = {...item, ...previous} as ItemOut;
  const was = dayOf(before, timeZone);
  const now = dayOf(item, timeZone);
  if (was && now && was !== now) return `From ${dayTitle(was)}`;
  if (item.kind === 'event' && previous.starts_at !== item.starts_at) return `From ${timeRange(before, timeZone)}`;
  return null;
}
