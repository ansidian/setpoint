// The server's reading of a whole search, offered as a suggestion (D386, D392, SV-138, SV-142). Typing
// never comes here: only POST /api/search/suggestion does, which the web asks on a pause in typing.
// Results are the words' results whatever it finds. Only accepting one filters, and that asks nothing.
//
// - Claude Haiku 5.5 reads the search with today's date and the organisations and types in its best
//   keyword matches (src/search/readingPrompt.ts). It says which organisations and types the search
//   asks for and which words are left. Dates stay the grammar's, the same every time; the model only
//   says when what the grammar took for a date is a name, and then its words go back to being words.
// - "!" words and "quotes" never reach the model: they're what the user said exactly. They run through
//   the grammar as always, and stay in force whatever the model says.
// - Its chips are checked against the mail: only organisations that exist, and only words that were
//   typed left as keywords. An organisation chip covers names that start with it, and a type chip
//   matches the classified type, or the type's word in the subject, summary or terms (D386).
// - A suggestion is offered only if it hides a real share of the word results and leaves a row:
//   see SUGGESTION_HIDES. Filters that leave nothing are dropped, leaving any date the grammar found.
// - The answer counts what the words find and the chips don't, the "more" line, and `left_out` lists it.
// - No key, no answer in time, or a failed call: no reading, so what the grammar found or nothing. The
//   model is never asked twice for a search: a call that runs past the wait still lands, in the ledger
//   and the cache.
// - Readings are held briefly per search, since a repeat would otherwise pay again and may change
//   its chips: see READING_HELD_MS. Each call is in the ledger, purpose `search_reading`.
import {MAX_SEARCH_CHIPS} from '@setpoint/shared';
import type {MessageType, SearchChip, SearchOut, SearchReadingFallback, SearchSuggestOut, SearchSuggestionOut, searchSuggestionInput} from '@setpoint/shared';
import type {z} from 'zod';
import type {SearchReadingLog} from '../db/schema.ts';
import {fold, isNot, keptTokens, parseQuery, sameChip, TYPE_LABELS, wordsOf} from '../domain/searchChips.ts';
import {textTerms} from '../domain/searchMatch.ts';
import {localDay} from '../domain/time.ts';
import {AI_ENDPOINTS, modelClient} from '../providers/ai/index.ts';
import type {AiEndpoints} from '../providers/ai/index.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {logSuggestion} from './log.ts';
import {keyOf} from '../triage/models.ts';
import {recordUsage} from '../triage/worker.ts';
import {
  FACET_MATCHES, readingFacets, readingOf, SEARCH_READING_MAX_OUTPUT_TOKENS, SEARCH_READING_MODEL, SEARCH_READING_PROMPT_VERSION, SEARCH_READING_SYSTEM, SEARCH_READING_TOOL,
  searchReadingInput,
} from './readingPrompt.ts';
import type {Reading} from './readingPrompt.ts';
import {answerSearch, chipVocabulary, matchSearch, organisationsFor, searchMail} from './search.ts';
import type {SearchMatches, SearchRequest} from './search.ts';

// How long a suggestion waits for the model, and how long the call may go on behind it. The model took
// about 0.85 s typically and 1.8 s at worst in SV-133's and SV-138's runs, nothing on screen waits for
// it, and a slower answer isn't lost: it's held for the next pause on those words.
export const READING_WAIT_MS = 2000;
const READING_CALL_MS = 15_000;
// How long a reading stays good, and how many are held.
export const READING_HELD_MS = 10 * 60_000;
const READINGS_HELD = 200;
// The share of the word results a suggestion must hide to be worth a look. An exact fifth counts.
export const SUGGESTION_HIDES = 0.2;

/** A chip a suggestion makes: what the "more" number is counted against. A Not chip is the user's own. */
const isSuggested = (chip: SearchChip) => !isNot(chip) && (chip.kind === 'organisation' || chip.kind === 'type' || chip.kind === 'date');

const withoutRepeats = (chips: SearchChip[]) => chips.filter((chip, at) => !chips.slice(0, at).some(earlier => sameChip(earlier, chip)));

