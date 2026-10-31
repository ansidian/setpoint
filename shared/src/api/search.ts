// Search and Alfred (BRIEF.md › Search and Alfred; DESIGN.md › Search, Alfred's Answer card and
// Proposal). B1 wrote the first shapes; B4 built them and changed them where noted.
//
//   POST /api/search                        SearchInput        SearchOut
//   POST /api/search/opened                 SearchOpenedInput  204 (the search log's "opened result N")
//   POST /api/search/chip-removed           SearchChipRemovedInput 204 (the search log's "chip removed")
//   POST /api/alfred/ask                    AskInput           AnswerOut
//   GET  /api/alfred/conversations/:id                         ConversationOut (the thread so far)
//   GET  /api/alfred/asks/:ask_id                              AskStepOut (what Alfred is doing for it)
//   POST /api/proposals/from-message        ProposalInput      ProposalOut (Add to calendar / Add as task)
//   POST /api/calendar/search               CalendarSearchInput CalendarSearchOut (SV-23)
//
// Nothing here creates anything: a proposal's `item` is what POST /api/items takes, and only Create
// sends it.
import {z} from 'zod';
import {ITEM_KINDS, KINDS, MESSAGE_TYPES, SEARCH_CHIP_KINDS, SEARCH_READS} from '../enums.ts';
import type {CalendarMatchField, ItemKind, MatchField, SearchChipKind, SearchReadingFallback} from '../enums.ts';
import {id, localDate} from './common.ts';
import type {ItemOut} from './items.ts';
import type {MessageRowOut} from './mail.ts';

// A day or range in the owner's zone, end exclusive: "Mar 2026" is 2026-03-01 to 2026-04-01.
const dateChipSchema = z.strictObject({kind: z.literal('date'), from: localDate, to: localDate, label: z.string().min(1)});

// SV-31: a mail chip typed after "!" ("!confirmation") leaves out what it matches: "Not Type Confirmation ×".
const not = {not: z.literal(true).optional()};

/**
 * A recognised word, as a chip in the field: "Org Northwind ×", "Type Rejection ×", "Date Mar 2026
 * ×", an account, a kind. `value` is what it filters on; `label` is what it shows. Chips of one kind
 * are alternatives (Org Northwind or Org Fabrikam); different kinds all apply. A Not chip leaves out
 * whatever it matches, whatever else is in force.
 */
export const searchChipSchema = z.discriminatedUnion('kind', [
  // `value` is the organisation's leading words as typed and capitalised ("Northwind"); it matches
  // every organisation whose name starts with those words ("Northwind Talent", "Northwind Engineering").
  z.strictObject({kind: z.literal('organisation'), value: z.string().min(1), label: z.string().min(1), ...not}),
  z.strictObject({kind: z.literal('type'), value: z.enum(MESSAGE_TYPES), label: z.string().min(1), ...not}),
  dateChipSchema.extend(not),
  z.strictObject({kind: z.literal('account'), value: id, label: z.string().min(1), ...not}),
  z.strictObject({kind: z.literal('kind'), value: z.enum(KINDS), label: z.string().min(1), ...not}),
]);
export type SearchChip = z.infer<typeof searchChipSchema>;
export type SearchChipKindCheck = SearchChip['kind'] extends SearchChipKind ? true : never;
export const searchChipKindSchema = z.enum(SEARCH_CHIP_KINDS);

export const MAX_SEARCH_CHIPS = 10;

/**
 * The field: the chips it already shows, and the text typed after them. Words stay words, a date's
 * too (D385, SV-139), so a phone sending only `text` gets keyword results and no filter it can't see.
 * A word after "!" leaves out what it names: a Not chip, or, staying text, the mail that has it.
 * Words in "quotes" always stay text.
 * A later page of the same search passes `search_id` and `offset` (`next_offset` from the last page).
 *
 * SV-138: `read` is D385's Enter, and only a request that says so can reach the model, so typing
 * never does. `ask` reads the search: dates from the grammar, organisations and types from the
 * model, as `chips`, with `text` the keywords left and `reading.typed` the words as typed. With
 * `kept` or `left_out` the client sends those back and nothing is read again: `text` and `chips` for
 * a later page, `typed` as well for what the chips left out. A chip removed puts the word it stood
 * for back in `text`, from `reading.typed`, so it's a word again.
 */
export const searchInput = z.strictObject({
  text: z.string().max(500),
  chips: z.array(searchChipSchema).max(MAX_SEARCH_CHIPS).default([]),
  // The sidebar's account, when search runs inside one (as an account chip would).
  account_id: id.optional(),
  limit: z.int().min(1).max(200).default(50),
  // B4: paging.
  offset: z.int().min(0).default(0),
  search_id: id.optional(),
  read: z.enum(SEARCH_READS).optional(),
  // With `read`: the words as typed, which the chips' "more" number counts from. `text` when left out.
  typed: z.string().max(500).optional(),
});
export type SearchInput = z.input<typeof searchInput>;

