// The week view's rules (DESIGN.md › Week view; board 16): the shown week (Sunday first, #52) and its
// title, which items go in the all-day row and how its bars and tasks stack before "+N", the timed
// blocks of each day (an event crossing midnight in both days) and their lanes, the opening scroll,
// and what a drag makes of a pointer: 15-minute steps for a create, a move or a resize. Local days
// are `YYYY-MM-DD` and times minutes after a day's midnight, in the owner's zone.
import type {CalendarOut, ItemChanges, ItemOut} from '@setpoint/shared';
import {week as tokens} from '../tokens.ts';
import {dayOfWeek, dayTitle, timeRange, weekIndex} from './calendar.ts';
import {addDays, clockTime, daysBetween, instantAt, localDate, minutesOf} from './format.ts';

const MINUTE = 60_000;
const DAY_MINUTES = 1440;

// ---------- The week ----------

/** The Sunday a day's week starts on. */
export const weekStart = (date: string) => dayOfWeek(weekIndex(date), 0);

/** The week's seven days, Sunday first. */
export const weekDays = (start: string) => Array.from({length: 7}, (_, day) => addDays(start, day));

const parts = (date: string) => {
  const [year, month, day] = [date.slice(0, 4), new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {month: 'short', timeZone: 'UTC'}), Number(date.slice(8))];
  return {year, month, day};
};

/** The header's and the tab's title: "Oct 4 – 10, 2026", "Sep 27 – Oct 3, 2026", "Dec 27, 2026 – Jan 2, 2027". */
export function weekTitle(start: string): string {
  const first = parts(start);
  const last = parts(addDays(start, 6));
  if (first.year !== last.year) return `${first.month} ${first.day}, ${first.year} – ${last.month} ${last.day}, ${last.year}`;
  if (first.month !== last.month) return `${first.month} ${first.day} – ${last.month} ${last.day}, ${last.year}`;
  return `${first.month} ${first.day} – ${last.day}, ${last.year}`;
}

/** The month the week is mostly in (its Wednesday's): the mini-month and the items around it follow it. */
export const weekMonth = (start: string) => addDays(start, 3).slice(0, 7);

// ---------- Which row an item goes in ----------

/** Whether an event is drawn as a bar in the all-day row: all day, or 24 hours or more. */
export function isAllDayBar(item: ItemOut): boolean {
  if (item.kind === 'task') return false;
  if (item.all_day) return !!item.start_date && !!item.end_date;
  return !!item.starts_at && !!item.ends_at && Date.parse(item.ends_at) - Date.parse(item.starts_at) >= DAY_MINUTES * MINUTE;
}

/** A bar's days, its last inclusive: an all-day event's dates, a long timed event's start and end days. */
function barDays(item: ItemOut, timeZone: string): {first: string; last: string} {
  if (item.all_day) return {first: item.start_date!, last: addDays(item.end_date!, -1)};
  const end = localDate(item.ends_at!, timeZone);
  // Ending at midnight, it doesn't reach into that day.
  return {first: localDate(item.starts_at!, timeZone), last: minutesOf(item.ends_at!, timeZone) === 0 ? addDays(end, -1) : end};
}

/** The items the week shows, once each, leaving out calendars toggled off. */
export function visibleItems(items: ItemOut[], calendars: CalendarOut[] | undefined): ItemOut[] {
  const hidden = new Set((calendars ?? []).filter(calendar => !calendar.visible).map(calendar => calendar.id));
  const seen = new Set<string>();
  return items.filter(item => {
    if (hidden.has(item.calendar_id) || seen.has(item.key)) return false;
    seen.add(item.key);
    return true;
  });
}

// ---------- The all-day row ----------

export interface Bar {
  item: ItemOut;
  // The first and last column it covers (0 Sunday … 6 Saturday), clipped to the week.
  from: number;
  to: number;
  lane: number;
  // Whether it carries on before the week's first day or after its last.
  before: boolean;
  after: boolean;
}

/** One drawn piece of a bar: the run of columns where its lane is shown. */
export interface BarPiece extends Bar {
  // The day the piece starts on: what a click on it selects.
  date: string;
}

