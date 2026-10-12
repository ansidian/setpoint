// The sidebar's Today block on mail pages (DESIGN.md › The Today block; BRIEF.md › The sidebar's
// Today block): the next event ("2:30 PM  Dentist  in 5h"), then the open tasks due today and
// tomorrow by name, tomorrow's marked "Tomorrow" (DESIGN.md › Decided while building #78). Confirmed
// data only, and nothing for an empty line.
import type {ItemOut} from '@setpoint/shared';
import {addDays, clockTime, localDate, startsIn} from './format.ts';

export interface TodayEvent {
  item: ItemOut;
  id: number;
  key: string;
  title: string;
  time: string;
  in: string;
  // "in 12m" warms as it nears (polish audit shell-06): `soon` from 15 minutes before, `now` once under way.
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
  // "Tomorrow" on tomorrow's, at the right where the event has "in 5h"; nothing on today's.
  label: string | null;
}

export interface Today {
  event: TodayEvent | null;
  // Today's first, then tomorrow's; none when nothing's due.
  tasks: TodayTask[];
  today: string;
  tomorrow: string;
}

/** How many task lines show before the rest fold into one line. */
export const TODAY_TASKS = 3;

/**
 * How long a completed task's line shows its done check before it folds away (DESIGN.md › The
 * Today block).
 */
export const DONE_MOMENT_MS = 360;

/** The range to load for it: today and tomorrow, `to` exclusive. */
export function todayRange(now: number, timeZone: string): {from: string; to: string} {
  const from = localDate(now, timeZone);
  return {from, to: addDays(from, 2)};
}

/**
 * The next timed event today that hasn't ended (one under way says "now"); open tasks due today and
 * tomorrow, each day's untimed ones first, then the timed by their time. Items still waiting for
 * their provider (pending) aren't confirmed, so they don't count.
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
    .filter(item => item.kind === 'task' && !item.done && item.due_date === day)
    .sort((a, b) => (a.due_at ? Date.parse(a.due_at) : 0) - (b.due_at ? Date.parse(b.due_at) : 0));
  return {
    event: next ? {item: next, id: next.id, key: next.key, title: next.title, time: clockTime(next.starts_at!, timeZone), in: startsIn(next.starts_at!, now), urgency: urgency(next.starts_at!, now), occurrence_start: next.occurrence_start} : null,
    tasks: [
      ...due(today).map(item => ({item, title: item.title, label: null})),
      ...due(tomorrow).map(item => ({item, title: item.title, label: 'Tomorrow'})),
    ],
    today,
    tomorrow,
  };
}

/**
 * The task lines to show: every one when they fit or the block's been opened; otherwise the first
 * two and "3 more due tomorrow" for the rest, which opens them all.
 */
export function shownTasks<T extends TodayTask>(tasks: T[], open: boolean): {shown: T[]; more: string | null} {
  if (open || tasks.length <= TODAY_TASKS) return {shown: tasks, more: null};
  const shown = tasks.slice(0, TODAY_TASKS - 1);
  const rest = tasks.slice(TODAY_TASKS - 1);
  const days = new Set(rest.map(task => (task.label ? 'tomorrow' : 'today')));
  return {shown, more: `${rest.length} more due ${[...days].join(' and ')}`};
}
