// Reminders as the editor and the detail word them (DESIGN.md › Editor; darma SV-109, D287–D289):
// each is minutes from the item's moment, a negative one after it, 4 weeks either side. The
// moment is a timed event's start, a timed task's due time, an all-day event's midnight, and a dated
// task's Settings' task time on its day (9:00 AM at None); a task with no date has none. A preset's
// offset keeps its words ("10 min before"); any other reads as the moment it goes off, the offset
// quiet beside it ("Sun, Oct 25, 8:00 PM" · "1 day 18 hrs before").
import type {ItemOut} from '@setpoint/shared';
import {REMINDER_LIMIT_MINUTES} from '@setpoint/shared';
import {dayTitle} from './calendar.ts';
import {remindersLine} from './detail.ts';
import {clockTime, instantAt, localDate} from './format.ts';

const MINUTE = 60_000;

/** The Add reminder menu's presets, in its order, before Custom…. */
export const REMINDER_PRESETS = [0, 5, 10, 15, 30, 60, 120, 1440];
/** As many as an item can have (the API's limit). */
export const REMINDER_MAX = 10;
/** What a dated task without a time counts from when Settings' task time is None (D288). */
export const UNTIMED_TASK_TIME = '09:00';

const isPreset = (minutes: number) => REMINDER_PRESETS.includes(minutes);

/** Minutes after midnight a dated task without a time counts from: Settings' task time, or 9:00 AM. */
export function taskTimeMinutes(taskTime: string | null): number {
  const [hours, minutes] = (taskTime ?? UNTIMED_TASK_TIME).split(':').map(Number);
  return hours! * 60 + minutes!;
}

type Anchored = Pick<ItemOut, 'kind' | 'all_day' | 'starts_at' | 'start_date' | 'due_date' | 'due_at'>;

/** The instant (ms) an item's reminders count from, or null for a task with no date. */
export function reminderAnchor(item: Anchored, taskTime: string | null, timeZone: string): number | null {
  if (item.kind === 'task') {
    if (!item.due_date) return null;
    return Date.parse(item.due_at ?? instantAt(item.due_date, taskTimeMinutes(taskTime), timeZone));
  }
  if (item.all_day) return item.start_date ? Date.parse(instantAt(item.start_date, 0, timeZone)) : null;
  return item.starts_at ? Date.parse(item.starts_at) : null;
}

/** When a reminder goes off. */
export const reminderMoment = (anchor: number, minutes: number) => anchor - minutes * MINUTE;
/** A moment picked, as its offset from the anchor. */
export const offsetAt = (anchor: number, moment: number) => Math.round((anchor - moment) / MINUTE);

/** "1 day 18 hrs", "2 hrs", "1 hr 30 min", "45 min". */
function span(minutes: number): string {
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  return [
    days ? `${days} ${days === 1 ? 'day' : 'days'}` : null,
    hours ? `${hours} ${hours === 1 ? 'hr' : 'hrs'}` : null,
    mins ? `${mins} min` : null,
  ].filter(Boolean).join(' ');
}

/** An offset in words: "1 day 18 hrs before", "2 hrs after", "At the start". */
export function relativeLine(minutes: number): string {
  if (minutes === 0) return 'At the start';
  return `${span(Math.abs(minutes))} ${minutes > 0 ? 'before' : 'after'}`;
}

/** Why a moment picked can't be a reminder (past 4 weeks either side), or null. */
export function customProblem(minutes: number): string | null {
  if (Math.abs(minutes) <= REMINDER_LIMIT_MINUTES) return null;
  return `That's more than 4 weeks ${minutes > 0 ? 'before' : 'after'}: a reminder goes within 4 weeks either side.`;
}

/** One reminder's words: a preset's, or its moment with the offset quiet beside it; with no anchor, the offset. */
export function reminderWords(minutes: number, anchor: number | null, timeZone: string): {text: string; quiet: string | null; custom: boolean} {
  if (isPreset(minutes)) return {text: remindersLine([minutes])!, quiet: null, custom: false};
  if (anchor === null) return {text: relativeLine(minutes), quiet: null, custom: true};
  const moment = reminderMoment(anchor, minutes);
  return {text: `${dayTitle(localDate(moment, timeZone))}, ${clockTime(moment, timeZone)}`, quiet: relativeLine(minutes), custom: true};
}

/** The order reminders are shown in: the before-ones nearest the start first, then the after-ones the same. */
export function inOrder(reminders: number[]): number[] {
  const key = (minutes: number) => (minutes >= 0 ? minutes : REMINDER_LIMIT_MINUTES - minutes);
  return [...new Set(reminders)].sort((a, b) => key(a) - key(b));
}

/** The detail's lines: the presets in one ("At the start, 10 min, 1 hour before"), then each other one at its moment. */
export function reminderLines(reminders: number[], anchor: number | null, timeZone: string): {text: string; quiet: string | null}[] {
  const presets = remindersLine(reminders.filter(isPreset));
  const others = inOrder(reminders.filter(minutes => !isPreset(minutes))).map(minutes => {
    const {text, quiet} = reminderWords(minutes, anchor, timeZone);
    return {text, quiet};
  });
  return [...(presets ? [{text: presets, quiet: null}] : []), ...others];
}
