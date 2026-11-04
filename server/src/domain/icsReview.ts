// What the import review says of each of a file's events before anything is sent (SV-181, D437):
// whether it's already over, so it starts unticked. Pure: the caller gives it now and the user's zone.
import {occurrenceDates, parseRule} from './recurrence.ts';
import {addDays, localDay} from './time.ts';

interface PastInput {
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  time_zone: string | null;
  recurrence: string[];
}

// How far ahead a COUNT is looked for (about 55 years): further than any file's series runs.
const COUNT_SEARCH_DAYS = 20_000;

/**
 * Whether the event has ended by `now`: a single event once its end has passed (an all-day one the
 * day after its last day; a timed one with no length at its start), a repeating one once its rule has
 * no occurrence from today on (UNTIL or COUNT run out). A rule the expander doesn't cover, or extra
 * dates (RDATE) beside one, count as still to come, so they start ticked.
 */
export function importPast(event: PastInput, now: string, userZone: string): boolean {
  const zone = event.time_zone ?? userZone;
  const today = localDay(now, zone);
  if (!event.recurrence.length) {
    if (event.all_day) return event.end_date! <= today;
    return Date.parse(event.ends_at ?? event.starts_at!) <= Date.parse(now);
  }
  if (event.recurrence.some(line => line.startsWith('RDATE'))) return false;
  const rules = event.recurrence.filter(line => line.startsWith('RRULE:'));
  const rule = rules.length === 1 ? parseRule(rules[0]!, until => localDay(until, zone)) : null;
  if (!rule) return false;
  const start = event.all_day ? event.start_date! : localDay(event.starts_at!, zone);
  if (rule.untilDate === null && rule.count === null) return false;
  // Today's occurrence counts as to come until the day is over: the review doesn't read its time.
  return occurrenceDates(rule, start, today, addDays(today, COUNT_SEARCH_DAYS)).length === 0;
}
