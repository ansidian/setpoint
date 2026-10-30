// Search (BRIEF.md › Search; DESIGN.md › Search): the field's words become chips that filter exactly
// (src/domain/searchChips.ts); whatever's left is free text over the full-text index, which holds an
// email's summary and its body without links or footers (src/domain/searchBody.ts). With any chip,
// results come newest first. Free text alone ranks by the best field a word matched — sender (and
// organisation), then subject, then body — and newest first within each, with no importance boost
// (decision 9). Search covers All's mail: archived mail is in (D14), trashed mail is out. A Not chip
// or a "!word" leaves out what it matches (SV-31).
//
// Each search from the field is logged with its chips and the ids it returned, and opening a result
// records its position (src/search/log.ts), so ranking can be measured against real searches.
// Alfred runs the same search through its tool, unlogged.
import type {MatchReasonOut, HighlightOut, SearchChip, SearchOut, SearchResultOut, searchInput} from '@setpoint/shared';
import {asc} from 'drizzle-orm';
import type {z} from 'zod';
import * as t from '../db/schema.ts';
import {dayLabel, fold, isNot, parseQuery, sameChip, wordsOf} from '../domain/searchChips.ts';
import {excerptOf, FIELD_TIERS, ftsExpression, mergeRuns, phraseRuns, termRuns, textLadder, textMatches, withoutExcluded} from '../domain/searchMatch.ts';
import {localDay, zonedInstant} from '../domain/time.ts';
import {indexing, messageRows} from '../queries/mail.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {logSearch} from './log.ts';

export type SearchRequest = z.output<typeof searchInput>;

/** The organisations emails carry and the accounts, for the chip grammar. */
export function chipVocabulary(store: Store) {
  const organisations = (store.sqlite.prepare('SELECT DISTINCT organisation FROM messages WHERE organisation IS NOT NULL AND trashed_at IS NULL').all() as {organisation: string}[])
    .map(row => row.organisation);
  const accounts = store.db.select({id: t.accounts.id, label: t.accounts.label}).from(t.accounts).orderBy(asc(t.accounts.position)).all();
  return {organisations, accounts};
}

/** Organisations an organisation chip covers: those whose name starts with its words. */
function organisationsFor(value: string, organisations: string[]): string[] {
  const wanted = wordsOf(value);
  return organisations.filter(organisation => {
    const own = wordsOf(organisation);
    return own.length >= wanted.length && wanted.every((word, index) => own[index] === word);
  });
}

interface Filter {
  sql: string[];
  args: (string | number)[];
  // A chip that can match nothing (an organisation no email carries).
  empty: boolean;
}

/** The chips' filter, with the mail that has an excluded word ("!proseware") left out. */
function chipFilter(store: Store, chips: SearchChip[], accountId: number | undefined, organisations: string[], excluded: string[]): Filter {
  const filter: Filter = {sql: ['m.trashed_at IS NULL'], args: [], empty: false};
  const placeholders = (values: unknown[]) => values.map(() => '?').join(', ');
  const any = (column: string, values: (string | number)[]) => {
    if (!values.length) {
      filter.empty = true;
      return;
    }
    filter.sql.push(`${column} IN (${placeholders(values)})`);
    filter.args.push(...values);
  };
  // A Not chip's values left out; an email without the column (no organisation, no type) stays.
  const none = (column: string, values: (string | number)[]) => {
    if (!values.length) return;
    filter.sql.push(`(${column} IS NULL OR ${column} NOT IN (${placeholders(values)}))`);
    filter.args.push(...values);
  };
  if (accountId) any('m.account_id', [accountId]);
  for (const [negated, add] of [[false, any], [true, none]] as const) {
    const of = <K extends SearchChip['kind']>(kind: K) => chips.filter((chip): chip is Extract<SearchChip, {kind: K}> => chip.kind === kind && isNot(chip) === negated);
    if (of('account').length) add('m.account_id', of('account').map(chip => chip.value));
    if (of('organisation').length) add('m.organisation', [...new Set(of('organisation').flatMap(chip => organisationsFor(chip.value, organisations)))]);
    if (of('type').length) add('m.type', of('type').map(chip => chip.value));
    if (of('kind').length) add('m.kind', of('kind').map(chip => chip.value));
    const dates = of('date');
    if (dates.length) {
      filter.sql.push(`${negated ? 'NOT ' : ''}(${dates.map(() => '(m.received_at >= ? AND m.received_at < ?)').join(' OR ')})`);
      for (const chip of dates) filter.args.push(zonedInstant(chip.from, '00:00', store.timeZone), zonedInstant(chip.to, '00:00', store.timeZone));
    }
  }
  if (excluded.length) {
    filter.sql.push('m.id NOT IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)');
    filter.args.push(ftsExpression(excluded, 'or'));
  }
  return filter;
}

