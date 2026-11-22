// An email's snooze (DESIGN.md › Interaction rules): the menu's choices and when each ends, a
// picked moment's problem, and the words for a snoozed or returned email. Tomorrow is the user's next
// date, and Next weekday the first Monday to Friday after today, shown only when it isn't tomorrow
// (Friday and Saturday, meaning Monday). Both are at Settings' task time, else 9:00 AM, as the
// overdue banner's Tomorrow. Pick a date and time is any moment ahead. Setpoint keeps the snooze;
// the server returns the email at its time (server/src/triage/snooze.ts).
import type {MessageRowOut} from '@setpoint/shared';
import {addDays, clockTime, daysBetween, instantAt, localDate} from './format.ts';
import {clockLabel, parseClock} from './compose.ts';
import {taskTimeMinutes} from './reminders.ts';

export type EmailSnoozeChoice = 'tomorrow' | 'weekday' | 'pick';

export interface EmailSnoozeOption {
  choice: EmailSnoozeChoice;
  label: string;
  // When it ends (ms), and that moment by its weekday ("Thu 9:00 AM"); none for Pick.
  until: number | null;
  when: string | null;
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
const onDay = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {...options, timeZone: 'UTC'});

/** The first Monday to Friday after `today`. */
export function nextWeekday(today: string): string {
  let date = addDays(today, 1);
  while (weekday(date) === 0 || weekday(date) === 6) date = addDays(date, 1);
  return date;
}

/** A moment's short words: "9:00 AM" today, "Tomorrow 9:00 AM", "Mon 9:00 AM" within the week, else "Nov 30, 9:00 AM". */
export function snoozeWhen(at: string | number, now: number, timeZone: string): string {
  const day = localDate(at, timeZone);
  const today = localDate(now, timeZone);
  const days = daysBetween(today, day);
  const time = clockTime(at, timeZone);
  if (days === 0) return time;
  if (days === 1) return `Tomorrow ${time}`;
  if (days > 1 && days < 7) return `${onDay(day, {weekday: 'short'})} ${time}`;
  return `${onDay(day, day.slice(0, 4) === today.slice(0, 4) ? {month: 'short', day: 'numeric'} : {month: 'short', day: 'numeric', year: 'numeric'})}, ${time}`;
}

/** A scheduled send's moment inside a sentence: "Scheduled for tomorrow 9:00 AM", "… for Mon 9:00 AM". */
export const scheduledWhen = (at: string | number, now: number, timeZone: string) => snoozeWhen(at, now, timeZone).replace(/^Tomorrow/, 'tomorrow');

/** The menu at `now`: Tomorrow, Next weekday when it isn't tomorrow, and Pick a date and time. */
export function snoozeOptions(now: number, taskTime: string | null, timeZone: string): EmailSnoozeOption[] {
  const today = localDate(now, timeZone);
  const morning = (date: string) => Date.parse(instantAt(date, taskTimeMinutes(taskTime), timeZone));
  const tomorrow = addDays(today, 1);
  const weekdayDate = nextWeekday(today);
  const at = (choice: EmailSnoozeChoice, label: string, date: string): EmailSnoozeOption => {
    const until = morning(date);
    return {choice, label, until, when: `${onDay(date, {weekday: 'short'})} ${clockTime(until, timeZone)}`};
  };
  return [
    at('tomorrow', 'Tomorrow', tomorrow),
    ...(weekdayDate !== tomorrow ? [at('weekday', 'Next weekday', weekdayDate)] : []),
    {choice: 'pick', label: 'Pick a date and time', until: null, when: null},
  ];
}

/** Pick's first moment: tomorrow, with the task time typed in. */
export function pickStart(now: number, taskTime: string | null, timeZone: string): {date: string; text: string} {
  return {date: addDays(localDate(now, timeZone), 1), text: clockLabel(taskTimeMinutes(taskTime))};
}

/**
 * Pick's time as typed, read on every keystroke: its minutes and how they read ("2:00 PM"), or why
 * it can't be read. "2pm", "2:30 p", "14:00" and "9a" read; a bare "2" asks for AM or PM.
 */
export function readPickTime(text: string): {minutes: number; label: string} | {problem: string} {
  const typed = text.trim();
  if (!typed) return {problem: 'Type a time'};
  // An hour that could be either half ("2", "230", "2:30") isn't guessed.
  const bare = /^(\d{1,2}?):?(\d{2})?$/.exec(typed) ?? /^(\d{1,2})$/.exec(typed);
  if (bare && Number(bare[1]) >= 1 && Number(bare[1]) <= 12) return {problem: 'Add AM or PM'};
  const minutes = parseClock(typed, null);
  if (minutes !== null && minutes >= 0 && minutes < 1440) return {minutes, label: clockLabel(minutes)};
  return {problem: 'Not a time'};
}

/**
 * What Pick would snooze until, for its line and its Snooze: the moment and its words ("Mon, Oct 12,
 * 2:00 PM"), or why not: the time unread, or a moment already past.
 */
export function pickOutcome(date: string, text: string, now: number, timeZone: string): {until: number; line: string} | {problem: string} {
  const time = readPickTime(text);
  if ('problem' in time) return time;
  const until = Date.parse(instantAt(date, time.minutes, timeZone));
  if (until <= now) return {problem: 'That time has passed'};
  return {until, line: `${onDay(date, {weekday: 'short', month: 'short', day: 'numeric'})}, ${time.label}`};
}

/** Whether a row can be snoozed: received mail, not snoozed already. Sent-only mail can't (the server refuses it). */
export const snoozeable = (row: Pick<MessageRowOut, 'sent_only' | 'snoozed_until'>) => !row.sent_only && !row.snoozed_until;

/** A snoozed row's words, for its mark and Snoozed's list: "Snoozed until Mon 9:00 AM". */
export const snoozedLine = (until: string, now: number, timeZone: string) => `Snoozed until ${snoozeWhen(until, now, timeZone)}`;
