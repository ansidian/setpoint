// The month grid's and the day agenda's rules (DESIGN.md › Calendar): weeks as rows that scroll
// through months, which items a day cell fits before "+N", the chips' times, past and dimmed items,
// the agenda's lines and the now-line, the mini-month, and where the "+N" popover hangs. Local
// days are `YYYY-MM-DD` in the owner's zone; weeks start on Sunday (SV-29).
import type {CalendarOut, ItemOut, WeatherCondition, WeatherDayOut} from '@setpoint/shared';
import {layout} from '../tokens.ts';
import {addDays, clockTime, daysBetween, localDate, startsIn} from './format.ts';
import {placeName} from './place.ts';

// ---------- Weeks and months ----------

/** Week 0 starts on Sunday, Jan 4, 1970; every week is a row of the grid. */
const EPOCH_SUNDAY = '1970-01-04';
/** The grid scrolls from the first week of 2000 to the end of 2099: "infinite" for a calendar. */
export const FIRST_WEEK = weekIndex('2000-01-02');
export const WEEK_COUNT = weekIndex('2100-01-03') - FIRST_WEEK;

/** Sunday 0 … Saturday 6. */
export const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** The week a day falls in, counted from the epoch's Sunday. */
export function weekIndex(date: string): number {
  return Math.floor(daysBetween(EPOCH_SUNDAY, date) / 7);
}

/** The day `day` (Sunday 0) of week `week`. */
export const dayOfWeek = (week: number, day: number) => addDays(EPOCH_SUNDAY, week * 7 + day);

/** "2026-10" for a day. */
export const monthOf = (date: string) => date.slice(0, 7);

/** The month `delta` months from `month` ("2026-10" + 1 → "2026-11"). */
export function addMonths(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  const index = year * 12 + (number - 1) + delta;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export const firstOfMonth = (month: string) => `${month}-01`;

/** The grid row (counted from FIRST_WEEK) holding a month's first day: paging puts it at the top. */
export const monthTopRow = (month: string) => weekIndex(firstOfMonth(month)) - FIRST_WEEK;

/**
 * The month the grid is showing at a scroll position in a view `height` tall: the month most of the
 * row at the middle of the view falls in (its Wednesday's), never less than a row below the top. A
 * row or so of the month before showing at the top never flips it while the month's own rows fill
 * the view; paging puts a month's 1st in the top row, and the rows under it are wholly that month.
 */
export function monthAtScroll(scrollTop: number, height: number, rowHeight: number = layout.monthRow): string {
  const row = Math.max(0, Math.floor((scrollTop + Math.max(height / 2, rowHeight)) / rowHeight));
  return monthOf(dayOfWeek(FIRST_WEEK + row, 3));
}

/** The grid rows to draw for a viewport: the rows in view and `overscan` more on each side. */
export function rowsInView(scrollTop: number, height: number, rowHeight: number = layout.monthRow, overscan = 2): {first: number; last: number} {
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const last = Math.min(WEEK_COUNT - 1, Math.ceil((scrollTop + height) / rowHeight) - 1 + overscan);
  return {first, last};
}

/** The month's weeks, as rows of seven days: the mini-month (Sunday first). */
export function monthWeeks(month: string): string[][] {
  const first = weekIndex(firstOfMonth(month));
  const last = weekIndex(addDays(firstOfMonth(addMonths(month, 1)), -1));
  const weeks: string[][] = [];
  for (let week = first; week <= last; week += 1) weeks.push(Array.from({length: 7}, (_, day) => dayOfWeek(week, day)));
  return weeks;
}

export interface MiniDay {
  date: string;
  day: number;
  // Outside the month.
  out: boolean;
  today: boolean;
  // The selected day, unless it's today (today's disc says it) or a range is shown: `sub`.
  selected: boolean;
  // SV-29: in the range an event's Date picks, and its first and last days.
  inRange: boolean;
  rangeStart: boolean;
  rangeEnd: boolean;
}

/**
 * The mini-month (DESIGN.md › Sidebar on Calendar): today a disc, the selected day `sub`, no other
 * marks; an event's Date shows its `range` as a band instead (SV-29). The week view marks its shown
 * `week` the selected day's way (board 16).
 */
export function miniMonth(month: string, today: string, selected: string | null, range: {from: string; to: string} | null = null, week: string | null = null): MiniDay[][] {
  const inWeek = (date: string) => week !== null && date >= week && daysBetween(week, date) < 7;
  return monthWeeks(month).map(days => days.map(date => ({
    date, day: Number(date.slice(8)), out: monthOf(date) !== month, today: date === today, selected: !range && (date === selected || inWeek(date)) && date !== today,
    inRange: !!range && date >= range.from && date <= range.to, rangeStart: date === range?.from, rangeEnd: date === range?.to,
  })));
}

/**
 * A day picked in an event's Date (SV-29), as the first click or the next: the first starts it on
 * that day alone; the next ends it there, or, before the first, starts it there and ends it on the
 * first (#103).
 */
export function rangePick(phase: 'start' | 'end', from: string, day: string): {from: string; to: string; done: boolean} {
  if (phase === 'start') return {from: day, to: day, done: false};
  return day >= from ? {from, to: day, done: true} : {from: day, to: from, done: true};
}

// ---------- A day cell ----------

export interface DayHead {
  // "7", or the month's name on its 1st ("Oct 1", "Nov 1") at 500.
  label: string;
  monthStart: boolean;
}

export function dayHead(date: string): DayHead {
  const day = Number(date.slice(8));
  if (day !== 1) return {label: String(day), monthStart: false};
  return {label: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}), monthStart: true};
}

