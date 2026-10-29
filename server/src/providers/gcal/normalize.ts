// Google events as items, and items as Google event bodies. Rewritten from v1's
// `calendar-event-normalize` (see SV-6): v1 built display rows in a fixed Pacific zone; v2 keeps
// what Google says. Carried over: all-day is a `date` start (Google's end date is already
// exclusive, as v2's), a master is an event with `recurrence`, an exception names its
// `recurringEventId` and `originalStartTime`, a cancelled one is deleted, rooms and equipment aren't
// attendees, "(No title)" for an untitled event, and only `default` events can be changed here
// (birthdays, focus time and out-of-office are Google's own; v1 4423e6b5).
import {eventColourOf, EVENT_COLOUR_IDS} from '../../domain/colours.ts';
import {parseRule} from '../../domain/recurrence.ts';
import {addDays, localDay} from '../../domain/time.ts';
import type {ItemRow} from '../../commands/itemMirror.ts';
import type {EventTime, GoogleEvent} from './api.ts';

/** The columns an event fills, as the mirror stores it. */
export type EventColumns = Pick<ItemRow,
  'title' | 'allDay' | 'startsAt' | 'endsAt' | 'startDate' | 'endDate' | 'timeZone' | 'recurrence' | 'place' | 'address' | 'attendees' | 'reminders' | 'leaveReminder' | 'etag' | 'expanded' | 'readOnly' | 'colour'>;

/** SV-31: an event's Time to Leave, as a private extended property only Setpoint reads ("on" or "off"). */
export const LEAVE_PROPERTY = 'setpointTimeToLeave';

export const toInstant = (value: string) => new Date(value).toISOString();

/** An occurrence's original start as the mirror keys it: an instant in UTC, or a date. */
export function originalStartOf(time: EventTime | undefined): string | null {
  if (time?.dateTime) return toInstant(time.dateTime);
  return time?.date ?? null;
}

/**
 * "Smile Dental, 1420 Elm St" is a place and its address. Google keeps one location line: Places
 * writes "name, address" (v1's details mapping), so the first part is the place unless it's
 * already the street address.
 */
export function splitLocation(location: string | undefined): {place: string | null; address: string | null} {
  const text = location?.trim();
  if (!text) return {place: null, address: null};
  const comma = text.indexOf(', ');
  if (/^\d/.test(text)) return {place: null, address: text};
  if (comma < 0) return {place: text, address: null};
  return {place: text.slice(0, comma), address: text.slice(comma + 2)};
}

/** "Smile Dental, 1420 Elm St, …"; a street address picked as the place is written once. */
export function joinLocation(place: string | null, address: string | null): string {
  if (place && address && (address === place || address.startsWith(`${place}, `))) return address;
  return [place, address].filter(Boolean).join(', ');
}

/** The series' rule when this expander covers it alone; otherwise Google's own expansion is used. */
export function recurrenceOf(lines: string[] | undefined, allDay: boolean): {recurrence: string | null; expanded: boolean} {
  if (!lines?.length) return {recurrence: null, expanded: false};
  const rules = lines.filter(line => line.startsWith('RRULE:'));
  const rule = rules[0] ?? null;
  // EXDATE, RDATE, several rules, an all-day series or a rule the expander doesn't cover: Google's
  // instances become rows (src/providers/gcal/sync.ts).
  const simple = rule !== null && rules.length === 1 && lines.length === 1 && !allDay && parseRule(rule, until => until.slice(0, 10)) !== null;
  return {recurrence: rule, expanded: !simple};
}

/** Reminders in minutes before: the event's own, or its calendar's defaults. */
export function remindersOf(event: GoogleEvent, calendarDefaults: number[]): number[] {
  if (!event.reminders || event.reminders.useDefault) return [...calendarDefaults];
  return (event.reminders.overrides ?? []).flatMap(reminder => (typeof reminder.minutes === 'number' ? [reminder.minutes] : [])).sort((a, b) => a - b);
}

/** Google's before-reminders with the row's own after-ones, which Google never holds (D287). */
export function withOwnAfter(fromGoogle: number[], row: Pick<ItemRow, 'reminders'> | undefined): number[] {
  return [...fromGoogle.filter(minutes => minutes >= 0), ...(row?.reminders ?? []).filter(minutes => minutes < 0)];
}

export function attendeesOf(event: GoogleEvent): string[] {
  return (event.attendees ?? []).filter(person => person.email && !person.resource && !person.self).map(person => person.displayName || person.email!);
}

