// An .ics file's text read into import drafts: the events a Google `events.import` will write,
// keyed on each event's iCalUID, with a count of what the file had that an import leaves out, and
// why (SV-178, D436–D438). Pure: it reads the file it's given and sends nothing.
//
// What an event keeps (D438): its title (trimmed), times and zone, repeats (RRULE with EXDATE and
// RDATE, and its changed occurrences, RECURRENCE-ID), location, description, URL, free/busy and the
// alarms that fall before its start. What it drops, counted by reason: cancelled events, to-dos and
// other non-events, events with no start, alarms after the start or at a fixed time, and
// categories. Times: DTSTART with DTEND or DURATION; an all-day end date is exclusive; with no end
// an all-day event lasts one day and a timed one has no length; a TZID maps to its IANA zone (an
// Outlook Windows name too), and a floating time takes the user's zone.
import {createHash} from 'node:crypto';
import ICAL from 'ical.js';
import {ICS_DROP_REASONS} from '@setpoint/shared';
import type {IcsDropReason, ItemWhen} from '@setpoint/shared';
import {addDays, localDay, zonedInstant} from './time.ts';
import {windowsZone} from './windowsZones.ts';

/** The most an import takes (D437). */
export const ICS_MAX_BYTES = 2 * 1024 * 1024;
export const ICS_MAX_EVENTS = 1000;
/** Google keeps at most 5 reminders on an event, up to 4 weeks before it. */
const MAX_REMINDERS = 5;
const MAX_REMINDER_MINUTES = 40_320;

/** What an imported event, or one changed occurrence of it, carries to Google. */
export interface IcsEvent extends ItemWhen {
  kind: 'event';
  // Trimmed; '' when the file gives none.
  title: string;
  // The IANA zone of a timed event's start when the file names one ('UTC' for a repeating event
  // written in UTC); null for an all-day event and for a time that takes the user's zone (floating,
  // a single event written in UTC, or a zone the file names but nobody knows).
  time_zone: string | null;
  location: string | null;
  // Google's description: the file's plain text, shown as the event's description (SV-264, D546).
  description: string | null;
  // Google's `source.url`: an http or https link only.
  url: string | null;
  // TRANSP:TRANSPARENT is free time.
  transparency: 'opaque' | 'transparent';
  // Minutes before the start, nearest first; only the file's own alarms (never the user's default).
  reminders: number[];
}

/** One changed occurrence of a repeating event (RECURRENCE-ID), named by its original start. */
export interface IcsChange extends IcsEvent {
  original_start_at: string | null;
  original_start_date: string | null;
}

export interface IcsDraft extends IcsEvent {
  ical_uid: string;
  sequence: number;
  // RFC 5545 lines as Google's `recurrence` takes them: RRULE, then EXDATE and RDATE in UTC (or as
  // dates for an all-day event). Empty for an event that doesn't repeat.
  recurrence: string[];
  changes: IcsChange[];
}

// What's left out, by reason (shared/src/enums.ts has each one's meaning).
export {ICS_DROP_REASONS};
export type {IcsDropReason};
export type IcsDropped = Record<IcsDropReason, number>;

export type IcsRead = {ok: true; drafts: IcsDraft[]; dropped: IcsDropped} | {ok: false; error: string};

export const ICS_ERRORS = {
  unreadable: 'This file can\'t be read, it isn\'t an .ics calendar',
  tooBig: 'This file is over 2 MB, the most an import takes',
  tooMany: (events: number) => `This file has ${events.toLocaleString('en-US')} events, over the ${ICS_MAX_EVENTS.toLocaleString('en-US')} an import takes`,
};

interface Context {
  userZone: string;
  // The file's own VTIMEZONEs by TZID, for a zone no table knows.
  zones: Map<string, ICAL.Timezone>;
  cancelsAll: boolean;
}

type Moment = {kind: 'date'; date: string} | {kind: 'instant'; at: string; zone: string | null; utc: boolean};