/** The words a model may read: what's typed, without "quotes" and "!words". */
const plainWords = (text: string) => keptTokens(text, token => !token.quoted && !token.negated);

type SearchedField = Pick<SearchRequest, 'text' | 'chips' | 'account_id'>;
type SearchSuggestionRequest = z.output<typeof searchSuggestionInput>;

export interface ReadingPlan {
  // The word results, with any date the grammar found.
  dated: SearchMatches;
  // The model's input; null when nothing in the search is for it to read.
  prompt: string | null;
  // Dates the grammar found, which the model may say are names.
  dates: SearchChip[];
  key: string;
}

/** The word results, and what the model would be asked about them. Reads the database only. */
export function planReading(store: Store, input: SearchedField): ReadingPlan {
  const dated = matchSearch(store, {...input, chips: input.chips.filter(chip => !isSuggested(chip))}, {chipsFromWords: 'dates'});
  const dates = dated.chips.filter(chip => chip.kind === 'date' && !isNot(chip) && !input.chips.some(given => sameChip(given, chip)));
  const search = plainWords(input.text);
  const today = localDay(isoNow(store), store.timeZone);
  const key = JSON.stringify([SEARCH_READING_PROMPT_VERSION, today, input.account_id ?? null, fold(search).replace(/\s+/g, ' ').trim()]);
  if (!plainWords(dated.text).trim()) return {dated, prompt: null, dates, key};
  const best = store.sqlite.prepare('SELECT organisation, type FROM messages WHERE id IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify(dated.ids.slice(0, FACET_MATCHES))) as {organisation: string | null; type: string | null}[];
  const facets = readingFacets(best, chipVocabulary(store).organisations, search);
  return {dated, dates, key, prompt: searchReadingInput({search, today, facets, dates: dates.flatMap(chip => (chip.kind === 'date' ? [chip.label] : []))})};
}

export interface KeptSearch {
  matches: SearchMatches;
  // What the words find and the chips don't, in the words' order.
  left: SearchMatches;
  // How many emails the words find, the list typing shows.
  words: number;
}

/** The words as typed, less those the date chips in force stand for, so a date alone reads newest first. */
function undatedWords(store: Store, typed: string, chips: SearchChip[]): string {
  const dated = parseQuery(typed, {...chipVocabulary(store), now: isoNow(store), timeZone: store.timeZone, fromWords: 'dates'});
  const dates = dated.chips.filter(chip => chip.kind === 'date' && !isNot(chip));
  return dates.length && dates.every(date => chips.some(chip => sameChip(chip, date))) ? dated.text : typed;
}

/** Chips as they stand, with what they leave out of the words as typed. No model is asked. */
export function keptSearch(store: Store, input: SearchedField, typed: string): KeptSearch {
  const matches = matchSearch(store, input, {chipsFromWords: 'none', readingTypes: true, rankText: undatedWords(store, typed, input.chips)});
  // With no words left, nothing can be said to match them.
  if (!input.chips.some(isSuggested) || !textTerms(typed).length) return {matches, left: {...matches, ids: [], first: 0}, words: matches.ids.length};
  const words = matchSearch(store, {...input, text: typed, chips: input.chips.filter(chip => !isSuggested(chip))}, {chipsFromWords: 'none'});
  const kept = new Set(matches.ids);
  const inLeft = (id: number) => !kept.has(id);
  return {matches, left: {...words, ids: words.ids.filter(inLeft), first: words.ids.slice(0, words.first).filter(inLeft).length}, words: words.ids.length};
}

/** The model's filters as chips: organisations the mail has, those another chip covers left out. */
function readingChips(store: Store, reading: Reading): SearchChip[] {
  const known = chipVocabulary(store).organisations;
  const names = [...new Set(reading.organisations.flatMap(name => known.filter(own => fold(own) === fold(name))))];
  const covered = (name: string) => names.some(other => other !== name && organisationsFor(other, [name]).length);
  return [
    ...names.filter(name => !covered(name)).map((name): SearchChip => ({kind: 'organisation', value: name, label: name})),
    ...reading.types.map((type: MessageType): SearchChip => ({kind: 'type', value: type, label: TYPE_LABELS[type]})),
  ];
}

export interface AppliedReading {
  kept: KeptSearch;
  // The words as typed, a date's too, and those without a date that became a chip.
  typed: string;
  undated: string;
  fallback: SearchReadingFallback | null;
}

/** What the search would be with `reading`'s filters and the grammar's dates, or the dates alone without one. */
export function applyReading(store: Store, input: SearchedField, plan: ReadingPlan, reading: Reading | null, fallback: SearchReadingFallback | null = null): AppliedReading {
  const held = input.chips.filter(chip => !isSuggested(chip));
  const plain = matchSearch(store, {...input, chips: held}, {chipsFromWords: 'none'});
  const words = reading && !reading.isDate ? plain : plan.dated;
  const typed = plain.text;
  const undated = words.text;
  const given = input.chips.filter(isSuggested);
  // The chips as the field draws them: organisations, types, then dates and what's left out.
  const settled = (text: string, filters: SearchChip[]) => keptSearch(store, {...input, text, chips: withoutRepeats([...filters, ...words.chips])}, typed);
  // Always few enough to send back.
  const filters = reading ? readingChips(store, reading).slice(0, Math.max(0, MAX_SEARCH_CHIPS - words.chips.length - given.length)) : [];
  if (reading && filters.length) {
    // Only words that were typed: the model can drop a word a chip now says, never add one.
    const keywords = new Set(wordsOf(reading.keywords));
    const text = keptTokens(undated, token => token.quoted || token.negated || (token.word !== '' && wordsOf(token.word).every(word => keywords.has(word))));
    const kept = settled(text, [...given, ...filters]);
    if (kept.matches.ids.length) return {kept, typed, undated, fallback: null};
    return {kept: settled(undated, given), typed, undated, fallback: 'left_nothing'};
  }
  return {kept: settled(undated, given), typed, undated, fallback};
}

/**
 * What the field would become, if it adds a chip, leaves a row and hides a real share of the word
 * results (SUGGESTION_HIDES). With no word results there's nothing to hide, and a filter that finds
 * something is the only way to anything: `last week` can have no word results.
 */
export function suggestionOf(input: SearchedField, {kept: {matches, left, words}, typed, undated}: AppliedReading): Omit<SearchSuggestionOut, 'id'> | null {
  const offers = matches.chips.filter(chip => isSuggested(chip) && !input.chips.some(given => sameChip(given, chip)));
  const hides = left.ids.length;
  if (!offers.length || !matches.ids.length || (words > 0 && hides / words < SUGGESTION_HIDES)) return null;
  return {chips: matches.chips, text: matches.text, typed, undated, offers, total: matches.ids.length, hides, words};
}

interface HeldReading {
  at: number;
  reading: Promise<Reading | null>;
}

export interface SearchReaderOptions {
  store: Store;
  endpoints?: AiEndpoints;
  // How long a suggestion waits for the model.
  waitMs?: number;
}

/** Searches with `read`, and every other search as it was. */
export class SearchReader {
  private readonly store: Store;
  private readonly endpoints: AiEndpoints;
  private readonly waitMs: number;
  private readonly held = new Map<string, HeldReading>();

  constructor({store, endpoints = AI_ENDPOINTS, waitMs = READING_WAIT_MS}: SearchReaderOptions) {
    this.store = store;
    this.endpoints = endpoints;
    this.waitMs = waitMs;
  }

  async search(input: SearchRequest): Promise<SearchOut> {
    if (!input.read) return searchMail(this.store, input);
    const started = performance.now();
    const typed = input.typed ?? input.text;
    const {matches, left} = keptSearch(this.store, input, typed);
    const reading = {more: left.ids.length, typed};
    if (input.read === 'left_out') return answerSearch(this.store, input, left, reading, null);
    return answerSearch(this.store, input, matches, reading, {reading: {...this.logged('kept', null, null), more: left.ids.length, ms: Math.round(performance.now() - started)}});
  }

  /** POST /api/search/suggestion: what the field's exact text could narrow to, if it's worth saying. */
  async suggest(input: SearchSuggestionRequest): Promise<SearchSuggestOut> {
    const started = performance.now();
    const {plan, reading, source, applied} = await this.read(input);
    const found = suggestionOf(input, applied);
    const reads = !input.model && plan.prompt !== null && keyOf(this.store, 'anthropic') !== null;
    if (!found) return {suggestion: null, reads};
    const id = logSuggestion(this.store, {
      query: input.text, accountId: input.account_id ?? null, chips: found.chips, words: found.words, hides: found.hides, total: found.total,
      reading: {...this.logged(source, reading, applied.fallback), more: found.hides, ms: Math.round(performance.now() - started)},
    });
    return {suggestion: {...found, id}, reads};
  }

  /** The field as it would be with what the grammar found and, with `model`, the reading. */
  async read(input: SearchSuggestionRequest) {
    const plan = planReading(this.store, input);
    const {reading, source, fallback} = input.model ? await this.reading(plan) : {reading: null, source: null, fallback: null};
    return {plan, reading, source, applied: applyReading(this.store, input, plan, reading, fallback)};
  }

  private logged(source: SearchReadingLog['source'], reading: Reading | null, fallback: SearchReadingFallback | null): Omit<SearchReadingLog, 'more' | 'ms'> {
    return {
      source, fallback, prompt: SEARCH_READING_PROMPT_VERSION, organisations: reading?.organisations ?? [], types: reading?.types ?? [], keywords: reading?.keywords ?? '',
      is_date: reading?.isDate ?? true,
    };
  }

  /** The search's reading, the one held if there is one, and why not if there's none. */
  private async reading(plan: ReadingPlan): Promise<{reading: Reading | null; source: SearchReadingLog['source']; fallback: SearchReadingFallback | null}> {
    const none = (fallback: SearchReadingFallback) => ({reading: null, source: null, fallback});
    const {prompt, key} = plan;
    if (prompt === null) return none('nothing_to_read');
    const apiKey = keyOf(this.store, 'anthropic');
    if (!apiKey) return none('no_key');
    const held = this.heldReading(key);
    const pending = held ?? this.call(apiKey, prompt, key);
    let timer: NodeJS.Timeout | undefined;
    const late = new Promise<'late'>(resolve => {
      timer = setTimeout(() => resolve('late'), this.waitMs);
    });
    const reading = await Promise.race([pending, late]);
    clearTimeout(timer);
    if (reading === 'late') return none('slow');
    return reading ? {reading, source: held ? 'cache' : 'model', fallback: null} : none('failed');
  }

  private heldReading(key: string) {
    const held = this.held.get(key);
    if (held && this.store.now().getTime() - held.at < READING_HELD_MS) return held.reading;
    this.held.delete(key);
    return undefined;
  }

  /** Asks the model, and holds the answer. A failed call holds nothing, so the next pause asks again. */
  private call(apiKey: string, input: string, key: string): Promise<Reading | null> {
    const client = modelClient('anthropic', {apiKey, baseUrl: this.endpoints.anthropic, timeoutMs: READING_CALL_MS});
    const reading = client.call({
      model: SEARCH_READING_MODEL, system: SEARCH_READING_SYSTEM, tool: SEARCH_READING_TOOL, input, maxOutputTokens: SEARCH_READING_MAX_OUTPUT_TOKENS,
      cacheKey: `setpoint-search-reading:v${SEARCH_READING_PROMPT_VERSION}`,
    }).then(answer => {
      recordUsage(this.store, answer, null, 'search_reading');
      return readingOf(answer.toolInput);
    }).catch(() => null).then(answer => {
      if (!answer) this.held.delete(key);
      return answer;
    });
    this.held.set(key, {at: this.store.now().getTime(), reading});
    while (this.held.size > READINGS_HELD) this.held.delete(this.held.keys().next().value!);
    return reading;
  }
}