/**
 * Where a day cell draws its month's boundary, as v1 traces it: its top edge when the day above is
 * in another month, its left edge when the day before is (never at Sunday's grid edge). Each shared
 * edge is drawn once, by the later month's cell, and stronger when either side is today's month.
 */
export function monthEdges(date: string, today: string): {top: boolean; left: boolean; now: boolean} {
  const month = monthOf(date);
  const current = monthOf(today);
  const above = monthOf(addDays(date, -7));
  const before = monthOf(addDays(date, -1));
  const top = above !== month;
  const left = weekday(date) > 0 && before !== month;
  const now = (top || left) && (month === current || (top && above === current) || (left && before === current));
  return {top, left, now};
}

/** A day cell's kind of tint: outside the shown month (`panel` 60%), the weekend (40%). */
export const isWeekend = (date: string) => weekday(date) % 6 === 0;

/**
 * A day cell's geometry (setpoint.css › .cell and .dhead): 6 px above and 4 below inside a 1 px
 * bottom line, the 22 px day head, then 20 px chips and the 18 px "+N", each 3 px below the last.
 */
export const CELL = {padTop: 6, padBottom: 4, border: 1, head: layout.dayHead, gap: 3, chip: layout.calendarChip, more: 18} as const;

/**
 * How many of a day's items its cell shows, and how many fold into "+N" (DESIGN.md › Overflow):
 * all of them when they fit, else as many as fit above the "+N" line.
 */
export function fitDay(count: number, rowHeight: number = layout.monthRow): {shown: number; more: number} {
  const room = rowHeight - CELL.border - CELL.padTop - CELL.padBottom - CELL.head;
  const row = CELL.gap + CELL.chip;
  if (count * row <= room) return {shown: count, more: 0};
  const shown = Math.max(0, Math.floor((room - CELL.gap - CELL.more) / row));
  return {shown, more: count - shown};
}

// ---------- Items on days ----------

/** The local days an item shows on: a timed event its start's day, an all-day event each day, a task its due day. */
export function itemDays(item: ItemOut, timeZone: string): string[] {
  if (item.kind === 'task') return item.due_date ? [item.due_date] : [];
  if (item.all_day) {
    if (!item.start_date || !item.end_date) return [];
    const days: string[] = [];
    for (let date = item.start_date; date < item.end_date && days.length < 366; date = addDays(date, 1)) days.push(date);
    return days;
  }
  return item.starts_at ? [localDate(item.starts_at, timeZone)] : [];
}

/** Within a day: all-day events, then timed events by start, then tasks (DESIGN.md › Month grid). */
function dayOrder(a: ItemOut, b: ItemOut): number {
  const rank = (item: ItemOut) => (item.kind === 'task' ? 2 : item.all_day ? 0 : 1);
  return rank(a) - rank(b) || (a.starts_at ?? '').localeCompare(b.starts_at ?? '') || a.title.localeCompare(b.title) || a.key.localeCompare(b.key);
}

