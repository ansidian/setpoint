// The overdue banner's rules (app/OverdueBanner.tsx): which tasks an arrival lists, in what order,
// how many before "and 3 more", the words for when each was due, which titles return to Today on
// the way out and how long that takes, and the browser's record of the tasks it has shown. Which tasks are overdue is logic/overdue.ts's; this looks 30 days back.
import type {ItemOut} from '@setpoint/shared';
import {addDays, clockTime, daysBetween, instantAt, localDate} from './format.ts';
import type {Overdue} from './overdue.ts';
import {overdue as timing} from '../tokens.ts';

/** How many days back an arrival looks for overdue tasks. */
export const OVERDUE_DAYS = 30;
/** How many of several tasks are listed before the rest fold into "and N more". */
export const LISTED = 4;

/** The range to load for it: the last 30 days through today, `to` exclusive. */
export function bannerRange(now: number, timeZone: string): {from: string; to: string} {
  const today = localDate(now, timeZone);
  return {from: addDays(today, -OVERDUE_DAYS), to: addDays(today, 1)};
}

/**
 * A task as this browser remembers it: its id with its due. A task rescheduled and missed again is
 * a new one, so it shows again.
 */
export const shownKey = (item: ItemOut): string => `${item.id}@${item.due_at ?? item.due_date}`;

const dueDay = (item: ItemOut, timeZone: string) => (item.due_at ? localDate(item.due_at, timeZone) : item.due_date!);

// When it fell due: a timed task at its time, an untimed one as its day ends.
const fellDue = (item: ItemOut, timeZone: string) =>
  (item.due_at ? Date.parse(item.due_at) : Date.parse(instantAt(item.due_date!, 1440, timeZone)));

/** The tasks an arrival lists: the overdue ones this browser hasn't shown, the most recently due first. */
export function arrivalTasks(overdue: readonly Overdue[], shown: ReadonlySet<string>, timeZone: string): Overdue[] {
  return overdue.filter(task => !shown.has(shownKey(task.item)))
    .sort((a, b) => fellDue(b.item, timeZone) - fellDue(a.item, timeZone));
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

/** The stored record as it reads back: its keys, or none if it isn't one. */
export function readShown(stored: string | null): string[] {
  try {
    const keys: unknown = JSON.parse(stored ?? '[]');
    return Array.isArray(keys) ? keys.filter((key): key is string => typeof key === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The record after showing `keys`: once each, without the ones due before the 30 days an arrival
 * looks back, which can't show again, so it doesn't grow.
 */
export function addShown(stored: readonly string[], keys: readonly string[], now: number, timeZone: string): string[] {
  const from = bannerRange(now, timeZone).from;
  const kept = (key: string) => {
    const due = key.slice(key.indexOf('@') + 1);
    const day = /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : Number.isNaN(Date.parse(due)) ? null : localDate(due, timeZone);
    return day !== null && day >= from;
  };
  return [...new Set([...stored, ...keys])].filter(kept);
}