/** Reads an .ics file (its bytes or its text) into import drafts, or one plain error line. */
export function readIcs(file: string | Uint8Array, options: {timeZone: string}): IcsRead {
  const bytes = typeof file === 'string' ? Buffer.byteLength(file, 'utf8') : file.byteLength;
  if (bytes > ICS_MAX_BYTES) return {ok: false, error: ICS_ERRORS.tooBig};
  const text = (typeof file === 'string' ? file : new TextDecoder('utf-8').decode(file)).replace(/^\uFEFF/, '');
  const calendars = parseCalendars(text);
  if (!calendars) return {ok: false, error: ICS_ERRORS.unreadable};

  const dropped = Object.fromEntries(ICS_DROP_REASONS.map(reason => [reason, 0])) as IcsDropped;
  const events: {component: ICAL.Component; context: Context}[] = [];
  for (const calendar of calendars) {
    const context: Context = {
      userZone: options.timeZone,
      zones: new Map(),
      cancelsAll: textOf(calendar.getFirstPropertyValue('method')).toUpperCase() === 'CANCEL',
    };
    for (const component of calendar.getAllSubcomponents()) {
      if (component.name === 'vtimezone') {
        const tzid = textOf(component.getFirstPropertyValue('tzid'));
        const zone = usableZone(component);
        if (tzid && zone) context.zones.set(tzid, zone);
      } else if (component.name === 'vevent') {
        events.push({component, context});
      } else {
        dropped.not_an_event++;
      }
    }
  }
  if (events.length > ICS_MAX_EVENTS) return {ok: false, error: ICS_ERRORS.tooMany(events.length)};

  // Each iCalUID's event and its changed occurrences, in the order the file first names them.
  const byUid = new Map<string, {masters: typeof events; changes: typeof events}>();
  for (const event of events) {
    const uid = uidOf(event.component);
    const group = byUid.get(uid) ?? {masters: [], changes: []};
    byUid.set(uid, group);
    (event.component.hasProperty('recurrence-id') ? group.changes : group.masters).push(event);
  }

  const drafts: IcsDraft[] = [];
  for (const [uid, group] of byUid) {
    const master = latest(group.masters, dropped);
    if (!master) {
      for (const change of group.changes) dropped[isCancelled(change.component, change.context) ? 'cancelled' : 'occurrence_without_series']++;
      continue;
    }
    if (isCancelled(master.component, master.context)) {
      dropped.cancelled++;
      continue;
    }
    const base = eventOf(master.component, master.context, dropped);
    if (!base) {
      dropped.no_start++;
      continue;
    }
    const {fields, start} = base;
    const repeats = repeatsOf(master.component, master.context, start);
    const changes: IcsChange[] = [];
    for (const change of byOriginalStart(group.changes, master.context, start, dropped)) {
      const original = change.original;
      if (!repeats.rules.length && !repeats.dates.length) {
        dropped.occurrence_without_series++;
        continue;
      }
      if (isCancelled(change.component, change.context)) {
        repeats.excluded.push(original);
        continue;
      }
      const read = eventOf(change.component, change.context, dropped);
      if (!read) {
        dropped.no_start++;
        continue;
      }
      changes.push({
        ...read.fields,
        original_start_at: start.kind === 'instant' ? isoOfBasic(original) : null,
        original_start_date: start.kind === 'date' ? dateOfBasic(original) : null,
      });
    }
    drafts.push({
      ...fields,
      ical_uid: uid,
      sequence: sequenceOf(master.component),
      // A repeating event written in UTC repeats in UTC; a single one shows in the user's zone.
      time_zone: start.kind === 'instant' && start.utc && repeats.rules.length ? 'UTC' : fields.time_zone,
      recurrence: recurrenceLines(repeats, start),
      changes,
    });
  }
  return {ok: true, drafts, dropped};
}

/** A VTIMEZONE whose every part has an offset ical.js can read; one that doesn't would read as UTC. */
function usableZone(component: ICAL.Component): ICAL.Timezone | null {
  const parts = [...component.getAllSubcomponents('standard'), ...component.getAllSubcomponents('daylight')];
  const readable = parts.length > 0 && parts.every(part => ['tzoffsetfrom', 'tzoffsetto'].every(name => safely(() => part.getFirstPropertyValue(name)) instanceof ICAL.UtcOffset));
  return readable ? safely(() => new ICAL.Timezone(component)) : null;
}

/** The file's VCALENDARs, or null when it isn't a calendar ical.js can read. */
function parseCalendars(text: string): ICAL.Component[] | null {
  // LF-only and CR-only line endings, and blank lines, which ical.js refuses.
  const lines = text.split(/\r\n|\r|\n/).filter(line => line.trim() !== '');
  if (!lines.length) return null;
  let parsed: unknown;
  try {
    parsed = ICAL.parse(lines.join('\r\n'));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || !parsed.length) return null;
  const roots = (typeof parsed[0] === 'string' ? [parsed] : parsed) as unknown[];
  const calendars = roots.map(root => new ICAL.Component(root as [string, unknown[], unknown[]])).filter(root => root.name === 'vcalendar');
  return calendars.length ? calendars : null;
}

/** A value ical.js reads only when asked, and throws on when it's malformed: null then. */
function safely<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : value == null ? '' : String(value)).trim();
const textOrNull = (value: unknown): string | null => textOf(value) || null;

