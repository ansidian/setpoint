// Proposals (BRIEF.md › The reader: Add to calendar and Add as task open a proposal pre-filled from
// the email: its key date, place and title; DESIGN.md › Proposal, board 08). Pure: what an email
// gives a proposal, and the conflict line against the day's items.
//
// From the email: the title from its subject ("Final exam schedule · CS 101" → "CS 101 final
// exam"), the date from triage's key date, and the time and place from the line of the body that
// names that date ("CS 101 · Software engineering — Wed, Dec 9 · 7:00 – 9:00 PM · Room 214"), read
// with Chrono. A room gets its organisation in front ("Contoso University · Room 214"). Harvested from v1's
// calendar proposal flow (SV-5): a date with no time is all day, and an end before the start is
// refused; v1's 30-minute default end became an hour (Google Calendar's own default).
import * as chrono from 'chrono-node';
import type {ProposalField} from '@setpoint/shared';
import {fold, wordsOf} from './searchChips.ts';
import {addDays} from './time.ts';

export interface ProposalEmail {
  subject: string;
  organisation: string | null;
  bodyText: string;
  keyDate: string | null;
}

export interface ProposalFields {
  title: string;
  date: string | null;
  // Local wall-clock times, "19:00".
  start: string | null;
  end: string | null;
  place: string | null;
}

/** Subject words that name the email rather than the thing ("schedule", "terms", "reminder"). */
const GENERIC_TAIL = /\s+(schedule|schedules|terms|details|information|info|update|updates|reminder|notice|confirmation|summary|invitation|invite)$/i;
const CODE = /^[A-Z]{2,5}\s?\d{2,5}[A-Z]?$/;

/**
 * A title from the subject: "Re:"/"Fwd:" and "Your" dropped, trailing words that name the email
 * dropped, and a course or ticket code ("CS 101") put first: "CS 101 final exam".
 */
export function titleFromSubject(subject: string): string {
  let text = subject.replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, '').replace(/^your\s+/i, '').trim();
  const parts = text.split(/\s+[·|—–-]\s+|:\s+/).map(part => part.replace(GENERIC_TAIL, '').trim()).filter(Boolean);
  const code = parts.find(part => CODE.test(part));
  if (code && parts.length > 1) {
    const rest = parts.filter(part => part !== code).join(' ');
    text = `${code} ${rest.charAt(0).toLowerCase()}${rest.slice(1)}`;
  } else {
    text = parts.join(' · ') || text;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const pad = (value: number) => String(value).padStart(2, '0');
const clock = (component: chrono.ParsedComponents) => `${pad(component.get('hour') ?? 0)}:${pad(component.get('minute') ?? 0)}`;

function reference(date: string): Date {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number];
  return new Date(year, month - 1, day, 12, 0, 0);
}

/** Whether a Chrono result names this day (year ignored unless it says one). */
function namesDay(result: chrono.ParsedResult, date: string): boolean {
  const [year, month, day] = date.split('-').map(Number);
  const start = result.start;
  if (!start.isCertain('day') || start.get('month') !== month || start.get('day') !== day) return false;
  return !start.isCertain('year') || start.get('year') === year;
}

/** The body's first line naming the key date, with its time if it gives one. */
export function keyLine(body: string, date: string): {line: string; start: string | null; end: string | null} | null {
  for (const line of body.split(/\n+/)) {
    const results = chrono.parse(line, reference(date));
    const day = results.find(result => namesDay(result, date));
    if (!day) continue;
    const timed = [day, ...results].find(result => result.start.isCertain('hour'));
    return {
      line,
      start: timed ? clock(timed.start) : null,
      end: timed?.end?.isCertain('hour') ? clock(timed.end) : null,
    };
  }
  return null;
}

