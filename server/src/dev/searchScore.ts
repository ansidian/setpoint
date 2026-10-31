// A search's score against the emails marked right for it (src/dev/scoreSearch.ts). Every number is
// per search, then the plain mean over searches, so a search with 15 right emails counts as much as
// one with 1.
import type Database from 'better-sqlite3';
import {z} from 'zod';
import {matchSearch} from '../search/search.ts';
import {termsOf, termsText} from '../search/termsPrompt.ts';
import type {Store} from '../store.ts';

const GROUPS = ['sender', 'topic', 'meaning'] as const;
export type SearchGroup = (typeof GROUPS)[number];

const TOP = 5;
const SHOWN = 10;

export const searchTest = z.object({
  searches: z.array(z.object({
    group: z.enum(GROUPS),
    text: z.string().min(1),
    wanted: z.array(z.number().int()).min(1),
    // Marked as partly right. Kept for reading a result, and scored as wrong.
    partial: z.array(z.number().int()).optional(),
  })).min(1),
});

export type TestSearch = z.output<typeof searchTest>['searches'][number];

const termsLine = z.object({id: z.number().int(), terms: z.array(z.string())});

/**
 * Writes files of search terms into the database as the job would, one {id, terms} a line, the
 * triggers indexing them. A later line for an email wins. Returns how many emails got terms.
 */
export function loadTerms(sqlite: Database.Database, files: string[]): number {
  const terms = new Map<number, string | null>();
  for (const file of files) {
    for (const line of file.split('\n').filter(line => line.trim())) {
      const {id, terms: written} = termsLine.parse(JSON.parse(line));
      terms.set(id, termsText(termsOf({terms: written})));
    }
  }
  const write = sqlite.prepare('UPDATE messages SET search_terms = ? WHERE id = ?');
  return sqlite.transaction(() => [...terms].reduce((changed, [id, text]) => changed + write.run(text, id).changes, 0))();
}

export interface SearchScore {
  group: SearchGroup;
  text: string;
  // Where the first right email came, from 1; null when none did.
  firstRight: number | null;
  reciprocalRank: number;
  // Share of the top 5 rows that are right, of 5 whatever the list's length.
  precisionTop5: number;
  // Right emails in the top 10, of as many as could fit there.
  top10: number;
  // Right emails anywhere in the list, of all of them.
  anywhere: number;
  listed: number;
}

/** One search's list against its right emails. */
export function scoreList(search: TestSearch, ids: number[]): SearchScore {
  const wanted = new Set(search.wanted);
  const rightIn = (rows: number[]) => rows.filter(id => wanted.has(id)).length;
  const first = ids.findIndex(id => wanted.has(id));
  return {
    group: search.group,
    text: search.text,
    firstRight: first < 0 ? null : first + 1,
    reciprocalRank: first < 0 ? 0 : 1 / (first + 1),
    precisionTop5: rightIn(ids.slice(0, TOP)) / TOP,
    top10: rightIn(ids.slice(0, SHOWN)) / Math.min(wanted.size, SHOWN),
    anywhere: rightIn(ids) / wanted.size,
    listed: ids.length,
  };
}

export interface ScoreSummary {
  searches: number;
  mrr: number;
  rankedFirst: number;
  foundNone: number;
  precisionTop5: number;
  top10: number;
  anywhere: number;
}

/** The mean of a set of searches. */
export function summarise(scores: SearchScore[]): ScoreSummary {
  const mean = (value: (score: SearchScore) => number) => scores.reduce((sum, score) => sum + value(score), 0) / (scores.length || 1);
  return {
    searches: scores.length,
    mrr: mean(score => score.reciprocalRank),
    rankedFirst: scores.filter(score => score.firstRight === 1).length,
    foundNone: scores.filter(score => score.firstRight === null).length,
    precisionTop5: mean(score => score.precisionTop5),
    top10: mean(score => score.top10),
    anywhere: mean(score => score.anywhere),
  };
}

/** Runs each search through the real matching, with nothing filtered by hand and no account. */
export function scoreSearches(store: Store, searches: TestSearch[]): SearchScore[] {
  return searches.map(search => scoreList(search, matchSearch(store, {text: search.text, chips: [], account_id: undefined}).ids));
}

const percent = (share: number) => `${(share * 100).toFixed(0)}%`.padStart(5);

function summaryRow(label: string, {searches, mrr, rankedFirst, foundNone, precisionTop5, top10, anywhere}: ScoreSummary) {
  return `${label.padEnd(9)}${String(searches).padStart(3)}  ${mrr.toFixed(3)}  ${String(rankedFirst).padStart(5)}  ${String(foundNone).padStart(4)}  ${precisionTop5.toFixed(2)}  ${percent(top10)}  ${percent(anywhere)}`;
}

function searchRow({firstRight, precisionTop5, top10, anywhere, listed, group, text}: SearchScore) {
  return `${String(firstRight ?? '-').padStart(5)}  ${precisionTop5.toFixed(2)}  ${percent(top10)}  ${percent(anywhere)}  ${String(listed).padStart(5)}  ${group.padEnd(8)} ${text}`;
}

/** Numbers and search text only, never a subject or a sender. */
export function scoreReport(scores: SearchScore[]): string {
  return [
    `${''.padEnd(9)}  n    MRR  first  none   P@5  top10    any`,
    summaryRow('all', summarise(scores)),
    ...GROUPS.map(group => summaryRow(group, summarise(scores.filter(score => score.group === group)))),
    '',
    `first   P@5  top10    any  listed  search`,
    ...scores.map(searchRow),
  ].join('\n');
}
