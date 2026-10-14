// The Inbox as one list (SV-70, D264, D266; DESIGN.md › All): New, Attention, the Pinned shelf, then
// every email by day, Noise included, newest first, under day headings ("TODAY Wed, Oct 7",
// "YESTERDAY Tue, Oct 6", "MON Oct 5"), with clock times rather than ages (decision 39). Days are the
// owner's, midnight to midnight Pacific, never the browser's. Each day groups its rows by lane, with
// the kind once where an FYI run starts, and folds its Noise to one line (#48, D58); New does the
// same under its own band. An email in New, Attention or on the Pinned shelf leaves its day meanwhile (D105).
import {INBOX_GROUPS} from '@setpoint/shared';
import type {InboxGroupOut, InboxGroup, MessageRowOut} from '@setpoint/shared';
import {daysBetween, localDate} from './format.ts';
import {codeGroups} from './format.ts';
import {GROUP_LABELS, rowKey, sender} from './inbox.ts';
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
 * Pinned shelf until it's unpinned (D105), and one New or Attention shows (`above`) leaves it too.
 */
export function groupByDay(rows: MessageRowOut[], timeZone: string, above: ReadonlySet<number> = new Set()): Day[] {
  const days: Day[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort(newest)) {
    if (seen.has(row.id) || row.pinned || above.has(row.id)) continue;
    seen.add(row.id);
    const date = localDate(row.received_at, timeZone);
    if (days.at(-1)?.date !== date) days.push({date, rows: []});
    days.at(-1)!.rows.push(row);
  }
  return days;
}

/** Where an email sits this visit to the Inbox: New, Attention, or its day (D264). */
export type Place = 'new' | 'attention' | 'day';

// New is drawn as a day is, under its own band; this stands for its date in its keys ("noise:new").
export const NEW = 'new';

/** Where an email goes the first time this visit sees it: New while unread, Attention while it waits on Done, else its day. */
const placeOf = (row: MessageRowOut): Place => (row.unread ? 'new' : row.lane === 'attention' && !row.done ? 'attention' : 'day');

/**
 * Each email's place this visit (D264): set the first time the list sees it, and kept until the
 * visit ends, so reading an email in New leaves it there and the list never moves under J and K.
 * Mail that arrives meanwhile comes in unread, so into New; one marked unread stays where it was.
 * Returns `placed` itself when nothing is new to it.
 */
export function placeRows(placed: ReadonlyMap<number, Place>, rows: MessageRowOut[]): ReadonlyMap<number, Place> {
  const added = rows.filter(row => !placed.has(row.id));
  if (!added.length) return placed;
  const next = new Map(placed);
  for (const row of added) if (!next.has(row.id)) next.set(row.id, placeOf(row));
  return next;
}

/**
 * Mark all as read empties New (D264): what it reads goes to its day; Attention it leaves unread
 * (BRIEF.md › The Inbox) goes to Attention, as Security it leaves unread goes to its day.
 */
export function clearNew(placed: ReadonlyMap<number, Place>, rows: MessageRowOut[]): ReadonlyMap<number, Place> {
  const waiting = new Set(rows.filter(row => row.lane === 'attention' && !row.done).map(row => row.id));
  return new Map([...placed].map(([id, place]): [number, Place] => [id, place === 'new' ? (waiting.has(id) ? 'attention' : 'day') : place]));
}

/**
 * New's and Attention's emails, newest first, from the Inbox's groups (with this visit's held rows):
 * New is what was unread when this visit first saw it; Attention, mail waiting on Done that wasn't.
 * A pinned email is on the Pinned shelf, and only there, as in All (D105).
 */
export function splitInbox(groups: InboxGroupOut[], placed: ReadonlyMap<number, Place>): {fresh: MessageRowOut[]; attention: MessageRowOut[]} {
  const rows = [...new Map(groups.filter(group => group.group !== 'pinned').flatMap(group => group.rows).filter(row => !row.pinned).map(row => [row.id, row])).values()].sort(newest);
  const at = (row: MessageRowOut) => placed.get(row.id) ?? placeOf(row);
  return {
    fresh: rows.filter(row => at(row) === 'new'),
    attention: rows.filter(row => at(row) === 'attention' && row.lane === 'attention' && !row.done),
  };
}

