// Proposals (BRIEF.md › The reader: Add to calendar and Add as task open a proposal pre-filled from
// the email: its key date, place and title; DESIGN.md › Proposal, board 08). Pure: what an email
// gives a proposal, and the conflict line against the day's items.
//
// From the email: the title from its subject ("Final exam schedule · CS 101" → "CS 101 final
// exam"), the date from triage's key date, and the time and place from the line of the body that
// names that date ("CS 101 · Software engineering — Wed, Dec 9 · 7:00 – 9:00 PM · Room 214"), read
// with Chrono. Mail that spreads them over lines is read too (SV-263): a time on the lines right
// under the date, an address under those or alone in the next paragraph, never a footer's or a
// shipping address. A room gets its organisation in front ("Contoso University · Room 214"). Harvested from v1's
// calendar proposal flow (SV-5): a date with no time is all day, and an end before the start is
// refused; v1's 30-minute default end became an hour (Google Calendar's own default).
import * as chrono from 'chrono-node';
import type {ProposalField} from '@setpoint/shared';
import {fold, wordsOf} from './searchChips.ts';
import {addDays, localDay, localTime} from './time.ts';

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

// A quoted email and the line over it ("On Tue, Nov 17, 2026 at 9:14 AM Jordan wrote:", "Sent: …"): when
// it was written, not when anything happens.
const QUOTED = /^\s*(>|on\b.*\bwrote:\s*$|(sent|date):)/i;

/** How many lines under the date's own, in its block, a time may be on. */
const TIME_LINES_BELOW = 2;

export interface KeyLine {
  line: string;
  // The day and the wall-clock times in the user's zone: a time that names its own zone ("1 am ET")
  // is moved to the user's, which can be the day before or after the key date.
  date: string;
  start: string | null;
  end: string | null;
  // Where else a place may be: the lines under the date in its block, and the line after the block
  // when it stands alone.
  near: string[];
}

/** The body's blocks: runs of lines with no blank line between them. */
function blocksOf(body: string): string[][] {
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of body.split('\n')) {
    if (line.trim()) {
      block.push(line.replace(/\r$/, ''));
    } else if (block.length) {
      blocks.push(block);
      block = [];
    }
  }
  if (block.length) blocks.push(block);
  return blocks;
}

/** A time Chrono read, as the user's wall clock; one that names a zone is moved to the user's. */
function clockIn(component: chrono.ParsedComponents, date: string, timeZone: string | undefined): {date: string; time: string} {
  if (!timeZone || !component.isCertain('timezoneOffset')) return {date, time: clock(component)};
  const instant = component.date().getTime();
  return {date: localDay(instant, timeZone), time: localTime(instant, timeZone)};
}

/**
 * The body's line naming the key date, with its time: the first such line that has a time, on it or
 * on the lines right under it in its block ("Thursday, November 19" over "10 am to 11 am PT"), else
 * the first that names the date at all (SV-263).
 */
export function keyLine(body: string, date: string, timeZone?: string): KeyLine | null {
  const blocks = blocksOf(body);
  let untimed: KeyLine | null = null;
  for (const [at, block] of blocks.entries()) {
    for (const [index, line] of block.entries()) {
      if (QUOTED.test(line)) continue;
      const results = chrono.parse(line, reference(date));
      const day = results.find(result => namesDay(result, date));
      if (!day) continue;
      const below = block.slice(index + 1);
      const after = blocks[at + 1];
      const near = [...below, ...(after?.length === 1 ? after : [])];
      let timed = [day, ...results].find(result => result.start.isCertain('hour'));
      if (!timed) {
        for (const under of below.slice(0, TIME_LINES_BELOW)) {
          const found = chrono.parse(under, reference(date)).find(result => result.start.isCertain('hour') && (!result.start.isCertain('day') || namesDay(result, date)));
          if (found) {
            timed = found;
            break;
          }
        }
      }
      if (!timed) {
        untimed ??= {line, date, start: null, end: null, near};
        continue;
      }
      const start = clockIn(timed.start, date, timeZone);
      const end = timed.end?.isCertain('hour') ? clockIn(timed.end, date, timeZone).time : null;
      return {line, date: start.date, start: start.time, end, near};
    }
  }
  return untimed;
}

