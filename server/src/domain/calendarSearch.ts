// Calendar search (DESIGN.md › Decided while building #24; darma SV-23 D48): the field's words become
// date chips (mail's grammar) and calendar chips (a calendar's name; "Todoist" is every task's), and
// the rest is free text over each item's title, place and address, attendees, calendar, and Todoist
// project and labels, with mail's matching (every word as a prefix with its plural, then any word but
// filler). Results come Upcoming soonest first, then Past most recent first.
//
// A recurring event is one row: its next occurrence, or its last once it has ended (within the date
// chips, when there are any). An occurrence changed on its own gets its own row only when the change
// is what matched, that is when it matches and its series doesn't. Hidden calendars are left out, as
// the grid leaves them out.
//
// Pure: the caller reads the items and calendars and presents the hits.
import type {CalendarMatchReasonOut, CalendarSearchChip} from '@setpoint/shared';
import {occurrenceDates, parseRule} from './recurrence.ts';
import {bareMonth, dateChip, dayLabel, fold, parseChips, wordsOf} from './searchChips.ts';
import {hasTerm, mergeRuns, termRuns, textLadder} from './searchMatch.ts';
import {addDays, localDay, localTime, zonedInstant} from './time.ts';

/** An item as the database holds it, with what search reads. */
export interface SearchItem {
  id: number;
  calendarId: number;
  kind: 'event' | 'task';
  title: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  startDate: string | null;
  endDate: string | null;
  dueDate: string | null;
  timeZone: string | null;
  recurrence: string | null;
  place: string | null;
  address: string | null;
  attendees: string[] | null;
  project: string | null;
  labels: string[] | null;
  recurringItemId: number | null;
  originalStart: string | null;
  cancelled: boolean;
  expanded: boolean;
}

export interface Clock {
  now: string;
  timeZone: string;
}

/** The field's words as chips: a date or range first, as mail's grammar reads them, then a calendar's name. */
export function parseCalendarQuery(text: string, calendars: string[], {now, timeZone}: Clock): {chips: CalendarSearchChip[]; text: string} {
  const today = localDay(now, timeZone);
  return parseChips<CalendarSearchChip>(text, (words, raw) => {
    const date = dateChip(words, raw, today);
    // A month's name alone, other than this month, is both its last and its coming one: two chips, either of which matches (D51).
    if (date && bareMonth(words) && date.from.slice(0, 7) !== today.slice(0, 7)) {
      const coming = String(Number(date.from.slice(0, 4)) + 1);
      return [{kind: 'date', ...date}, {kind: 'date', ...dateChip([...words, coming], `${raw} ${coming}`, today)!}];
    }
    if (date) return {kind: 'date', ...date};
    const phrase = words.join(' ');
    const name = calendars.find(calendar => wordsOf(calendar).length > 0 && wordsOf(calendar).join(' ') === phrase);
    return name ? {kind: 'calendar', value: name, label: name} : null;
  });
}

/** One occurrence: the row it is, a rule occurrence's start and end, its span as instants, and its local day. */
interface Occurrence<R extends SearchItem = SearchItem> {
  row: R;
  occurrence: {start: string; end: string} | null;
  from: string;
  to: string;
  day: string;
}

function single<R extends SearchItem>(row: R, timeZone: string): Occurrence<R> {
  if (row.kind === 'task') {
    return {row, occurrence: null, from: zonedInstant(row.dueDate!, '00:00', timeZone), to: zonedInstant(addDays(row.dueDate!, 1), '00:00', timeZone), day: row.dueDate!};
  }
  if (row.allDay) return {row, occurrence: null, from: zonedInstant(row.startDate!, '00:00', timeZone), to: zonedInstant(row.endDate!, '00:00', timeZone), day: row.startDate!};
  return {row, occurrence: null, from: row.startsAt!, to: row.endsAt!, day: localDay(row.startsAt!, timeZone)};
}

// How far ahead a series' next occurrence is looked for.
const HORIZON_DAYS = 1100;

