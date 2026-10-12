// Dates, times and ages as DESIGN.md › Copy writes them: ages "now", "4m", "2h", "Yesterday",
// "Mon", "Oct 1" in the Inbox; clock times "2:30 PM"; full timestamps in tooltips. Local days are
// the owner's zone (GET /api/me's `time_zone`), never the browser's.

const MINUTE = 60_000;
const DAY = 86_400_000;

const dateParts = new Map<string, Intl.DateTimeFormat>();
function dateFormat(timeZone: string): Intl.DateTimeFormat {
  let found = dateParts.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'});
    dateParts.set(timeZone, found);
  }
  return found;
}

/** The local day ("2026-10-07") of an instant in `timeZone`. */
export function localDate(at: string | number, timeZone: string): string {
  return dateFormat(timeZone).format(typeof at === 'number' ? at : Date.parse(at));
}

/** A local day `days` after `date` ("2026-10-07" + 1 → "2026-10-08"). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both local days. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
}

const wallParts = new Map<string, Intl.DateTimeFormat>();
/** Minutes after local midnight of an instant in `timeZone` (7:30 PM → 1170). */
export function minutesOf(at: string | number, timeZone: string): number {
  let format = wallParts.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit'});
    wallParts.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(new Date(at)).map(part => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

/** The instant of a local day and minutes after its midnight in `timeZone` (DST-safe; 1440 is the next midnight). */
export function instantAt(date: string, minutes: number, timeZone: string): string {
  const day = addDays(date, Math.floor(minutes / 1440));
  const rest = ((minutes % 1440) + 1440) % 1440;
  const wall = Date.parse(`${day}T00:00:00Z`) + rest * MINUTE;
  // The zone's offset at the wall time, asked twice so a time next to a DST change lands right.
  const offset = (instant: number) => {
    const local = Date.parse(`${localDate(instant, timeZone)}T00:00:00Z`) + minutesOf(instant, timeZone) * MINUTE;
    return local - instant;
  };
  const first = wall - offset(wall);
  return new Date(wall - offset(first)).toISOString();
}

// Intl writes a narrow no-break space before AM/PM; the design writes a plain one.
const plain = (text: string) => text.replace(/\s/g, ' ');

/** "7:12 AM". */
export function clockTime(at: string | number, timeZone: string): string {
  return plain(new Date(at).toLocaleTimeString('en-US', {timeZone, hour: 'numeric', minute: '2-digit'}));
}

/** "Wed, Oct 7, 2026, 7:12 AM", for tooltips. */
export function fullTimestamp(at: string | number, timeZone: string): string {
  return plain(new Date(at).toLocaleString('en-US', {timeZone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'}));
}

const onDay = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {...options, timeZone: 'UTC'});

/** "October 2026", the month of a local day. */
export const monthName = (date: string) => onDay(date, {month: 'long', year: 'numeric'});

/**
 * An email's age in the Inbox: "now" under a minute, minutes under an hour, hours (to the nearest)
 * the same day, then "Yesterday", the weekday within the week, then the date ("Sep 30"), with the
 * year once it isn't this year's.
 */
export function age(at: string, now: number, timeZone: string): string {
  const minutes = Math.floor((now - Date.parse(at)) / MINUTE);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const today = localDate(now, timeZone);
  const day = localDate(at, timeZone);
  if (day === today) return `${Math.round(minutes / 60)}h`;
  const days = daysBetween(day, today);
  if (days === 1) return 'Yesterday';
  if (days < 7) return onDay(day, {weekday: 'short'});
  return day.slice(0, 4) === today.slice(0, 4) ? onDay(day, {month: 'short', day: 'numeric'}) : onDay(day, {month: 'short', day: 'numeric', year: 'numeric'});
}

/** The reader's time: the clock time today ("7:12 AM"), with the date before ("Sep 30, 2:15 PM"). */
export function readerTime(at: string, now: number, timeZone: string): string {
  const time = clockTime(at, timeZone);
  const day = localDate(at, timeZone);
  const today = localDate(now, timeZone);
  if (day === today) return time;
  const date = day.slice(0, 4) === today.slice(0, 4) ? onDay(day, {month: 'short', day: 'numeric'}) : onDay(day, {month: 'short', day: 'numeric', year: 'numeric'});
  return `${date}, ${time}`;
}

/** How long until something starts, for the Today block: "now", "in 45m", "in 5h". */
export function startsIn(at: string, now: number): string {
  const minutes = Math.round((Date.parse(at) - now) / MINUTE);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes}m`;
  return `in ${Math.round(minutes / 60)}h`;
}

/** What's left of an event under way: "45m left", "1h 20m left", "2h left" (whole minutes, rounded up). */
export function timeLeft(end: string, now: number): string {
  const minutes = Math.max(1, Math.ceil((Date.parse(end) - now) / MINUTE));
  if (minutes < 60) return `${minutes}m left`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 ? `${hours}h ${minutes % 60}m left` : `${hours}h left`;
}

/**
 * A code row's countdown: "Expires in 11 min" (whole minutes, rounded up), and in its last minute
 * "Expires in 42 sec" (polish audit inbox-11).
 */
export function expiresIn(at: string, now: number): string {
  const left = Date.parse(at) - now;
  if (left <= 0) return 'Expired';
  return left <= MINUTE ? `Expires in ${Math.ceil(left / 1000)} sec` : `Expires in ${Math.ceil(left / MINUTE)} min`;
}

/** Whether a code is in its last minute, its countdown in seconds and `caution`. */
export function expiresSoon(at: string, now: number): boolean {
  const left = Date.parse(at) - now;
  return left > 0 && left <= MINUTE;
}

/**
 * When expiresIn's words next change: the end of the current minute ("Expires in 11 min" reads 10),
 * and in the last minute the expiry itself, when the row leaves; null once expired.
 */
export function countdownChange(at: string, now: number): number | null {
  const expires = Date.parse(at);
  const minutes = Math.ceil((expires - now) / MINUTE);
  return minutes <= 0 ? null : expires - (minutes - 1) * MINUTE;
}

/** A verification code in two groups: "482913" → "482 913", "12345678" → "1234 5678"; others as they are. */
export function codeGroups(code: string): string {
  if (!/^\w+$/.test(code) || code.length < 6 || code.length % 2) return code;
  return `${code.slice(0, code.length / 2)} ${code.slice(code.length / 2)}`;
}
