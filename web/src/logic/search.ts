// Search, Alfred's Answer card, the proposal card's and the calendar search's rules: what the field
// asks, the results line, each reason's parts, the highlighted runs, what the reader highlights,
// and how a proposal's time reads.
import {parseOperators, searchTokens} from '@setpoint/shared';
import type {AnswerItemOut, AnswerOut, AskContext, CalendarOut, Colour, ItemOut, ProposalItemOut, ProposalOut, AskStep, ProposalPrefillFailure, CalendarMatchReasonOut, CalendarSearchResultOut, HighlightOut, MatchReasonOut, SearchChip, SearchOut, SearchResultOut, SearchSuggestionOut, SourceProvider} from '@setpoint/shared';
import {timeRange} from './calendar.ts';
import {describeRule, describeTaskRepeat} from './compose.ts';
import {clockTime, localDate} from './format.ts';
import {placeName} from './place.ts';
import {reminderLines} from './reminders.ts';
import {refusalWords} from './providerWords.ts';
import type {IconName} from '../ui/glyphs.ts';
import type {Route} from './route.ts';

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
 * The reasons a mail result shows: only what its lines don't already show. A sender's or
 * organisation's goes when the sender line is highlighted, a subject's when the subject is, a body's
 * when the excerpt is, and a date's always (it's the row's own day, in its age column). Type, kind,
 * account and a body match the excerpt doesn't hold stay. With none left, the row has no why line.
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
  // A search that fell back to any word says so, rather than showing a near miss as a match.
  const count = out.partial && out.total
    ? ['No email has every word', `${out.total} ${out.total === 1 ? 'has' : 'have'} some of them`]
    : [`${out.total} ${out.total === 1 ? 'result' : 'results'}`];
  return [...count, ...(out.order === 'newest' ? ['newest first'] : [])];
}

/** How many results the list shows before its fold: all of them when none is about the search. */
export const firstSection = (out: Pick<SearchOut, 'total' | 'first_section'>) => out.first_section || out.total;

/**
 * What the list's end asks for as it nears (Search.tsx):
 * - the next page while the section above the fold is still paging, or the fold is open and its
 *   pages are
 * - else the rows left out under an open fold
 * - nothing once the section above a closed fold is all here, so the rows under it wait until it
 *   opens.
 */
export function nextAsk(out: Pick<SearchOut, 'total' | 'first_section' | 'next_offset'> | null, mentions: boolean, shown: number, moreLeftOut: boolean): 'more' | 'left-out' | null {
  const ended = out !== null && !mentions && shown >= firstSection(out);
  if (ended && !moreLeftOut) return null;
  return !ended && out?.next_offset != null ? 'more' : 'left-out';
}

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

// Fewer rows than this above the fold and search isn't sure of them, so it hides nothing.
export const FOLD_OPENS_UNDER = 5;

/** Whether a search's fold starts open: the first section is thin, and not empty, which is a plain list. */
export const foldStartsOpen = ({first_section}: Pick<SearchOut, 'first_section'>) => first_section > 0 && first_section < FOLD_OPENS_UNDER;

/** The fold of the search on screen. */
export interface MentionsFold {
  chips: string;
  text: string;
  open: boolean;
  // The user closed it.
  closed: boolean;
}

/**
 * The fold for an answer. The same search keeps its own, whatever a later page or new mail says. A
 * new one decides again, except that a fold the user closed stays closed while they refine the same
 * words (one's text starting the other's, the same chips), so typing doesn't undo the close.
 */
export function foldFor(before: MentionsFold | null, out: Pick<SearchOut, 'chips' | 'text' | 'first_section'> | null): MentionsFold | null {
  if (!out) return null;
  const chips = JSON.stringify(out.chips);
  const text = out.text.trim().toLowerCase();
  if (before?.chips === chips && before.text === text) return before;
  const refined = before?.closed && before.chips === chips && (text.startsWith(before.text) || before.text.startsWith(text));
  return refined ? {...before, text} : {chips, text, open: foldStartsOpen(out), closed: false};
}

