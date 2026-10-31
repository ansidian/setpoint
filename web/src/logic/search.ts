// Search, Alfred's Answer card and the proposal card's rules (DESIGN.md › Search, Alfred's Answer
// card, Proposal; SV-23's calendar search): what the field asks, the results line, each reason's parts, the highlighted runs,
// what the reader highlights, and how a proposal's time reads.
import type {AnswerOut, AskStep, CalendarMatchReasonOut, CalendarSearchResultOut, HighlightOut, MatchReasonOut, ProposalItemOut, SearchChip, SearchOut, SearchResultOut, SourceProvider} from '@setpoint/shared';
import {timeRange} from './calendar.ts';
import {describeRule, describeTaskRepeat} from './compose.ts';
import {addDays, clockTime, instantAt, localDate, minutesOf} from './format.ts';
import {placeName} from './place.ts';
import type {IconName} from '../ui/glyphs.ts';

export interface Run {
  start: number;
  end: number;
}

export interface Segment {
  text: string;
  mark: boolean;
}

/**
 * A text cut into plain and highlighted parts. Runs that overlap, touch or have only spaces between
 * them become one mark ("Lease renewal", as the boards draw it).
 */
export function segments(text: string, runs: readonly Run[]): Segment[] {
  const merged: Run[] = [];
  for (const run of [...runs].filter(item => item.end > item.start).sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && /^\s*$/.test(text.slice(last.end, run.start))) last.end = Math.max(last.end, run.end);
    else if (last && run.start < last.end) last.end = Math.max(last.end, run.end);
    else merged.push({...run});
  }
  const out: Segment[] = [];
  let at = 0;
  for (const run of merged) {
    if (run.start > at) out.push({text: text.slice(at, run.start), mark: false});
    out.push({text: text.slice(run.start, run.end), mark: true});
    at = run.end;
  }
  if (at < text.length || !out.length) out.push({text: text.slice(at), mark: false});
  return out;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every place a phrase starts a word, ignoring case ("Northwind", "$2,140", "Oct 31, 2026"). */