export interface AllDayLine {
  item: ItemOut;
  date: string;
  column: number;
  line: number;
}

export interface AllDayMore {
  date: string;
  column: number;
  line: number;
  count: number;
}

export interface AllDayLayout {
  pieces: BarPiece[];
  tasks: AllDayLine[];
  more: AllDayMore[];
  // The lines the row is drawn with: at least two, at most three.
  lines: number;
}

/** A task's line in the all-day row: "9:00 AM Pay rent" for a timed one, its title otherwise. */
export const taskTime = (item: ItemOut, timeZone: string) => (item.kind === 'task' && item.due_at ? clockTime(item.due_at, timeZone) : null);

// Timed tasks in time order, then the rest.
const dueOrder = (item: ItemOut) => (item.due_at ? Date.parse(item.due_at) : Infinity);

/**
 * The all-day row (board 16): bars in lanes, the earliest first and the longest on a tie, then each
 * day's tasks under that day's lowest bar. A day needing more than three lines shows two and "+N" on
 * the third, and a bar shows only on the days its lane is drawn.
 */
export function allDayLayout(items: ItemOut[], start: string, timeZone: string): AllDayLayout {
  const days = weekDays(start);
  const end = days[6]!;
  const bars: Bar[] = [];
  for (const item of items) {
    if (!isAllDayBar(item)) continue;
    const {first, last} = barDays(item, timeZone);
    if (last < start || first > end) continue;
    bars.push({item, from: Math.max(0, daysBetween(start, first)), to: Math.min(6, daysBetween(start, last)), lane: 0, before: first < start, after: last > end});
  }
  bars.sort((a, b) => a.from - b.from || (b.to - b.from) - (a.to - a.from) || a.item.title.localeCompare(b.item.title) || a.item.key.localeCompare(b.item.key));
  const lanes: number[][] = [];
  for (const bar of bars) {
    let lane = lanes.findIndex(taken => taken.every(column => column < bar.from || column > bar.to));
    if (lane < 0) lane = lanes.push([]) - 1;
    for (let column = bar.from; column <= bar.to; column += 1) lanes[lane]!.push(column);
    bar.lane = lane;
  }
  const tasksOn = days.map(date => items.filter(item => item.kind === 'task' && item.due_date === date)
    .sort((a, b) => Number(a.done) - Number(b.done) || dueOrder(a) - dueOrder(b) || a.title.localeCompare(b.title)));
  // Each day's lines: its bars' lanes, then its tasks under the lowest one.
  const firstTaskLine = days.map((_, column) => Math.max(-1, ...bars.filter(bar => bar.from <= column && bar.to >= column).map(bar => bar.lane)) + 1);
  const needed = days.map((_, column) => firstTaskLine[column]! + tasksOn[column]!.length);
  const shownLines = needed.map(count => (count > tokens.maxLines ? tokens.maxLines - 1 : tokens.maxLines));

  const pieces: BarPiece[] = [];
  for (const bar of bars) {
    let column = bar.from;
    while (column <= bar.to) {
      if (bar.lane >= shownLines[column]!) {
        column += 1;
        continue;
      }
      const from = column;
      while (column + 1 <= bar.to && bar.lane < shownLines[column + 1]!) column += 1;
      pieces.push({...bar, from, to: column, before: bar.before || from > bar.from, after: bar.after || column < bar.to, date: days[from]!});
      column += 1;
    }
  }
  const tasks: AllDayLine[] = [];
  const more: AllDayMore[] = [];
  days.forEach((date, column) => {
    tasksOn[column]!.forEach((item, index) => {
      const line = firstTaskLine[column]! + index;
      if (line < shownLines[column]!) tasks.push({item, date, column, line});
    });
    if (needed[column]! > tokens.maxLines) more.push({date, column, line: tokens.maxLines - 1, count: needed[column]! - (tokens.maxLines - 1)});
  });
  const lines = Math.max(tokens.minLines, Math.min(tokens.maxLines, Math.max(0, ...needed)));
  return {pieces, tasks, more, lines};
}

// ---------- The hours ----------

