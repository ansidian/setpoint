// Which Todoist tasks are overdue: open and confirmed, a timed one once its time has passed, an
// untimed one once its day is over in the user's time zone. Today's Today lines and the arrival
// banner both read it. Which range of days to look in is the caller's: this judges what it's given.
import type {ItemOut} from '@setpoint/shared';
import {localDate} from './format.ts';

export interface Overdue {
  item: ItemOut;
  // Due today, so it has a line in Today (a timed task whose time has passed). An earlier day's
  // has none.
  today: boolean;
}

/** Whether one item is an overdue task, `today` being the user's date ("2026-10-07"). */
export function isOverdue(item: ItemOut, now: number, today: string): boolean {
  if (item.kind !== 'task' || item.done || item.command?.state === 'pending') return false;
  if (item.due_at) return Date.parse(item.due_at) < now;
  return item.due_date !== null && item.due_date < today;
}

/** The overdue tasks among `items`, in the order given, each saying whether it's due today. */
export function overdueTasks(items: readonly ItemOut[], now: number, timeZone: string): Overdue[] {
  const today = localDate(now, timeZone);
  return items.filter(item => isOverdue(item, now, today)).map(item => ({item, today: item.due_date === today}));
}
