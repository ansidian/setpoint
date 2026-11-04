// SV-181: the .ics import review's rules (D437): which events start ticked, what each row and the
// list's lines say, what's sent for each, and how a run reads as it goes. Pure; the pane
// (app/calendar/ImportPane.tsx) and its run (app/calendar/importRun.ts) draw and send what these say.
import type {IcsDropReason, IcsEventOut, IcsImportEvent, IcsReadOut, ItemCreateInput} from '@setpoint/shared';
import {ICS_DROP_REASONS} from '@setpoint/shared';
import {timeRange, dayTitle} from './calendar.ts';
import {addDays, localDate} from './format.ts';

/** What the file picker takes. */
export const ICS_ACCEPT = '.ics,text/calendar';
/** The most an import takes (D437), checked before the file is sent. */
export const ICS_MAX_BYTES = 2 * 1024 * 1024;
export const ICS_TOO_BIG = 'This file is over 2 MB, the most an import takes';

/** Whether a dropped or picked file is an .ics calendar, by its type or its name. */
export const isIcsFile = (file: {name: string; type: string}) => file.type === 'text/calendar' || /\.ics$/i.test(file.name);

/**
 * SV-190: what a drag over the grid holds, before the drop (DESIGN.md #305). A page sees only each
 * item's kind and type then, not its name or size, so: one file of `text/calendar`, or of a type the
 * browser doesn't know (''), might import ('ics', the drop then judges it by name); one of any other
 * type can't ('other'); more than one file can't ('several'); and a drag that isn't of files is none
 * of these (null), as an item's own drag on the grid.
 */
export type FileDrag = 'ics' | 'other' | 'several' | null;
export function fileDrag(types: readonly string[], items: readonly {kind: string; type: string}[]): FileDrag {
  if (!types.includes('Files')) return null;
  const files = items.filter(item => item.kind === 'file');
  if (files.length > 1) return 'several';
  const type = files[0]?.type ?? '';
  return type === 'text/calendar' || type === '' ? 'ics' : 'other';
}

/** The words the grid shows while a file is over it. */
export const FILE_DRAG_LINES: Record<NonNullable<FileDrag>, string> = {
  ics: 'Drop to import .ics',
  other: 'Only an .ics file imports',
  several: 'One .ics file at a time',
};

/** The ticks the review starts with: every event but the past ones. */
export const initialTicks = (events: IcsEventOut[]) => new Set(events.filter(event => !event.past).map(event => event.ical_uid));

/** The title a row shows: the file's, or Google's "(No title)". */
export const rowTitle = (event: Pick<IcsEventOut, 'title'>) => event.title || '(No title)';

/** "Thu, Nov 12 · 7:00 – 8:00 AM", "Sat, Nov 14 · All day", "Mon, Dec 21 – Fri, Dec 25 · All day", in the user's zone. */
export function rowWhen(event: Pick<IcsEventOut, 'all_day' | 'starts_at' | 'ends_at' | 'start_date' | 'end_date'>, timeZone: string): string {
  if (event.all_day) {
    const last = addDays(event.end_date!, -1);
    return `${dayTitle(event.start_date!)}${last > event.start_date! ? ` – ${dayTitle(last)}` : ''} · All day`;
  }
  return `${dayTitle(localDate(event.starts_at!, timeZone))} · ${timeRange({all_day: false, starts_at: event.starts_at, ends_at: event.ends_at} as Parameters<typeof timeRange>[0], timeZone)}`;
}

/** The row's marks after its time: "repeats", "past", "will update". */
export function rowMarks(event: Pick<IcsEventOut, 'recurrence' | 'past' | 'existing'>, calendarId: number | null): string[] {
  return [
    event.recurrence.length > 0 && 'repeats',
    event.past && 'past',
    calendarId !== null && event.existing.includes(calendarId) && 'will update',
  ].filter((mark): mark is string => mark !== false);
}

/** "2 already on Personal (will update)", for the ticked events the chosen calendar already holds; null for none. */
export function alreadyLine(events: IcsEventOut[], ticked: ReadonlySet<string>, calendarId: number | null, calendarName: string | null): string | null {
  if (calendarId === null || !calendarName) return null;
  const count = events.filter(event => ticked.has(event.ical_uid) && event.existing.includes(calendarId)).length;
  return count ? `${count} already on ${calendarName} (will update)` : null;
}

const events = (count: number) => `${count.toLocaleString('en-US')} ${count === 1 ? 'event' : 'events'}`;

/** The footer's button: "Import 35 events". */
export const importLabel = (count: number) => `Import ${events(count)}`;

/** While it runs: "Importing 12 of 35", the one being sent counted. */
export const progressLine = (sent: number, total: number) => `Importing ${Math.min(sent + 1, total).toLocaleString('en-US')} of ${total.toLocaleString('en-US')}`;

/** The toast once a run has sent what it could: "Imported 35 events to Personal". */
export const importedLine = (count: number, calendarName: string) => `Imported ${events(count)} to ${calendarName}`;

/** A run with refusals: "2 events weren't imported" over the rows Google refused. */
export const refusedLine = (count: number) => `${events(count)} ${count === 1 ? 'wasn\'t' : 'weren\'t'} imported`;

