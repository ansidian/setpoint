// Local days and wall-clock times in the owner's zone. Instants are ISO 8601 UTC strings; dates are
// `YYYY-MM-DD`; times are 24-hour `HH:MM`.

const formats = new Map<string, Intl.DateTimeFormat>();
function partsFormat(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formats.set(timeZone, format);
  }
  return format;
}

function wallParts(instant: number, timeZone: string) {
  const parts = Object.fromEntries(partsFormat(timeZone).formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return {year: +parts.year!, month: +parts.month!, day: +parts.day!, hour: +parts.hour!, minute: +parts.minute!, second: +parts.second!};
}

/** The zone's offset from UTC at an instant, in ms. */
function offsetAt(instant: number, timeZone: string): number {
  const p = wallParts(instant, timeZone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant;
}

/** A wall-clock time in a zone ("2026-10-07", "09:12") as a UTC instant. */
export function zonedInstant(date: string, time: string, timeZone: string): string {
  const wall = Date.parse(`${date}T${time}:00.000Z`);
  const first = wall - offsetAt(wall, timeZone);
  return new Date(wall - offsetAt(first, timeZone)).toISOString();
}

/** The local day (YYYY-MM-DD) of an instant. */
export function localDay(instant: string | number, timeZone: string): string {
  const p = wallParts(typeof instant === 'string' ? Date.parse(instant) : instant, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** The local wall-clock time (HH:MM:SS.mmm is not needed: HH:MM) of an instant. */
export function localTime(instant: string | number, timeZone: string): string {
  const p = wallParts(typeof instant === 'string' ? Date.parse(instant) : instant, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export function addDays(date: string, days: number): string {
  const at = new Date(`${date}T00:00:00.000Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** Days from `a` to `b`. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00.000Z`) - Date.parse(`${a}T00:00:00.000Z`)) / 86_400_000);
}

/** 0 Sunday … 6 Saturday. */
export function weekday(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}
