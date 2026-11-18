// The overdue banner's rules (app/OverdueBanner.tsx): which tasks an arrival lists, in what order,
// how many before "and 3 more", the words for when each was due, which titles return to Today on
// the way out and how long that takes, and the snooze: when each preset ends, which tasks a snooze
// holds off, and which snoozes the browser keeps (app/overdueSnoozed.ts). Which tasks are overdue
// is logic/overdue.ts's; this looks 30 days back.
import type {ItemOut} from '@setpoint/shared';
import {addDays, clockTime, daysBetween, instantAt, localDate} from './format.ts';
import type {Overdue} from './overdue.ts';
import {taskTimeMinutes} from './reminders.ts';
import {overdue as timing} from '../tokens.ts';

/** A snooze's presets, in the menu's order. */
export type SnoozeChoice = 'hour' | 'threeHours' | 'tomorrow';
export const SNOOZES: readonly {choice: SnoozeChoice; label: string}[] = [
  {choice: 'hour', label: '1 hour'},
  {choice: 'threeHours', label: '3 hours'},
  {choice: 'tomorrow', label: 'Tomorrow'},
];

/** A snooze: a task by its id, at the due it had, held off the banner until `until` (ms). */
export interface Snooze {
  id: number;
  due: string;
  until: number;
}

const HOUR = 3_600_000;
const dueOf = (item: ItemOut) => item.due_at ?? item.due_date ?? '';

/** A snooze of `item` at its due now, until `until`. */
export function snoozeFor(item: ItemOut, until: number): Snooze {
  return {id: item.id, due: dueOf(item), until};
}

/**
 * When a preset picked at `now` ends: an hour or three on, or tomorrow, the user's next date, at
 * Settings' task time (`taskTime`, "08:30"), else the untimed tasks' default.
 */
export function snoozeUntil(choice: SnoozeChoice, now: number, taskTime: string | null, timeZone: string): number {
  if (choice === 'hour') return now + HOUR;
  if (choice === 'threeHours') return now + 3 * HOUR;
  return Date.parse(instantAt(addDays(localDate(now, timeZone), 1), taskTimeMinutes(taskTime), timeZone));
}

const holds = (snooze: Snooze, item: ItemOut) => snooze.id === item.id && snooze.due === dueOf(item);

/** Whether a snooze holds `item` off the banner at `now`: one for it at its current due, not yet ended. */
export function isSnoozed(item: ItemOut, snoozes: readonly Snooze[], now: number): boolean {
  return snoozes.some(snooze => snooze.until > now && holds(snooze, item));
}

/**
 * The snoozes still worth keeping at an arrival over `items`: those not yet ended whose task is
 * still there, open, at the same due. A task rescheduled, completed, or gone from the banner's days
 * is no longer snoozed; one whose change is still on its way to Todoist keeps it, in case it fails.
 */
export function keptSnoozes(snoozes: readonly Snooze[], items: readonly ItemOut[], now: number): Snooze[] {
  return snoozes.filter(snooze => snooze.until > now && items.some(item => item.kind === 'task' && !item.done && holds(snooze, item)));
}

/** How many days back an arrival looks for overdue tasks. */
export const OVERDUE_DAYS = 30;
/** How many of several tasks are listed before the rest fold into "and N more". */
export const LISTED = 4;

/** The range to load for it: the last 30 days through today, `to` exclusive. */
export function bannerRange(now: number, timeZone: string): {from: string; to: string} {
  const today = localDate(now, timeZone);
  return {from: addDays(today, -OVERDUE_DAYS), to: addDays(today, 1)};
}

const dueDay = (item: ItemOut, timeZone: string) => (item.due_at ? localDate(item.due_at, timeZone) : item.due_date!);

// When it fell due: a timed task at its time, an untimed one as its day ends.
const fellDue = (item: ItemOut, timeZone: string) =>
  (item.due_at ? Date.parse(item.due_at) : Date.parse(instantAt(item.due_date!, 1440, timeZone)));

/** The tasks an arrival lists: every overdue one, the most recently due first. */
export function arrivalTasks(overdue: readonly Overdue[], timeZone: string): Overdue[] {
  return [...overdue].sort((a, b) => fellDue(b.item, timeZone) - fellDue(a.item, timeZone));
}

/** Several tasks' list: the first four, and how many more fold into "and N more". */
export function listed<T>(tasks: readonly T[]): {listed: T[]; more: number} {
  return {listed: tasks.slice(0, LISTED), more: Math.max(0, tasks.length - LISTED)};
}

/**
 * The way out: of the tasks drawn (one task's title, or several's listed four), the ones due today
 * return to their line in Today, in the order drawn; the rest, from earlier days, fade where they
 * are. Tasks under "and N more" aren't drawn, so they do neither.
 */
export function exitSplit(tasks: readonly Overdue[]): {returning: Overdue[]; fading: Overdue[]} {
  const drawn = listed(tasks).listed;
  return {returning: drawn.filter(task => task.today), fading: drawn.filter(task => !task.today)};
}

/**
 * How long the way out lasts, once `flying` titles leave 50 ms apart: until the last has landed
 * and its line's tint (or the icon's, `toIcon`) has gone. With none flying, until the veil has faded.
 */
export function exitLength(flying: number, toIcon: boolean): number {
  const faded = Math.max(timing.rest, timing.veilOutDelay + timing.veilOut);
  if (!flying) return faded;
  return Math.max(faded, (flying - 1) * timing.flyStagger + timing.fly + (toIcon ? timing.iconLand : timing.land));
}

const onDay = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {...options, timeZone: 'UTC'});
const dateOf = (day: string, today: string) =>
  onDay(day, day.slice(0, 4) === today.slice(0, 4) ? {month: 'short', day: 'numeric'} : {month: 'short', day: 'numeric', year: 'numeric'});

/** One task's due line: "Due today, 8:00 AM", "Due yesterday, 5:00 PM", "Due Monday", "Due Nov 13". */
export function dueLine(item: ItemOut, now: number, timeZone: string): string {
  const today = localDate(now, timeZone);
  const day = dueDay(item, timeZone);
  const days = daysBetween(day, today);
  const when = days === 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? onDay(day, {weekday: 'long'}) : dateOf(day, today);
  return `Due ${when}${item.due_at ? `, ${clockTime(item.due_at, timeZone)}` : ''}`;
}

/** A listed task's short due: "8:00 AM" today, else "Yesterday", "Mon", "Nov 13". */
export function shortDue(item: ItemOut, now: number, timeZone: string): string {
  const today = localDate(now, timeZone);
  const day = dueDay(item, timeZone);
  const days = daysBetween(day, today);
  if (days === 0) return item.due_at ? clockTime(item.due_at, timeZone) : 'Today';
  if (days === 1) return 'Yesterday';
  return days < 7 ? onDay(day, {weekday: 'short'}) : dateOf(day, today);
}