/** The fold after a click or Enter on its line. */
export const toggledFold = (fold: MentionsFold): MentionsFold => ({...fold, open: !fold.open, closed: fold.open});

/** The fold's line: "12 more mention these words". */
export const mentionsLine = (more: number, partial: boolean) => `${more} more ${more === 1 ? 'mentions' : 'mention'} ${partial ? 'some of ' : ''}these words`;

/** The rows a suggestion's chips hid, as far as the user has asked for them. */
export interface LeftOut<R> {
  open: boolean;
  rows: readonly R[];
}

/**
 * The line under the results and its rows: `more` from the reading, less rows taken out meanwhile.
 * Like the fold, it waits for everything above it to load, then shows whether the fold is open or
 * not. The server's count, not the rows, since only an open line has any.
 */
export function leftOutSection<R extends {id: number}>(results: readonly R[], out: Pick<SearchOut, 'total' | 'first_section' | 'reading'> | null, left: LeftOut<R> | null, gone: ReadonlySet<number>): {more: number; rows: R[]} {
  const more = out?.reading?.more ?? 0;
  if (!out || !more || results.length < firstSection(out)) return {more: 0, rows: []};
  const rows = left?.rows ?? [];
  const here = rows.filter(row => !gone.has(row.id));
  return {more: more - (rows.length - here.length), rows: left?.open ? here : []};
}

/** The line itself: "6 more emails match your words", the same words a search of them would find. */
export const leftOutLine = (more: number) => `${more} more ${more === 1 ? 'email matches' : 'emails match'} your words`;

/** A chip that stood for words in the search: what a suggestion makes. A Not chip stands for no word in `typed`. */
export const standsForWords = (chip: SearchChip) => !chip.not && (chip.kind === 'organisation' || chip.kind === 'type' || chip.kind === 'date');

// Text with fewer letters or digits than this means too little to read: it's a word on its way.
const SUGGEST_MIN_LETTERS = 3;

/** A search's text as the suggestions the user turned down remember it. */
export const suggestionKey = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Whether a pause on the field's text asks for a suggestion. It doesn't with chips a suggestion left
 * in the field, which are the search's one reading. It doesn't for text too short to mean anything,
 * or for text the user turned one down for. A "!word"'s Not chip is what they typed, and doesn't
 * count.
 */
export const asksForSuggestion = (chips: readonly SearchChip[], text: string, declined: ReadonlySet<string>) =>
  !chips.some(standsForWords) && (text.match(/[\p{L}\p{N}]/gu)?.length ?? 0) >= SUGGEST_MIN_LETTERS && !declined.has(suggestionKey(text));

/** Tab or a click would apply this: the same chips, for the same number of rows. */
export const sameSuggestion = (a: SearchSuggestionOut | null, b: SearchSuggestionOut | null) => a?.total === b?.total && JSON.stringify(a?.chips) === JSON.stringify(b?.chips);

/** The suggestion's words: "Only Northwind Talent · Rejection" and "2 emails". */
export const suggestionLine = ({offers, total}: Pick<SearchSuggestionOut, 'offers' | 'total'>) => ({
  filters: `Only ${offers.map(chip => chip.label).join(' · ')}`,
  count: `${total} ${total === 1 ? 'email' : 'emails'}`,
});

const foldedWord = (word: string) => word.normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();

// As the server reads them: an operator whole (`from:"Sam Ortiz"`), a "quote", or a word.
const typedTokens = (text: string) => searchTokens(text).map(token => token.raw);

/**
 * The field's words once a chip comes off: the words as typed, but for those a chip still in force
 * says itself ("receipts" under Type Receipt), unless the reading kept them. So the word comes back
 * without the words the other chips still stand for.
 */
export function wordsBack(typed: string, text: string, left: readonly SearchChip[]): string {
  const kept = new Set(typedTokens(text));
  const says = (chip: SearchChip, word: string) => chip.label.split(/\s+/).some(part => {
    const own = foldedWord(part);
    return word !== '' && (own.startsWith(word) || word.startsWith(own));
  });
  return typedTokens(typed).filter(token => kept.has(token) || !left.some(chip => standsForWords(chip) && says(chip, foldedWord(token)))).join(' ');
}