function uidOf(component: ICAL.Component): string {
  const uid = textOf(component.getFirstPropertyValue('uid'));
  if (uid) return uid;
  // Google needs an iCalUID: one made from the event's start and title, so importing the same
  // file again still updates rather than duplicates.
  const start = component.getFirstProperty('dtstart')?.toICALString() ?? '';
  const hash = createHash('sha256').update(`${start}\n${textOf(component.getFirstPropertyValue('summary'))}`).digest('hex');
  return `${hash.slice(0, 32)}@ics-import`;
}

function sequenceOf(component: ICAL.Component): number {
  const sequence = Number(safely(() => component.getFirstPropertyValue('sequence')));
  return Number.isInteger(sequence) && sequence >= 0 ? sequence : 0;
}

/** The copy to keep of several with one iCalUID (or one occurrence): highest SEQUENCE, later on a tie. */
function latest<T extends {component: ICAL.Component}>(copies: T[], dropped: IcsDropped): T | null {
  if (!copies.length) return null;
  dropped.duplicate += copies.length - 1;
  return copies.reduce((best, copy) => (sequenceOf(copy.component) >= sequenceOf(best.component) ? copy : best));
}

function isCancelled(component: ICAL.Component, context: Context): boolean {
  return context.cancelsAll || textOf(component.getFirstPropertyValue('status')).toUpperCase() === 'CANCELLED';
}

/** The changed occurrences by their original start (in the series' terms), one copy of each. */
function byOriginalStart(changes: {component: ICAL.Component; context: Context}[], context: Context, start: Moment, dropped: IcsDropped) {
  const groups = new Map<string, typeof changes>();
  for (const change of changes) {
    const property = change.component.getFirstProperty('recurrence-id');
    const moment = property ? momentOfProperty(property, change.context) : null;
    const original = moment ? basicIn(moment, start, context) : null;
    if (!original) {
      dropped.no_start++;
      continue;
    }
    groups.set(original, [...(groups.get(original) ?? []), change]);
  }
  return [...groups].map(([original, copies]) => ({...latest(copies, dropped)!, original}));
}

/** The fields an event or a changed occurrence carries, and its start; null with no readable start. */
function eventOf(component: ICAL.Component, context: Context, dropped: IcsDropped): {fields: IcsEvent; start: Moment} | null {
  const startProperty = component.getFirstProperty('dtstart');
  const start = startProperty ? momentOfProperty(startProperty, context) : null;
  if (!start) return null;
  const when = whenOf(component, startProperty!, start, context);
  if (component.hasProperty('categories')) dropped.categories++;
  const url = textOf(component.getFirstPropertyValue('url'));
  return {
    start,
    fields: {
      kind: 'event',
      title: textOf(component.getFirstPropertyValue('summary')),
      ...when.item,
      time_zone: start.kind === 'instant' ? start.zone : null,
      location: textOrNull(component.getFirstPropertyValue('location')),
      description: textOrNull(component.getFirstPropertyValue('description')),
      url: isWebLink(url) ? url : null,
      transparency: textOf(component.getFirstPropertyValue('transp')).toUpperCase() === 'TRANSPARENT' ? 'transparent' : 'opaque',
      reminders: remindersOf(component, when.lengthSeconds, dropped),
    },
  };
}

