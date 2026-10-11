// Which occurrences of a recurring event a change applies to (DESIGN.md › Recurring events; boards
// 14 and 15b): This event (the default, override 6), This and following, or All events, each with
// its consequence. Moving Gym from Wed, Oct 7 to Thu, Oct 8 reads "Thu, Oct 8 only", "Wed → Thu
// from Oct 7 on", "Wed → Thu, past ones too"; a change that keeps its weekday reads "Wed, Oct 7
// only", "From Wed, Oct 7 on", "Past ones too". v1's scope options ("Just this one", "Upcoming
// only", "All events", with fixed descriptions) are rewritten here (darma SV-15).
import type {RecurringScope} from '@setpoint/shared';
import {dayTitle} from './calendar.ts';
import {clockTime} from './format.ts';

export interface ScopeChoice {
  scope: RecurringScope;
  label: string;
  line: string;
}

export const DEFAULT_SCOPE: RecurringScope = 'this';

const onDay = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {...options, timeZone: 'UTC'});
const weekdayName = (date: string) => onDay(date, {weekday: 'short'});
const monthDay = (date: string) => onDay(date, {month: 'short', day: 'numeric'});

/** The three choices for an occurrence on `from` that would now be on `to` (the same day when only its time or details change). */
export function scopeChoices(from: string, to: string): ScopeChoice[] {
  const moved = weekdayName(from) !== weekdayName(to);
  const arrow = `${weekdayName(from)} → ${weekdayName(to)}`;
  return [
    {scope: 'this', label: 'This event', line: `${dayTitle(to)} only`},
    {scope: 'following', label: 'This and following', line: moved ? `${arrow} from ${monthDay(from)} on` : `From ${dayTitle(from)} on`},
    {scope: 'all', label: 'All events', line: moved ? `${arrow}, past ones too` : 'Past ones too'},
  ];
}

/**
 * The choices when a recurring event also moves to another calendar (F6b): Google moves a whole
 * series (events.move) and can't move one occurrence ("cannotChangeOrganizerOfInstance"), so This
 * event isn't offered; This and following starts a new series there.
 */
export function calendarMoveChoices(from: string, calendar: string): ScopeChoice[] {
  return [
    {scope: 'following', label: 'This and following', line: `To ${calendar} from ${monthDay(from)} on`},
    {scope: 'all', label: 'All events', line: `To ${calendar}, past ones too`},
  ];
}

/** The drop prompt's line: "Gym · Wed, Oct 7 → Thu, Oct 8 · 7:00 AM" (a task or all-day event has no time). */
export function moveLine(title: string, from: string, to: string, startsAt: string | null, timeZone: string): string {
  return [title, `${dayTitle(from)} → ${dayTitle(to)}`, startsAt ? clockTime(startsAt, timeZone) : null].filter(Boolean).join(' · ');
}
