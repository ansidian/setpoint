// How free text matches an email, and how a result says why it matched (BRIEF.md › Search; DESIGN.md
// › Search and Override 12). Pure: the search query (src/search/search.ts) runs these over the
// full-text index's candidates.
//
// The field's search (SV-137) requires every word but filler, a word's prefix or plural anywhere in
// the index, so ranking only orders and sections what today's every-word search finds. How well a
// word matched decides its tier (matchTier): an email about the search comes before one that only
// mentions it, newest first within each, with no importance boost (decision 9).
//
// Alfred's broad search keeps what's harvested from v1's email search (SV-5): the query's words as
// prefix terms with their singular or plural form (`email-search-query` pluralVariants), and v1's
// zero-result ladder, so one stray word degrades a search instead of emptying it: every word must
// match, and when none do, any word but filler ("When does my lease renewal need to be signed?"
// finds lease, renewal or signed, as board 07's results show). v1's middle step (every word but
// filler) is left out: a question's words broaden the search for Alfred's card rather than narrow
// it. v1's scoring (`email-search-ranking`) is not carried: it ranked lane, urgency and deadlines
// above the match (decision 9). Broad free text alone ranks by the best field any word matched,
// sender (and organisation) before subject before body, then newest first.
import type {MatchField, MessageType} from '@setpoint/shared';
import {fold, NEGATED, TYPE_CHIP_WORDS, TYPE_WORDS, wordsOf} from './searchChips.ts';

/** v1's filler words (FTS_QUERY_STOPWORDS), plus "need", which questions to Alfred are full of. */
export const FILLER_WORDS = new Set([
  'a', 'about', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'by', 'can', 'could', 'did', 'do', 'does',
  'earliest', 'email', 'emails', 'find', 'first', 'for', 'from', 'get', 'had', 'has', 'have', 'her', 'his', 'how', 'i', 'in', 'is',
  'it', 'its', 'last', 'latest', 'look', 'looking', 'mail', 'may', 'me', 'message', 'messages', 'might', 'most', 'must', 'my',
  'need', 'needs', 'new', 'newest', 'no', 'not', 'of', 'old', 'oldest', 'on', 'or', 'our', 'please', 'recent', 'recently', 'search',
  'shall', 'should', 'show', 'some', 'that', 'the', 'their', 'these', 'this', 'those', 'to', 'was', 'were', 'what', 'whats',
  'when', 'whens', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'your',
]);

/** The words of free text, folded, once each. */
export function textTerms(text: string): string[] {
  return [...new Set(fold(text).match(/[\p{L}\p{N}]+/gu) ?? [])];
}

/**
 * Free text's "!word"s (SV-31), whose words leave out the mail that has any of them, and the text
 * left to match: `invoice !proseware` matches invoice and leaves out Proseware's.
 */
export function withoutExcluded(text: string): {text: string; excluded: string[]} {
  const kept: string[] = [];
  const excluded: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (NEGATED.test(word)) excluded.push(...textTerms(word));
    else kept.push(word);
  }
  return {text: kept.join(' '), excluded: [...new Set(excluded)]};
}

/** v1's regular English singular/plural partner of a word of 4+ letters ("rejections" ↔ "rejection"). */
export function pluralVariants(term: string): string[] {
  if (term.length < 4 || /[^a-z]/.test(term)) return [];
  if (term.endsWith('ies')) return [`${term.slice(0, -3)}y`];
  if (/(ses|xes|zes|ches|shes)$/.test(term)) return [term.slice(0, -2)];
  if (term.endsWith('ss')) return [];
  if (term.endsWith('s')) return [term.slice(0, -1)];
  if (term.endsWith('y') && !/[aeiou]y$/.test(term)) return [`${term.slice(0, -1)}ies`];
  return [`${term}s`];
}

/** A word's forms: itself and its plural partner. Each matches as a prefix. */
export const formsOf = (term: string) => [term, ...pluralVariants(term)];

export type LadderStep = 'all' | 'any_but_filler';

/**
 * The full-text queries to try in order until one matches: every word, then any word but filler
 * (left out when it would repeat the first).
 */
