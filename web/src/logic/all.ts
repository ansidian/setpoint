// All (DESIGN.md › All; BRIEF.md › The Inbox): every email, Noise included, newest first, under
// day headings ("TODAY Wed, Oct 7", "YESTERDAY Tue, Oct 6", "MON Oct 5"), with clock times rather
// than ages (decision 39). Days are the owner's, midnight to midnight Pacific, never the browser's.
// Each day groups its rows by lane, with the kind once where an FYI run starts, and folds its Noise
// to one line (#48, D58). A pinned email sits on the Pinned shelf above the days, and only there (D105).
import {INBOX_GROUPS} from '@setpoint/shared';
import type {MessageRowOut} from '@setpoint/shared';
import {daysBetween, localDate} from './format.ts';
import {codeGroups} from './format.ts';
import {rowKey, sender} from './inbox.ts';
import type {Stop} from './inbox.ts';

export interface Day {
  // The local day, "2026-10-07".
  date: string;
  rows: MessageRowOut[];
}

const newest = (a: MessageRowOut, b: MessageRowOut) => b.received_at.localeCompare(a.received_at) || b.id - a.id;

/**
 * Rows by local day in `timeZone`, newest day first and newest first within it. Pages of All are
 * joined here, so a day split between two pages shows once. A pinned email leaves its day for the
 * Pinned shelf until it's unpinned (D105).
 */
export function groupByDay(rows: MessageRowOut[], timeZone: string): Day[] {
  const days: Day[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort(newest)) {
    if (seen.has(row.id) || row.pinned) continue;
    seen.add(row.id);
    const date = localDate(row.received_at, timeZone);
    if (days.at(-1)?.date !== date) days.push({date, rows: []});
    days.at(-1)!.rows.push(row);
  }
  return days;
}

export type AllLane = 'attention' | 'unsorted' | 'fyi';

export interface LaneView {
  lane: AllLane;
  label: string;
  // Each row with its kind where an FYI run of that kind starts, else null.
  rows: {row: MessageRowOut; kind: string | null}[];
}

export interface DayView {
  date: string;
  lanes: LaneView[];
  // The day's Noise: its count and first three organisations, and its rows once opened (none while folded).
  noise: {count: number; preview: string; open: boolean; rows: MessageRowOut[]} | null;
}

const LANES: [AllLane, string][] = [['attention', 'Attention'], ['unsorted', 'Unsorted'], ['fyi', 'FYI']];
const laneOf = (row: MessageRowOut) => row.lane ?? 'unsorted';
const kindOrder = (row: MessageRowOut) => INBOX_GROUPS.indexOf(row.kind ?? 'other');

/**
 * A day as All draws it: Attention, Unsorted and FYI in Unread's order, FYI's rows by kind in
 * Unread's order and newest first within one, then the day's Noise, folded unless `noiseOpen`.
 */
export function dayView(day: Day, noiseOpen: boolean): DayView {
  const lanes = LANES.flatMap(([lane, label]): LaneView[] => {
    const rows = day.rows.filter(row => laneOf(row) === lane);
    if (!rows.length) return [];
    if (lane !== 'fyi') return [{lane, label, rows: rows.map(row => ({row, kind: null}))}];
    const sorted = rows.toSorted((a, b) => kindOrder(a) - kindOrder(b));
    return [{lane, label, rows: sorted.map((row, index) => ({row, kind: index > 0 && kindLabel(sorted[index - 1]!) === kindLabel(row) ? null : kindLabel(row)}))}];
  });
  const noise = day.rows.filter(row => row.lane === 'noise');
  return {
    date: day.date, lanes,
    noise: noise.length ? {count: noise.length, preview: [...new Set(noise.map(sender))].slice(0, 3).join(' · '), open: noiseOpen, rows: noiseOpen ? noise : []} : null,
  };
}

export const noiseKey = (date: string) => `noise:${date}`;
const allStop = (row: MessageRowOut): Stop => ({key: `all:${row.id}`, kind: 'row', group: 'all', id: row.id});

