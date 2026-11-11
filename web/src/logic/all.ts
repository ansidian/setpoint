// The Inbox, days first (SV-199, D449; DESIGN.md › The list): Attention, the Pinned shelf, then every
// email by day, Noise included, newest first, under day headings ("TODAY Wed, Oct 7",
// "YESTERDAY Tue, Oct 6", "MON Oct 5"). Days are the owner's, midnight to midnight Pacific, never the
// browser's. Unread mail stays in its day, drawn unread, so reading never moves a row. Each day groups
// its rows by lane, with the kind once where an FYI run starts, and folds its Noise to one line (#48,
// D58). An email in Attention or on the Pinned shelf leaves its day meanwhile (D105).
// The views (SV-221, D471) show part of it: Unread the unread mail in the same shape, Attention its
// rows alone, FYI and Noise their mail by day; only All has the shelf, so elsewhere a pinned email
// sits where it belongs.
import {INBOX_GROUPS} from '@setpoint/shared';
import type {InboxGroupOut, InboxGroup, MessageRowOut} from '@setpoint/shared';
import {daysBetween, localDate} from './format.ts';
import {codeGroups} from './format.ts';
import {GROUP_LABELS, rowKey, sender} from './inbox.ts';
import type {Stop} from './inbox.ts';
import type {InboxView} from './route.ts';

export interface Day {
  // The local day, "2026-10-07".
  date: string;
  rows: MessageRowOut[];
}

const newest = (a: MessageRowOut, b: MessageRowOut) => b.received_at.localeCompare(a.received_at) || b.id - a.id;

/** An email the list draws unread: unread and not Done, as the counts have it (#241). */
export const unreadNotDone = (row: Pick<MessageRowOut, 'unread' | 'done'>) => row.unread && !row.done;

/**
 * Rows by local day in `timeZone`, newest day first and newest first within it. Pages of All are
 * joined here, so a day split between two pages shows once. A pinned email leaves its day for the
 * Pinned shelf until it's unpinned (D105), unless there's no shelf (`shelf` false), and one Attention
 * shows (`above`) leaves it too.
 */
export function groupByDay(rows: MessageRowOut[], timeZone: string, above: ReadonlySet<number> = new Set(), shelf = true): Day[] {
  const days: Day[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort(newest)) {
    if (seen.has(row.id) || (shelf && row.pinned) || above.has(row.id)) continue;
    seen.add(row.id);
    const date = localDate(row.received_at, timeZone);
    if (days.at(-1)?.date !== date) days.push({date, rows: []});
    days.at(-1)!.rows.push(row);
  }
  return days;
}

/**
 * Attention's emails, newest first, from the Inbox's groups (with Undo's held rows): every Attention
 * email not yet Done, unread or read (D449). A pinned email is on the Pinned shelf, and only there
 * (D105), unless there's no shelf (`shelf` false).
 */
export function attentionRows(groups: InboxGroupOut[], shelf = true): MessageRowOut[] {
  const rows = new Map(groups.filter(group => group.group !== 'pinned').flatMap(group => group.rows).filter(row => !shelf || !row.pinned).map(row => [row.id, row]));
  return [...rows.values()].filter(row => row.lane === 'attention' && !row.done).sort(newest);
}

export type AllLane = 'attention' | 'unsorted' | 'fyi' | 'noise';

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
 * A day as the list draws it: Attention, Unsorted and FYI in the groups' order, FYI's rows
 * by kind in that order and newest first within one, then the day's Noise, folded unless `noiseOpen`.
 * Unread and Noise have its rows in full instead, as the last lane (`noiseRows`, SV-221).
 */
export function dayView(day: Day, noiseOpen: boolean, noiseRows = false): DayView {
  const lanes = LANES.flatMap(([lane, label]): LaneView[] => {
    const rows = day.rows.filter(row => laneOf(row) === lane);
    if (!rows.length) return [];
    if (lane !== 'fyi') return [{lane, label, rows: rows.map(row => ({row, kind: null}))}];
    const sorted = rows.toSorted((a, b) => kindOrder(a) - kindOrder(b));
    return [{lane, label, rows: sorted.map((row, index) => ({row, kind: index > 0 && kindGroup(sorted[index - 1]!) === kindGroup(row) ? null : kindGroup(row)}))}];
  });
  const noise = day.rows.filter(row => row.lane === 'noise');
  if (noiseRows) return {date: day.date, lanes: noise.length ? [...lanes, {lane: 'noise', label: 'Noise', rows: noise.map(row => ({row, kind: null}))}] : lanes, noise: null};
  return {
    date: day.date, lanes,
    noise: noise.length ? {count: noise.length, preview: [...new Set(noise.map(sender))].slice(0, 3).join(', '), open: noiseOpen, rows: noiseOpen ? noise : []} : null,
  };
}

export const noiseKey = (date: string) => `noise:${date}`;

/** What a view draws: Attention's rows, the Pinned shelf's, the days, and whether the days name their lanes. */
export interface ViewList {
  attention: MessageRowOut[];
  shelf: MessageRowOut[];
  days: DayView[];
  lanes: boolean;
}