export function textLadder(text: string): {step: LadderStep; terms: string[]; mode: 'and' | 'or'}[] {
  const all = textTerms(text);
  if (!all.length) return [];
  const meaningful = all.filter(term => !FILLER_WORDS.has(term));
  const steps: {step: LadderStep; terms: string[]; mode: 'and' | 'or'}[] = [{step: 'all', terms: all, mode: 'and'}];
  if (meaningful.length > 1 || (meaningful.length === 1 && all.length > 1)) steps.push({step: 'any_but_filler', terms: meaningful, mode: 'or'});
  return steps;
}

/** A word a search requires. */
export interface SearchWord {
  term: string;
  forms: string[];
  // Finds the start of a word in folded text with one of its forms.
  starts: RegExp;
  // Still being typed, so a whole word's matches take its start too.
  typing: boolean;
  // The type it names ("rejections", "bill"), which also counts as the word in a tier.
  type: MessageType | null;
}

// Words that name a type without being a chip's: only for ranking, so nothing joins the list by them.
const RANKING_TYPE_WORDS: Record<string, MessageType> = {bill: 'statement', bills: 'statement'};

/**
 * The words the field's search requires: all but filler, once each. A word in capitals isn't filler
 * ("IT Specialist"), unless the whole search is in capitals. A search of filler alone requires it
 * all, or, with `dropAllFiller` (a chip already says what's wanted), nothing.
 */
export function searchWords(text: string, {typing = false, dropAllFiller = false} = {}): SearchWord[] {
  const typed = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  const shouted = typed.length > 1 && !/\p{Ll}/u.test(text);
  const isFiller = (word: string) => FILLER_WORDS.has(fold(word)) && (shouted || !/^\p{Lu}{2,}$/u.test(word));
  const kept = typed.some(word => !isFiller(word)) ? typed.filter(word => !isFiller(word)) : dropAllFiller ? [] : typed;
  const terms = [...new Set(kept.map(fold))];
  const last = typed.length && typing ? fold(typed.at(-1)!) : null;
  return terms.map(term => ({
    term, forms: formsOf(term), starts: new RegExp(`(?<![\\p{L}\\p{N}])(?:${formsOf(term).join('|')})`, 'u'),
    typing: term === last, type: RANKING_TYPE_WORDS[term] ?? TYPE_WORDS[term] ?? null,
  }));
}

const quote = (term: string) => `"${term.replace(/"/g, '""')}"*`;
const termExpression = (term: string) => {
  const forms = formsOf(term);
  return forms.length === 1 ? quote(term) : `(${forms.map(quote).join(' OR ')})`;
};

/** An FTS5 MATCH expression for the terms, optionally only in some columns. */
export function ftsExpression(terms: string[], mode: 'and' | 'or', columns?: string[]): string {
  const body = terms.map(termExpression).join(mode === 'and' ? ' AND ' : ' OR ');
  return columns ? `{${columns.join(' ')}} : (${body})` : body;
}

const typeForms = (type: MessageType) => TYPE_CHIP_WORDS[type].flatMap(word => formsOf(word));

/**
 * What a reading's type chip finds beyond the classified type (D386): one of the type's words, whole,
 * in the subject, summary or search terms. Never the body, or newsletters that mention it come back.
 */
export const typeWordsExpression = (types: MessageType[]) => `{subject summary search_terms} : (${[...new Set(types.flatMap(typeForms))].map(form => `"${form}"`).join(' OR ')})`;

/** Where an email says it's of a type: the field and words a reason gives, or null. */
export function typeWordsIn(row: Pick<TextRow, 'subject' | 'summary' | 'searchTerms'>, type: MessageType): {field: 'subject' | 'body'; words: string[]} | null {
  const found = (value: string) => {
    const own = new Set<string>(wordsOf(value));
    return typeForms(type).filter(form => own.has(form));
  };
  const subject = found(row.subject);
  if (subject.length) return {field: 'subject', words: subject};
  const words = found(`${row.summary ?? ''}\n${row.searchTerms ?? ''}`);
  return words.length ? {field: 'body', words} : null;
}

/**
 * The index's columns for each field, in BRIEF.md's order of preference. A row's summary and search
 * terms rank with its body for now: they're words about the email, and a match there has no place
 * of its own in a result.
 */
export const FIELD_TIERS: {field: 'sender' | 'subject' | 'body'; columns: string[]}[] = [
  {field: 'sender', columns: ['from_name', 'from_address', 'organisation']},
  {field: 'subject', columns: ['subject']},
  {field: 'body', columns: ['search_body', 'summary', 'search_terms']},
];

