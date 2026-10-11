// The phone's own rules (DESIGN.md › Phone; board 21): the Inbox's group order, and the read-only
// agenda of today and the next 7 days with its empty days collapsed.
import type {InboxGroup, ItemOut} from '@setpoint/shared';
import {dayTitle, isPast, timeRange} from './calendar.ts';
import {addDays, clockTime, daysBetween} from './format.ts';

/** The Inbox on the phone: Attention (and Unsorted under it) before the Pinned shelf, then the rest. */
export function phoneGroups<T extends {group: InboxGroup}>(views: T[]): T[] {
  const pinned = views.filter(view => view.group === 'pinned');
  const rest = views.filter(view => view.group !== 'pinned');
  const after = rest.findIndex(view => view.group !== 'attention' && view.group !== 'unsorted');
  const at = after < 0 ? rest.length : after;
  return [...rest.slice(0, at), ...pinned, ...rest.slice(at)];
}

/** Today and the next 7 days. */
export const AGENDA_DAYS = 8;

/** Where the agenda starts: today, unless a link names a day outside today and the next 7 days, then that day. */
export function agendaStart(today: string, linked: string | null): string {
  if (!linked) return today;
  const offset = daysBetween(today, linked);
  return offset >= 0 && offset < AGENDA_DAYS ? today : linked;
}

/** "Oct 7 – 14", or "Oct 28 – Nov 4" across a month. */
export function agendaRange(start: string): string {
  const end = addDays(start, AGENDA_DAYS - 1);
  const label = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {...options, timeZone: 'UTC'});
  return `${label(start, {month: 'short', day: 'numeric'})} – ${label(end, start.slice(0, 7) === end.slice(0, 7) ? {day: 'numeric'} : {month: 'short', day: 'numeric'})}`;
}

export interface AgendaLine {
  item: ItemOut;
  // "7:00 – 8:00 AM", "All day", a timed task's "9:00 AM", or nothing for a task due on the day.
  when: string;
  past: boolean;
}

export type AgendaSection =
  | {kind: 'day'; date: string; title: string; lines: AgendaLine[]}
  | {kind: 'empty'; from: string; to: string; title: string};

/**
 * The agenda's days from `start`: each day's items in the grid's order (`byDay` is itemsByDay's), and
 * each run of empty days as one line, "Sat, Oct 10 – Sun, Oct 11" (No events), except that an empty day
 * with a forecast (`forecast`, its dates) keeps its own line to show it.
 */
export function phoneAgenda(start: string, today: string, byDay: Map<string, ItemOut[]>, now: number, timeZone: string, forecast: ReadonlySet<string> = new Set()): AgendaSection[] {
  const sections: AgendaSection[] = [];
  for (let offset = 0; offset < AGENDA_DAYS; offset += 1) {
    const date = addDays(start, offset);
    const items = byDay.get(date) ?? [];
    const title = date === today ? `Today · ${dayTitle(date)}` : dayTitle(date);
    if (items.length) {
      sections.push({kind: 'day', date, title, lines: items.map(item => ({item, when: when(item, timeZone), past: isPast(item, now, timeZone)}))});
      continue;
    }
    const last = sections.at(-1);
    // Today stays on its own line, named as today, and so does a day with a forecast.
    if (last?.kind === 'empty' && last.from !== today && !forecast.has(last.from) && !forecast.has(date)) sections[sections.length - 1] = {...last, to: date, title: `${dayTitle(last.from)} – ${dayTitle(date)}`};
    else sections.push({kind: 'empty', from: date, to: date, title});
  }
  return sections;
}

function when(item: ItemOut, timeZone: string): string {
  if (item.kind === 'task') return item.due_at ? clockTime(item.due_at, timeZone) : '';
  return timeRange(item, timeZone);
}