/** A series' occurrences up to `horizon` (a local date), as the grid expands them, skipping those its exceptions replace. */
function ruleOccurrences<R extends SearchItem>(row: R, horizon: string, replaced: Set<string>, timeZone: string): Occurrence<R>[] {
  const zone = row.timeZone ?? timeZone;
  const duration = Date.parse(row.endsAt!) - Date.parse(row.startsAt!);
  const first = localDay(row.startsAt!, zone);
  const rule = parseRule(row.recurrence!, until => localDay(until, zone));
  // A rule the expander doesn't cover shows its first occurrence, as on the grid.
  const dates = rule ? occurrenceDates(rule, first, first, horizon) : [first];
  const time = localTime(row.startsAt!, zone);
  return dates.flatMap(date => {
    const start = zonedInstant(date, time, zone);
    // UNTIL is inclusive of an occurrence starting exactly then (RFC 5545).
    if (replaced.has(start) || (rule?.untilAt && start > rule.untilAt)) return [];
    const end = new Date(Date.parse(start) + duration).toISOString();
    return [{row, occurrence: {start, end}, from: start, to: end, day: localDay(start, timeZone)}];
  });
}

/** A row that stands for a series: Google expands it (its occurrences are rows), or its rule does. */
const isSeries = (row: SearchItem) => row.kind === 'event' && (row.expanded || (!row.allDay && row.recurrence !== null));

/** Every occurrence of a top-level row, its changed ones included, in order. */
function occurrencesOf<R extends SearchItem>(row: R, children: R[], horizon: string, timeZone: string): Occurrence<R>[] {
  if (!isSeries(row)) return [single(row, timeZone)];
  // A deleted occurrence only takes its start out of the rule's.
  const own = children.filter(child => !child.cancelled).map(child => single(child, timeZone));
  const generated = row.expanded ? [] : ruleOccurrences(row, horizon, new Set(children.map(child => child.originalStart!)), timeZone);
  return [...generated, ...own].sort((a, b) => a.from.localeCompare(b.from));
}

const FIELDS = [
  {field: 'title', key: 'Title', values: (row: SearchItem) => [row.title]},
  {field: 'place', key: 'Place', values: (row: SearchItem) => (row.place ? [row.place] : [])},
  {field: 'address', key: 'Address', values: (row: SearchItem) => (row.address ? [row.address] : [])},
  {field: 'attendees', key: 'With', values: (row: SearchItem) => row.attendees ?? []},
  {field: 'calendar', key: 'Calendar', values: (_row: SearchItem, calendar: string) => [calendar]},
  {field: 'project', key: 'Project', values: (row: SearchItem) => (row.project ? [row.project] : [])},
  {field: 'labels', key: 'Label', values: (row: SearchItem) => row.labels ?? []},
] as const;

/** A title's own words that match the terms, as it writes them ("Dinner"). */
const titleWords = (title: string, terms: string[]) => (title.match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => terms.some(term => hasTerm(word, term))).join(' ');

/**
 * Why the row matches the free text, each term under the first field it's in, or null when it
 * doesn't: every term must match (`and`), or any (`or`).
 */
export function textReasons(row: SearchItem, calendar: string, terms: string[], mode: 'and' | 'or'): CalendarMatchReasonOut[] | null {
  const told = new Set<string>();
  const reasons: CalendarMatchReasonOut[] = [];
  for (const {field, key, values: valuesOf} of FIELDS) {
    const values = valuesOf(row, calendar);
    const fresh = terms.filter(term => !told.has(term) && values.some(value => hasTerm(value, term)));
    if (!fresh.length) continue;
    fresh.forEach(term => told.add(term));
    const value = field === 'title' ? titleWords(row.title, fresh) : values.filter(item => fresh.some(term => hasTerm(item, term))).join(', ');
    reasons.push({field, key, value, runs: mergeRuns(termRuns(value, fresh))});
  }
  const matched = mode === 'and' ? told.size === terms.length : told.size > 0;
  return matched ? reasons : null;
}

export interface CalendarHit<R extends SearchItem = SearchItem> {
  // The row the result shows, and a series' occurrence when the row is the series itself.
  row: R;
  occurrence: {start: string; end: string} | null;
  day: string;
  // When it starts, for the order.
  from: string;
  upcoming: boolean;
  // The series' rule, when the hit stands for a series.
  rule: string | null;
  reasons: CalendarMatchReasonOut[];
  highlights: {start: number; end: number}[];
}