const wordStarts = (value: string) => [...value.matchAll(/[\p{L}\p{N}]+/gu)].map(match => ({start: match.index, word: match[0], folded: fold(match[0])}));

/** Whether a word in `value` starts with one of the term's forms. */
export function hasTerm(value: string | null, term: string): boolean {
  if (!value) return false;
  const forms = formsOf(term);
  return wordStarts(value).some(({folded}) => forms.some(form => folded.startsWith(form)));
}

/** Runs in `value` where a word starts with a term's form: the form's length, or the whole word. */
export function termRuns(value: string | null, terms: string[]): {start: number; end: number}[] {
  if (!value || !terms.length) return [];
  const runs: {start: number; end: number}[] = [];
  for (const {start, word, folded} of wordStarts(value)) {
    let best = 0;
    for (const term of terms) for (const form of formsOf(term)) if (folded.startsWith(form)) best = Math.max(best, form.length);
    if (best) runs.push({start, end: start + (best >= folded.length ? word.length : best)});
  }
  return runs;
}

/** Runs where the given words appear in sequence, as whole words ("Northwind" in "Northwind Talent"). */
export function phraseRuns(value: string | null, phrase: string): {start: number; end: number}[] {
  if (!value) return [];
  const wanted = fold(phrase).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!wanted.length) return [];
  const words = wordStarts(value);
  const runs: {start: number; end: number}[] = [];
  for (let at = 0; at + wanted.length <= words.length; at += 1) {
    if (wanted.every((word, index) => words[at + index]!.folded === word)) {
      const last = words[at + wanted.length - 1]!;
      runs.push({start: words[at]!.start, end: last.start + last.word.length});
    }
  }
  return runs;
}

export interface TextRow {
  fromName: string;
  fromAddress: string;
  organisation: string | null;
  subject: string;
  summary: string | null;
  searchTerms: string | null;
  searchBody: string;
}

export type RankedRow = TextRow & {type: MessageType | null};

// Words between two a search has for them to still read as one thing, in the body.
const NEAR_WORDS = 8;

/** The field's tiers, best first; each is newest first (DESIGN.md › Search). */
export const TIER = {
  sender: 0,
  phrase: 1,
  subject: 2,
  across: 3,
  body: 4,
  // From here on an email only mentions the search.
  mention: 5,
  partOfWord: 6,
  link: 7,
} as const;

const startsWithForm = (token: string, {forms}: SearchWord) => forms.some(form => token.startsWith(form));
const isWhole = (token: string, word: SearchWord) => (word.typing ? startsWithForm(token, word) : word.forms.includes(token));

/** Tokens that hold the word, its start being enough. */
const hasStart = (tokens: string[], word: SearchWord) => tokens.some(token => startsWithForm(token, word));

/** Tokens that hold the word whole; the word being typed may still be only its start. */
const hasWhole = (tokens: string[], word: SearchWord) => tokens.some(token => isWhole(token, word));

/** Two or more words side by side in order, each by its start: "follow up" in "following up". */
function hasPhrase(tokens: string[], words: SearchWord[]): boolean {
  if (words.length < 2) return false;
  for (let at = 0; at + words.length <= tokens.length; at += 1) {
    if (words.every((word, index) => startsWithForm(tokens[at + index]!, word))) return true;
  }
  return false;
}

/** Two or more words, each whole, in any order, with at most NEAR_WORDS words from the first to the last. */
function isNear(tokens: string[], words: SearchWord[]): boolean {
  if (words.length < 2) return false;
  const last = new Array<number>(words.length).fill(Number.NEGATIVE_INFINITY);
  for (const [at, token] of tokens.entries()) {
    let seen = false;
    words.forEach((word, index) => {
      if (isWhole(token, word)) {
        last[index] = at;
        seen = true;
      }
    });
    if (seen && at - Math.min(...last) <= NEAR_WORDS) return true;
  }
  return false;
}

/**
 * How well an email matches the words: the best of TIER that holds. The sender and subject take a
 * word's start; the summary, search terms and body want it whole, since an ending there is how a
 * short word lands in unrelated mail. A phrase is rare enough by itself to take each word's start.
 * A word that's one email's only evidence isn't a phrase or a search term's whole point, so one
 * word needs the subject or the sender for the top tiers, and is a mention in the body alone.
 */
