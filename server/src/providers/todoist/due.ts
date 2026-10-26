// A Todoist due as an item's due day and time, done once at the adapter's edge. Todoist's
// `due.date` comes three ways: a day ("2026-10-07"); a floating time, wall-clock in the user's zone
// ("2026-10-07T19:00:00"); or a fixed-zone time, a UTC instant with `due.timezone` beside it
// ("2026-10-08T02:00:00Z"). v1 read the last as wall-clock time (56a59a4e), fixed that for display
// only (0cf93d2d), and still stored its UTC day and misplaced its reminder (see SV-6): here an
// instant is an instant, and its day is the local day in the user's zone.
import {localDay, localTime, zonedInstant} from '../../domain/time.ts';

export interface TodoistDue {
  date: string;
  timezone?: string | null;
  string?: string | null;
  is_recurring?: boolean;
  lang?: string | null;
}

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const WITH_OFFSET = /(?:Z|[+-]\d{2}:\d{2})$/;
const FLOATING = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/;

/** The due day (local) and, with a time, the instant; null for a due Setpoint can't read. */
export function readDue(due: TodoistDue, timeZone: string): {dueDate: string; dueAt: string | null} | null {
  if (DAY_ONLY.test(due.date)) return {dueDate: due.date, dueAt: null};
  if (WITH_OFFSET.test(due.date)) {
    const at = Date.parse(due.date);
    if (Number.isNaN(at)) return null;
    const dueAt = new Date(at).toISOString();
    return {dueDate: localDay(dueAt, timeZone), dueAt};
  }
  const floating = FLOATING.exec(due.date);
  if (!floating) return null;
  return {dueDate: floating[1]!, dueAt: zonedInstant(floating[1]!, `${floating[2]}:${floating[3]}`, timeZone)};
}

/**
 * A task's due as Todoist's write fields: a day, an instant (UTC, so Todoist keeps it fixed), or,
 * for a repeating task, one due string holding the repeat, the time and the day it starts from
 * ("every mon at 09:00 starting 2026-10-12"). Todoist reads a bare date as the end of a repeat, so
 * the repeat always travels with the date (F6b; B5 refused the date change instead, D16). A repeat
 * with a last day ("every mon until 2026-12-15", SV-113) puts it after the first, in the form Todoist
 * documents ("everyday from 10 May until 20 May"): "every mon at 09:00 from 2026-10-12 until 2026-12-15".
 */
export function writeDue(task: {dueDate: string | null; dueAt: string | null; repeat?: string | null}, timeZone: string): {due_date?: string; due_datetime?: string; due_string?: string} {
  if (task.repeat && task.dueDate) {
    const at = task.dueAt ? ` at ${localTime(task.dueAt, timeZone)}` : '';
    const ending = ENDING_CLAUSE.exec(task.repeat);
    if (ending) return {due_string: `${task.repeat.slice(0, ending.index)}${at} from ${task.dueDate} ${ending[0].trim()}`};
    return {due_string: `${task.repeat}${at} starting ${task.dueDate}`};
  }
  if (task.dueAt) return {due_datetime: new Date(task.dueAt).toISOString().replace(/\.\d{3}Z$/, 'Z')};
  if (task.dueDate) return {due_date: task.dueDate};
  return {due_string: 'no date'};
}

// "… starting oct 12", "… from 2026-10-12", "… at 9am", "… @ 21:00": what Todoist adds to a repeat.
const START_CLAUSE = /\s+(?:starting|from)\s+.*$/i;
const TIME_CLAUSE = /\s+(?:at|@)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?$/i;
// "… until dec 15", "… ending aug 3": a repeat's last day (SV-113), up to a start after it or the end.
const ENDING_CLAUSE = /\s+(?:until|ending)\s+.+?(?=\s+(?:starting|from)\s+|$)/i;

/**
 * The repeat in a repeating task's due string, without the time or the start Todoist keeps in it
 * ("every mon at 9am starting oct 12" → "every mon"); null when there are no words to keep.
 * shortcut: only trailing "at <time>" and "starting/from <day>" clauses are taken off; a time inside
 * the repeat ("every mon 9am, wed 5pm") stays in it, and Todoist reads it the same way again. A last
 * day ("until …", "ending …") is kept, after the repeat ("every mon from oct 12 until dec 15" →
 * "every mon until dec 15"; SV-113).
 */
export function repeatOf(dueString: string | null): string | null {
  const text = (dueString ?? '').trim();
  const ending = ENDING_CLAUSE.exec(text);
  const rest = ending ? `${text.slice(0, ending.index)}${text.slice(ending.index + ending[0].length)}` : text;
  const words = rest.replace(START_CLAUSE, '').replace(TIME_CLAUSE, '').trim();
  return words ? `${words}${ending ? ` ${ending[0].trim()}` : ''}` : null;
}

/**
 * The repeat a change to a task leaves it with: the one asked for, else the one it has; undefined
 * when it repeats but Todoist sent no words for it, so Setpoint can't send the repeat back with a
 * new date and the change is refused.
 */
export function repeatAfter(task: {dueRecurring: boolean; dueString: string | null}, asked: string | null | undefined): string | null | undefined {
  if (asked !== undefined) return asked;
  if (!task.dueRecurring) return null;
  return repeatOf(task.dueString) ?? undefined;
}
