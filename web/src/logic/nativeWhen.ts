// The phone's editor picks a day and a time with iOS's own pickers (`<input type="date">` and
// `"time"`), which speak "2026-10-07" and "13:05". An event's end is minutes from its first day's
// midnight, so the end's day and its time of day are two fields that each keep the other.
import {spanTo} from './compose.ts';
import {addDays, daysBetween} from './format.ts';

/** "13:05": a time input's value for minutes past a day's midnight (an end at midnight is "00:00"). */
export function inputTime(minutes: number): string {
  const within = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(within / 60)).padStart(2, '0')}:${String(within % 60).padStart(2, '0')}`;
}

/** Minutes past midnight from a time input's value, or null for anything else (an emptied one). */
export function readInputTime(value: string): number | null {
  const found = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (!found) return null;
  const [hours, minutes] = [Number(found[1]), Number(found[2])];
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** A timed event's end as the Ends row shows it: its own day and its time of day (midnight starts the next day). */
export function endOf(date: string, end: number): {date: string; minutes: number} {
  return {date: addDays(date, Math.floor(end / 1440)), minutes: end % 1440};
}

/**
 * An end time picked: on the end's own day, and on the day after when that's earlier than the start
 * ("11 PM" to "1 AM" runs past midnight). The start's own time is no end.
 */
export function endTimePicked(start: number, end: number, minutes: number): number {
  const next = Math.floor(end / 1440) * 1440 + minutes;
  return next < start ? next + 1440 : next;
}

/**
 * An end day picked for a timed event: its time of day on that day, or an hour after the start when
 * that's no later. A day before the first is the first (the picker offers none).
 */
export function endDatePicked(date: string, start: number, end: number, to: string): number {
  const next = Math.max(0, daysBetween(date, to)) * 1440 + (end % 1440);
  return next > start ? next : start + 60;
}

/** An all-day event's last day picked: the days from its first to that one (at least the first). */
export const lastDayPicked = (date: string, to: string) => spanTo(date, to, null, null).days;