interface Candidate {
  id: number;
  received_at: string;
}

const newestFirst = (a: Candidate, b: Candidate) => (a.received_at < b.received_at ? 1 : a.received_at > b.received_at ? -1 : b.id - a.id);

function textCandidates(store: Store, filter: Filter, expression: string): Candidate[] {
  return store.sqlite.prepare(`
    SELECT m.id, m.received_at FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
    WHERE messages_fts MATCH ? AND ${filter.sql.join(' AND ')}`).all(expression, ...filter.args) as Candidate[];
}

export interface SearchMatches {
  chips: SearchChip[];
  // Free text left after the chips, and the terms the matching ladder step used.
  text: string;
  terms: string[];
  order: 'newest' | 'match';
  // The ladder fell back from every word to any word (UX #10).
  partial: boolean;
  // Every match, in order.
  ids: number[];
}

/** Every email a search matches, in its order. */
export function matchSearch(store: Store, input: Pick<SearchRequest, 'text' | 'chips' | 'account_id'>): SearchMatches {
  const vocabulary = chipVocabulary(store);
  const parsed = parseQuery(input.text, {...vocabulary, now: isoNow(store), timeZone: store.timeZone});
  const chips: SearchChip[] = [];
  for (const chip of [...input.chips, ...parsed.chips]) if (!chips.some(existing => sameChip(existing, chip))) chips.push(chip);
  const {text, excluded} = withoutExcluded(parsed.text);
  const filter = chipFilter(store, chips, input.account_id, vocabulary.organisations, excluded);
  const ladder = textLadder(text);
  // Leaving out alone doesn't rank: words with only Not chips still order by the best field.
  const order = chips.some(chip => !isNot(chip)) || !ladder.length ? 'newest' : 'match';
  const none = {chips, text: parsed.text, terms: [], order, partial: false, ids: []} as SearchMatches;
  if (filter.empty || (!chips.length && !ladder.length && !excluded.length)) return none;

  if (!ladder.length) {
    const rows = store.sqlite.prepare(`SELECT m.id, m.received_at FROM messages m WHERE ${filter.sql.join(' AND ')}`).all(...filter.args) as Candidate[];
    return {...none, ids: rows.sort(newestFirst).map(row => row.id)};
  }
  for (const step of ladder) {
    const rows = textCandidates(store, filter, ftsExpression(step.terms, step.mode));
    if (!rows.length) continue;
    const partial = step.step !== 'all';
    if (order === 'newest') return {...none, terms: step.terms, partial, ids: rows.sort(newestFirst).map(row => row.id)};
    // Free text alone: the best field any word matched, then newest first.
    const tierOf = new Map<number, number>();
    FIELD_TIERS.forEach(({columns}, tier) => {
      for (const row of textCandidates(store, filter, ftsExpression(step.terms, 'or', columns))) if (!tierOf.has(row.id)) tierOf.set(row.id, tier);
    });
    const tier = (row: Candidate) => tierOf.get(row.id) ?? FIELD_TIERS.length;
    return {...none, terms: step.terms, partial, ids: rows.sort((a, b) => tier(a) - tier(b) || newestFirst(a, b)).map(row => row.id)};
  }
  return none;
}

const TEXT_LABELS = {sender: 'Sender', organisation: 'Org', subject: 'Subject', body: 'Body'} as const;