export function phraseRuns(text: string, phrases: readonly string[]): Run[] {
  const runs: Run[] = [];
  for (const phrase of phrases) {
    if (!phrase.trim()) continue;
    for (const match of text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}])${escape(phrase.trim())}`, 'giu'))) runs.push({start: match.index, end: match.index + match[0].length});
  }
  return runs;
}

/** The sender a result row shows (its organisation, else its name), with that field's highlights. */
export function resultSender(result: Pick<SearchResultOut, 'organisation' | 'from_name' | 'highlights'>): Segment[] {
  const field: HighlightOut['field'] = result.organisation ? 'organisation' : 'from_name';
  return segments(result.organisation ?? result.from_name, result.highlights.filter(run => run.field === field));
}

export const fieldSegments = (result: Pick<SearchResultOut, 'subject' | 'excerpt' | 'highlights'>, field: 'subject' | 'excerpt') =>
  segments(result[field], result.highlights.filter(run => run.field === field));

/**
 * The reasons a mail result shows (polish audit search-11): only what its lines don't already show. A
 * sender's or organisation's goes when the sender line is highlighted, a subject's when the subject is,
 * a body's when the excerpt is, and a date's always (it's the row's own day, in its age column). Type,
 * kind, account and a body match the excerpt doesn't hold stay. None left, the row has no why line.
 */
export function shownReasons(result: Pick<SearchResultOut, 'reasons' | 'highlights' | 'organisation'>): MatchReasonOut[] {
  const marked = (field: HighlightOut['field']) => result.highlights.some(run => run.field === field && run.end > run.start);
  const senderField: HighlightOut['field'] = result.organisation ? 'organisation' : 'from_name';
  return result.reasons.filter(reason => {
    if (reason.field === 'sender' || reason.field === 'organisation') return !marked(senderField);
    if (reason.field === 'subject') return !marked('subject');
    if (reason.field === 'body') return !marked('excerpt');
    return reason.field !== 'date';
  });
}

/** The same for a calendar result: its title's when the title is highlighted, and its date's always (the row's day column). */
export function shownCalendarReasons(result: Pick<CalendarSearchResultOut, 'reasons' | 'highlights'>): CalendarMatchReasonOut[] {
  return result.reasons.filter(reason => !(reason.field === 'title' && result.highlights.length > 0) && reason.field !== 'date');
}

/** "Org Northwind" → Org, Northwind: the label's first word is its kind (`ink3`), the rest what matched. */
export function reasonParts(label: string): {key: string; value: string} {
  const space = label.indexOf(' ');
  return space < 0 ? {key: label, value: ''} : {key: label.slice(0, space), value: label.slice(space + 1)};
}

/** The results line's parts: "2 results", then "newest first" when chips order them so (the calendar's have no order). */
export function resultsLine(out: Pick<SearchOut, 'total'> & Partial<Pick<SearchOut, 'order' | 'partial'>>): string[] {
  // A search that fell back to any word says so, rather than showing a near miss as a match (UX #10).
  const count = out.partial && out.total
    ? ['No email has every word', `${out.total} ${out.total === 1 ? 'has' : 'have'} some of them`]
    : [`${out.total} ${out.total === 1 ? 'result' : 'results'}`];
  return [...count, ...(out.order === 'newest' ? ['newest first'] : [])];
}

/** How many results the list shows before its fold: all of them when none is about the search. */
export const firstSection = (out: Pick<SearchOut, 'total' | 'first_section'>) => out.first_section || out.total;

/**
 * The results as the list shows them: those about the search, then, once they're all here, a fold
 * with how many `more` only mention it, and their rows once it's `open`. The server's order runs
 * straight through, so a result's index among all the results is its place in the list however it's
 * folded. `gone` are rows taken out meanwhile (Trash), which leave a section without moving the fold.
 */
export function resultSections<R extends {id: number}>(results: readonly R[], out: Pick<SearchOut, 'total' | 'first_section'> | null, open: boolean, gone: ReadonlySet<number>): {about: R[]; more: number; mentions: R[]} {
  const first = out ? firstSection(out) : results.length;
  const here = (result: R) => !gone.has(result.id);
  const about = results.slice(0, first).filter(here);
  if (results.length < first) return {about, more: 0, mentions: []};
  const after = results.slice(first);
  const mentions = after.filter(here);
  return {about, more: (out?.total ?? results.length) - first - (after.length - mentions.length), mentions: open ? mentions : []};
}

/** The fold's line: "12 more mention these words". */
export const mentionsLine = (more: number, partial: boolean) => `${more} more ${more === 1 ? 'mentions' : 'mention'} ${partial ? 'some of ' : ''}these words`;

/** "Indexing · 62% · showing what's indexed so far", during the first backfill. */
export const indexingLine = (indexing: SearchOut['indexing']) =>
  indexing ? `Indexing · ${Math.round(indexing.progress * 100)}% · showing what’s indexed so far` : null;

/** A chip as words: its label, with "!" before a Not chip's ("!Confirmation"), which the grammar reads as the same chip. */
export const chipWords = (chip: SearchChip) => (chip.not ? `!${chip.label}` : chip.label);

/** The query as one phrase: the chips' labels, then the text ("Northwind · Rejection · Mar 2026"). */
export const queryParts = (chips: readonly SearchChip[], text: string) => [...chips.map(chipWords), ...(text.trim() ? [text.trim()] : [])];

/**
 * What ⌘Enter asks Alfred: the words in the field, in the order they were typed when the field still
 * knows it (`typed`), since a chip leaves the text where it formed and sits first. Without that order,
 * chips go back first as their words, which the grammar reads as the same chips.
 */
export const alfredQuestion = (chips: readonly SearchChip[], text: string, typed: string | null = null) =>
  typed?.trim() ? typed.trim() : queryParts(chips, text).join(' ');

/**
 * The field's words as typed, after its text went from `before` to `after` while it holds chips.
 * Typing on at the end keeps the order; any other edit loses it (null), and it stays lost until the
 * field holds no chips again.
 */
export const typedAfter = (typed: string | null, before: string, after: string): string | null =>
  typed !== null && after.startsWith(before) ? typed + after.slice(before.length) : null;

/** Whether the field holds a search: chips, or words. */
export const isSearching = (chips: readonly unknown[], text: string) => chips.length > 0 || text.trim().length > 0;

/** An answer's text with its bold runs. */
export const answerSegments = (turn: Pick<AnswerOut, 'answer' | 'emphasis'>) => segments(turn.answer ?? '', turn.emphasis);

/**
 * What the reader highlights in the open email's body: the bold phrases of the answers it's a source
 * of (board 07); else the words the search matched in it (board 06).
 */
export function readerMarks(open: number | null, results: readonly SearchResultOut[], turns: readonly AnswerOut[]): string[] {
  if (open === null) return [];
  const cited = turns.filter(turn => turn.answer && turn.sources.some(source => source.message_id === open));
  if (cited.length) return cited.flatMap(turn => turn.emphasis.map(run => turn.answer!.slice(run.start, run.end)));
  return results.find(result => result.id === open)?.reasons.flatMap(reason => reason.matched) ?? [];
}

/** Whether the turn shows its question: every follow-up, and the first when it isn't in the search field. */
export const showsQuestion = (index: number, scoped: boolean) => index > 0 || scoped;

/** Couldn't find that: what Alfred searched, each phrase quoted ("Searched “lease renewal”"). */
export function searchedLine(searched: readonly string[]): string | null {
  if (!searched.length) return null;
  const quoted = searched.map(phrase => `“${phrase}”`);
  return `Searched ${quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}` : quoted[0]}`;
}