/** Items by local day, in the grid's order, leaving out the calendars toggled off. */
export function itemsByDay(items: ItemOut[], calendars: CalendarOut[] | undefined, timeZone: string): Map<string, ItemOut[]> {
  const hidden = new Set((calendars ?? []).filter(calendar => !calendar.visible).map(calendar => calendar.id));
  const days = new Map<string, ItemOut[]>();
  const seen = new Set<string>();
  for (const item of items) {
    if (hidden.has(item.calendar_id) || seen.has(item.key)) continue;
    seen.add(item.key);
    for (const date of itemDays(item, timeZone)) {
      const list = days.get(date);
      if (list) list.push(item);
      else days.set(date, [item]);
    }
  }
  for (const list of days.values()) list.sort(dayOrder);
  return days;
}

/** How many of a day's items the calendars toggled off hide, so an empty day can say so rather than "No events" (SV-56). */
export function hiddenOn(day: string, items: ItemOut[], calendars: CalendarOut[] | undefined, timeZone: string): number {
  const hidden = new Set((calendars ?? []).filter(calendar => !calendar.visible).map(calendar => calendar.id));
  if (!hidden.size) return 0;
  return itemsByDay(items.filter(item => hidden.has(item.calendar_id)), undefined, timeZone).get(day)?.length ?? 0;
}

/** Whether an event is over (past items show at .55 on the grid); tasks never are, done or not. */
export function isPast(item: ItemOut, now: number, timeZone: string): boolean {
  if (item.kind === 'task') return false;
  if (item.all_day) return !!item.end_date && item.end_date <= localDate(now, timeZone);
  return !!item.ends_at && Date.parse(item.ends_at) <= now;
}

/** A chip's time: "7 AM", "2:30 PM"; all-day events have none. */
export function chipTime(item: ItemOut, timeZone: string): string | null {
  if (item.kind === 'task' || item.all_day || !item.starts_at) return null;
  return clockTime(item.starts_at, timeZone).replace(':00 ', ' ');
}

/** An event's span: "7:00 – 8:00 AM", "11:30 AM – 1:30 PM", "All day". */
export function timeRange(item: ItemOut, timeZone: string): string {
  if (item.all_day || !item.starts_at || !item.ends_at) return 'All day';
  const start = clockTime(item.starts_at, timeZone);
  const end = clockTime(item.ends_at, timeZone);
  const [startTime, startHalf] = start.split(' ');
  const [, endHalf] = end.split(' ');
  return startHalf === endHalf && localDate(item.starts_at, timeZone) === localDate(item.ends_at, timeZone) ? `${startTime} – ${end}` : `${start} – ${end}`;
}

// ---------- The right pane ----------

/** "Wed, Oct 7". */
export const dayTitle = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC'});

const CONDITIONS: Record<WeatherCondition, {label: string; icon: 'sunny' | 'partly_cloudy_day' | 'cloud' | 'rainy'; tone: 'sun' | 'cloud' | 'rain'}> = {
  sun: {label: 'Sunny', icon: 'sunny', tone: 'sun'},
  partly_cloudy: {label: 'Partly cloudy', icon: 'partly_cloudy_day', tone: 'cloud'},
  cloud: {label: 'Cloudy', icon: 'cloud', tone: 'cloud'},
  rain: {label: 'Rain', icon: 'rainy', tone: 'rain'},
};

/** A forecast's icon and tone (sun `sunGlyph`, cloud `ink2`, rain `cool`), its high and low, and its line, "Sunny · 78° / 61°". */
export function weatherOf(day: WeatherDayOut) {
  const condition = CONDITIONS[day.condition];
  const [high, low] = [`${Math.round(day.high_f)}°`, `${Math.round(day.low_f)}°`];
  const temps = `${high} / ${low}`;
  return {icon: condition.icon, tone: condition.tone, temps, high, low, line: `${condition.label} · ${temps}`};
}

/** The day's line under its date when there's no forecast: "6 events · 2 tasks". */
export function dayCounts(items: ItemOut[]): string {
  const events = items.filter(item => item.kind === 'event').length;
  const tasks = items.length - events;
  const part = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;
  if (!events && !tasks) return 'Nothing planned';
  return [events ? part(events, 'event') : null, tasks ? part(tasks, 'task') : null].filter(Boolean).join(' · ');
}

