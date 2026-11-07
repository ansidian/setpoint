// The Inbox's empty pane (SV-218, D465): how the mail day is going, as its lines say it. After "·", a
// list takes commas (the error-copy rule).
import type {MailDayOut} from '@setpoint/shared';
import {fileSize} from './reader.ts';

const n = (value: number) => value.toLocaleString('en-US');

/** The headline: "3 need you" and ", 1 overdue" (in `caution`); null when nothing needs the user (All caught up). */
export function needLine(day: Pick<MailDayOut, 'need_you' | 'overdue'>): {need: string; overdue: string | null} | null {
  if (day.need_you === 0) return null;
  return {need: `${n(day.need_you)} ${day.need_you === 1 ? 'needs' : 'need'} you`, overdue: day.overdue ? `${n(day.overdue)} overdue` : null};
}

export interface TodayTile {
  value: string;
  label: string;
  glyph: 'task_alt' | 'inbox' | 'low_priority';
  tone: 'done' | 'fyi' | 'noise';
  // Above 0: a tinted cell's colour shows only then, so a zero never looks like something done.
  lit: boolean;
}

/** Today's strip: Done, and what triage sorted to FYI and to Noise. */
export function todayTiles(day: Pick<MailDayOut, 'done' | 'sorted_fyi' | 'sorted_noise'>): TodayTile[] {
  return [
    {value: n(day.done), label: 'Done today', glyph: 'task_alt', tone: 'done', lit: day.done > 0},
    {value: n(day.sorted_fyi), label: 'Sorted to FYI', glyph: 'inbox', tone: 'fyi', lit: day.sorted_fyi > 0},
    {value: n(day.sorted_noise), label: 'Sorted to Noise', glyph: 'low_priority', tone: 'noise', lit: day.sorted_noise > 0},
  ];
}

/** "12,408 emails · 1.3 GB, since Mar 2019."; "No emails yet." */
export function keptLine(day: Pick<MailDayOut, 'total' | 'bytes' | 'oldest_at'>, timeZone: string): string {
  if (!day.total || !day.oldest_at) return 'No emails yet.';
  const since = new Date(day.oldest_at).toLocaleDateString('en-US', {timeZone, month: 'short', year: 'numeric'});
  return `${n(day.total)} ${day.total === 1 ? 'email' : 'emails'} · ${fileSize(day.bytes)}, since ${since}.`;
}