export interface Segment {
  item: ItemOut;
  date: string;
  // Minutes after the day's midnight; an event carrying on into the next day ends at 1440.
  start: number;
  end: number;
  // Whether it began the day before, or carries on into the next.
  continued: boolean;
  continues: boolean;
}

/** A timed event's piece on each day of the week it covers (an event crossing midnight draws in both). */
export function segments(items: ItemOut[], start: string, timeZone: string): Segment[] {
  const days = new Set(weekDays(start));
  const list: Segment[] = [];
  for (const item of items) {
    if (item.kind === 'task' || item.all_day || !item.starts_at || !item.ends_at || isAllDayBar(item)) continue;
    const first = localDate(item.starts_at, timeZone);
    const last = localDate(item.ends_at, timeZone);
    const endMinutes = minutesOf(item.ends_at, timeZone);
    for (let date = first; date <= last; date = addDays(date, 1)) {
      const segmentStart = date === first ? minutesOf(item.starts_at, timeZone) : 0;
      const segmentEnd = date === last ? endMinutes : DAY_MINUTES;
      // An event ending at midnight doesn't reach into that day.
      if (date !== first && segmentEnd === 0) continue;
      if (days.has(date)) list.push({item, date, start: segmentStart, end: Math.max(segmentEnd, segmentStart), continued: date !== first, continues: date !== last && !(addDays(date, 1) === last && endMinutes === 0)});
    }
  }
  return list;
}

export interface Block extends Segment {
  lane: number;
  // The lanes its run of overlapping events is drawn in (up to three).
  lanes: number;
}

export interface LaneMore {
  date: string;
  // Minutes after midnight where the run starts: the "+N" sits at its top, in its last lane.
  start: number;
  lane: number;
  lanes: number;
  count: number;
}

const blockLength = (segment: Segment) => Math.max(segment.end - segment.start, (tokens.minBlockPx / tokens.hourPx) * 60);

/**
 * A day's blocks in lanes (board 16's Study group beside Dinner with Sam): each run of overlapping
 * events shares the column, each event in the first lane free when it starts, the earliest first and
 * the longest on a tie. A run needing more than three lanes draws two, and "+N" in the third for the
 * rest. Overlap counts a block's drawn height, so a short block's 20 px doesn't hide the next.
 */
export function dayBlocks(list: Segment[]): {blocks: Block[]; more: LaneMore[]} {
  const sorted = [...list].sort((a, b) => a.start - b.start || b.end - a.end || a.item.title.localeCompare(b.item.title) || a.item.key.localeCompare(b.item.key));
  const blocks: Block[] = [];
  const more: LaneMore[] = [];
  let run: {segment: Segment; lane: number}[] = [];
  let runEnd = -1;
  const close = () => {
    if (!run.length) return;
    const needed = Math.max(...run.map(one => one.lane)) + 1;
    const lanes = Math.min(needed, tokens.lanes);
    const shown = needed > tokens.lanes ? tokens.lanes - 1 : tokens.lanes;
    const hidden = run.filter(one => one.lane >= shown);
    for (const one of run) if (one.lane < shown) blocks.push({...one.segment, lane: one.lane, lanes});
    if (hidden.length) more.push({date: run[0]!.segment.date, start: run[0]!.segment.start, lane: tokens.lanes - 1, lanes, count: hidden.length});
    run = [];
    runEnd = -1;
  };
  for (const segment of sorted) {
    if (run.length && segment.start >= runEnd) close();
    const ends = run.map(one => one.segment.start + blockLength(one.segment));
    let lane = 0;
    while (run.some((one, index) => one.lane === lane && ends[index]! > segment.start)) lane += 1;
    run.push({segment, lane});
    runEnd = Math.max(runEnd, segment.start + blockLength(segment));
  }
  close();
  return {blocks, more};
}

/** A minute's place in the hours, in px from midnight's line. */
export const minuteTop = (minutes: number) => (minutes / 60) * tokens.hourPx;

/** A block's box within its day: 1 px under its start's line, 2 px short of its end's (board 16), at least 20 px. */
export function blockBox(start: number, end: number): {top: number; height: number} {
  return {top: minuteTop(start) + 1, height: Math.max(tokens.minBlockPx, minuteTop(end) - minuteTop(start) - 2)};
}