/** "Tasks · due today", "Tasks · due tomorrow", "Tasks · due Sat". */
export function tasksHeading(date: string, today: string): string {
  const days = daysBetween(today, date);
  if (days === 0) return 'Tasks · due today';
  if (days === 1) return 'Tasks · due tomorrow';
  if (days === -1) return 'Tasks · due yesterday';
  return `Tasks · due ${new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {weekday: 'short', timeZone: 'UTC'})}`;
}

/** Where an event is, on its own line under the time's (#166): the place's name or street, or a call's host. */
export interface AgendaPlace {
  text: string;
  // A link (a call): videocam and its host; otherwise location_on.
  video: boolean;
}

export interface AgendaEvent {
  item: ItemOut;
  // "7:00 AM", or "All day".
  when: string;
  // "7:00 – 8:00 AM · Personal": the time and always the calendar (#166).
  line: string;
  place: AgendaPlace | null;
  past: boolean;
  // "in 5h" on today's next event, "now" on one under way.
  startsIn: string | null;
}

export interface Agenda {
  events: AgendaEvent[];
  tasks: ItemOut[];
  // Where the now-line goes among the events (before events[index]); null on other days.
  nowAt: number | null;
}

const LINK = /^(?:https?:\/\/|www\.)\S+$/i;

/** An event's place line (#166): a link's host ("zoom.us"), else the place's name or the street of its address. */
export function agendaPlace(item: Pick<ItemOut, 'place' | 'address'>): AgendaPlace | null {
  const name = placeName(item);
  if (!name) return null;
  if (!LINK.test(name)) return {text: name, video: false};
  try {
    return {text: new URL(/^www\./i.test(name) ? `https://${name}` : name).hostname.replace(/^www\./, ''), video: true};
  } catch {
    return {text: name, video: false};
  }
}

/**
 * The selected day's agenda (DESIGN.md › Right pane): its events with their times and lines, the
 * now-line after what has started (today only), "in 5h" on the next event today, then its tasks.
 */
export function agenda(day: string, items: ItemOut[], calendars: CalendarOut[] | undefined, now: number, timeZone: string): Agenda {
  const names = new Map((calendars ?? []).map(calendar => [calendar.id, calendar.name]));
  const today = localDate(now, timeZone) === day;
  const events = items.filter(item => item.kind === 'event');
  const next = today ? events.find(item => !item.all_day && item.starts_at && item.ends_at && Date.parse(item.ends_at) > now) : undefined;
  return {
    events: events.map(item => ({
      item,
      when: item.all_day || !item.starts_at ? 'All day' : clockTime(item.starts_at, timeZone),
      line: [timeRange(item, timeZone), names.get(item.calendar_id)].filter(Boolean).join(' · '),
      place: agendaPlace(item),
      past: isPast(item, now, timeZone),
      startsIn: item === next ? startsIn(item.starts_at!, now) : null,
    })),
    tasks: items.filter(item => item.kind === 'task'),
    nowAt: today ? events.filter(item => item.all_day || (item.starts_at && Date.parse(item.starts_at) <= now)).length : null,
  };
}

// ---------- The "+N" popover ----------

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The popover's distance from its "+N", and the least room it keeps from the grid's edges. */
export const POPOVER = {offset: 2, margin: 8} as const;

/**
 * Where the day's popover goes (board 11b): it hangs from the "+N", its left edge 2 px left of it
 * and 2 px below, over the cells underneath; with no room below it opens above, and it stays
 * inside the grid.
 */
export function hangFrom(anchor: Rect, size: {width: number; height: number}, bounds: Rect): {left: number; top: number} {
  const maxLeft = bounds.left + bounds.width - POPOVER.margin - size.width;
  const left = Math.max(bounds.left + POPOVER.margin, Math.min(anchor.left - POPOVER.offset, maxLeft));
  const below = anchor.top + anchor.height + POPOVER.offset;
  const bottom = bounds.top + bounds.height - POPOVER.margin;
  let top = below;
  if (below + size.height > bottom) {
    const above = anchor.top - POPOVER.offset - size.height;
    top = above >= bounds.top + POPOVER.margin ? above : Math.max(bounds.top + POPOVER.margin, bottom - size.height);
  }
  return {left, top};
}

/** An item's key in the address: an occurrence of a recurring event is `id@start`. */
export const itemKey = (id: number, at: string | null) => (at ? `${id}@${at}` : String(id));