const ROOM = /\b(room|rm\.?|hall|building|bldg\.?|suite|ste\.?|floor|auditorium|lab)\s*#?\s*[\w-]+/i;
const ADDRESS = /\b\d{2,6}\s+[\w.' ]+?\s(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|pl|place|ct|court|pkwy|parkway)\b\.?/i;

/** A place on the key line: a room (with its organisation in front) or a street address. */
export function placeIn(line: string, organisation: string | null): string | null {
  for (const segment of line.split(/\s+[·|—]\s+|\s+-\s+|;\s+/)) {
    const address = segment.match(ADDRESS);
    if (address) return address[0].trim();
    const room = segment.match(ROOM);
    if (room) {
      const name = room[0].trim().replace(/^rm\.?/i, 'Room');
      const capitalised = name.charAt(0).toUpperCase() + name.slice(1);
      return organisation ? `${organisation} · ${capitalised}` : capitalised;
    }
  }
  return null;
}

/** What the email gives a proposal. */
export function proposalFields(email: ProposalEmail): ProposalFields {
  const title = titleFromSubject(email.subject);
  if (!email.keyDate) return {title, date: null, start: null, end: null, place: null};
  const line = keyLine(email.bodyText, email.keyDate);
  return {
    title, date: email.keyDate, start: line?.start ?? null, end: line?.end ?? null,
    place: line ? placeIn(line.line, email.organisation) : null,
  };
}

/**
 * Which fields the email itself says (the "from the email" marks): a title whose words are all in
 * the subject or body, the key date or a day the email names, a time it names, a place it names.
 * Fields Alfred filled from elsewhere stay unmarked.
 */
export function fromEmail(email: ProposalEmail, fields: ProposalFields): ProposalField[] {
  const text = `${email.subject}\n${email.bodyText}`;
  const words = new Set(wordsOf(text));
  const marks: ProposalField[] = [];
  if (fields.title && wordsOf(fields.title).every(word => words.has(word))) marks.push('title');
  if (fields.date) {
    const date = fields.date;
    const named = date === email.keyDate || text.split(/\n+/).some(line => chrono.parse(line, reference(date)).some(result => namesDay(result, date)));
    if (named) marks.push('date');
    if (fields.start && named) {
      const times = text.split(/\n+/).flatMap(line => chrono.parse(line, reference(date))).filter(result => result.start.isCertain('hour')).map(result => clock(result.start));
      if (times.includes(fields.start)) marks.push('time');
    }
  }
  if (fields.place) {
    const place = fields.place;
    const derived = email.keyDate ? keyLine(email.bodyText, email.keyDate) : null;
    if (fold(text).includes(fold(place)) || (derived && placeIn(derived.line, email.organisation) === place)) marks.push('place');
  }
  return marks;
}

// ---- The conflict line ----

export interface DayItem {
  title: string;
  kind: 'event' | 'task';
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

/** "1h 30m", "2h", "45m". */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours ? `${hours}h` : '', rest ? `${rest}m` : ''].filter(Boolean).join(' ') || '0m';
}

const more = (count: number) => (count > 0 ? ` and ${count} more` : '');

/**
 * Board 08's line for an event: "Free that evening" or "Overlaps Study group · 1h 30m" (the time the
 * two share). A timed event is checked against the day's timed events; an all-day one against any.
 * `startHour` is the proposal's local start hour, for morning, afternoon or evening.
 */
export function conflictLine(proposal: {all_day: boolean; starts_at: string | null; ends_at: string | null; startHour: number | null}, items: DayItem[]): {free: boolean; label: string} {
  const events = items.filter(item => item.kind === 'event');
  if (proposal.all_day || !proposal.starts_at || !proposal.ends_at) {
    if (!events.length) return {free: true, label: 'Free that day'};
    return {free: false, label: `Overlaps ${events[0]!.title}${more(events.length - 1)}`};
  }
  const start = Date.parse(proposal.starts_at);
  const end = Date.parse(proposal.ends_at);
  const overlaps = events
    .filter(item => !item.all_day && item.starts_at && item.ends_at)
    .map(item => ({item, minutes: Math.round((Math.min(end, Date.parse(item.ends_at!)) - Math.max(start, Date.parse(item.starts_at!))) / 60_000)}))
    .filter(overlap => overlap.minutes > 0)
    .sort((a, b) => Date.parse(a.item.starts_at!) - Date.parse(b.item.starts_at!));
  if (!overlaps.length) {
    const hour = proposal.startHour ?? 12;
    return {free: true, label: `Free that ${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}`};
  }
  const [first] = overlaps;
  return {free: false, label: `Overlaps ${first!.item.title} · ${durationLabel(first!.minutes)}${more(overlaps.length - 1)}`};
}

/** The day after, for an all-day event's exclusive end. */
export const dayAfter = (date: string) => addDays(date, 1);