/** A confirmed Google event as the mirror's columns; `calendarZone` when the event names none. */
export function eventColumns(event: GoogleEvent, calendarZone: string, calendarDefaults: number[]): EventColumns {
  const allDay = !event.start?.dateTime && Boolean(event.start?.date);
  const {place, address} = splitLocation(event.location);
  const {recurrence, expanded} = recurrenceOf(event.recurrence, allDay);
  const startDate = allDay ? event.start!.date! : null;
  return {
    title: event.summary?.trim() || '(No title)',
    allDay,
    startsAt: allDay ? null : toInstant(event.start!.dateTime!),
    endsAt: allDay ? null : toInstant(event.end?.dateTime ?? event.start!.dateTime!),
    startDate,
    // A zero-length all-day event still covers its day.
    endDate: allDay ? (event.end?.date && event.end.date > startDate! ? event.end.date : addDays(startDate!, 1)) : null,
    timeZone: event.start?.timeZone ?? calendarZone,
    recurrence, expanded, place, address,
    attendees: attendeesOf(event),
    reminders: remindersOf(event, calendarDefaults),
    leaveReminder: event.extendedProperties?.private?.[LEAVE_PROPERTY] === 'on',
    etag: event.etag ?? null,
    readOnly: (event.eventType ?? 'default') !== 'default',
    colour: eventColourOf(event.colorId),
  };
}

/**
 * A cancelled occurrence of a series: kept as a cancelled exception so the series skips it. Google
 * sends only its original start; it takes that time (and the series' length) so the row is whole.
 */
export function cancelledOccurrence(originalStart: string, master: Pick<ItemRow, 'startsAt' | 'endsAt'> | null) {
  if (!originalStart.includes('T')) {
    return {allDay: true, startDate: originalStart, endDate: addDays(originalStart, 1), startsAt: null, endsAt: null};
  }
  const length = master?.startsAt && master.endsAt ? Date.parse(master.endsAt) - Date.parse(master.startsAt) : 0;
  return {allDay: false, startsAt: originalStart, endsAt: new Date(Date.parse(originalStart) + length).toISOString(), startDate: null, endDate: null};
}

/**
 * An item's when, as Google's start and end: an all-day date pair, or instants in the item's zone.
 * The other kind's fields go as null: a patch merges start and end into what they were, so an all-day
 * event made timed would otherwise keep its date beside the new dateTime, which Google refuses as
 * "Invalid start time" (SV-117).
 */
export function eventTimes(item: Pick<ItemRow, 'allDay' | 'startsAt' | 'endsAt' | 'startDate' | 'endDate' | 'timeZone'>, fallbackZone: string): {start: EventTime; end: EventTime} {
  if (item.allDay) return {start: {date: item.startDate!, dateTime: null, timeZone: null}, end: {date: item.endDate!, dateTime: null, timeZone: null}};
  const timeZone = item.timeZone ?? fallbackZone;
  return {start: {date: null, dateTime: item.startsAt!, timeZone}, end: {date: null, dateTime: item.endsAt!, timeZone}};
}

/**
 * The event's colour as Google's colorId, or null to take the calendar's. Written only when the
 * colour itself changes (or on create): several of Google's colours read as one swatch, so writing it
 * back on every change would turn Lavender into Grape.
 */
export const colorIdOf = (colour: ItemRow['colour']) => (colour && colour in EVENT_COLOUR_IDS ? EVENT_COLOUR_IDS[colour as keyof typeof EVENT_COLOUR_IDS] : null);

/** The fields Setpoint writes: everything the editor changes, never what it doesn't know (conference links). The colour is the caller's (colorIdOf). */
export function eventBody(item: ItemRow, fallbackZone: string): Partial<GoogleEvent> {
  return {
    summary: item.title,
    location: joinLocation(item.place, item.address),
    ...eventTimes(item, fallbackZone),
    // Google has no reminder after the start: only the before-ones go, the after-ones stay Setpoint's (D287).
    reminders: {useDefault: false, overrides: (item.reminders ?? []).filter(minutes => minutes >= 0).map(minutes => ({method: 'popup', minutes}))},
    // "off" rather than nothing: a patch merges private properties, so leaving it out would keep "on".
    extendedProperties: {private: {[LEAVE_PROPERTY]: item.leaveReminder ? 'on' : 'off'}},
  };
}

/** Replaces the RRULE line among a master's lines, keeping its EXDATE and RDATE lines (v1 dropped them). */
export function withRule(lines: string[] | undefined, rule: string): string[] {
  const others = (lines ?? []).filter(line => !line.startsWith('RRULE:'));
  return [...others, rule];
}

/**
 * Ends a series before an occurrence (This and following): UNTIL a second before a timed one, the
 * day before an all-day one, COUNT replaced (v1's `buildSeriesTrimmedBeforeTarget`).
 */
export function ruleEndingBefore(rule: string, originalStart: string): string {
  const parts = rule.replace(/^RRULE:/, '').split(';').filter(part => part && !/^(UNTIL|COUNT)=/.test(part));
  const until = originalStart.includes('T')
    ? new Date(Date.parse(originalStart) - 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
    : addDays(originalStart, -1).replace(/-/g, '');
  return `RRULE:${[...parts, `UNTIL=${until}`].join(';')}`;
}

/** Whether an occurrence is a series' first (v1's isSameRecurringStart: instants by time, dates by day). */
export function isFirstOccurrence(masterStart: string, originalStart: string, zone: string): boolean {
  if (masterStart.includes('T') && originalStart.includes('T')) return Date.parse(masterStart) === Date.parse(originalStart);
  const day = (value: string) => (value.includes('T') ? localDay(value, zone) : value.slice(0, 10));
  return day(masterStart) === day(originalStart);
}