// ---------- Operators ----------

/** Where the field marks its operators: each one the search filters by, whole, its `-` and quotes in it. */
export const operatorMarks = (text: string): Run[] => parseOperators(text).operators.map(({start, end}) => ({start, end}));

/** An operator the field offers values for, at the caret. */
export interface OperatorAt {
  start: number;
  end: number;
  not: boolean;
  name: 'from' | 'to' | 'has' | 'is';
  // What's typed of its value, up to the caret.
  query: string;
  // The token up to its value, its `-` where it was typed ("-from:", "from:-").
  head: string;
}

const OFFERING = /^([-!]?)(from|to|has|is):([-!]?)("?)([^"]*)$/i;

/** The from:, to:, has: or is: token the caret is in or just after, or null. subject:, before: and after: offer nothing. */
export function operatorAt(text: string, caret: number): OperatorAt | null {
  const token = searchTokens(text).find(one => one.start < caret && caret <= one.end);
  const match = token ? OFFERING.exec(text.slice(token.start, caret)) : null;
  if (!token || !match) return null;
  const [, before, name, after, , query] = match as unknown as [string, string, string, string, string, string];
  return {start: token.start, end: token.end, not: before !== '' || after !== '', name: name.toLowerCase() as OperatorAt['name'], query, head: `${before}${name}:${after}`};
}

const OPERATOR_VALUES = {has: ['attachment', 'file'], is: ['unread', 'read']} as const;

/** The values has: and is: take, those starting with what's typed. */
export const operatorValues = (name: 'has' | 'is', query: string): string[] => OPERATOR_VALUES[name].filter(value => value.startsWith(query.toLowerCase()));

/** The field with a pick in the operator's place, then a space, and the caret after it. */
export function withOperatorPick(text: string, at: Pick<OperatorAt, 'start' | 'end' | 'head'>, value: string): {text: string; caret: number} {
  const pick = `${at.head}${/\s/.test(value) ? `"${value}"` : value} `;
  return {text: `${text.slice(0, at.start)}${pick}${text.slice(at.end).replace(/^ +/, '')}`, caret: at.start + pick.length};
}

/** "Indexing · 62% · showing what's indexed so far", during the first backfill. */
export const indexingLine = (indexing: SearchOut['indexing']) =>
  indexing ? `Indexing · ${Math.round(indexing.progress * 100)}%, showing what’s indexed so far` : null;

/** A chip as words: its label, with "!" before a Not chip's ("!Confirmation"), which the grammar reads as the same chip. */
export const chipWords = (chip: SearchChip) => (chip.not ? `!${chip.label}` : chip.label);

/** The query as one phrase: the chips' labels, then the text ("Northwind · Rejection · Mar 2026"). */
export const queryParts = (chips: readonly SearchChip[], text: string) => [...chips.map(chipWords), ...(text.trim() ? [text.trim()] : [])];

/**
 * What ⌘Enter asks Alfred: the words in the field, in the order they were typed when the field
 * still knows it (`typed`), since a chip leaves the text where it formed and sits first. Without
 * that order, chips go back first as their words, which the grammar reads as the same chips.
 */
export const alfredQuestion = (chips: readonly SearchChip[], text: string, typed: string | null = null) =>
  typed?.trim() ? typed.trim() : queryParts(chips, text).join(' ');

/**
 * The field's words as typed, after its text went from `before` to `after` while it holds chips.
 * Typing on at the end keeps the order, a new word after chips that took every word. Any other edit
 * loses it (null), and it stays lost until the field holds no chips again.
 */
export function typedAfter(typed: string | null, before: string, after: string): string | null {
  if (typed === null || !after.startsWith(before)) return null;
  const gap = before === '' && after !== '' && typed !== '' && !/\s$/.test(typed) ? ' ' : '';
  return `${typed}${gap}${after.slice(before.length)}`;
}

/** Whether the field holds a search: chips, or words. */
export const isSearching = (chips: readonly unknown[], text: string) => chips.length > 0 || text.trim().length > 0;

