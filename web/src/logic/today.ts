// The sidebar's Today block on mail pages: the next event ("2:30 PM  Dentist  in 5h") and the open
// tasks due today, a timed one with its time ("9:00 AM"). They are in one list by time with the
// untimed tasks after. Then, under its own Tomorrow label, come tomorrow's events and its open tasks
// in the same order. Confirmed data only, and nothing for an empty line.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {addDays, clockTime, localDate, startsIn} from './format.ts';
import {isOverdue} from './overdue.ts';
import {completion} from '../tokens.ts';

export interface TodayEvent {
  item: ItemOut;
  id: number;
  key: string;
  title: string;
  time: string;
  in: string;
  // "in 12m" warms as it nears: `soon` from 15 minutes before, `now` once under way.
  urgency: 'soon' | 'now' | null;
  occurrence_start: string | null;
}

/** How near the next event is to warm its "in 12m": within this many minutes it's soon. */
export const SOON_MINUTES = 15;

/** Soon from 15 minutes before an event's start (as "in 15m" reads), now once it's under way. */
export function urgency(startsAt: string, now: number): TodayEvent['urgency'] {
  const minutes = Math.round((Date.parse(startsAt) - now) / 60_000);
  return minutes <= 0 ? 'now' : minutes <= SOON_MINUTES ? 'soon' : null;
}

export interface TodayTask {
  item: ItemOut;
  title: string;
  // A timed task's time ("9:00 AM"), null for one due on a day alone.
  time: string | null;
  // Which label it's under: Today's, or Tomorrow's.
  tomorrow: boolean;
  // A timed task of today's whose time has passed while it's still open: its time shows in caution.
  passed: boolean;
}

/** One of tomorrow's timed events: its time only ("9:00 AM"), the label saying the day. */
export interface TomorrowEvent {
  item: ItemOut;
  key: string;
  title: string;
  time: string;
}

export interface Today {
  event: TodayEvent | null;
  // Today's first, then tomorrow's. None when nothing's due.
  tasks: TodayTask[];
  // Tomorrow's timed events by their start, under the Tomorrow label before its tasks.
  tomorrowEvents: TomorrowEvent[];
  today: string;
  tomorrow: string;
}

/** How many of tomorrow's lines show before the rest fold into one line. */
export const TODAY_TASKS = 3;

/**
 * How long a completed task plays the completion moment: the Today block's line folds away after it.
 */
export const DONE_MOMENT_MS = completion.moment;
/** How long a repeating task's completion is held on the calendar (manipulate.ts › withHeldDone): a little past
 * its moment, which starts a frame or two after the click. */
export const DONE_HELD_MS = DONE_MOMENT_MS + 100;

/** The range to load for it: today and tomorrow, `to` exclusive. */
export function todayRange(now: number, timeZone: string): {from: string; to: string} {
  const from = localDate(now, timeZone);
  return {from, to: addDays(from, 2)};
}

/** Where an item sits in a day's time order: an event's start, a timed task's time. Null for an untimed task. */
export const lineTime = (item: ItemOut): string | null => (item.kind === 'task' ? item.due_at : item.starts_at);

/**
 * The items of the calendars listed in Settings › Calendar, Todoist's included: one switched off
 * there is left out here too. The Calendar sidebar's checkbox is Calendar's own filter, so it doesn't count.
 */
export function onListed(items: ItemOut[], calendars: readonly Pick<CalendarOut, 'id' | 'listed'>[]): ItemOut[] {
  const off = new Set(calendars.filter(calendar => !calendar.listed).map(calendar => calendar.id));
  return off.size ? items.filter(item => !off.has(item.calendar_id)) : items;
}

/**
 * A day's lines in time order: the timed ones by their time, an event before a task at the
 * same time, then the untimed in the order given. A timed task whose time has passed sorts by it too,
 * so an open one stays at the top until it's completed.
 */
export function byTime<T>(lines: readonly T[], itemOf: (line: T) => ItemOut): T[] {
  const at = (line: T) => {
    const time = lineTime(itemOf(line));
    return time ? Date.parse(time) : Infinity;
  };
  const rank = (line: T) => (itemOf(line).kind === 'task' ? 1 : 0);
  return [...lines].sort((a, b) => at(a) - at(b) || rank(a) - rank(b));
}