export function matchTier(row: RankedRow, words: SearchWord[]): number {
  const sender = wordsOf(`${row.fromName} ${row.fromAddress} ${row.organisation ?? ''}`);
  if (words.every(word => hasStart(sender, word))) return TIER.sender;
  const subject = wordsOf(row.subject);
  const terms = (row.searchTerms ?? '').split('\n').map(wordsOf);
  const whole = words.length === 1 && hasWhole(subject, words[0]!);
  if (whole || hasPhrase(subject, words) || terms.some(term => hasPhrase(term, words))) return TIER.phrase;
  if (words.every(word => hasStart(subject, word)) || (words.length > 1 && terms.some(term => words.every(word => hasWhole(term, word))))) return TIER.subject;
  const summary = wordsOf(row.summary ?? '');
  const allTerms = terms.flat();
  const inFields = (word: SearchWord) => namesType(word, row) || hasStart(sender, word) || hasStart(subject, word) || hasWhole(summary, word) || hasWhole(allTerms, word);
  if (words.every(inFields)) return TIER.across;
  const body = wordsOf(row.searchBody);
  if (hasPhrase(body, words) || isNear(body, words)) return TIER.body;
  return words.every(word => inFields(word) || hasWhole(body, word)) ? TIER.mention : TIER.partOfWord;
}

/** Whether the word names the email's type. */
export const namesType = (word: SearchWord, row: Pick<RankedRow, 'type'>) => word.type !== null && word.type === row.type;

/** Whether some word is only in what a link left: `said` is the body without its links. */
export function isLinkOnly(row: RankedRow, words: SearchWord[], said: string): boolean {
  const text = fold([row.fromName, row.fromAddress, row.organisation, row.subject, row.summary, row.searchTerms, said].filter(Boolean).join(' '));
  return words.some(word => !namesType(word, row) && !word.starts.test(text));
}

/**
 * Which fields each term matched, in BRIEF.md's order: sender (and organisation), subject, body. These
 * are the index's words, so a link's path never reads as a match, and body takes the summary and
 * search terms as FIELD_TIERS does.
 */
export function textMatches(row: TextRow, terms: string[]): {field: Extract<MatchField, 'sender' | 'organisation' | 'subject' | 'body'>; terms: string[]}[] {
  const fields = [
    {field: 'sender' as const, matches: (term: string) => hasTerm(row.fromName, term) || hasTerm(row.fromAddress, term)},
    {field: 'organisation' as const, matches: (term: string) => hasTerm(row.organisation, term)},
    {field: 'subject' as const, matches: (term: string) => hasTerm(row.subject, term)},
    {field: 'body' as const, matches: (term: string) => hasTerm(row.searchBody, term) || hasTerm(row.summary, term) || hasTerm(row.searchTerms, term)},
  ];
  return fields.map(({field, matches}) => ({field, terms: terms.filter(matches)})).filter(entry => entry.terms.length);
}

const EXCERPT_LENGTH = 160;
const EXCERPT_LEAD = 50;

/**
 * The body around the first run, about 160 characters, cut at word edges with "…"; the body's
 * start when no run is in it.
 */
export function excerptOf(body: string, runsIn: (text: string) => {start: number; end: number}[]): string {
  const text = body.replace(/\s+/g, ' ').trim();
  const first = runsIn(text)[0];
  // From the start when the first run shows there anyway.
  let start = first && first.end > EXCERPT_LENGTH - 20 ? Math.max(0, first.start - EXCERPT_LEAD) : 0;
  if (start > 0) {
    const space = text.indexOf(' ', start);
    start = space === -1 || space > (first?.start ?? start) ? start : space + 1;
  }
  let end = Math.min(text.length, start + EXCERPT_LENGTH);
  if (end < text.length) {
    const space = text.lastIndexOf(' ', end);
    if (space > start + EXCERPT_LENGTH / 2) end = space;
  }
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/[\s,;:]+$/, '')}${end < text.length ? '…' : ''}`;
}

/** Overlapping or touching runs merged, in order. */
export function mergeRuns(runs: {start: number; end: number}[]): {start: number; end: number}[] {
  const sorted = [...runs].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: {start: number; end: number}[] = [];
  for (const run of sorted) {
    const last = merged.at(-1);
    if (last && run.start <= last.end) last.end = Math.max(last.end, run.end);
    else merged.push({...run});
  }
  return merged;
}