/** Whether a block puts its time after its title, on one line ("Standup, 9:00 AM"). */
export const isShort = (start: number, end: number) => end - start < tokens.shortMinutes;

/**
 * Where the hours open (DESIGN.md › Week view › Opening scroll): this week puts now about a third
 * down; another week an hour before its first timed item, else 7 AM.
 */
export function openingScroll(start: string, today: string, now: number, list: Segment[], timeZone: string, height: number): number {
  const total = minuteTop(DAY_MINUTES) - height;
  const clamp = (top: number) => Math.round(Math.max(0, Math.min(total, top)));
  if (weekDays(start).includes(today)) return clamp(minuteTop(minutesOf(now, timeZone)) - height / 3);
  const first = list.length ? Math.min(...list.map(segment => segment.start)) : null;
  return clamp(minuteTop(first === null ? tokens.openingMinutes : Math.min(tokens.openingMinutes, Math.max(0, first - 60))));
}

// ---------- Drags ----------

/** Minutes snapped to the drag's 15-minute steps, inside the day (and 1440, its end). */
export function snap(minutes: number): number {
  const step = tokens.snapMinutes;
  return Math.max(0, Math.min(DAY_MINUTES, Math.round(minutes / step) * step));
}

/** Minutes after the week's first midnight, from a column and the minutes into its day. */
export const weekMinutes = (column: number, minutes: number) => column * DAY_MINUTES + minutes;

/** The range a drag over empty hours makes: from where it was pressed to the pointer, in 15-minute steps, 15 minutes at least. */
export function createRange(pressed: number, pointer: number): {start: number; end: number} {
  const [low, high] = pressed <= pointer ? [pressed, pointer] : [pointer, pressed];
  const start = Math.min(DAY_MINUTES - tokens.minMinutes, Math.floor(low / tokens.snapMinutes) * tokens.snapMinutes);
  const end = Math.max(start + tokens.minMinutes, Math.min(DAY_MINUTES, Math.ceil(high / tokens.snapMinutes) * tokens.snapMinutes));
  return {start, end};
}

/**
 * A timed event moved so it starts at `startMinutes` after the week's first midnight (snapped),
 * keeping its length: its new times, or null where it already is.
 */
export function movedTo(item: ItemOut, start: string, startMinutes: number, timeZone: string): ItemChanges | null {
  if (!item.starts_at || !item.ends_at) return null;
  const minutes = Math.round(startMinutes / tokens.snapMinutes) * tokens.snapMinutes;
  const starts = instantAt(start, minutes, timeZone);
  if (Date.parse(starts) === Date.parse(item.starts_at)) return null;
  const length = Date.parse(item.ends_at) - Date.parse(item.starts_at);
  return {starts_at: starts, ends_at: new Date(Date.parse(starts) + length).toISOString()};
}

/** Where a timed event's start sits, in minutes after the week's first midnight. */
export function startInWeek(item: ItemOut, start: string, timeZone: string): number {
  return weekMinutes(daysBetween(start, localDate(item.starts_at!, timeZone)), minutesOf(item.starts_at!, timeZone));
}

export type Edge = 'start' | 'end';

/** Whether a timed block offers its top edge too (DESIGN.md › Week view › Resize): only from 30 minutes. */
export const offersTop = (segment: Segment) => !segment.continued && segment.end - segment.start >= tokens.topEdgeFromMinutes;

/**
 * A timed event with an edge dragged to `minutes` after the week's first midnight (snapped): the
 * start never later than 15 minutes before the end, the end never earlier than 15 after the start.
 * Null when it doesn't change.
 */
export function resizedTo(item: ItemOut, edge: Edge, start: string, minutes: number, timeZone: string): ItemChanges | null {
  if (!item.starts_at || !item.ends_at) return null;
  const at = Date.parse(instantAt(start, Math.round(minutes / tokens.snapMinutes) * tokens.snapMinutes, timeZone));
  const least = tokens.minMinutes * MINUTE;
  if (edge === 'start') {
    const starts = Math.min(at, Date.parse(item.ends_at) - least);
    return starts === Date.parse(item.starts_at) ? null : {starts_at: new Date(starts).toISOString()};
  }
  const ends = Math.max(at, Date.parse(item.starts_at) + least);
  return ends === Date.parse(item.ends_at) ? null : {ends_at: new Date(ends).toISOString()};
}

