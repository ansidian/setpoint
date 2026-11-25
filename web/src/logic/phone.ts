// The phone's own rules (board 21): the agenda, from the week before the day it opens on and on
// without an end, a week at a time, its empty days collapsed, today led by its Overdue group.
import type {ItemOut} from '@setpoint/shared';
import {dayTitle, isPast, timeRange} from './calendar.ts';
import {addDays, clockTime, daysBetween, instantAt, localDate, monthName} from './format.ts';

/**
 * How the phone's reader changes. An email opened from the list slides in over it, and closing it
 * slides back. Going from one email to another, and the desktop's reader beside the list, don't slide.
 */
export function phoneSlide(phone: boolean, from: number | null, to: number | null): 'in' | 'back' | null {
  if (!phone) return null;
  if (from === null && to !== null) return 'in';
  if (from !== null && to === null) return 'back';
  return null;
}

/** How the phone's reader moves through the history (readerStep), and whether the list sits under the entry. */
export interface ReaderStep {
  how: 'push' | 'replace' | 'back';
  overList: boolean;
}

/**
 * How the phone's reader moves through the history, so the system's Back (Safari's edge swipe) is the
 * app's Back. An email opened from the list is pushed over it, and its Back goes back to the list
 * rather than pushing it again. Done or Trash moving on to the next email takes its place. A line of the
 * thread is pushed over the email it was opened from, whose Back is the history's. A list reached
 * otherwise (a deep link) is pushed; the desktop pushes as it did.
 */
export function readerStep(phone: boolean, from: number | null, to: number | null, moving: boolean, overList: boolean): ReaderStep {
  if (!phone) return {how: 'push', overList: false};
  if (to === null) return {how: overList ? 'back' : 'push', overList: false};
  if (from === null) return {how: 'push', overList: true};
  if (moving) return {how: 'replace', overList};
  return {how: 'push', overList: false};
}

/** The days phoneAgenda draws unless told: today and the next 7. */
export const AGENDA_DAYS = 8;

/** The agenda loads a week at a time. */
export const WEEK = 7;
/** Above the day it opens on, the week before it; older days are the month picker's. */
export const PAST_DAYS = 7;
/** The weeks loaded at first after the day it opens on. */
export const FIRST_WEEKS = 2;
/** Loading on its own stops after this many empty weeks in a row, for a Show later row. */
export const EMPTY_WEEKS = 4;

/**
 * The day the agenda opens on once it's showing from `anchor` with `weeks` loaded after it: it stays,
 * unless a link names a day outside what's loaded (the week before through the last week), which it
 * then opens on. While a search shows, nothing moves it.
 */
export function agendaAnchor(anchor: string, weeks: number, linked: string | null, searching = false): string {
  if (!linked || searching) return anchor;
  const from = addDays(anchor, -PAST_DAYS);
  const to = addDays(anchor, weeks * WEEK);
  return linked >= from && linked < to ? anchor : linked;
}

/** What's loaded, a range each (`to` exclusive): the week before `anchor`, then `weeks` weeks from it. */
export function agendaChunks(anchor: string, weeks: number): {from: string; to: string}[] {
  const chunks = [{from: addDays(anchor, -PAST_DAYS), to: anchor}];
  for (let week = 0; week < weeks; week += 1) chunks.push({from: addDays(anchor, week * WEEK), to: addDays(anchor, (week + 1) * WEEK)});
  return chunks;
}

/**
 * Whether nearing the end loads the next week by itself: not once the last `EMPTY_WEEKS` weeks
 * loaded (`counts`, each week's items from the day it opens on) were all empty, since empty days
 * fold into one line and the end would stay in sight. A Show later row loads on from there.
 */
export function loadsOn(counts: readonly number[]): boolean {
  return counts.length < EMPTY_WEEKS || counts.slice(-EMPTY_WEEKS).some(count => count > 0);
}

/** The header's month for the day in view: "October", with its year outside the current one, "January 2027". */
export function agendaMonth(date: string, today: string): string {
  const name = monthName(`${date.slice(0, 7)}-01`);
  return date.slice(0, 4) === today.slice(0, 4) ? name.replace(/ \d{4}$/, '') : name;
}

