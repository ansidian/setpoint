// Overlaps (DESIGN.md › Editor's conflict preview; boards 12b, 13 and 14): the editor's small
// timeline of the day ("Overlaps Study group · 1h 30m", or "No conflicts") and the agenda's line
// under an event that starts during another ("Overlaps Study group until 8:30 PM").
import type {ItemOut} from '@setpoint/shared';
import {clockTime, instantAt} from './format.ts';

const MINUTE = 60_000;
const HOUR = 60;

/** A span of time as instants (ms). */
export interface Span {
  start: number;
  end: number;
}

export interface Overlap {
  item: ItemOut;
  // The part the two share.
  start: number;
  end: number;
}

/** A timed event's span; null for all-day events, tasks, events without times and, taking no time, one with no end (SV-78). */
export function spanOf(item: ItemOut): Span | null {
  if (item.kind !== 'event' || item.all_day || !item.starts_at || !item.ends_at) return null;
  const span = {start: Date.parse(item.starts_at), end: Date.parse(item.ends_at)};
  return span.end > span.start ? span : null;
}

/** The timed events `span` shares time with (touching isn't overlapping), earliest first; `except` is the event itself. */
export function overlapsWith(span: Span, items: ItemOut[], except: string | null = null): Overlap[] {
  if (span.end <= span.start) return [];
  return items.flatMap(item => {
    const other = item.key === except ? null : spanOf(item);
    if (!other || other.start >= span.end || other.end <= span.start) return [];
    return [{item, start: Math.max(span.start, other.start), end: Math.min(span.end, other.end)}];
  }).sort((a, b) => Date.parse(a.item.starts_at!) - Date.parse(b.item.starts_at!) || a.item.title.localeCompare(b.item.title));
}

/** "1h 30m", "45m", "2h". */
export function shortDuration(ms: number): string {
  const minutes = Math.round(ms / MINUTE);
  const hours = Math.floor(minutes / HOUR);
  const rest = minutes % HOUR;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** The preview's line: "Overlaps Study group · 1h 30m" (and "and 1 more"), or "No conflicts". */
export function conflictLine(overlaps: Overlap[]): {free: boolean; text: string} {
  const [first, ...rest] = overlaps;
  if (!first) return {free: true, text: 'No conflicts'};
  const more = rest.length ? ` and ${rest.length} more` : '';
  return {free: false, text: `Overlaps ${first.item.title}${more} · ${shortDuration(first.end - first.start)}`};
}

export interface Timeline {
  // Minutes after the day's midnight at the timeline's ends, on whole hours.
  from: number;
  to: number;
}

/**
 * The preview's window on the day (boards 13 and 14): at least 4 hours on whole hours, centred on
 * the event and what it overlaps, and taking all of them in. Times are minutes after midnight.
 */
export function timelineWindow(spans: {start: number; end: number}[]): Timeline {
  const first = Math.min(...spans.map(span => span.start));
  const last = Math.max(...spans.map(span => span.end));
  const hours = Math.max(4, Math.ceil((last - first) / HOUR));
  let from = Math.round(((first + last) / 2 - (hours * HOUR) / 2) / HOUR) * HOUR;
  if (from > first) from = Math.floor(first / HOUR) * HOUR;
  let to = from + hours * HOUR;
  if (to < last) to = Math.ceil(last / HOUR) * HOUR;
  return {from, to};
}

/** The axis under the timeline: "6 PM", "7", "8", "9", "10 PM" (the ends with AM or PM). */
export function timelineLabels({from, to}: Timeline): {at: number; label: string}[] {
  const labels = [];
  for (let minutes = from; minutes <= to; minutes += HOUR) {
    const hour = Math.floor((((minutes % 1440) + 1440) % 1440) / HOUR);
    const twelve = hour % 12 || 12;
    labels.push({at: (minutes - from) / (to - from), label: minutes === from || minutes === to ? `${twelve} ${hour < 12 ? 'AM' : 'PM'}` : String(twelve)});
  }
  return labels;
}

/** An instant as minutes after `date`'s local midnight. */
export const minutesFrom = (date: string, at: number, timeZone: string) => (at - Date.parse(instantAt(date, 0, timeZone))) / MINUTE;

/**
 * The agenda's line under an event that starts while another is on (board 12b: Dinner with Sam at
 * 7 PM during Study group, 6:30 – 8:30 PM): "Overlaps Study group until 8:30 PM", until the
 * earlier of the two ends. The event that was on first says nothing.
 */
export function agendaOverlap(item: ItemOut, dayItems: ItemOut[], timeZone: string): string | null {
  const span = spanOf(item);
  if (!span) return null;
  const during = dayItems.find(other => {
    const theirs = other.key === item.key ? null : spanOf(other);
    return theirs !== null && theirs.start < span.start && span.start < theirs.end;
  });
  if (!during) return null;
  return `Overlaps ${during.title} until ${clockTime(Math.min(span.end, spanOf(during)!.end), timeZone)}`;
}