/** The hits for chips and free text, Upcoming soonest first, then Past most recent first. */
export function searchItems<R extends SearchItem>(rows: R[], calendars: Map<number, string>, chips: CalendarSearchChip[], text: string, clock: Clock): CalendarHit<R>[] {
  const ladder = textLadder(text);
  if (!chips.length && !ladder.length) return [];
  for (const step of ladder.length ? ladder : [{terms: [], mode: 'and' as const}]) {
    const hits = collect(rows, calendars, chips, step.terms, step.mode, clock);
    if (hits.length) return hits;
  }
  return [];
}

function collect<R extends SearchItem>(rows: R[], calendars: Map<number, string>, chips: CalendarSearchChip[], terms: string[], mode: 'and' | 'or', {now, timeZone}: Clock): CalendarHit<R>[] {
  const today = localDay(now, timeZone);
  const shown = rows.filter(row => calendars.has(row.calendarId));
  // Each series' changed and deleted occurrences.
  const children = new Map<number, R[]>();
  for (const row of shown) if (row.recurringItemId !== null) children.set(row.recurringItemId, [...children.get(row.recurringItemId) ?? [], row]);

  const named = chips.flatMap(chip => (chip.kind === 'calendar' ? [fold(chip.value)] : []));
  const ranges = chips.flatMap(chip => (chip.kind === 'date' ? [[zonedInstant(chip.from, '00:00', timeZone), zonedInstant(chip.to, '00:00', timeZone)] as const] : []));
  const lastChipDay = chips.reduce((last, chip) => (chip.kind === 'date' && chip.to > last ? chip.to : last), today);
  const horizon = addDays(lastChipDay, HORIZON_DAYS);
  const inRange = (span: Occurrence<R>) => !ranges.length || ranges.some(([from, to]) => span.from < to && span.to > from);

  /** The calendar chip's reason and the free text's for a row, or null when it doesn't match them (dates aside). */
  const matchOf = (row: SearchItem): {chip: CalendarMatchReasonOut[]; text: CalendarMatchReasonOut[]} | null => {
    const calendar = calendars.get(row.calendarId)!;
    if (named.length && !named.includes(fold(calendar))) return null;
    const text = terms.length ? textReasons(row, calendar, terms, mode) : [];
    if (!text) return null;
    if (!named.length) return {chip: [], text};
    return {chip: [{field: 'calendar', key: 'Calendar', value: calendar, runs: []}], text: text.filter(reason => reason.field !== 'calendar')};
  };

  const hits: CalendarHit<R>[] = [];
  // Chips first (calendar, then date), then the free text, as mail's reasons go.
  const add = (occurrence: Occurrence<R>, {chip, text}: NonNullable<ReturnType<typeof matchOf>>, rule: string | null) => {
    const date: CalendarMatchReasonOut[] = ranges.length ? [{field: 'date', key: 'Date', value: dayLabel(occurrence.day, today), runs: []}] : [];
    hits.push({
      row: occurrence.row, occurrence: occurrence.occurrence, day: occurrence.day, from: occurrence.from, upcoming: occurrence.to > now, rule,
      reasons: [...chip, ...date, ...text], highlights: mergeRuns(termRuns(occurrence.row.title, terms)),
    });
  };

  for (const top of shown) {
    if (top.recurringItemId !== null || top.cancelled) continue;
    const own = children.get(top.id) ?? [];
    const reasons = matchOf(top);
    if (reasons) {
      const occurrences = occurrencesOf(top, own, horizon, timeZone).filter(inRange);
      const pick = occurrences.find(occurrence => occurrence.to > now) ?? occurrences.at(-1);
      if (pick) add(pick, reasons, isSeries(top) ? top.recurrence : null);
      continue;
    }
    // The series doesn't match: an occurrence changed on its own may, by what changed.
    for (const child of own) {
      if (child.cancelled) continue;
      const childReasons = matchOf(child);
      const occurrence = single(child, timeZone);
      if (childReasons && inRange(occurrence)) add(occurrence, childReasons, null);
    }
  }
  const upcoming = hits.filter(hit => hit.upcoming).sort((a, b) => a.from.localeCompare(b.from) || a.row.title.localeCompare(b.row.title));
  const past = hits.filter(hit => !hit.upcoming).sort((a, b) => b.from.localeCompare(a.from) || a.row.title.localeCompare(b.row.title));
  return [...upcoming, ...past];
}
