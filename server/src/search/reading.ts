// The server's reading of a whole search on Enter (D385, D386, SV-138). Typing never comes here: only
// a request with `read` does (shared/src/api/search.ts).
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
// - The answer counts what the words find and the chips don't, the "more" line, and `left_out` lists
//   it. A reading that leaves nothing gives the word results with no chips from the model.
// - No key, no answer in time, or a failed call: the word results, marked as such. The model is never
//   asked twice for a search: a call that runs past the wait still lands, in the ledger and the cache.
// - Readings are held briefly per search, since a repeat would otherwise pay again and may change
//   its chips: see READING_HELD_MS. Each call is in the ledger, purpose `search_reading`.
import {MAX_SEARCH_CHIPS} from '@setpoint/shared';
import type {MessageType, SearchChip, SearchOut, SearchReadingFallback} from '@setpoint/shared';
import type {SearchReadingLog} from '../db/schema.ts';
import {fold, isNot, keptTokens, sameChip, TYPE_LABELS, wordsOf} from '../domain/searchChips.ts';
import {textTerms} from '../domain/searchMatch.ts';
import {localDay} from '../domain/time.ts';
import {AI_ENDPOINTS, modelClient} from '../providers/ai/index.ts';
import type {AiEndpoints} from '../providers/ai/index.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {keyOf} from '../triage/models.ts';
import {recordUsage} from '../triage/worker.ts';
import {
  FACET_MATCHES, readingFacets, readingOf, SEARCH_READING_MAX_OUTPUT_TOKENS, SEARCH_READING_MODEL, SEARCH_READING_PROMPT_VERSION, SEARCH_READING_SYSTEM, SEARCH_READING_TOOL,
  searchReadingInput,
} from './readingPrompt.ts';
import type {Reading} from './readingPrompt.ts';
import {answerSearch, chipVocabulary, matchSearch, organisationsFor, searchMail} from './search.ts';
import type {SearchMatches, SearchRequest} from './search.ts';

// How long Enter waits for the model, and how long the call may go on behind it. The model took about
// 0.85 s typically and 1.8 s at worst in SV-133's and SV-138's runs, the words are already on screen,
// and a slower answer isn't lost: it's held for the next Enter.
export const READING_WAIT_MS = 2000;
const READING_CALL_MS = 15_000;
// How long a reading stays good, and how many are held.
export const READING_HELD_MS = 10 * 60_000;
const READINGS_HELD = 200;

/** A chip a reading makes: what the "more" number is counted against. */
const isReadingFilter = (chip: SearchChip) => !isNot(chip) && (chip.kind === 'organisation' || chip.kind === 'type');

const withoutRepeats = (chips: SearchChip[]) => chips.filter((chip, at) => !chips.slice(0, at).some(earlier => sameChip(earlier, chip)));

/** The words a model may read: what's typed, without "quotes" and "!words". */
const plainWords = (text: string) => keptTokens(text, token => !token.quoted && !token.negated);

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
export function planReading(store: Store, input: SearchRequest): ReadingPlan {
  const dated = matchSearch(store, {...input, chips: input.chips.filter(chip => !isReadingFilter(chip))}, {chipsFromWords: 'dates'});
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
}

/** Chips as they stand, with what they leave out of the words as typed. No model is asked. */
export function keptSearch(store: Store, input: Pick<SearchRequest, 'text' | 'chips' | 'account_id'>, typed: string): KeptSearch {
  const matches = matchSearch(store, input, {chipsFromWords: 'none', readingTypes: true, rankText: typed});
  // With no words left, nothing can be said to match them.
  if (!input.chips.some(isReadingFilter) || !textTerms(typed).length) return {matches, left: {...matches, ids: [], first: 0}};
  const words = matchSearch(store, {...input, text: typed, chips: input.chips.filter(chip => !isReadingFilter(chip))}, {chipsFromWords: 'none'});
  const kept = new Set(matches.ids);
  const inLeft = (id: number) => !kept.has(id);
  return {matches, left: {...words, ids: words.ids.filter(inLeft), first: words.ids.slice(0, words.first).filter(inLeft).length}};
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
  // The words as typed, without dates that became chips.
  typed: string;
  fallback: SearchReadingFallback | null;
}

/** The word results with what `reading` adds to them, or the given chips alone without one. */
export function applyReading(store: Store, input: SearchRequest, plan: ReadingPlan, reading: Reading | null, fallback: SearchReadingFallback | null = null): AppliedReading {
  const held = input.chips.filter(chip => !isReadingFilter(chip));
  const words = reading && !reading.isDate && plan.dates.length ? matchSearch(store, {...input, chips: held}, {chipsFromWords: 'none'}) : plan.dated;
  const typed = words.text;
  const given = input.chips.filter(isReadingFilter);
  // The chips as the field draws them: organisations, types, then dates and what's left out.
  const settled = (text: string, filters: SearchChip[]) => keptSearch(store, {...input, text, chips: withoutRepeats([...filters, ...words.chips])}, typed);
  // Always few enough to send back.
  const filters = reading ? readingChips(store, reading).slice(0, Math.max(0, MAX_SEARCH_CHIPS - words.chips.length - given.length)) : [];
  if (reading && filters.length) {
    // Only words that were typed: the model can drop a word a chip now says, never add one.
    const keywords = new Set(wordsOf(reading.keywords));
    const text = keptTokens(typed, token => token.quoted || token.negated || (token.word !== '' && wordsOf(token.word).every(word => keywords.has(word))));
    const kept = settled(text, [...given, ...filters]);
    if (kept.matches.ids.length) return {kept, typed, fallback: null};
    return {kept: settled(typed, given), typed, fallback: 'left_nothing'};
  }
  return {kept: settled(typed, given), typed, fallback};
}

interface HeldReading {
  at: number;
  reading: Promise<Reading | null>;
}

export interface SearchReaderOptions {
  store: Store;
  endpoints?: AiEndpoints;
  // How long Enter waits for the model.
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
    if (input.read === 'ask') return this.ask(input);
    const started = performance.now();
    const typed = input.typed ?? input.text;
    const {matches, left} = keptSearch(this.store, input, typed);
    const reading = {used: 'reading' as const, fallback: null, more: left.ids.length, typed};
    if (input.read === 'left_out') return answerSearch(this.store, input, left, reading, null);
    return answerSearch(this.store, input, matches, reading, {reading: {...this.logged('kept', null, null), more: left.ids.length, ms: Math.round(performance.now() - started)}});
  }

  private async ask(input: SearchRequest): Promise<SearchOut> {
    const started = performance.now();
    const plan = planReading(this.store, input);
    const {reading, source, fallback} = await this.reading(plan);
    const applied = applyReading(this.store, input, plan, reading, fallback);
    const {matches, left} = applied.kept;
    const out = {used: reading && !applied.fallback ? 'reading' as const : 'words' as const, fallback: applied.fallback, more: left.ids.length, typed: applied.typed};
    return answerSearch(this.store, input, matches, out, {reading: {...this.logged(source, reading, applied.fallback), more: left.ids.length, ms: Math.round(performance.now() - started)}});
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

  /** Asks the model, and holds the answer. A failed call holds nothing, so the next Enter asks again. */
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