/** An all-day event with an end dragged onto `day`: its first or last day, never past the other. Null when it doesn't change. */
export function resizedDays(item: ItemOut, edge: Edge, day: string): ItemChanges | null {
  if (!item.all_day || !item.start_date || !item.end_date) return null;
  if (edge === 'start') {
    const first = day < item.end_date ? day : addDays(item.end_date, -1);
    return first === item.start_date ? null : {start_date: first};
  }
  const end = addDays(day >= item.start_date ? day : item.start_date, 1);
  return end === item.end_date ? null : {end_date: end};
}

/** The days a drag across the all-day row covers, from where it was pressed to the pointer. */
export function dayRange(pressed: string, pointer: string): {from: string; to: string} {
  return pressed <= pointer ? {from: pressed, to: pointer} : {from: pointer, to: pressed};
}

// ---------- Words ----------

/** What a move says: "Moved Dentist to Thu, Oct 8, 3:00 PM"; an all-day event or a task "Moved Pay rent to Thu, Oct 8". */
export function movedLine(item: ItemOut, changes: ItemChanges, timeZone: string): string {
  if (changes.starts_at) return `Moved ${item.title} to ${dayTitle(localDate(changes.starts_at, timeZone))}, ${clockTime(changes.starts_at, timeZone)}`;
  const day = changes.start_date ?? changes.due_date;
  return `Moved ${item.title} to ${day ? dayTitle(day) : 'another day'}`;
}

/** What a resize says: "Changed Dentist to 2:30 – 4:00 PM", "Changed Trip to Sun, Oct 4 – Tue, Oct 6". */
export function resizedLine(item: ItemOut, changes: ItemChanges, timeZone: string): string {
  const after = {...item, ...changes} as ItemOut;
  if (after.all_day && after.start_date && after.end_date) {
    const last = addDays(after.end_date, -1);
    return `Changed ${item.title} to ${last === after.start_date ? dayTitle(last) : `${dayTitle(after.start_date)} – ${dayTitle(last)}`}`;
  }
  return `Changed ${item.title} to ${timeRange(after, timeZone)}`;
}

/** A block's time where it shares its column: its start, as a month chip words it ("7 PM", "6:30 PM"); its height gives its length. */
export const laneTime = (item: ItemOut, timeZone: string) => clockTime(item.starts_at!, timeZone).replace(':00 ', ' ');

/**
 * What a block has room for, in 15.6 px lines under 3 px of padding: its title (two lines where it
 * shares its column and three or more fit, else one), its times, and its place on the line after.
 * No line is drawn that would be cut off.
 */
export function blockLines(height: number, narrow: boolean): {title: 1 | 2; place: boolean} {
  const lines = Math.floor((height - 3) / 15.6);
  const title = narrow && lines >= 4 ? 2 : 1;
  return {title, place: lines >= title + 2};
}

/** The drag's tooltip while resizing or creating: the range, "2:30 – 4:00 PM". */
export function rangeLabel(date: string, start: number, end: number, timeZone: string): string {
  const startsAt = instantAt(date, start, timeZone);
  const endsAt = instantAt(date, end, timeZone);
  return timeRange({all_day: false, starts_at: startsAt, ends_at: endsAt} as ItemOut, timeZone);
}

/** What a block reads to assistive tech: "Dentist, Wed, Oct 7, 2:30 – 3:30 PM, Personal". */
export function blockLabel(item: ItemOut, date: string, calendar: string | undefined, timeZone: string): string {
  const when = item.kind === 'task' ? (item.due_at ? clockTime(item.due_at, timeZone) : 'Due') : timeRange(item, timeZone);
  return [item.title, dayTitle(date), when, item.kind === 'task' ? item.project : calendar].filter(Boolean).join(', ');
}
