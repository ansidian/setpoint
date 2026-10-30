// How free text matches an email, and how a result says why it matched (BRIEF.md › Search; DESIGN.md
// › Search and Override 12). Pure: the search query (src/search/search.ts) runs these over the
// full-text index's candidates.
//
// Harvested from v1's email search (SV-5): the query's words as prefix terms with their singular or
// plural form (`email-search-query` pluralVariants), and v1's zero-result ladder, so one stray word
// degrades a search instead of emptying it: every word must match, and when none do, any word but
// filler ("When does my lease renewal need to be signed?" finds lease, renewal or signed, as board
// 07's results show). v1's middle step (every word but filler) is left out: a question's words
// broaden the search for Alfred's card rather than narrow it. v1's scoring (`email-search-ranking`)
// is not carried: it ranked lane, urgency and deadlines above the match (decision 9). Free text
// alone ranks by the best field any word matched, sender (and organisation) before subject before
// body, then newest first.
import type {MatchField} from '@setpoint/shared';
import {fold, NEGATED} from './searchChips.ts';

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
