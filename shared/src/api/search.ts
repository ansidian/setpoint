// Search and Alfred: the search, Alfred's Answer card and its proposals.
//
//   POST /api/search                        SearchInput        SearchOut
//   POST /api/search/suggestion             SearchSuggestionInput SearchSuggestOut (a reading of the field, offered as a suggestion)
//   POST /api/search/suggestion-log         SearchSuggestionLogInput 204 (the search log's "shown" and "accepted")
//   POST /api/search/opened                 SearchOpenedInput  204 (the search log's "opened result N")
//   POST /api/search/chip-removed           SearchChipRemovedInput 204 (the search log's "chip removed")
//   POST /api/alfred/ask                    AskInput           AnswerOut
//   GET  /api/alfred/conversations/:id                         ConversationOut (the thread so far)
//   GET  /api/alfred/asks/:ask_id                              AskStepOut (what Alfred is doing for it)
//   POST /api/alfred/acted                  AlfredActedInput   204 (a proposal's Create or Save went through, or a fix applied or undone)
//   POST /api/proposals/from-message        ProposalInput      ProposalOut (Add to calendar / Add as task)
//   POST /api/proposals/prefill             ProposalInput      ProposalPrefillOut (the same, filled by a model)
//   POST /api/calendar/search               CalendarSearchInput CalendarSearchOut
//
// Nothing here creates anything: a proposal's `item` is what POST /api/items takes, and only Create
// sends it.
import {z} from 'zod';
import {ITEM_KINDS, KINDS, MESSAGE_TYPES, SEARCH_READS} from '../enums.ts';
import type {CalendarMatchField, EventColour, ItemKind, MatchField, RecurringScope, SearchChipKind} from '../enums.ts';
import {id, instant, localDate} from './common.ts';
import type {ItemChanges, ItemOut} from './items.ts';
import type {Recipient} from '../message.ts';
import type {MessageRowOut} from './mail.ts';

// A day or range in the owner's zone, end exclusive: "Mar 2026" is 2026-03-01 to 2026-04-01.
const dateChipSchema = z.strictObject({kind: z.literal('date'), from: localDate, to: localDate, label: z.string().min(1)});

// A mail chip typed after "!" or "-" ("!confirmation") leaves out what it matches: "Not Type Confirmation ×".
const not = {not: z.literal(true).optional()};

/**
 * A recognised word, as a chip in the field: "Org Northwind ×", "Type Rejection ×", "Date Mar 2026
 * ×", an account, a kind. `value` is what it filters on, and `label` is what it shows. Chips of one
 * kind are alternatives (Org Northwind or Org Fabrikam). Different kinds all apply. A Not chip leaves out
 * whatever it matches, whatever else is in force.
 */
export const searchChipSchema = z.discriminatedUnion('kind', [
  // `value` is the organisation's leading words as typed and capitalised ("Northwind"). It matches
  // every organisation whose name starts with those words ("Northwind Talent", "Northwind
  // Engineering").
  z.strictObject({kind: z.literal('organisation'), value: z.string().min(1), label: z.string().min(1), ...not}),
  z.strictObject({kind: z.literal('type'), value: z.enum(MESSAGE_TYPES), label: z.string().min(1), ...not}),
  dateChipSchema.extend(not),
  z.strictObject({kind: z.literal('account'), value: id, label: z.string().min(1), ...not}),
  z.strictObject({kind: z.literal('kind'), value: z.enum(KINDS), label: z.string().min(1), ...not}),
]);
export type SearchChip = z.infer<typeof searchChipSchema>;
export type SearchChipKindCheck = SearchChip['kind'] extends SearchChipKind ? true : never;

export const MAX_SEARCH_CHIPS = 10;

/**
 * The field: the chips it already shows, and the text typed after them. Words stay words, a date's
 * too, so a phone sending only `text` gets keyword results and no filter it can't see. A word
 * after "!" or "-" leaves out what it names: a Not chip, or, staying text, the mail that has it. Words in
 * "quotes" always stay text.
 * A later page of the same search passes `search_id` and `offset` (`next_offset` from the last page).
 *
 * With `read` the chips are ones a suggestion made, and nothing is read: `kept` applies them, `left_out`
 * lists what they hid. `typed` is the words as typed, which rank and which the "more" number counts
 * from (`SearchSuggestionOut.typed`, then what's typed after it). A chip removed puts the word it
 * stood for back in `text`, so it's a word again.
 */
