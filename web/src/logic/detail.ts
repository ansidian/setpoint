// The floating detail's lines (DESIGN.md › The floating detail; boards 12a and 12b): the date and
// time, Time to Leave, attendees and reminders, worded as the boards word them. Time to Leave reads
// the same in the day agenda (DESIGN.md › Right pane).
import type {ItemOut, TimeToLeaveOut} from '@setpoint/shared';
import {timeRange, dayTitle} from './calendar.ts';
import {addDays, clockTime, localDate} from './format.ts';

/** "Wed, Oct 7 · 2:30 – 3:30 PM"; "Sat, Oct 17 · All day"; a task "Wed, Oct 7" or "Wed, Oct 7 · 5:00 PM". */
export function detailWhen(item: ItemOut, timeZone: string): string {
  if (item.kind === 'task') {
    if (!item.due_date) return 'No date';
    return item.due_at ? `${dayTitle(item.due_date)} · ${clockTime(item.due_at, timeZone)}` : dayTitle(item.due_date);
  }
  if (item.all_day) {
    if (!item.start_date) return 'All day';
    const last = item.end_date ? addDays(item.end_date, -1) : item.start_date;
    return last > item.start_date ? `${dayTitle(item.start_date)} – ${dayTitle(last)}` : `${dayTitle(item.start_date)} · All day`;
  }
  if (!item.starts_at) return 'No date';
  const start = localDate(item.starts_at, timeZone);
  const end = item.ends_at ? localDate(item.ends_at, timeZone) : start;
  // An event into another day names both: "Fri, Oct 9, 10:00 PM – Sat, Oct 10, 1:00 AM".
  if (end !== start && item.ends_at) return `${dayTitle(start)}, ${clockTime(item.starts_at, timeZone)} – ${dayTitle(end)}, ${clockTime(item.ends_at, timeZone)}`;
  return `${dayTitle(start)} · ${timeRange(item, timeZone)}`;
}

/** "18 min", "1 hr 5 min". */
export function travelTime(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/** Time to Leave's two parts: "Leave by 2:05 PM" and "18 min". */
export function leaveBy(leave: TimeToLeaveOut, timeZone: string): {at: string; travel: string} {
  return {at: `Leave by ${clockTime(leave.leave_at, timeZone)}`, travel: travelTime(leave.travel_minutes)};
}

/** "Leave by 2:05 PM · 18 min", or null without Time to Leave. */
export function leaveLine(item: ItemOut, timeZone: string): string | null {
  if (!item.time_to_leave) return null;
  const {at, travel} = leaveBy(item.time_to_leave, timeZone);
  return `${at} · ${travel}`;
}

/** One reminder's offset: "30 min", "1 hour", "2 hours", "1 day", "1 hour 30 min", "At the start". */
function offset(minutes: number): string {
  if (minutes === 0) return 'At the start';
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const parts = [
    days ? `${days} ${days === 1 ? 'day' : 'days'}` : null,
    hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : null,
    mins ? `${mins} min` : null,
  ].filter(Boolean);
  return parts.join(' ');
}

/** "30 min before", "1 hour before", "10 min, 1 hour before"; null with none. */
export function remindersLine(reminders: number[]): string | null {
  const sorted = [...new Set(reminders)].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const atStart = sorted[0] === 0;
  const before = sorted.filter(minutes => minutes > 0).map(offset);
  if (!before.length) return 'At the start';
  return `${atStart ? 'At the start, ' : ''}${before.join(', ')} before`;
}

/** "Sam Lee", "Sam Lee, Jo Park", "Sam Lee, Jo Park and 3 more"; null with none. */
export function attendeesLine(attendees: string[]): string | null {
  if (!attendees.length) return null;
  if (attendees.length <= 3) return attendees.join(', ');
  return `${attendees.slice(0, 2).join(', ')} and ${attendees.length - 2} more`;
}