/**
 * The Answer card while Alfred works: what it's doing, from the tool it last ran; before its first,
 * reading the email a scoped card (Ask about this email) is about, or looking through the mail.
 */
export function alfredStepLine(step: AskStep | null, scoped = false): string {
  if (!step) return scoped ? 'Reading this email…' : 'Looking through your mail…';
  if (step.tool === 'search_mail') return `Searching “${step.query}”…`;
  if (step.tool === 'get_email') return `Reading ${step.from}’s email…`;
  if (step.tool === 'list_items') return 'Checking your calendar…';
  return `Preparing the ${step.kind}…`;
}

/** A step Alfred has finished, in its trail (search-04): its tool's glyph and what it did, in the past tense. */
export function alfredStepDone(step: AskStep): {icon: IconName; text: string} {
  if (step.tool === 'search_mail') return {icon: 'search', text: `Searched “${step.query}”`};
  if (step.tool === 'get_email') return {icon: 'mail', text: `Read ${step.from}’s email`};
  if (step.tool === 'list_items') return {icon: 'calendar_today', text: 'Checked your calendar'};
  return {icon: 'event', text: `Prepared the ${step.kind}`};
}

/** The trail with the step Alfred is on now: added when it differs from the last, so a step asked about twice shows once. */
export function withStep(trail: readonly AskStep[], step: AskStep | null): AskStep[] {
  if (!step) return [...trail];
  const last = trail.at(-1);
  return last && JSON.stringify(last) === JSON.stringify(step) ? [...trail] : [...trail, step];
}

const SOURCES_SHOWN = 5;

/** A turn's sources: the first five and "Show all 26", or every one and "Show fewer". */
export function shownSources<T>(sources: readonly T[], all: boolean): {shown: T[]; more: string | null} {
  if (sources.length <= SOURCES_SHOWN) return {shown: [...sources], more: null};
  return all ? {shown: [...sources], more: 'Show fewer'} : {shown: sources.slice(0, SOURCES_SHOWN), more: `Show all ${sources.length}`};
}

// An event the email gave a start and no end lasts an hour, as the editor's do.
const DEFAULT_LENGTH = 60;

