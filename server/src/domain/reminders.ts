// When reminders go off, and what they say (BRIEF.md › ntfy; Settings › Notifications: events some
// minutes before, tasks at a time on the due day, each None by default, D49). Rewritten from v1's reminder rows (see SV-6): v2
// derives each reminder from the item as it is now, so a moved, cancelled or completed item needs
// no bookkeeping, and the dedupe key (the occurrence's start, the minutes) sends each once.
// Carried over from v1:
// - a reminder may go late, within a grace, but never long after (v1 6 hours; here 1 hour, as a
//   "10 min before" is no use later);
// - a reminder an item moved into the past doesn't fire (v1 b9a4306a): only moments after the
//   scheduler's last pass count;
// - all-day events count from local midnight (v1 497ea1af); a dated task reminds at Settings' time
//   on its day, a timed one at its time (and never at a UTC instant read as wall-clock time); with
//   Settings' task time at None, a task reminds only at the reminders it has itself.
// SV-109: an offset may be negative, after the item's moment (D287), and a dated task's own
// reminders count from Settings' time on its day, or 9:00 AM at None (D288).
import {zonedInstant} from './time.ts';

const MINUTE = 60_000;
export const REMINDER_GRACE_MS = 60 * MINUTE;

export interface ReminderItem {
  id: number;
  kind: 'event' | 'task';
  title: string;
  all_day: boolean;
  starts_at: string | null;
  start_date: string | null;
  due_date: string | null;
  due_at: string | null;
  done: boolean;
  reminders: number[];
  place: string | null;
  project: string | null;
  occurrence_start: string | null;
}

export interface Reminder {
  at: string;
  // The dedupe key: one per occurrence, time and offset.
  key: string;
  minutes: number;
}

/** A dated task without a time counts from this when Settings' task time is None (D288). */
export const UNTIMED_TASK_ANCHOR = '09:00';

/** Every reminder an item (or occurrence) has, at its moment; a negative offset is after it (D287). */
export function remindersOf(item: ReminderItem, settings: {taskTime: string | null; timeZone: string}): Reminder[] {
  const at = (anchor: string, minutes: number) => new Date(Date.parse(anchor) - minutes * MINUTE).toISOString();
  const fromAnchor = (anchor: string, offsets: number[]) => offsets.map(minutes => ({at: at(anchor, minutes), key: `reminder:${item.id}@${anchor}:${minutes}`, minutes}));
  if (item.kind === 'task') {
    if (item.done || !item.due_date) return [];
    if (item.due_at) return fromAnchor(item.due_at, item.reminders.length || settings.taskTime === null ? item.reminders : [0]);
    // D288: its own reminders count from Settings' time on its day (9:00 AM at None), in place of that one.
    if (item.reminders.length) return fromAnchor(zonedInstant(item.due_date, settings.taskTime ?? UNTIMED_TASK_ANCHOR, settings.timeZone), item.reminders);
    if (settings.taskTime === null) return [];
    return [{at: zonedInstant(item.due_date, settings.taskTime, settings.timeZone), key: `reminder:${item.id}@${item.due_date}T${settings.taskTime}`, minutes: 0}];
  }
  const anchor = item.all_day ? (item.start_date ? zonedInstant(item.start_date, '00:00', settings.timeZone) : null) : item.starts_at;
  return anchor ? fromAnchor(anchor, item.reminders) : [];
}

/** Whether a reminder goes now: its moment has come since the last pass, within the grace. */
export function reminderDue(at: string, now: string, lastPass: string, retrying = false): boolean {
  const atMs = Date.parse(at);
  const nowMs = Date.parse(now);
  if (atMs > nowMs || nowMs - atMs > REMINDER_GRACE_MS) return false;
  return retrying || atMs > Date.parse(lastPass);
}

/** "2:30 PM" in the owner's zone. */
export function clockTime(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {timeZone, hour: 'numeric', minute: '2-digit'}).format(new Date(instant)).replace(/\s/g, ' ');
}

/** A reminder's words: "Dentist" / "2:30 PM · Smile Dental"; "Pay rent" / "Due today · Home". */
export function reminderText(item: ReminderItem, timeZone: string): {title: string; body: string} {
  if (item.kind === 'task') {
    const when = item.due_at ? `Due ${clockTime(item.due_at, timeZone)}` : 'Due today';
    return {title: item.title, body: [when, item.project].filter(Boolean).join(' · ')};
  }
  const when = item.all_day || !item.starts_at ? 'All day' : clockTime(item.starts_at, timeZone);
  return {title: item.title, body: [when, item.place].filter(Boolean).join(' · ')};
}

/** Time to Leave's words: "Time to leave for Dentist" / "Leave by 2:05 PM · 18 min · Smile Dental". Never Home. */
export function leaveText(item: Pick<ReminderItem, 'title' | 'place'>, leaveAt: string, travelMinutes: number, timeZone: string): {title: string; body: string} {
  return {title: `Time to leave for ${item.title}`, body: [`Leave by ${clockTime(leaveAt, timeZone)}`, `${travelMinutes} min`, item.place].filter(Boolean).join(' · ')};
}