/**
 * Why a result matched, in DESIGN.md's one case style: "Org Northwind", "Type Rejection", "Date Mar
 * 14", "Subject lease renewal", "Body signed". `matched` holds the words to highlight.
 */
export interface MatchReasonOut {
  field: MatchField;
  label: string;
  matched: string[];
}

/** A highlighted run (`sun` at 26%): UTF-16 offsets, end exclusive, into the result's own field. */
export interface HighlightOut {
  field: 'from_name' | 'organisation' | 'subject' | 'excerpt';
  start: number;
  end: number;
}

export interface SearchResultOut extends MessageRowOut {
  // Chips first (org, type, date, account, kind), then the text: sender, subject, body.
  reasons: MatchReasonOut[];
  // B4: the body around the first highlighted word, with "…" where it's cut; the body's start when
  // no word is in the body.
  excerpt: string;
  highlights: HighlightOut[];
}

/**
 * SV-138: how a search with `read` was read. `used` is 'reading' when the model's reading was applied
 * or kept, even one that made no chip, and 'words' for the plain word results, with `fallback` saying
 * why.
 */
export interface SearchReadingOut {
  used: 'reading' | 'words';
  fallback: SearchReadingFallback | null;
  // Emails matching the words the chips left out: "6 more emails match your words". `read: 'left_out'` lists them.
  more: number;
  // The words as typed, without the dates that became chips: `typed` on the next request.
  typed: string;
}

export interface SearchOut {
  // The search log's id, for SearchOpenedInput and later pages.
  search_id: number;
  // Every chip in force (the input's and the ones the text became), so the field can show them.
  chips: SearchChip[];
  // Free text left after the chips.
  text: string;
  // B4: "newest" when any chip is in force (chips filter exactly; "2 results · newest first"); "match"
  // for free text alone, ordered by how well the words matched, each tier newest first (SV-137).
  // A reading's chips narrow and keep that order (SV-138).
  order: 'newest' | 'match';
  // B4: every match; `results` is this page of them.
  total: number;
  // SV-137: how many of the matches, from the top, are about the search. The rest only mention it
  // and may be folded away ("12 more mention these words"). `total` when nothing's in the second
  // section, and 0 when everything is, which shows as a plain list.
  first_section: number;
  // No email had every word, so these have some of them ("No email has every word · 1 has some of
  // them", UX #10).
  partial: boolean;
  results: SearchResultOut[];
  // B4: the next page's offset, or null on the last page.
  next_offset: number | null;
  // During the first backfill: "Indexing · 62% · showing what's indexed so far".
  indexing: {progress: number} | null;
  // SV-138: null unless the request had `read`.
  reading: SearchReadingOut | null;
}

/** The search log: which result was opened, and where it was in the list (0-based). */
export const searchOpenedInput = z.strictObject({search_id: id, message_id: id, position: z.int().min(0)});

/** The search log: a chip the user took off a search (SV-138), so a wrong reading can be seen. */
export const searchChipRemovedInput = z.strictObject({search_id: id, chip: searchChipSchema});

/**
 * Alfred: a question, a follow-up in the same conversation (`conversation_id`), or one scoped to an
 * open email (`message_id`, Ask about this email). A follow-up keeps its conversation's scope.
 */