const onDay = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {...options, timeZone: 'UTC'});

/** A proposal's day as its field shows it: "Wed, Dec 9"; another year's "Wed, Dec 9, 2027". */
export function proposalDay(date: string, now: number, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {weekday: 'short', month: 'short', day: 'numeric'};
  return onDay(date, date.startsWith(localDate(now, timeZone).slice(0, 4)) ? options : {...options, year: 'numeric'});
}

/** A proposal's day and times as its fields hold them: minutes after the day's midnight, null for all day or no time; no day when the email gave none. */
export interface ProposalWhen {
  date: string | null;
  start: number | null;
  end: number | null;
}

export function proposalWhen(item: ProposalItemOut, timeZone: string): ProposalWhen {
  const zone = item.time_zone ?? timeZone;
  if (item.kind === 'task') return {date: item.due_date, start: item.due_at ? minutesOf(item.due_at, zone) : null, end: null};
  if (item.all_day || !item.starts_at) return {date: item.all_day ? item.start_date : null, start: null, end: null};
  const start = minutesOf(item.starts_at, zone);
  const length = item.ends_at ? Math.round((Date.parse(item.ends_at) - Date.parse(item.starts_at)) / 60_000) : DEFAULT_LENGTH;
  return {date: localDate(item.starts_at, zone), start, end: start + length};
}

/** The proposal's item on the day and at the times the user left in its fields (SV-24); an all-day event keeps its length in days. */
export function proposalAt(item: ProposalItemOut, when: ProposalWhen & {date: string}, timeZone: string): ProposalItemOut {
  const zone = item.time_zone ?? timeZone;
  if (item.kind === 'task') return {...item, due_date: when.date, due_at: when.start === null ? null : instantAt(when.date, when.start, zone)};
  if (when.start === null) {
    const days = item.all_day && item.start_date && item.end_date ? Math.max(1, Math.round((Date.parse(item.end_date) - Date.parse(item.start_date)) / 86_400_000)) : 1;
    return {...item, all_day: true, starts_at: null, ends_at: null, start_date: when.date, end_date: addDays(when.date, days)};
  }
  return {...item, all_day: false, starts_at: instantAt(when.date, when.start, zone), ends_at: instantAt(when.date, when.end ?? when.start + DEFAULT_LENGTH, zone), start_date: null, end_date: null};
}

/**
 * The names holding what's typed, any case, best first (SV-56): those starting with it, then those
 * with a word starting with it, then the rest, each in list order; all of them for nothing typed.
 * The line reads "#ho" as the name it starts, so the menu's first row is the one it reads.
 */
export function rankMatches<T>(text: string, list: T[], name: (one: T) => string): T[] {
  const typed = text.trim().toLowerCase();
  const tier = (one: T): number | null => {
    const lower = name(one).toLowerCase();
    if (lower.startsWith(typed)) return 0;
    let at = lower.indexOf(typed, 1);
    if (at < 0) return null;
    for (; at >= 0; at = lower.indexOf(typed, at + 1)) if (!/[\p{L}\p{N}]/u.test(lower[at - 1]!)) return 1;
    return 2;
  };
  return list.map(one => ({one, tier: tier(one)}))
    .filter((entry): entry is {one: T; tier: number} => entry.tier !== null)
    .sort((a, b) => a.tier - b.tier)
    .map(entry => entry.one);
}

/** The projects Project's menu offers for what's typed: those whose name holds it, any case, best first (rankMatches); all of them for nothing typed. */
export const projectMatches = <T extends {name: string}>(text: string, projects: T[]): T[] => rankMatches(text, projects, project => project.name);

/** Whether what's typed names a project exactly, any case, so the menu offers no New project. */
export const namesProject = (text: string, projects: {name: string}[]) => projects.some(project => project.name.toLowerCase() === text.trim().toLowerCase());

/**
 * Project's menu for what's typed: the matching projects, then New project for a name none has
 * exactly, unless it's already picked as new (SV-25).
 */