function isWebLink(text: string): boolean {
  if (!/^https?:\/\//i.test(text)) return false;
  try {
    new URL(text);
    return true;
  } catch {
    return false;
  }
}

/** The event's when, from DTSTART with DTEND or DURATION, and its length for alarms set from its end. */
function whenOf(component: ICAL.Component, startProperty: ICAL.Property, start: Moment, context: Context): {item: ItemWhen; lengthSeconds: number} {
  const none = {due_date: null, due_at: null};
  const endProperty = component.getFirstProperty('dtend');
  const duration = safely(() => component.getFirstPropertyValue('duration'));
  if (start.kind === 'date') {
    let end: string | null = null;
    const endMoment = endProperty ? momentOfProperty(endProperty, context) : null;
    if (endMoment) end = endMoment.kind === 'date' ? endMoment.date : localDay(endMoment.at, endMoment.zone ?? context.userZone);
    else if (duration instanceof ICAL.Duration && !duration.isNegative) end = addDays(start.date, duration.weeks * 7 + duration.days);
    if (!end || end <= start.date) end = addDays(start.date, 1);
    const days = Math.round((Date.parse(end) - Date.parse(start.date)) / 86_400_000);
    return {item: {all_day: true, starts_at: null, ends_at: null, start_date: start.date, end_date: end, ...none}, lengthSeconds: days * 86_400};
  }
  let end: string | null = null;
  const endMoment = endProperty ? momentOfProperty(endProperty, context) : null;
  if (endMoment) {
    end = endMoment.kind === 'instant' ? endMoment.at : zonedInstant(endMoment.date, '00:00', start.zone ?? context.userZone);
  } else if (duration instanceof ICAL.Duration && !duration.isNegative) {
    // Nominal days: a day across a daylight-saving change is the same wall-clock time the next day.
    const later = (startProperty.getFirstValue() as ICAL.Time).clone();
    later.addDuration(duration);
    const moment = momentOfTime(later, startProperty.getParameter('tzid'), context);
    end = moment?.kind === 'instant' ? moment.at : null;
  }
  if (!end || Date.parse(end) < Date.parse(start.at)) end = start.at;
  return {item: {all_day: false, starts_at: start.at, ends_at: end, start_date: null, end_date: null, ...none}, lengthSeconds: (Date.parse(end) - Date.parse(start.at)) / 1000};
}

/** The file's alarms before the start, as minutes before it, nearest first. */
function remindersOf(component: ICAL.Component, lengthSeconds: number, dropped: IcsDropped): number[] {
  const minutes = new Set<number>();
  for (const alarm of component.getAllSubcomponents('valarm')) {
    const trigger = alarm.getFirstProperty('trigger');
    const value = trigger ? safely(() => trigger.getFirstValue()) : null;
    // Apple writes ACTION:NONE at a fixed time in 1976 for "no alert": nothing to drop.
    if (!trigger || textOf(alarm.getFirstPropertyValue('action')).toUpperCase() === 'NONE') continue;
    if (!(value instanceof ICAL.Duration)) {
      dropped.alarm_at_fixed_time++;
      continue;
    }
    const fromEnd = textOf(trigger.getParameter('related')).toUpperCase() === 'END';
    const fromStart = value.toSeconds() + (fromEnd ? lengthSeconds : 0);
    if (fromStart > 0) dropped.alarm_after_start++;
    else if (-fromStart / 60 > MAX_REMINDER_MINUTES) dropped.alarm_over_limit++;
    else minutes.add(Math.round(-fromStart / 60));
  }
  const nearest = [...minutes].sort((a, b) => a - b);
  dropped.alarm_over_limit += Math.max(0, nearest.length - MAX_REMINDERS);
  return nearest.slice(0, MAX_REMINDERS);
}

/** A date or date-time property's first value as a moment, or null when it can't be read. */
function momentOfProperty(property: ICAL.Property, context: Context): Moment | null {
  const value = safely(() => property.getFirstValue());
  return value instanceof ICAL.Time ? momentOfTime(value, property.getParameter('tzid'), context) : null;
}

const pad = (value: number, length = 2) => String(value).padStart(length, '0');

function momentOfTime(time: ICAL.Time, tzid: unknown, context: Context): Moment | null {
  const parts = [time.year, time.month, time.day, time.hour, time.minute, time.second];
  if (!parts.every(Number.isInteger) || time.year < 1 || time.month < 1 || time.month > 12 || time.day < 1 || time.day > 31) return null;
  const date = `${pad(time.year, 4)}-${pad(time.month)}-${pad(time.day)}`;
  if (Number.isNaN(Date.parse(date))) return null;
  if (time.isDate) return {kind: 'date', date};
  if (time.hour > 23 || time.minute > 59 || time.second > 60) return null;
  const clock = `${pad(time.hour)}:${pad(time.minute)}`;
  const seconds = Math.min(time.second, 59) * 1000;
  if (time.zone?.tzid === 'UTC') {
    return {kind: 'instant', at: new Date(Date.parse(`${date}T${clock}:00.000Z`) + seconds).toISOString(), zone: null, utc: true};
  }
  const name = typeof tzid === 'string' ? tzid.trim() : '';
  const zone = name ? ianaZone(name) : null;
  if (zone) return {kind: 'instant', at: plus(zonedInstant(date, clock, zone), seconds), zone, utc: false};
  const defined = name ? context.zones.get(name) : undefined;
  if (defined) {
    // A zone only the file defines: its own rules give the instant, and the user's zone stands in.
    const local = time.clone();
    local.zone = defined;
    const seconds = safely(() => local.toUnixTime());
    if (seconds !== null && Number.isFinite(seconds)) return {kind: 'instant', at: new Date(seconds * 1000).toISOString(), zone: null, utc: false};
  }
  // Floating, or a zone nobody knows: the user's zone.
  return {kind: 'instant', at: plus(zonedInstant(date, clock, context.userZone), seconds), zone: null, utc: false};
}

const plus = (instant: string, ms: number) => (ms ? new Date(Date.parse(instant) + ms).toISOString() : instant);

/** The IANA zone a TZID names: an IANA name, a Windows one, or an IANA name at the end of a path ("/mozilla.org/…/America/New_York"). */
export function ianaZone(tzid: string): string | null {
  const name = tzid.replace(/^"|"$/g, '').trim();
  const known = (candidate: string) => {
    try {
      return new Intl.DateTimeFormat('en-US', {timeZone: candidate}).resolvedOptions().timeZone;
    } catch {
      return null;
    }
  };
  if (/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$|^UTC$|^GMT$/.test(name)) {
    const zone = known(name);
    if (zone) return zone;
  }
  const windows = windowsZone(name);
  if (windows) return windows;
  const segments = name.split('/').filter(Boolean);
  for (const take of [3, 2]) {
    if (segments.length <= take) continue;
    const tail = segments.slice(-take).join('/');
    if (/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/.test(tail)) {
      const zone = known(tail);
      if (zone) return zone;
    }
  }
  return null;
}

// RFC 5545 basic forms: "20261117T170000Z" for an instant, "20261117" for a date.
const basicOfInstant = (at: string) => at.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const basicOfDate = (date: string) => date.replace(/-/g, '');
const isoOfBasic = (basic: string) => `${basic.slice(0, 4)}-${basic.slice(4, 6)}-${basic.slice(6, 8)}T${basic.slice(9, 11)}:${basic.slice(11, 13)}:${basic.slice(13, 15)}.000Z`;
const dateOfBasic = (basic: string) => `${basic.slice(0, 4)}-${basic.slice(4, 6)}-${basic.slice(6, 8)}`;

/**
 * A moment in the series' terms, in basic form: a date for an all-day series, a UTC instant for a
 * timed one (a date on a timed series takes the series' start time that day).
 */
function basicIn(moment: Moment, start: Moment, context: Context): string | null {
  if (start.kind === 'date') return basicOfDate(moment.kind === 'date' ? moment.date : localDay(moment.at, moment.zone ?? context.userZone));
  if (moment.kind === 'instant') return basicOfInstant(moment.at);
  const zone = start.zone ?? (start.utc ? 'UTC' : context.userZone);
  const clock = new Intl.DateTimeFormat('en-GB', {timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(start.at));
  return basicOfInstant(zonedInstant(moment.date, clock, zone));
}

interface Repeats {
  rules: string[];
  excluded: string[];
  dates: string[];
}

function repeatsOf(component: ICAL.Component, context: Context, start: Moment): Repeats {
  const startProperty = component.getFirstProperty('dtstart')!;
  const tzid = startProperty.getParameter('tzid');
  const rules: string[] = [];
  for (const property of component.getAllProperties('rrule')) {
    const recur = safely(() => property.getFirstValue());
    if (!(recur instanceof ICAL.Recur) || !recur.freq) continue;
    let rule = recur.toString();
    if (recur.until) {
      // UNTIL in UTC for a timed event and as a date for an all-day one, as Google wants it.
      const until = momentOfTime(recur.until, tzid, context);
      const basic = until ? basicIn(until, start, context) : null;
      rule = basic ? rule.replace(/UNTIL=[^;]*/, `UNTIL=${basic}`) : rule.replace(/;?UNTIL=[^;]*/, '');
    }
    if (/^[A-Z0-9=;,:+-]+$/.test(rule)) rules.push(`RRULE:${rule}`);
  }
  const momentsOf = (name: string) => component.getAllProperties(name).flatMap(property => (safely(() => property.getValues()) ?? []).map(value => {
    const time = value instanceof ICAL.Period ? value.start : value;
    const moment = time instanceof ICAL.Time ? momentOfTime(time, property.getParameter('tzid'), context) : null;
    return moment ? basicIn(moment, start, context) : null;
  })).filter((basic): basic is string => basic !== null);
  return {rules, excluded: momentsOf('exdate'), dates: momentsOf('rdate')};
}

function recurrenceLines(repeats: Repeats, start: Moment): string[] {
  const kind = start.kind === 'date' ? ';VALUE=DATE' : '';
  const line = (name: string, values: string[]) => (values.length ? [`${name}${kind}:${[...new Set(values)].sort().join(',')}`] : []);
  if (!repeats.rules.length && !repeats.dates.length) return [];
  return [...repeats.rules, ...line('EXDATE', repeats.excluded), ...line('RDATE', repeats.dates)];
}