const ROOM = /\b(room|rm\.?|hall|building|bldg\.?|suite|ste\.?|floor|auditorium|lab)\s*#?\s*[\w-]+/i;
// A street address, with its unit and its city, state and ZIP when they follow ("12 Main St #4, Springfield, IL 62701").
const ADDRESS = /\b\d{2,6}\s+[\w.' ]+?\s(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|pl|place|ct|court|pkwy|parkway)\b\.?(?:,?\s+(?:#|(?:suite|ste\.?|apt\.?|unit)\s)\s*[\w-]+)?(?:,\s*[A-Za-z .'-]+,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)?/i;
// An address that is where something is sent, not where something happens.
const POSTAL = /\b(ship(ping|ped|s)?|deliver(y|ed|ing)?|bill(ing|ed)?|mail(ing|ed)?|sent|send)\b/i;

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

/** A street address a line near the key line starts with (a footer's follows a company's name), unless it's where something is sent. */
function addressNear(lines: string[]): string | null {
  for (const line of lines) {
    const found = line.replace(/^\s*[-*•]\s+/, '').match(ADDRESS);
    if (found?.index === 0 && !POSTAL.test(line)) return found[0].trim();
  }
  return null;
}

/** What the email gives a proposal; times are in `timeZone`, the user's. */
export function proposalFields(email: ProposalEmail, timeZone?: string): ProposalFields {
  const title = titleFromSubject(email.subject);
  if (!email.keyDate) return {title, date: null, start: null, end: null, place: null};
  const line = keyLine(email.bodyText, email.keyDate, timeZone);
  return {
    title, date: line?.date ?? email.keyDate, start: line?.start ?? null, end: line?.end ?? null,
    place: line ? placeIn(line.line, email.organisation) ?? addressNear(line.near) : null,
  };
}

/**
 * Which fields the email itself says (the "from the email" marks): a title whose words are all in
 * the subject or body, the key date or a day the email names, a time it names, a place it names.
 * Fields Alfred filled from elsewhere stay unmarked.
 */
export function fromEmail(email: ProposalEmail, fields: ProposalFields, timeZone?: string): ProposalField[] {
  const text = `${email.subject}\n${email.bodyText}`;
  const words = new Set(wordsOf(text));
  // What the email gives on its own: a field that still says it is the email's.
  const given = proposalFields(email, timeZone);
  const marks: ProposalField[] = [];
  if (fields.title && wordsOf(fields.title).every(word => words.has(word))) marks.push('title');
  if (fields.date) {
    const date = fields.date;
    const named = date === email.keyDate || date === given.date || text.split(/\n+/).some(line => chrono.parse(line, reference(date)).some(result => namesDay(result, date)));
    if (named) marks.push('date');
    if (fields.start && named) {
      const times = text.split(/\n+/).flatMap(line => chrono.parse(line, reference(date))).filter(result => result.start.isCertain('hour')).map(result => clock(result.start));
      if (times.includes(fields.start) || (date === given.date && fields.start === given.start)) marks.push('time');
    }
  }
  if (fields.place) {
    const place = fields.place;
    if (fold(text).includes(fold(place)) || given.place === place) marks.push('place');
  }
  return marks;
}

// ---- The conflict line ----

// The rule lives in shared/ (freeBusy.ts), so the web's proposal card works it out again as its day and time change (SV-208).
export {proposalConflict as conflictLine, durationLabel} from '@setpoint/shared';
export type {DayItem} from '@setpoint/shared';

/** The day after, for an all-day event's exclusive end. */
export const dayAfter = (date: string) => addDays(date, 1);