/**
 * How long a task has been overdue at `now`, by the larger unit: "25 min", "3 hr", "1 day", "12 days".
 * A timed task counts from its time, an untimed one from the end of its day.
 */
export function overdueFor(item: ItemOut, now: number, timeZone: string): string {
  const due = item.due_at ? Date.parse(item.due_at) : Date.parse(instantAt(item.due_date!, 1440, timeZone));
  const minutes = Math.max(1, Math.floor((now - due) / 60_000));
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr`;
  const days = daysBetween(item.due_at ? localDate(item.due_at, timeZone) : item.due_date!, localDate(now, timeZone));
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/** When an overdue task's snooze would end, on its choice's right: "10:12 AM", or "Thu 9:00 AM" on another day, as mail's snooze menu. */
export function snoozeEnd(at: number, now: number, timeZone: string): string {
  const time = clockTime(at, timeZone);
  if (localDate(at, timeZone) === localDate(now, timeZone)) return time;
  return `${new Date(at).toLocaleDateString('en-US', {weekday: 'short', timeZone})} ${time}`;
}

export interface AgendaLine {
  item: ItemOut;
  // "7:00 – 8:00 AM", "All day", a timed task's "9:00 AM", or nothing for a task due on the day.
  when: string;
  past: boolean;
}

export type AgendaSection =
  // `nowAt`: today's now-line, before lines[nowAt] (agendaNowAt). Null on other days.
  | {kind: 'day'; date: string; title: string; today: boolean; lines: AgendaLine[]; nowAt: number | null}
  | {kind: 'empty'; from: string; to: string; title: string; today: boolean};

/**
 * Where today's now-line goes among its lines: before the first timed event not yet over,
 * else after the last timed event, before the tasks. All-day events lead the day and tasks end it,
 * so neither places it. A day without a timed event has none.
 */
export function agendaNowAt(lines: AgendaLine[]): number | null {
  const timed = lines.flatMap((line, index) => (line.item.kind === 'event' && !line.item.all_day && line.item.starts_at ? [index] : []));
  if (!timed.length) return null;
  return timed.find(index => !lines[index]!.past) ?? timed.at(-1)! + 1;
}

/**
 * The agenda's `days` days from `start`: each day's items in the grid's order (`byDay` is
 * itemsByDay's), and each run of empty days as one line, "Sat, Oct 10 – Sun, Oct 11" (No events),
 * except that an empty day with a forecast (`forecast`, its dates) keeps its own line to show it.
 * Today leaves out the tasks in its Overdue group (`overdue`, their keys), which leads it instead.
 * Today and the day the agenda opens on (`opens`, a link's or the month picker's) keep their own lines.
 */
export function phoneAgenda(start: string, today: string, byDay: Map<string, ItemOut[]>, now: number, timeZone: string, forecast: ReadonlySet<string> = new Set(),
  {days = AGENDA_DAYS, overdue = new Set<string>(), opens = null}: {days?: number; overdue?: ReadonlySet<string>; opens?: string | null} = {}): AgendaSection[] {
  const sections: AgendaSection[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = addDays(start, offset);
    const items = (byDay.get(date) ?? []).filter(item => date !== today || !overdue.has(item.key));
    const title = date === today ? `Today · ${dayTitle(date)}` : dayTitle(date);
    if (items.length) {
      const lines = items.map(item => ({item, when: when(item, timeZone), past: isPast(item, now, timeZone)}));
      sections.push({kind: 'day', date, title, today: date === today, lines, nowAt: date === today ? agendaNowAt(lines) : null});
      continue;
    }
    const last = sections.at(-1);
    // Today stays on its own line, named as today, and so do the day it opens on (`opens`) and a day with a forecast.
    const own = (day: string) => day === today || day === opens || forecast.has(day);
    if (last?.kind === 'empty' && !own(last.from) && !own(date)) sections[sections.length - 1] = {...last, to: date, title: `${dayTitle(last.from)} – ${dayTitle(date)}`};
    else sections.push({kind: 'empty', from: date, to: date, title, today: date === today});
  }
  return sections;
}

function when(item: ItemOut, timeZone: string): string {
  if (item.kind === 'task') return item.due_at ? clockTime(item.due_at, timeZone) : '';
  return timeRange(item, timeZone);
}