/** Each reason's words, for "Left out: …" (shared/src/enums.ts says what each one is). */
const DROPPED_WORDS: Record<IcsDropReason, (count: number) => string> = {
  cancelled: count => `${events(count)} cancelled`,
  not_an_event: count => `${count.toLocaleString('en-US')} ${count === 1 ? 'to-do or note' : 'to-dos and notes'}`,
  no_start: count => `${events(count)} with no start`,
  alarm_after_start: count => `${count === 1 ? 'a reminder' : `${count} reminders`} after the start`,
  alarm_at_fixed_time: count => `${count === 1 ? 'a reminder' : `${count} reminders`} at a set time`,
  alarm_over_limit: count => `${count === 1 ? 'a reminder' : `${count} reminders`} past Google's limit`,
  categories: count => `categories on ${events(count)}`,
  duplicate: count => `${count === 1 ? 'a second copy' : `${count} second copies`} of an event`,
  occurrence_without_series: count => `${count === 1 ? 'a changed occurrence' : `${count} changed occurrences`} without its event`,
};

/** "Left out: categories on 35 events · 2 events cancelled", or null when the file had nothing to leave out. */
export function droppedLine(dropped: IcsReadOut['dropped']): string | null {
  const parts = ICS_DROP_REASONS.filter(reason => dropped[reason] > 0).map(reason => DROPPED_WORDS[reason](dropped[reason]));
  return parts.length ? `Left out: ${parts.join(' · ')}` : null;
}

/** A file with nothing to import says so, with what it had (D436: one that only cancels). */
export function nothingLine(dropped: IcsReadOut['dropped']): string {
  const left = droppedLine(dropped);
  return left ? `Nothing to import, ${left.replace(/^Left out: /, 'the file has ')}` : 'Nothing to import, the file has no events';
}

/** The day an event starts on, in the user's zone. */
export const eventDay = (event: Pick<IcsEventOut, 'all_day' | 'start_date' | 'starts_at'>, timeZone: string) =>
  event.all_day ? event.start_date! : localDate(event.starts_at!, timeZone);

/**
 * Where a read file lands (D437, D444): nothing to import says so in the toast; one event opens the
 * editor as a draft on its day; two or more open the review, on the first upcoming event's day (or the
 * first event's, when all are past), so Calendar from an email shows where they'd go (SV-182).
 */
export type IcsLanding = {kind: 'nothing'; line: string} | {kind: 'draft'; event: IcsEventOut; date: string} | {kind: 'review'; date: string};
export function icsLanding(read: IcsReadOut, timeZone: string): IcsLanding {
  const [first] = read.events;
  if (!first) return {kind: 'nothing', line: nothingLine(read.dropped)};
  if (read.events.length === 1) return {kind: 'draft', event: first, date: eventDay(first, timeZone)};
  return {kind: 'review', date: eventDay(read.events.find(event => !event.past) ?? first, timeZone)};
}

/** What the review sends for an event: the draft as read, without the review's own fields. */
export function importOf(event: IcsEventOut): IcsImportEvent {
  const {past: _past, existing: _existing, ...rest} = event;
  return {...rest, colour: null, leave_reminder: false};
}

/**
 * One event opened in the editor (D437) and created there: the editor's fields over the file's, so it
 * keeps its iCalUID, description, link, free/busy and changed occurrences. A repeat changed in the
 * editor replaces the file's RRULE and keeps its EXDATE and RDATE lines; one taken off drops them.
 */
export function editedImport(event: IcsEventOut, input: ItemCreateInput): IcsImportEvent {
  const fileRule = event.recurrence.find(line => line.startsWith('RRULE:')) ?? null;
  const recurrence = input.recurrence === fileRule ? event.recurrence
    : input.recurrence ? [...event.recurrence.filter(line => !line.startsWith('RRULE:')), input.recurrence] : [];
  return {
    ...importOf(event),
    title: input.title, all_day: input.all_day, starts_at: input.starts_at, ends_at: input.ends_at, start_date: input.start_date, end_date: input.end_date,
    time_zone: input.time_zone ?? event.time_zone, place: input.place, address: input.address,
    // Google keeps 5 reminders, all before the start.
    reminders: (input.reminders ?? event.reminders).filter(minutes => minutes >= 0).slice(0, 5),
    recurrence, changes: recurrence.length ? event.changes : [],
    colour: input.colour, leave_reminder: input.leave_reminder,
  };
}

/** One event's place in a run. */
export type RowState = {state: 'sending'} | {state: 'done'; created: boolean; itemId: number} | {state: 'failed'; message: string; commandId: number | null};

/** How a run stands: sent so far, how many it's sending, and the refused. */
export function runCounts(order: string[], rows: ReadonlyMap<string, RowState>) {
  const states = order.map(uid => rows.get(uid));
  return {
    done: states.filter(row => row?.state === 'done').length,
    failed: states.filter(row => row?.state === 'failed').length,
    settled: states.filter(row => row?.state === 'done' || row?.state === 'failed').length,
    total: order.length,
  };
}