/**
 * The next timed event today that hasn't ended (one under way says "now"), tomorrow's timed events
 * by their start, and open tasks due today and tomorrow, each day's timed ones by their time, then
 * the untimed. Items still waiting for their provider (pending) aren't confirmed, so they don't count.
 */
export function todayBlock(items: ItemOut[], now: number, timeZone: string): Today {
  const today = localDate(now, timeZone);
  const tomorrow = addDays(today, 1);
  const confirmed = items.filter(item => item.command?.state !== 'pending');
  const next = confirmed
    .filter(item => item.kind === 'event' && !item.all_day && item.starts_at && item.ends_at
      && localDate(item.starts_at, timeZone) === today && Date.parse(item.ends_at) > now)
    .sort((a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!))[0];
  const due = (day: string) => confirmed
    .filter(item => item.kind === 'task' && !item.done && item.due_date === day);
  const taskTime = (item: ItemOut) => (item.due_at ? clockTime(item.due_at, timeZone) : null);
  const tomorrowEvents = confirmed
    .filter(item => item.kind === 'event' && !item.all_day && item.starts_at && localDate(item.starts_at, timeZone) === tomorrow)
    .sort((a, b) => Date.parse(a.starts_at!) - Date.parse(b.starts_at!));
  return {
    event: next ? {item: next, id: next.id, key: next.key, title: next.title, time: clockTime(next.starts_at!, timeZone), in: startsIn(next.starts_at!, now), urgency: urgency(next.starts_at!, now), occurrence_start: next.occurrence_start} : null,
    tasks: [
      ...byTime(due(today), item => item).map(item => ({item, title: item.title, time: taskTime(item), tomorrow: false, passed: isOverdue(item, now, today)})),
      ...byTime(due(tomorrow), item => item).map(item => ({item, title: item.title, time: taskTime(item), tomorrow: true, passed: false})),
    ],
    tomorrowEvents: tomorrowEvents.map(item => ({item, key: item.key, title: item.title, time: clockTime(item.starts_at!, timeZone)})),
    today,
    tomorrow,
  };
}

/**
 * Tomorrow's lines, in time order, to show (Today's never fold). Every one shows when they fit or
 * the block's been opened. Otherwise the first two show, and "3 more due tomorrow" for the rest
 * ("3 more tomorrow" when an event is among them), which opens them all.
 */
export function shownTomorrow<T>(lines: T[], open: boolean, isEvent: (line: T) => boolean): {shown: T[]; more: string | null} {
  if (open || lines.length <= TODAY_TASKS) return {shown: lines, more: null};
  const shown = lines.slice(0, TODAY_TASKS - 1);
  const rest = lines.slice(TODAY_TASKS - 1);
  return {shown, more: `${rest.length} more ${rest.some(isEvent) ? '' : 'due '}tomorrow`};
}

/** The folded rail's one slot: the next timed item today, its countdown and what else is left. */
export interface NextUp {
  item: ItemOut;
  key: string;
  title: string;
  // "2:30 PM".
  time: string;
  // "5h", "40m", "now": the Today block's "in 5h" without its "in".
  in: string;
  urgency: TodayEvent['urgency'];
  // Today's other events not yet over and open tasks, timed or not.
  more: number;
}

/**
 * Today's next timed item, an event or a task alike: an event under way or still to start, or
 * a timed task still to come, the earliest first, an event before a task at the same time. A timed
 * task whose time has passed isn't next. None once nothing timed is left today. Pending items don't count.
 */
export function nextUp(items: ItemOut[], now: number, timeZone: string): NextUp | null {
  const today = localDate(now, timeZone);
  const confirmed = items.filter(item => item.command?.state !== 'pending');
  const events = confirmed.filter(item => item.kind === 'event' && !item.all_day && item.starts_at && item.ends_at
    && localDate(item.starts_at, timeZone) === today && Date.parse(item.ends_at) > now);
  const tasks = confirmed.filter(item => item.kind === 'task' && !item.done && item.due_date === today);
  const upcoming = [...events, ...tasks.filter(item => item.due_at && Date.parse(item.due_at) > now)];
  const next = byTime(upcoming, item => item)[0];
  if (!next) return null;
  const at = lineTime(next)!;
  return {
    item: next, key: next.key, title: next.title, time: clockTime(at, timeZone),
    in: startsIn(at, now).replace(/^in /, ''), urgency: urgency(at, now), more: events.length + tasks.length - 1,
  };
}