/** An answer's text with its bold runs. */
export const answerSegments = (turn: Pick<AnswerOut, 'answer' | 'emphasis'>) => segments(turn.answer ?? '', turn.emphasis);

/**
 * What the reader highlights in the open email's body: the bold phrases of the answers it's a source
 * of (board 07), else the words the search matched in it (board 06).
 */
export function readerMarks(open: number | null, results: readonly SearchResultOut[], turns: readonly AnswerOut[]): string[] {
  if (open === null) return [];
  const cited = turns.filter(turn => turn.answer && turn.sources.some(source => source.message_id === open));
  if (cited.length) return cited.flatMap(turn => turn.emphasis.map(run => turn.answer!.slice(run.start, run.end)));
  return results.find(result => result.id === open)?.reasons.flatMap(reason => reason.matched) ?? [];
}

/** Whether the turn shows its question: every follow-up, and the first when it isn't in the search field. */
export const showsQuestion = (index: number, scoped: boolean) => index > 0 || scoped;

/**
 * What's on screen, for a question asked from ⌘K or the phone's button: the page, what's open there
 * (an email in a mail list, an item on the Calendar, an application on Jobs), and the dates in view.
 */
export function pageContext(route: Route, dates: {from: string; to: string} | null = null): AskContext {
  const context: AskContext = {page: route.page};
  if ((route.page === 'inbox' || route.page === 'sent' || route.page === 'snoozed') && route.open !== null) context.email_id = route.open;
  if (route.page === 'calendar' && route.item !== null) context.item = {id: route.item, at: route.at};
  if (route.page === 'jobs' && route.open !== null) context.application_id = route.open;
  if (dates) context.dates = dates;
  return context;
}

/** Couldn't find that: what Alfred searched, each phrase quoted ("Searched “lease renewal”"). */
export function searchedLine(searched: readonly string[]): string | null {
  if (!searched.length) return null;
  const quoted = searched.map(phrase => `“${phrase}”`);
  return `Searched ${quoted.length > 1 ? `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}` : quoted[0]}`;
}

/**
 * The Answer card while Alfred works: what it's doing, from the tool it last ran. Before its first,
 * it is reading the email a scoped card (Ask about this email) is about, or looking through the mail.
 */
export function alfredStepLine(step: AskStep | null, scoped = false): string {
  if (!step) return scoped ? 'Reading this email…' : 'Looking through your mail…';
  if (step.tool === 'search_mail') return `Searching “${step.query}”…`;
  if (step.tool === 'get_email') return `Reading ${step.from}’s email…`;
  if (step.tool === 'list_items') return 'Checking your calendar…';
  if (step.tool === 'search_calendar') return `Searching your calendar for “${step.query}”…`;
  if (step.tool === 'propose_change') return 'Preparing a change…';
  if (step.tool === 'search_jobs') return step.query ? `Searching your applications for “${step.query}”…` : 'Looking through your applications…';
  if (step.tool === 'get_application') return `Reading ${step.company}’s application…`;
  if (step.tool === 'list_needs_you') return 'Reading Needs you…';
  if (step.tool === 'jobs_for_emails') return 'Matching emails to applications…';
  if (step.tool === 'propose_fix') return 'Preparing a fix…';
  return `Preparing the ${step.kind}…`;
}