/** The typed words behind folded terms, for reasons: "Subject lease renewal". */
function typedWords(text: string): Map<string, string> {
  const words = new Map<string, string>();
  for (const word of text.match(/[\p{L}\p{N}]+/gu) ?? []) if (!words.has(fold(word))) words.set(fold(word), word);
  return words;
}

type Row = ReturnType<typeof messageRows> extends Map<number, infer V> ? V : never;

/** A result: its row, why it matched, the body excerpt and the runs to highlight. */
export function presentResult(store: Store, {row, out}: Row, matches: SearchMatches): SearchResultOut {
  const today = localDay(isoNow(store), store.timeZone);
  const reasons: MatchReasonOut[] = [];
  const orgPhrases: string[] = [];
  // A Not chip is no reason a result matched.
  const chips = matches.chips.filter(chip => !isNot(chip));
  for (const chip of chips) {
    if (chip.kind === 'organisation' && row.organisation && organisationsFor(chip.value, [row.organisation]).length) {
      reasons.push({field: 'organisation', label: `Org ${chip.label}`, matched: [chip.value]});
      orgPhrases.push(chip.value);
    }
  }
  for (const chip of chips) if (chip.kind === 'type' && chip.value === row.type) reasons.push({field: 'type', label: `Type ${chip.label}`, matched: []});
  if (chips.some(chip => chip.kind === 'date')) reasons.push({field: 'date', label: `Date ${dayLabel(localDay(row.receivedAt, store.timeZone), today)}`, matched: []});
  for (const chip of chips) if (chip.kind === 'account' && chip.value === row.accountId) reasons.push({field: 'account', label: `Account ${chip.label}`, matched: []});
  for (const chip of chips) if (chip.kind === 'kind' && chip.value === row.kind) reasons.push({field: 'kind', label: `Kind ${chip.label}`, matched: []});
  // Each word under the best field it matched: "Subject lease renewal · Body signed".
  const typed = typedWords(matches.text);
  const told = new Set<string>();
  const bodyTerms: string[] = [];
  for (const {field, terms} of textMatches(row, matches.terms)) {
    const fresh = terms.filter(term => !told.has(term));
    terms.forEach(term => told.add(term));
    if (field === 'body') bodyTerms.push(...fresh);
    const words = fresh.map(term => typed.get(term) ?? term);
    if (words.length) reasons.push({field, label: `${TEXT_LABELS[field]} ${words.join(' ')}`, matched: words});
  }

  const runsIn = (value: string | null) => mergeRuns([...termRuns(value, matches.terms), ...orgPhrases.flatMap(phrase => phraseRuns(value, phrase))]);
  // The excerpt comes from what the index holds, so it never shows a word search no longer knows,
  // and shows the words only the body has ("Body signed"), else any. A word only the summary has
  // isn't in it: its reason stays, and the row has nothing to mark.
  const excerpt = excerptOf(row.searchBody, text => {
    const own = termRuns(text, bodyTerms);
    return own.length ? own : runsIn(text);
  });
  const highlights: HighlightOut[] = [];
  for (const [field, value] of [['from_name', row.fromName], ['organisation', row.organisation], ['subject', row.subject], ['excerpt', excerpt]] as const) {
    for (const run of runsIn(value)) highlights.push({field, ...run});
  }
  return {...out, reasons, excerpt, highlights};
}

export interface SearchOptions {
  // Alfred's searches aren't logged.
  log?: boolean;
}

/** POST /api/search: a page of results, the chips in force, and the search log's id. */
export function searchMail(store: Store, input: SearchRequest, {log = true}: SearchOptions = {}): SearchOut {
  const matches = matchSearch(store, input);
  const pageIds = matches.ids.slice(input.offset, input.offset + input.limit);
  const rows = messageRows(store, pageIds);
  const results = pageIds.flatMap(id => {
    const row = rows.get(id);
    return row ? [presentResult(store, row, matches)] : [];
  });
  const searchId = log ? logSearch(store, input, matches, pageIds) : 0;
  const next = input.offset + input.limit;
  return {
    search_id: searchId, chips: matches.chips, text: matches.text, order: matches.order, total: matches.ids.length, partial: matches.partial, results,
    next_offset: next < matches.ids.length ? next : null, indexing: indexing(store).indexing,
  };
}