/** Sent mail in a search: with received mail (the Inbox's search), or alone (Sent's). Left out by default. */
export const SEARCH_SENT = ['include', 'only'] as const;
export type SearchSent = (typeof SEARCH_SENT)[number];

export const searchInput = z.strictObject({
  text: z.string().max(500),
  chips: z.array(searchChipSchema).max(MAX_SEARCH_CHIPS).default([]),
  // The sidebar's account, when search runs inside one (as an account chip would).
  account_id: id.optional(),
  // Mail the user sent to others, only when asked. Mail to yourself is received mail, and is found
  // either way.
  sent: z.enum(SEARCH_SENT).optional(),
  limit: z.int().min(1).max(200).default(50),
  // Paging.
  offset: z.int().min(0).default(0),
  search_id: id.optional(),
  read: z.enum(SEARCH_READS).optional(),
  // With `read`: the words as typed, which rank and which the "more" number counts from. `text` when left out.
  typed: z.string().max(500).optional(),
});
export type SearchInput = z.input<typeof searchInput>;

/**
 * Why a result matched, in sentence case: "Org Northwind", "Type Rejection", "Date Mar
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
  // On sent-only mail (`sent_only`): who it went to, null while Setpoint hasn't read its headers.
  to?: Recipient[] | null;
  cc?: Recipient[] | null;
  // Chips first (org, type, date, account, kind), then the text: sender, subject, body.
  reasons: MatchReasonOut[];
  // The body around the first highlighted word, with "…" where it's cut. It's the body's start
  // when no word is in the body.
  excerpt: string;
  highlights: HighlightOut[];
}

/** What a search with `read` says of its chips. */
export interface SearchReadingOut {
  // Emails matching the words the chips left out: "6 more emails match your words". `read: 'left_out'` lists them.
  more: number;
  // The words as typed: `typed` on the next request.
  typed: string;
}

export interface SearchOut {
  // The search log's id, for SearchOpenedInput and later pages.
  search_id: number;
  // Every chip in force: the input's and a "!word"'s.
  chips: SearchChip[];
  // Free text left after the chips.
  text: string;
  // "newest" with no words to order by ("2 results · newest first"), or for Alfred's search with a
  // chip. "match" for words, ordered by how well they matched, each tier newest first. A
  // reading's chips narrow and keep that order.
  order: 'newest' | 'match';
  // Every match. `results` is this page of them.
  total: number;
  // How many of the matches, from the top, are about the search. The rest only mention it
  // and may be folded away ("12 more mention these words"). `total` when nothing's in the second
  // section, and 0 when everything is, which shows as a plain list.
  first_section: number;
  // No email had every word, so these have some of them ("No email has every word · 1 has some of
  // them").
  partial: boolean;
  results: SearchResultOut[];
  // The next page's offset, or null on the last page.
  next_offset: number | null;
  // During the first backfill: "Indexing · 62%, showing what's indexed so far".
  indexing: {progress: number} | null;
  // Null unless the request had `read`.
  reading: SearchReadingOut | null;
}

/**
 * Asks for a suggestion for the field's exact text. Only this route can reach the model. With
 * `model: false` it says at once what the date grammar alone would suggest, and whether a reading is
 * worth asking for (`reads`). With `model` it answers with both. `chips` are the field's Not chips.
 */
export const searchSuggestionInput = z.strictObject({
  text: z.string().max(500),
  chips: z.array(searchChipSchema).max(MAX_SEARCH_CHIPS).default([]),
  account_id: id.optional(),
  model: z.boolean().default(true),
});
export type SearchSuggestionInput = z.input<typeof searchSuggestionInput>;

/**
 * What the field would become, all of it here so that accepting asks the model nothing: POST
 * /api/search with `read: 'kept'` and these. "Only Northwind Talent · 7 emails".
 */
