// Recurring items' occurrences in a range, from an RFC 5545 rule as Google stores it
// ("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"). Occurrences keep their wall-clock time in the item's zone,
// so Gym stays at 7 AM across a daylight-saving change.
//
// Covered: FREQ DAILY, WEEKLY (with BYDAY), MONTHLY (on the start's day of the month) and YEARLY,
// with INTERVAL, COUNT and UNTIL. Anything else (BYSETPOS, "2nd Tuesday", several month days) is
// `unsupported`: the caller shows the first occurrence only, and the provider's own expansion (B5)
// takes over for real calendars.
import {addDays, daysBetween, weekday} from './time.ts';

const DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;

export interface Rule {
  freq: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  interval: number;
  // Weekdays, 0 Sunday … 6 Saturday (WEEKLY only).
  byDay: number[] | null;
  count: number | null;
  // The last local date an occurrence may start on, and for a timed UNTIL the last instant.
  untilDate: string | null;
  untilAt: string | null;
}

/** Parses the rule, or null when it uses something this expander doesn't cover. */
export function parseRule(text: string, untilToDate: (until: string) => string): Rule | null {
  const body = text.replace(/^RRULE:/, '');
  const parts = new Map(body.split(';').filter(Boolean).map(part => part.split('=') as [string, string]));
  const freq = parts.get('FREQ');
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  for (const key of parts.keys()) if (!['FREQ', 'INTERVAL', 'BYDAY', 'COUNT', 'UNTIL', 'WKST'].includes(key)) return null;
  const interval = Number(parts.get('INTERVAL') ?? 1);
  if (!Number.isInteger(interval) || interval < 1) return null;
  let byDay: number[] | null = null;
  const days = parts.get('BYDAY');
  if (days !== undefined) {
    if (freq !== 'WEEKLY') return null;
    byDay = days.split(',').map(day => DAYS.indexOf(day as (typeof DAYS)[number]));
    if (byDay.some(day => day < 0)) return null;
  }
  const count = parts.has('COUNT') ? Number(parts.get('COUNT')) : null;
  if (count !== null && (!Number.isInteger(count) || count < 1)) return null;
  const until = parts.get('UNTIL');
  let untilDate: string | null = null;
  let untilAt: string | null = null;
  if (until !== undefined) {
    const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(until);
    if (!match) return null;
    const [, y, m, d, hh, mm, ss] = match;
    if (hh !== undefined) untilAt = `${y}-${m}-${d}T${hh}:${mm}:${ss}.000Z`;
    untilDate = untilAt ? untilToDate(untilAt) : `${y}-${m}-${d}`;
  }
  return {freq, interval, byDay, count, untilDate, untilAt};
}

/** Monday of the week holding `date` (RFC 5545's default week start). */
const weekStart = (date: string) => addDays(date, -((weekday(date) + 6) % 7));

function matches(rule: Rule, start: string, date: string): boolean {
  switch (rule.freq) {
    case 'DAILY':
      return daysBetween(start, date) % rule.interval === 0;
    case 'WEEKLY': {
      const weeks = daysBetween(weekStart(start), weekStart(date)) / 7;
      return weeks % rule.interval === 0 && (rule.byDay ?? [weekday(start)]).includes(weekday(date));
    }
    case 'MONTHLY': {
      const months = (+date.slice(0, 4) - +start.slice(0, 4)) * 12 + (+date.slice(5, 7) - +start.slice(5, 7));
      return date.slice(8) === start.slice(8) && months % rule.interval === 0;
    }
    case 'YEARLY':
      return date.slice(5) === start.slice(5) && (+date.slice(0, 4) - +start.slice(0, 4)) % rule.interval === 0;
  }
}

/** The local dates the rule's occurrences start on, from `start` (the first occurrence's date), within [from, to). */
export function occurrenceDates(rule: Rule, start: string, from: string, to: string, maxDays = 20_000): string[] {
  const dates: string[] = [];
  let seen = 0;
  const last = rule.untilDate && rule.untilDate < to ? addDays(rule.untilDate, 1) : to;
  // COUNT counts from the start; without it, skip straight to the range.
  let date = rule.count === null && from > start ? from : start;
  for (let steps = 0; date < last && steps < maxDays; steps += 1, date = addDays(date, 1)) {
    if (date < start || !matches(rule, start, date)) continue;
    seen += 1;
    if (rule.count !== null && seen > rule.count) break;
    if (date >= from) dates.push(date);
  }
  return dates;
}