export const projectMenu = (text: string, projects: {name: string}[], isNew: boolean): {name: string; isNew: boolean}[] => [
  ...projectMatches(text, projects).map(project => ({name: project.name, isNew: false})),
  ...(text.trim() && !isNew && !namesProject(text, projects) ? [{name: text.trim(), isNew: true}] : []),
];

/**
 * A task proposal's project as Create sends it (SV-24, D50): none typed is Settings' default; a
 * project's name in any case is that project; a new one is made only when the user picked New project,
 * and otherwise the card says so rather than guessing.
 */
export function projectChoice(text: string, projects: {name: string}[], create: boolean): {project: string | null; create_project: boolean} | {problem: string} {
  const name = text.trim();
  if (!name) return {project: null, create_project: false};
  const found = projects.find(project => project.name.toLowerCase() === name.toLowerCase());
  if (found) return {project: found.name, create_project: false};
  return create ? {project: name, create_project: true} : {problem: `No project named “${name}”, pick one or create it`};
}

/** The reminder choices on the proposal card, in minutes before; Settings' default is chosen first. */
export const REMINDER_CHOICES = [0, 10, 30, 60, 1440] as const;

const PROVIDER_NAMES: Record<SourceProvider, string> = {gmail: 'Gmail', icloud: 'iCloud', google_calendar: 'Google Calendar', todoist: 'Todoist', weather: 'Weather'};

/** A failed Create, with the provider's own words: "Google Calendar, The calendar is read-only. (403)". */
export const failedLine = (provider: SourceProvider | null, message: string | null) =>
  [provider ? PROVIDER_NAMES[provider] : null, message ?? 'It wasn’t created.'].filter(Boolean).join(', ');

// ---------- SV-23: calendar search ----------

/** Before typing, the calendar's search says what it finds (DESIGN.md › Decided while building #24). */
export const CALENDAR_SEARCH_HINT = 'Search events and tasks by title, place, people or calendar, or a date like ‘march’';

/** The results under Upcoming, then Past, leaving out an empty heading. */
export function calendarResultGroups<R extends Pick<CalendarSearchResultOut, 'upcoming'>>(results: readonly R[]): {heading: 'Upcoming' | 'Past'; results: R[]}[] {
  return ([['Upcoming', true], ['Past', false]] as const)
    .map(([heading, upcoming]) => ({heading, results: results.filter(result => result.upcoming === upcoming)}))
    .filter(group => group.results.length > 0);
}

/** A result's day in the row's time column: "Oct 9", with the year under it outside this one. */
export function resultDay(date: string, today: string): {day: string; year: string | null} {
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
  return {day, year: date.slice(0, 4) === today.slice(0, 4) ? null : date.slice(0, 4)};
}

/**
 * A result's line under its title, as the agenda's: an event's time, its series' rule as the editor
 * words it ("Weekly on Mon, Wed") and its place or calendar; a task's time, repeat and project.
 */
export function calendarResultLine(result: Pick<CalendarSearchResultOut, 'item' | 'rule' | 'date'>, calendar: string | undefined, timeZone: string): string {
  const {item} = result;
  const parts = item.kind === 'task'
    ? [item.due_at ? clockTime(item.due_at, timeZone) : null, item.repeat ? describeTaskRepeat(item.repeat) : null, item.project]
    : [timeRange(item, timeZone), result.rule ? describeRule(result.rule, result.date) : null, placeName(item) ?? calendar];
  return parts.filter(Boolean).join(' · ');
}

/**
 * The words before the last when the field's text doesn't end in a space ("northwind rejection" and
 * "march"), or null when there's only one word or a "quote" is still open.
 */
export function finishedWords(text: string): {words: string; last: string} | null {
  const match = /^(.*\S)\s+(\S+)$/s.exec(text.trimStart());
  if (!match || (match[1]!.split('"').length - 1) % 2 === 1) return null;
  return {words: `${match[1]!} `, last: match[2]!};
}