export interface SearchSuggestionOut {
  // The search log's row for it, for SearchSuggestionLogInput.
  id: number;
  // Every chip in force once accepted, and the words left after them.
  chips: SearchChip[];
  text: string;
  // The words as typed, `typed` on later requests, and those words less any a date chip stands for,
  // which is what a chip's × gives back while a date chip stays.
  typed: string;
  undated: string;
  // The chips this adds to the field, as the suggestion's words.
  offers: SearchChip[];
  // Rows it would leave, the word results' rows it would hide, and how many rows those are.
  total: number;
  hides: number;
  words: number;
}

export interface SearchSuggestOut {
  suggestion: SearchSuggestionOut | null;
  // After `model: false`: a reading might add to this, so it's worth asking with `model`.
  reads: boolean;
}

/** The search log: a suggestion on screen, or accepted, and the search that accepting ran. */
export const searchSuggestionLogInput = z.strictObject({
  id,
  event: z.enum(['shown', 'accepted']),
  search_id: id.optional(),
});

/** The search log: which result was opened, and where it was in the list (0-based). */
export const searchOpenedInput = z.strictObject({search_id: id, message_id: id, position: z.int().min(0)});

/** The search log: a chip the user took off a search, so a wrong reading can be seen. */
export const searchChipRemovedInput = z.strictObject({search_id: id, chip: searchChipSchema});

/** The pages Alfred can be asked from (⌘K, the phone's button). */
export const ASK_PAGES = ['inbox', 'sent', 'drafts', 'snoozed', 'scheduled', 'calendar', 'news', 'jobs', 'settings'] as const;
export type AskPage = (typeof ASK_PAGES)[number];

/**
 * What was on screen when a thread's first question was asked from ⌘K or the phone's button: the
 * page, what's open there (an email, a calendar item by its id and occurrence, a job application),
 * and on the Calendar the dates in view.
 */
export const askContextSchema = z.strictObject({
  page: z.enum(ASK_PAGES),
  email_id: id.optional(),
  item: z.strictObject({id, at: instant.nullable()}).optional(),
  application_id: id.optional(),
  dates: z.strictObject({from: localDate, to: localDate}).optional(),
});
export type AskContext = z.infer<typeof askContextSchema>;

/**
 * Alfred: a question, a follow-up in the same conversation (`conversation_id`), or one scoped to an
 * open email (`message_id`, Ask about this email). A follow-up keeps its conversation's scope. A
 * thread's first question can carry what was on screen (`context`), and a follow-up the fix on
 * screen (`fix`), so "this" is that fix.
 */
export const askInput = z.strictObject({
  question: z.string().trim().min(1).max(2000),
  conversation_id: id.optional(),
  message_id: id.optional(),
  context: askContextSchema.optional(),
  // A follow-up asked while one of the thread's fixes is on screen: that fix, by its turn and place.
  fix: z.strictObject({turn_id: id, index: z.int().min(0).max(20)}).optional(),
  // The page's own id for this question, to ask what Alfred is doing while it waits.
  ask_id: z.string().regex(/^[A-Za-z0-9-]{8,64}$/).optional(),
});

/** What Alfred is doing for a question: the tool it last ran, or nothing before its first. */
export type AskStep =
  | {tool: 'search_mail'; query: string}
  | {tool: 'get_email'; from: string}
  | {tool: 'list_items'}
  | {tool: 'search_calendar'; query: string}
  | {tool: 'propose_item'; kind: 'event' | 'task'}
  | {tool: 'propose_change'}
  | {tool: 'search_jobs'; query: string | null}
  | {tool: 'get_application'; company: string}
  | {tool: 'list_needs_you'}
  | {tool: 'jobs_for_emails'}
  | {tool: 'propose_fix'};

export interface AskStepOut {
  step: AskStep | null;
}

/** An email Alfred's answer rests on. Clicking it opens the email in the reading pane. */
export interface AnswerSourceOut {
  message_id: number;
  account_id: number;
  subject: string;
  organisation: string | null;
  from_name: string;
  received_at: string;
  // The row's pin glyph (board 07).
  pinned: boolean;
}