/** Where J and K stop in All: the Pinned shelf's rows, then each day's rows in the order shown, and a folded Noise line (Enter opens it). */
export const dayStops = (views: DayView[], shelf: MessageRowOut[] = []): Stop[] => [
  ...shelf.map((row): Stop => ({key: rowKey('pinned', row.id), kind: 'row', group: 'pinned', id: row.id})),
  ...views.flatMap(view => [
    ...view.lanes.flatMap(lane => lane.rows.map(({row}) => allStop(row))),
    ...(!view.noise ? [] : view.noise.open ? view.noise.rows.map(allStop) : [{key: noiseKey(view.date), kind: 'noise', date: view.date} satisfies Stop]),
  ]),
];

const onDay = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {...options, timeZone: 'UTC'});

/**
 * A day's heading: the label in the group header's uppercase, then the date in its own case.
 * Today and Yesterday name the weekday with the date; earlier days are the weekday, then the date,
 * with the year once it isn't this year's.
 */
export function dayHeading(date: string, today: string): {label: string; date: string} {
  const days = daysBetween(date, today);
  const weekday = onDay(date, {weekday: 'short'});
  if (days === 0) return {label: 'Today', date: `${weekday}, ${onDay(date, {month: 'short', day: 'numeric'})}`};
  if (days === 1) return {label: 'Yesterday', date: `${weekday}, ${onDay(date, {month: 'short', day: 'numeric'})}`};
  const sameYear = date.slice(0, 4) === today.slice(0, 4);
  return {label: weekday, date: onDay(date, sameYear ? {month: 'short', day: 'numeric'} : {month: 'short', day: 'numeric', year: 'numeric'})};
}

export const KIND_LABELS = {
  deliveries: 'Deliveries', money: 'Money', career: 'Career', security: 'Security', updates: 'Updates', people: 'People', other: 'Other',
} as const;

/** The kind All shows before the account: the FYI kind, else Noise, or Unsorted while triage hasn't sorted it. */
export function kindLabel(row: Pick<MessageRowOut, 'lane' | 'kind'>): string {
  if (row.lane === null) return 'Unsorted';
  if (row.lane === 'noise') return 'Noise';
  return KIND_LABELS[row.kind ?? 'other'];
}

/**
 * A row's text in All, as the Inbox's (Decided while building #35, #74): the summary, when triage
 * wrote one, takes the subject's place and the subject moves to the row's tooltip; then " · " and
 * the platform in `ink3`. A code row shows its subject with the code in Geist Mono, two groups of
 * three. A security email's lead is its decisive fact ("New sign-in · MacBook Pro · Los Angeles"); a
 * protected one keeps its subject, in `alert`, with the fact's details or its summary after it
 * ("Your recovery email was changed · Windows · Chrome · Phoenix, AZ").
 */
export interface AllLine {
  from: string;
  subject: string;
  // A code inside the subject: the subject's text before it, the code, the text after.
  code: {before: string; value: string; after: string} | null;
  summary: string | null;
  alert: boolean;
  // The subject, when the summary took its place.
  title: string | null;
}

export function allRowLine(row: MessageRowOut): AllLine {
  const from = sender(row);
  const via = row.via ? `via ${row.via}` : null;
  const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ') || null;
  if (row.code) {
    const at = row.subject.indexOf(row.code.value);
    const code = at >= 0
      ? {before: row.subject.slice(0, at), value: codeGroups(row.code.value), after: row.subject.slice(at + row.code.value.length)}
      : {before: `${row.subject} `, value: codeGroups(row.code.value), after: ''};
    return {from, subject: row.subject, code, summary: null, alert: false, title: null};
  }
  if (row.fact) {
    const [what, ...rest] = row.fact.split(' · ');
    if (row.protected) return {from, subject: row.subject, code: null, summary: join(...rest, via), alert: true, title: null};
    return {from, subject: what ?? row.fact, code: null, summary: join(...rest, via), alert: false, title: null};
  }
  if (row.protected) return {from, subject: row.subject, code: null, summary: join(row.summary, via), alert: true, title: null};
  if (row.summary) return {from, subject: row.summary, code: null, summary: via, alert: false, title: row.subject};
  return {from, subject: row.subject, code: null, summary: via, alert: false, title: null};
}
