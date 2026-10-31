// A search's score against the emails marked right for it (src/dev/scoreSearch.ts). Every number is
// per search, then the plain mean over searches, so a search with 15 right emails counts as much as
// one with 1.
import type Database from 'better-sqlite3';
import {z} from 'zod';
import {searchInput} from '@setpoint/shared';
import {applyReading, planReading} from '../search/reading.ts';
import {readingOf} from '../search/readingPrompt.ts';
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
  // Rows in the section the list shows first, and the right emails among them, of all of them.
  firstSection: number;
  rightInFirst: number;
}

/** One search's list against its right emails; its first `section` rows are the first section. */
export function scoreList(search: TestSearch, ids: number[], section = ids.length): SearchScore {
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
    firstSection: section,
    rightInFirst: rightIn(ids.slice(0, section)) / wanted.size,
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

/** Runs each search through the field's real matching as it's typed, with nothing filtered by hand and no account. */
export function scoreSearches(store: Store, searches: TestSearch[]): SearchScore[] {
  return searches.map(search => {
    const {ids, first} = matchSearch(store, {text: search.text, chips: [], account_id: undefined});
    return scoreList(search, ids, first);
  });
}

/** One search's prompt for the model, built by the real code: `null` when it wouldn't ask. */
export function readingPrompts(store: Store, searches: Pick<TestSearch, 'text'>[]): {text: string; input: string | null}[] {
  return searches.map(({text}) => ({text, input: planReading(store, searchInput.parse({text, read: 'ask'})).prompt}));
}

export interface ReadingScore extends SearchScore {
  chips: string[];
  fallback: string | null;
  // What the words find, and what the chips leave out of that: the "more" number.
  words: number;
  more: number;
  // Right emails the words find and the chips hide, and how many of those the "more" number counts.
  hidden: number;
  counted: number;
}

/** A model's answer, as the tool's input, applied by the real code. An answer of null is no reading. */
export function readingScore(store: Store, search: TestSearch, answer: Record<string, unknown> | null): ReadingScore {
  const input = searchInput.parse({text: search.text, read: 'ask'});
  const plan = planReading(store, input);
  const reading = readingOf(answer);
  const {kept: {matches, left}, fallback} = applyReading(store, input, plan, reading, reading ? null : 'failed');
  const shown = new Set(matches.ids);
  const leftOut = new Set(left.ids);
  // The word results asked for afresh, so the "more" number is checked rather than restated.
  const wordResults = matchSearch(store, input, {chipsFromWords: reading?.isDate === false ? 'none' : 'dates'});
  const words = new Set(wordResults.ids);
  const hidden = search.wanted.filter(id => words.has(id) && !shown.has(id));
  return {
    ...scoreList(search, matches.ids, matches.first),
    chips: matches.chips.map(chip => chip.label), fallback, words: words.size, more: left.ids.length,
    hidden: hidden.length, counted: hidden.filter(id => leftOut.has(id)).length,
  };
}

const percent = (share: number) => `${(share * 100).toFixed(0)}%`.padStart(5);

function summaryRow(label: string, {searches, mrr, rankedFirst, foundNone, precisionTop5, top10, anywhere}: ScoreSummary) {
  return `${label.padEnd(9)}${String(searches).padStart(3)}  ${mrr.toFixed(3)}  ${String(rankedFirst).padStart(5)}  ${String(foundNone).padStart(4)}  ${precisionTop5.toFixed(2)}  ${percent(top10)}  ${percent(anywhere)}`;
}

function searchRow({firstRight, precisionTop5, top10, anywhere, listed, firstSection, rightInFirst, group, text}: SearchScore) {
  return `${String(firstRight ?? '-').padStart(5)}  ${precisionTop5.toFixed(2)}  ${percent(top10)}  ${percent(anywhere)}  ${String(listed).padStart(5)}  ${String(firstSection).padStart(5)}  ${percent(rightInFirst)}  ${group.padEnd(8)} ${text}`;
}

/** Numbers and search text only, never a subject or a sender. */
export function scoreReport(scores: SearchScore[]): string {
  return [
    `${''.padEnd(9)}  n    MRR  first  none   P@5  top10    any`,
    summaryRow('all', summarise(scores)),
    ...GROUPS.map(group => summaryRow(group, summarise(scores.filter(score => score.group === group)))),
    '',
    `first   P@5  top10    any  listed  about  right  search`,
    ...scores.map(searchRow),
  ].join('\n');
}

/** The score with readings, and what the reading did to each search. Numbers, search text and chips. */
export function readingReport(scores: ReadingScore[]): string {
  const row = ({firstRight, top10, anywhere, listed, firstSection, words, more, hidden, counted, chips, fallback, text}: ReadingScore) =>
    `${String(firstRight ?? '-').padStart(5)}  ${percent(top10)}  ${percent(anywhere)}  ${String(listed).padStart(5)}  ${String(firstSection).padStart(5)}  ${String(words).padStart(5)}  ${String(more).padStart(4)}  ${`${counted}/${hidden}`.padStart(6)}  ${text} [${chips.join(', ')}]${fallback ? ` (${fallback})` : ''}`;
  const hiddenAll = scores.reduce((sum, {hidden}) => sum + hidden, 0);
  const countedAll = scores.reduce((sum, {counted}) => sum + counted, 0);
  return [
    `${''.padEnd(9)}  n    MRR  first  none   P@5  top10    any`,
    summaryRow('all', summarise(scores)),
    '',
    `Right emails hidden by chips: ${hiddenAll}, counted in "more": ${countedAll}`,
    '',
    'first  top10    any  listed  about  words  more  hidden  search [chips]',
    ...scores.map(row),
  ].join('\n');
}