/**
 * A calendar event or task an answer rests on, as list_items or search_calendar gave it: its row
 * opens the item on the calendar. `date` is its local day (null for a task with no date), `start`
 * the instant it starts (or a task is due), null when all-day or untimed. `occurrence_start` names
 * a recurring item's occurrence.
 */
export interface AnswerItemOut {
  key: string;
  id: number;
  kind: ItemKind;
  calendar_id: number;
  title: string;
  date: string | null;
  start: string | null;
  all_day: boolean;
  occurrence_start: string | null;
}

/** Where a proposal's fields came from: each one listed here gets the "from the email" mark. */
export const PROPOSAL_FIELDS = ['title', 'date', 'time', 'place'] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];

/**
 * The item a proposal would create, as POST /api/items takes it, so Create sends it (as the user
 * edited it) and More options opens it in the editor. Fields the email didn't give are null: an
 * event with no time is all day, and one with no date has none yet (the card asks for it). Reminders Alfred didn't set are left out, so Settings' default applies.
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
  // What Alfred set beyond those (each missing from a proposal saved before he could). The
  // description is in its provider's format (HTML for an event, Markdown for a task), after the
  // source's "From:" line. Reminders missing take Settings' default.
  description?: string | null;
  reminders?: number[];
  leave_reminder?: boolean;
  colour?: EventColour | null;
  // An event's rule and a task's Todoist repeat, as the editor's repeat picker writes them.
  recurrence?: string | null;
  repeat?: string | null;
}

/**
 * The fields Alfred set on a new item beyond its title, day, times and place, for his chip's summary
 * line and the editor's marks. `days` is an event over several days.
 */
export const ALFRED_FIELDS = ['description', 'reminders', 'leave_reminder', 'calendar', 'colour', 'repeat', 'days'] as const;
export type AlfredField = (typeof ALFRED_FIELDS)[number];

/**
 * Where a proposal came from, for its description's first line, "From:
 * *subject*": the email's subject and its Gmail address (null for a non-Gmail account), or the
 * story's headline and Setpoint's address for it.
 */
export interface ProposalSourceOut {
  subject: string;
  url: string | null;
}

/**
 * Alfred's change to an existing event or task: the item (or a recurring event's occurrence) as it
 * was when he proposed it, the fields he'd change as PATCH /api/items/:id takes them, and which of a
 * recurring event's occurrences it changes. Nothing changes until the user presses Save.
 */
export interface ProposalChangeOut {
  item: ItemOut;
  changes: ItemChanges;
  scope: RecurringScope;
}

/**
 * A pre-filled event or task the user reviews before anything is created (board 08). `conflict` is
 * "Free that evening" or "Overlaps Study group · 1h 30m" for an event with a date, null otherwise.
 * `message_id` is the email it came from, null for one Alfred made from the user's words. `source`
 * is missing from an Alfred answer saved before proposals carried it. With `change`, it's a change to
 * an existing item, and `item` is that item as the change leaves it.
 */
export interface ProposalOut {
  kind: ItemKind;
  message_id: number | null;
  item: ProposalItemOut;
  from_email: ProposalField[];
  conflict: {free: boolean; label: string} | null;
  source?: ProposalSourceOut;
  change?: ProposalChangeOut;
  // In an Alfred answer: what he set beyond the title, day, times and place (a change says it in `change`).
  alfred?: AlfredField[];
  // In an Alfred answer: its Create or Save went through, so a later proposal leaves it be.
  acted?: boolean;
  // In an Alfred answer: a later answer in the thread proposed again before this was acted on, so it's gone.
  replaced?: boolean;
}

/** Bold runs in an answer ("By **Oct 31, 2026**, …"): UTF-16 offsets into `answer`, end exclusive. */
export interface EmphasisOut {
  start: number;
  end: number;
}

/**
 * A job application an answer rests on, as Jobs gave it then (only while Jobs is on): its row opens
 * the application on Jobs. `status` is the word Jobs' row shows ("In process", "Ghosted").
 */
export interface AnswerApplicationOut {
  application_id: number;
  company: string;
  title: string;
  status: string;
}