export type AllLane = 'attention' | 'unsorted' | 'fyi';

export interface LaneView {
  lane: AllLane;
  label: string;
  // Each row with its kind where an FYI run of that kind starts (its group, for the word and the glyph), else null.
  rows: {row: MessageRowOut; kind: InboxGroup | null}[];
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
 * A day as the list draws it (New too): Attention, Unsorted and FYI in the groups' order, FYI's rows
 * by kind in that order and newest first within one, then the day's Noise, folded unless `noiseOpen`.
 */
export function dayView(day: Day, noiseOpen: boolean): DayView {
  const lanes = LANES.flatMap(([lane, label]): LaneView[] => {
    const rows = day.rows.filter(row => laneOf(row) === lane);
    if (!rows.length) return [];
    if (lane !== 'fyi') return [{lane, label, rows: rows.map(row => ({row, kind: null}))}];
    const sorted = rows.toSorted((a, b) => kindOrder(a) - kindOrder(b));
    return [{lane, label, rows: sorted.map((row, index) => ({row, kind: index > 0 && kindGroup(sorted[index - 1]!) === kindGroup(row) ? null : kindGroup(row)}))}];
  });
  const noise = day.rows.filter(row => row.lane === 'noise');
  return {
    date: day.date, lanes,
    noise: noise.length ? {count: noise.length, preview: [...new Set(noise.map(sender))].slice(0, 3).join(' · '), open: noiseOpen, rows: noiseOpen ? noise : []} : null,
  };
}

export const noiseKey = (date: string) => `noise:${date}`;

/**
 * A row's key in the list: its part's ("new:12" in New, "attention:12" in Attention) or "all:12" in its
 * day, so an email moving between them folds out of one and into the other.
 */
export const listKey = (part: 'new' | 'attention' | 'all', id: number) => `${part}:${id}`;
const stopOf = (part: 'new' | 'attention' | 'all') => (row: MessageRowOut): Stop => ({key: listKey(part, row.id), kind: 'row', group: 'all', id: row.id});

const viewStops = (view: DayView, part: 'new' | 'all'): Stop[] => [
  ...view.lanes.flatMap(lane => lane.rows.map(({row}) => stopOf(part)(row))),
  ...(!view.noise ? [] : view.noise.open ? view.noise.rows.map(stopOf(part)) : [{key: noiseKey(view.date), kind: 'noise', date: view.date} satisfies Stop]),
];

/**
 * Where J and K stop, in the list's order: New's rows as its lanes show them, Attention's, the Pinned
 * shelf's, then each day's, with a folded Noise line in place of its rows (Enter opens it).
 */
export const dayStops = (views: DayView[], shelf: MessageRowOut[] = [], top: {fresh?: DayView | null; attention?: MessageRowOut[]} = {}): Stop[] => [
  ...(top.fresh ? viewStops(top.fresh, 'new') : []),
  ...(top.attention ?? []).map(stopOf('attention')),
  ...shelf.map((row): Stop => ({key: rowKey('pinned', row.id), kind: 'row', group: 'pinned', id: row.id})),
  ...views.flatMap(view => viewStops(view, 'all')),
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

/** The kind the list shows before the account: the FYI kind, else Noise, or Unsorted while triage hasn't sorted it. */
export function kindGroup(row: Pick<MessageRowOut, 'lane' | 'kind'>): InboxGroup {
  if (row.lane === null) return 'unsorted';
  if (row.lane === 'noise') return 'noise';
  return row.kind ?? 'other';
}

/** The kind's word: "Deliveries", "Noise", "Unsorted". */
export const kindLabel = (row: Pick<MessageRowOut, 'lane' | 'kind'>): string => GROUP_LABELS[kindGroup(row)];

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