/** A step Alfred has finished, in its trail: its tool's glyph and what it did, in the past tense. */
export function alfredStepDone(step: AskStep): {icon: IconName; text: string} {
  if (step.tool === 'search_mail') return {icon: 'search', text: `Searched “${step.query}”`};
  if (step.tool === 'get_email') return {icon: 'mail', text: `Read ${step.from}’s email`};
  if (step.tool === 'list_items') return {icon: 'calendar_today', text: 'Checked your calendar'};
  if (step.tool === 'search_calendar') return {icon: 'calendar_today', text: `Searched your calendar for “${step.query}”`};
  if (step.tool === 'propose_change') return {icon: 'edit', text: 'Prepared a change'};
  if (step.tool === 'search_jobs') return {icon: 'work', text: step.query ? `Searched your applications for “${step.query}”` : 'Looked through your applications'};
  if (step.tool === 'get_application') return {icon: 'work', text: `Read ${step.company}’s application`};
  if (step.tool === 'list_needs_you') return {icon: 'work', text: 'Read Needs you'};
  if (step.tool === 'jobs_for_emails') return {icon: 'work', text: 'Matched emails to applications'};
  if (step.tool === 'propose_fix') return {icon: 'work', text: 'Prepared a fix'};
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

/**
 * The names holding what's typed, any case, best first: those starting with it, then those
 * with a word starting with it, then the rest, each in list order. All of them for nothing typed.
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

/** The projects Project's menu offers for what's typed: those whose name holds it, any case, best first (rankMatches). All of them for nothing typed. */
export const projectMatches = <T extends {name: string}>(text: string, projects: T[]): T[] => rankMatches(text, projects, project => project.name);

/** Whether what's typed names a project exactly, any case, so the menu offers no New project. */
export const namesProject = (text: string, projects: {name: string}[]) => projects.some(project => project.name.toLowerCase() === text.trim().toLowerCase());

/**
 * Project's menu for what's typed: the matching projects, then New project for a name none has
 * exactly, unless it's already picked as new.
 */
export const projectMenu = (text: string, projects: {name: string}[], isNew: boolean): {name: string; isNew: boolean}[] => [
  ...projectMatches(text, projects).map(project => ({name: project.name, isNew: false})),
  ...(text.trim() && !isNew && !namesProject(text, projects) ? [{name: text.trim(), isNew: true}] : []),
];

/**
 * A task proposal's project as Create sends it. None typed is Settings' default. A project's name in
 * any case is that project. A new one is made only when the user picked New project, and otherwise
 * the card says so rather than guessing.
 */
export function projectChoice(text: string, projects: {name: string}[], create: boolean): {project: string | null; create_project: boolean} | {problem: string} {
  const name = text.trim();
  if (!name) return {project: null, create_project: false};
  const found = projects.find(project => project.name.toLowerCase() === name.toLowerCase());
  if (found) return {project: found.name, create_project: false};
  return create ? {project: name, create_project: true} : {problem: `No project named “${name}”, pick one or create it`};
}

/** A failed Create, in the provider's own sentence ("The calendar is read-only."), or its trouble ("Todoist is down"). */
/** How long a proposal's fields wait for the model before they unlock with the rules' prefill. */
export const PREFILL_WAIT_MS = 1500;

/** Why a proposal's prefill didn't come: too slow, Setpoint out of reach, or the server's failure. */
export type PrefillMiss = {slow: true} | {unreachable: true} | ProposalPrefillFailure;

/**
 * The red line in a proposal's head when its prefill didn't come, with Anthropic's status when it
 * refused ("Failed to prefill, Claude didn't answer (529)"), and on hover what that means.
 */
export function prefillMissLine(miss: PrefillMiss): {line: string; tip: string | null} {
  if ('slow' in miss) return {line: 'Failed to prefill, Claude took too long', tip: 'No answer within 1.5 s, so the fields are filled from the email by Setpoint'};
  if ('unreachable' in miss) return {line: 'Failed to prefill, can’t reach Setpoint', tip: null};
  if (miss.reason === 'unusable') return {line: 'Failed to prefill, Claude’s answer was unusable', tip: 'Its answer had no title Setpoint could use'};
  if (miss.reason === 'unreachable' || miss.status === null) return {line: 'Failed to prefill, can’t reach Anthropic', tip: 'Anthropic didn’t answer in time, or couldn’t be reached'};
  const status = miss.status;
  const tip = status === 429 ? 'Rate limited: Anthropic is limiting requests for now'
    : status === 529 ? 'Anthropic is overloaded right now'
      : status >= 500 ? 'Trouble on Anthropic’s side'
        : status === 401 || status === 403 ? 'Anthropic refused the key. Check it in Settings › AI'
          : 'Anthropic refused the request';
  return {line: `Failed to prefill, Claude didn’t answer (${status})`, tip};
}

export const failedLine = (provider: SourceProvider | null, message: string | null) => refusalWords(provider, message, 'It wasn’t created.');

// ---------- Calendar search ----------

/** Before typing, the calendar's search says what it finds. */
export const CALENDAR_SEARCH_HINT = 'Search events and tasks by title, place, people or calendar, or a date like ‘march’';

/** The results under Upcoming, then Past, leaving out an empty heading. */
export function calendarResultGroups<R extends Pick<CalendarSearchResultOut, 'upcoming'>>(results: readonly R[]): {heading: 'Upcoming' | 'Past'; results: R[]}[] {
  return ([['Upcoming', true], ['Past', false]] as const)
    .map(([heading, upcoming]) => ({heading, results: results.filter(result => result.upcoming === upcoming)}))
    .filter(group => group.results.length > 0);
}

/** A result's day in the row's time column: "Oct 9", with the year under it outside this one. */
/**
 * An Answer card item row's when: "Fri, Oct 9 · 7:00 PM", the day alone for one all day or
 * untimed, its year when it isn't this year's, and "No date" for a task without one.
 */
export function answerItemWhen(item: Pick<AnswerItemOut, 'date' | 'start'>, now: number, timeZone: string): string {
  if (!item.date) return 'No date';
  const year = item.date.slice(0, 4) === localDate(now, timeZone).slice(0, 4) ? {} : {year: 'numeric'} as const;
  const day = new Date(`${item.date}T12:00:00Z`).toLocaleDateString('en-US', {weekday: 'short', month: 'short', day: 'numeric', ...year, timeZone: 'UTC'});
  return item.start ? `${day} · ${clockTime(item.start, timeZone)}` : day;
}

export function resultDay(date: string, today: string): {day: string; year: string | null} {
  const day = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'});
  return {day, year: date.slice(0, 4) === today.slice(0, 4) ? null : date.slice(0, 4)};
}

/**
 * A result's line under its title, as the agenda's: an event's time, its series' rule as the editor
 * words it ("Weekly on Mon, Wed") and its place or calendar. A task's time, repeat and project.
 */
export function calendarResultLine(result: Pick<CalendarSearchResultOut, 'item' | 'rule' | 'date'>, calendar: string | undefined, timeZone: string): string {
  const {item} = result;
  const parts = item.kind === 'task'
    ? [item.due_at ? clockTime(item.due_at, timeZone) : null, item.repeat ? describeTaskRepeat(item.repeat) : null, item.project]
    : [timeRange(item, timeZone), result.rule ? describeRule(result.rule, result.date) : null, placeName(item) ?? calendar];
  return parts.filter(Boolean).join(' · ');
}

/**
 * The calendar field's words before the last when its text doesn't end in a space ("classes" and
 * "october"), or null when there's only one word or a "quote" is still open.
 */
export function finishedWords(text: string): {words: string; last: string} | null {
  const match = /^(.*\S)\s+(\S+)$/s.exec(text.trimStart());
  if (!match || (match[1]!.split('"').length - 1) % 2 === 1) return null;
  return {words: `${match[1]!} `, last: match[2]!};
}

/**
 * Where a proposal would go, for the phone's proposal card: an event's calendar (the one it names,
 * else the editor's fallback, the first visible Google calendar the user can write to) with its
 * colour, or a task's project (Settings' default, else Todoist's Inbox, when it names none). Null
 * while the calendars are still on their way, or with none to write to.
 */
export function proposalHome(item: Pick<ProposalItemOut, 'kind' | 'calendar_id' | 'project'>, calendars: readonly CalendarOut[] | undefined, defaultProject: string | null): {name: string; colour: Colour | null} | null {
  if (item.kind === 'task') return {name: item.project ?? defaultProject ?? 'Todoist', colour: null};
  if (!calendars) return null;
  const google = calendars.filter(calendar => calendar.listed && calendar.provider === 'google' && calendar.writable);
  const calendar = google.find(one => one.id === item.calendar_id) ?? google.find(one => one.visible) ?? google[0];
  return calendar ? {name: calendar.name, colour: calendar.colour} : null;
}

/** An item's day for its repeat's words: its start's or due day. */
const repeatDay = (item: Pick<ProposalItemOut, 'start_date' | 'starts_at' | 'due_date' | 'time_zone'>, timeZone: string) =>
  item.start_date ?? (item.starts_at ? localDate(item.starts_at, item.time_zone ?? timeZone) : item.due_date) ?? localDate(Date.now(), timeZone);

type Summed = Pick<ProposalItemOut, 'kind' | 'start_date' | 'starts_at' | 'due_date' | 'time_zone' | 'recurrence' | 'repeat' | 'reminders' | 'leave_reminder'>;

/** One item's summary parts for the fields asked: its repeat, reminders and Time to Leave. */
function summaryParts(item: Summed, fields: {repeat: boolean; reminders: boolean; leave: boolean}, timeZone: string): string[] {
  const parts: string[] = [];
  if (fields.repeat) parts.push(item.kind === 'event' ? describeRule(item.recurrence ?? null, repeatDay(item, timeZone)) : describeTaskRepeat(item.repeat ?? null));
  if (fields.reminders) {
    const lines = reminderLines(item.reminders ?? [], null, timeZone).map(line => line.text);
    parts.push(lines.length ? lines.join(', ') : 'No reminders');
  }
  if (fields.leave) parts.push(item.leave_reminder ? 'Time to Leave' : 'No Time to Leave');
  return parts;
}

/**
 * Alfred's chip's summary line under the place: the repeat, reminders and Time to Leave he set, as
 * "Weekly on Tuesday · 30 min before · Time to Leave", only those he set. A change says them as they
 * become and, struck under it, as they were. Null when he set none of them.
 */
export function proposalSummary(proposal: ProposalOut, timeZone: string): {now: string; was: string | null} | null {
  const {change} = proposal;
  const changed = change ? Object.keys(change.changes) : [];
  const set = proposal.alfred ?? [];
  const fields = change
    ? {repeat: changed.includes('recurrence') || changed.includes('repeat'), reminders: changed.includes('reminders'), leave: changed.includes('leave_reminder')}
    : {repeat: set.includes('repeat'), reminders: set.includes('reminders'), leave: set.includes('leave_reminder')};
  if (!fields.repeat && !fields.reminders && !fields.leave) return null;
  const now = summaryParts(proposal.item, fields, timeZone).join(' · ');
  const was = change ? summaryParts(change.item as ItemOut & Summed, fields, timeZone).join(' · ') : null;
  return {now, was: was && was !== now ? was : null};
}

/** An answer's proposal by its turn and place in it, as the server knows it. */
export interface ShownProposal {
  turn_id: number;
  index: number;
  proposal: ProposalOut;
}

/**
 * Each turn's proposals the Answer card shows. One replaced by a later answer goes, as one already
 * created or saved when the thread was read back does (its chip folded away then). In the thread
 * as it stands, a later turn's proposal replaces an earlier one not acted on here (`acted`, by
 * "turn:index"), as the server does, so the card agrees before a reload.
 */
export function shownProposals(turns: AnswerOut[], acted: ReadonlySet<string>): ShownProposal[][] {
  return turns.map((_, at) => standing(turns, at, acted));
}

/**
 * Whether a turn's proposal was replaced by a later one (its answer line then reads as past, muted):
 * it had one, none stands, and none was created or saved.
 */
export function replacedTurns(turns: AnswerOut[], acted: ReadonlySet<string>): boolean[] {
  return turns.map((turn, at) => turn.proposals.length > 0 && !standing(turns, at, acted).length
    && turn.proposals.every((proposal, index) => !proposal.acted && !acted.has(`${turn.turn_id}:${index}`)));
}

function standing(turns: AnswerOut[], at: number, acted: ReadonlySet<string>): ShownProposal[] {
  const turn = turns[at]!;
  const later = turns.slice(at + 1).some(next => next.proposals.length > 0);
  return turn.proposals.flatMap((proposal, index) => {
    const key = `${turn.turn_id}:${index}`;
    if (proposal.replaced || proposal.acted || (later && !acted.has(key))) return [];
    return [{turn_id: turn.turn_id, index, proposal}];
  });
}