export interface AnswerOut {
  conversation_id: number;
  turn_id: number;
  // When the thread ends if nothing more is asked: four idle hours after its last question.
  ends_at: string;
  // The question this turn answers, for the thread.
  question: string;
  // One or two lines. Null when Alfred couldn't find it ("Couldn't find that in your mail or calendar").
  answer: string | null;
  emphasis: EmphasisOut[];
  sources: AnswerSourceOut[];
  // The events and tasks it rests on, after the emails.
  items: AnswerItemOut[];
  // The job applications it rests on, after the events and tasks.
  applications: AnswerApplicationOut[];
  // What it searched ("Northwind · Rejection · Mar 2026", "lease renewal"), said when it couldn't answer.
  searched: string[];
  proposals: ProposalOut[];
  // Fixes a registered module proposed (Jobs', while it's on), after the proposals.
  fixes: FixProposalOut[];
}

/**
 * A fix to a registered module's records that Alfred proposes (a Jobs merge, a Needs you item
 * assigned): its one line, the emails it rests on, and the module's own route that Apply posts, with
 * the toast's words and Undo. The answer of `apply` carries `undo`, which fills `{undo}` in `undo`.
 * Nothing changes until the user presses Apply. Alfred never applies one himself.
 */
export interface FixProposalOut {
  // "Merge Woodgrove Bank · Developer into Woodgrove Bank · Application Developer".
  line: string;
  evidence: AnswerSourceOut[];
  // The route under /api, posted as is.
  apply: {path: string; body: Record<string, unknown> | null};
  // The toast's Undo route, its `{undo}` the apply answer's `undo`; null for none.
  undo: string | null;
  // The toast's words: what it did ("Merged"), and what failed ("Failed to merge").
  done: string;
  failed: string;
  // Applied (and not undone since), so the next question says so.
  acted?: boolean;
}

/** GET /api/alfred/conversations/:id, the short thread so far, oldest turn first. */
export interface ConversationOut {
  conversation_id: number;
  // The email it's scoped to (Ask about this email), or null.
  message_id: number | null;
  // Idle past four hours (or begun on a provider no longer offered): a follow-up is refused.
  ended: boolean;
  turns: AnswerOut[];
}

/**
 * POST /api/alfred/acted: an answer's proposal (by its turn and its place in it) was created or
 * saved, or with `fix`, its fix was applied (`acted` true) or undone (false).
 */
export const alfredActedInput = z.strictObject({turn_id: id, index: z.int().min(0).max(20), fix: z.boolean().default(false), acted: z.boolean().default(true)});
export type AlfredActedInput = z.infer<typeof alfredActedInput>;

/** POST /api/proposals/from-message: Add to calendar / Add as task, pre-filled from the email. */
export const proposalInput = z.strictObject({message_id: id, kind: z.enum(ITEM_KINDS)});

/**
 * POST /api/proposals/prefill: the proposal with its fields read from the email by a model, or why
 * there was no call (`invite`: the invite's fields stand; `no_key`: no Anthropic key). A failed call
 * is a 502 `prefill_failed`, its details a ProposalPrefillFailure.
 */
export interface ProposalPrefillOut {
  proposal: ProposalOut | null;
  skipped: 'invite' | 'no_key' | null;
}

/**
 * Why a prefill failed: Anthropic refused it with an HTTP `status`, or it gave no status
 * (`unreachable`: no answer in time, or no connection), or its answer had no usable title (`unusable`).
 */
export interface ProposalPrefillFailure {
  reason: 'refused' | 'unreachable' | 'unusable';
  status: number | null;
}

// ---- Calendar search ----

/**
 * A calendar search's chips: a date or range, as mail's, and a calendar by name ("Classes", and
 * "Todoist" covers every task). `value` is the calendar's name as it writes it. It matches every
 * calendar of that name (one shared with two accounts is on both). Chips of one kind are alternatives.
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
  // A recurring event's rule ("RRULE:FREQ=WEEKLY;BYDAY=MO,WE") when the row stands for its series.
  // Null for one item, or an occurrence changed on its own.
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
  // Every match, for "14 results". Upcoming come first (soonest first), then Past (most recent first).
  total: number;
  results: CalendarSearchResultOut[];
  next_offset: number | null;
}