/**
 * What `view` shows (SV-221, D471), from the Inbox's `groups` (with Undo's held rows), All's pages
 * (`rows`) and Unread's rows for this visit (`unread`, heldUnread's):
 * - **All** as it always was: Attention, the Pinned shelf, then the days.
 * - **Unread** the same shape with only its rows: their Attention, then each day's, Noise in full.
 * - **Attention** every Attention email not Done, newest first.
 * - **FYI** and **Noise** their mail by day, read or not, Noise in full, under the day alone.
 * Only All has the shelf; elsewhere a pinned email sits in Attention or its day.
 */
export function viewList(view: InboxView, from: {groups: InboxGroupOut[]; rows: MessageRowOut[]; unread: MessageRowOut[]}, timeZone: string, noiseOpen: ReadonlySet<string>): ViewList {
  const byDay = (rows: MessageRowOut[], above: MessageRowOut[], shelf: boolean) => groupByDay(rows, timeZone, new Set(above.map(row => row.id)), shelf);
  const folded = (days: Day[]) => days.map(day => dayView(day, noiseOpen.has(day.date)));
  switch (view) {
    case 'all': {
      const attention = attentionRows(from.groups);
      return {attention, shelf: from.groups.find(group => group.group === 'pinned')?.rows ?? [], days: folded(byDay(from.rows, attention, true)), lanes: true};
    }
    case 'unread': {
      const attention = from.unread.filter(row => row.lane === 'attention').sort(newest);
      return {attention, shelf: [], days: byDay(from.unread, attention, false).map(day => dayView(day, false, true)), lanes: true};
    }
    case 'attention':
      return {attention: attentionRows(from.groups, false), shelf: [], days: [], lanes: false};
    case 'fyi':
    case 'noise': {
      // Every one the list has: All's pages, and the Inbox's unread ones from further back.
      const rows = [...from.rows, ...from.groups.flatMap(group => group.rows)].filter(row => row.lane === view);
      return {attention: [], shelf: [], days: byDay(rows, [], false).map(day => dayView(day, false, view === 'noise')), lanes: false};
    }
  }
}

/**
 * Unread's rows for this visit to it (SV-221): each email unread and not Done in the Inbox (`inbox`),
 * and each one it held before as it is now (`latest`, All's pages and the Inbox's), so one read here
 * stays, drawn read, until the user leaves the view. One Done or in Trash (`gone`) leaves; one read
 * that no list has any more stays read as it was held. A row the hold already has is kept as it is, so
 * an unchanged answer gives back the same rows.
 */
export function heldUnread(held: ReadonlyMap<number, MessageRowOut>, inbox: MessageRowOut[], latest: ReadonlyMap<number, MessageRowOut>, gone: ReadonlySet<number>): Map<number, MessageRowOut> {
  const next = new Map<number, MessageRowOut>();
  for (const row of inbox) if (unreadNotDone(row) && !gone.has(row.id)) next.set(row.id, latest.get(row.id) ?? row);
  for (const [id, was] of held) {
    if (next.has(id) || gone.has(id)) continue;
    const now = latest.get(id);
    if (now) {
      if (!now.done) next.set(id, now);
    // Out of every list: an Attention email went Done; any other was read.
    } else if (was.lane !== 'attention') next.set(id, was.unread ? {...was, unread: false} : was);
  }
  return next;
}

/** Whether two holds have the same rows, so a render that changes nothing doesn't store a new one. */
export const sameHold = (a: ReadonlyMap<number, MessageRowOut>, b: ReadonlyMap<number, MessageRowOut>) =>
  a.size === b.size && [...a].every(([id, row]) => b.get(id) === row);

/**
 * A row's key in the list: "attention:12" in Attention or "all:12" in its day, so an email moving
 * between them (Done) folds out of one and into the other.
 */
export const listKey = (part: 'attention' | 'all', id: number) => `${part}:${id}`;
const stopOf = (part: 'attention' | 'all') => (row: MessageRowOut): Stop => ({key: listKey(part, row.id), kind: 'row', group: 'all', id: row.id});

const viewStops = (view: DayView): Stop[] => [
  ...view.lanes.flatMap(lane => lane.rows.map(({row}) => stopOf('all')(row))),
  ...(!view.noise ? [] : view.noise.open ? view.noise.rows.map(stopOf('all')) : [{key: noiseKey(view.date), kind: 'noise', date: view.date} satisfies Stop]),
];

/**
 * Where J and K stop, in the list's order: Attention's rows, the Pinned shelf's, then each day's as
 * its lanes show them, with a folded Noise line in place of its rows (Enter opens it).
 */
export const dayStops = (views: DayView[], shelf: MessageRowOut[] = [], attention: MessageRowOut[] = []): Stop[] => [
  ...attention.map(stopOf('attention')),
  ...shelf.map((row): Stop => ({key: rowKey('pinned', row.id), kind: 'row', group: 'pinned', id: row.id})),
  ...views.flatMap(viewStops),
];

/**
 * U (D449): the next unread email's stop after the cursor, in the list's order, from the top again
 * past the last one; from the top with no cursor. A folded Noise's emails have no stop, so U passes
 * them. Null when no unread email has one.
 */
export function nextUnread(stops: Stop[], cursor: string | null, unread: ReadonlySet<number>): string | null {
  const at = cursor === null ? -1 : stops.findIndex(stop => stop.key === cursor);
  const order = [...stops.slice(at + 1), ...stops.slice(0, at + 1)];
  return order.find(stop => stop.kind === 'row' && unread.has(stop.id))?.key ?? null;
}

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