export const askInput = z.strictObject({
  question: z.string().trim().min(1).max(2000),
  conversation_id: id.optional(),
  message_id: id.optional(),
  // The page's own id for this question, to ask what Alfred is doing while it waits.
  ask_id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

/** What Alfred is doing for a question: the tool it last ran, or nothing before its first. */
export type AskStep =
  | {tool: 'search_mail'; query: string}
  | {tool: 'get_email'; from: string}
  | {tool: 'list_items'}
  | {tool: 'propose_item'; kind: 'event' | 'task'};

export interface AskStepOut {
  step: AskStep | null;
}

/** An email Alfred's answer rests on; clicking it opens the email in the reading pane. */
export interface AnswerSourceOut {
  message_id: number;
  account_id: number;
  subject: string;
  organisation: string | null;
  from_name: string;
  received_at: string;
  // B4: the row's pin glyph (board 07).
  pinned: boolean;
}

/** Where a proposal's fields came from: each one listed here gets the "from the email" mark. */
export const PROPOSAL_FIELDS = ['title', 'date', 'time', 'place'] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];

/**
 * B4 (replaces B1's flat fields): the item a proposal would create, as POST /api/items takes it, so
 * Create sends it (as the user edited it) and More options opens it in the editor. Fields the email
 * didn't give are null: an event with no time is all day, and one with no date has none yet (the
 * card asks for it). `reminders` is left out, so Settings' default applies.
 */
export interface ProposalItemOut {
  kind: ItemKind;
  calendar_id: number | null;
  title: string;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  due_date: string | null;
  due_at: string | null;
  time_zone: string;
  place: string | null;
  // A task's Todoist project.
  project: string | null;
}

/**
 * A pre-filled event or task the user reviews before anything is created (board 08). `conflict` is "Free
 * that evening" or "Overlaps Study group · 1h 30m" for an event with a date, null otherwise.
 */
export interface ProposalOut {
  kind: ItemKind;
  message_id: number;
  item: ProposalItemOut;
  from_email: ProposalField[];
  conflict: {free: boolean; label: string} | null;
}
export const proposalKindSchema = z.enum(ITEM_KINDS);

/** Bold runs in an answer ("By **Oct 31, 2026**, …"): UTF-16 offsets into `answer`, end exclusive. */
export interface EmphasisOut {
  start: number;
  end: number;
}

export interface AnswerOut {
  conversation_id: number;
  turn_id: number;
  // B4: the question this turn answers, for the thread.
  question: string;
  // One or two lines; null when Alfred couldn't find it ("Couldn't find that in your mail").
  answer: string | null;
  // B4.
  emphasis: EmphasisOut[];
  sources: AnswerSourceOut[];
  // What it searched ("Northwind · Rejection · Mar 2026", "lease renewal"), said when it couldn't answer.
  searched: string[];
  proposals: ProposalOut[];
}

/** B4: GET /api/alfred/conversations/:id, the short thread so far, oldest turn first. */
export interface ConversationOut {
  conversation_id: number;
  // The email it's scoped to (Ask about this email), or null.
  message_id: number | null;
  turns: AnswerOut[];
}

/** POST /api/proposals/from-message: Add to calendar / Add as task, pre-filled from the email. */
export const proposalInput = z.strictObject({message_id: id, kind: z.enum(ITEM_KINDS)});

// ---- SV-23: calendar search (DESIGN.md › Decided while building #24) ----

/**
 * A calendar search's chips: a date or range, as mail's, and a calendar by name ("Classes"; "Todoist"
 * covers every task). `value` is the calendar's name as it writes it; it matches every calendar of
 * that name (one shared with two accounts is on both). Chips of one kind are alternatives.
 */
export const calendarSearchChipSchema = z.discriminatedUnion('kind', [
  dateChipSchema,
  z.strictObject({kind: z.literal('calendar'), value: z.string().min(1), label: z.string().min(1)}),
]);
export type CalendarSearchChip = z.infer<typeof calendarSearchChipSchema>;

/** The field as mail's: the chips it shows and the text after them. A later page passes `offset`. */
export const calendarSearchInput = z.strictObject({
  text: z.string().max(500),
  chips: z.array(calendarSearchChipSchema).max(10).default([]),
  limit: z.int().min(1).max(200).default(50),
  offset: z.int().min(0).default(0),
});
export type CalendarSearchInput = z.input<typeof calendarSearchInput>;

/**
 * Why a calendar result matched: "Place Blue Door", "With Sam Lee", "Calendar Classes", "Date Oct 9".
 * `key` shows in `ink3`, `value` after it with `runs` (UTF-16 offsets into `value`, end exclusive)
 * highlighted (a chip's reason has none). A title's value is the title's own words that matched.
 */
export interface CalendarMatchReasonOut {
  field: CalendarMatchField;
  key: string;
  value: string;
  runs: {start: number; end: number}[];
}

export interface CalendarSearchResultOut {
  // The occurrence the row shows, as the grid draws it (its `key` is the grid's): a series' next
  // occurrence, or its last once it has ended.
  item: ItemOut;
  // Its local day, where a click scrolls the grid.
  date: string;
  // Under Upcoming (not over yet) or Past.
  upcoming: boolean;
  // A recurring event's rule ("RRULE:FREQ=WEEKLY;BYDAY=MO,WE") when the row stands for its series;
  // null for one item, or an occurrence changed on its own.
  rule: string | null;
  // Chips first (calendar, date), then free text: title, place, address, attendees, calendar, project, labels.
  reasons: CalendarMatchReasonOut[];
  // Runs in `item.title` to highlight.
  highlights: {start: number; end: number}[];
}

export interface CalendarSearchOut {
  // Every chip in force, and the free text left after them.
  chips: CalendarSearchChip[];
  text: string;
  // Every match, for "14 results"; Upcoming come first (soonest first), then Past (most recent first).
  total: number;
  results: CalendarSearchResultOut[];
  next_offset: number | null;
}
