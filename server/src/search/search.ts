// Search (BRIEF.md › Search; DESIGN.md › Search): the field's words are free text over the full-text
// index, which holds an email's summary, its search terms (src/search/terms.ts) and its body without
// links or footers (src/domain/searchBody.ts). They rank by how well they matched
// (src/domain/searchMatch.ts › matchTier), newest first within each tier, with no importance boost
// (decision 9): what's about the search comes first, and `first` counts it, then what only mentions
// it. Words never become chips by themselves (D392): chips come from a suggestion the user accepted,
// a model's reading of the whole search and the date grammar (src/search/reading.ts), and a client
// sends them back. They narrow the list and keep its order. A "!word" alone still forms a chip here,
// a Not chip, since it says exactly what it leaves out, or stays text and leaves out the mail with
// it (SV-31).
// Search covers All's mail: archived mail is in (D14), trashed mail is out.
//
// Each search from the field is logged with its chips and the ids it returned, and opening a result
// records its position (src/search/log.ts), so ranking can be measured against real searches.
// Alfred runs the broad search through its tool, unlogged: its words each widen the search on their
// own, so its answers stay what they were (matching: 'broad').
import type {MatchReasonOut, HighlightOut, MessageType, SearchChip, SearchOut, SearchReadingOut, SearchResultOut, searchInput} from '@setpoint/shared';
import {asc} from 'drizzle-orm';
import type {z} from 'zod';
import * as t from '../db/schema.ts';
import {dayLabel, fold, isNot, parseQuery, sameChip, TYPE_LABELS, TYPE_WORDS, wordsOf} from '../domain/searchChips.ts';
import {withoutLinks} from '../domain/searchBody.ts';
import {excerptOf, FIELD_TIERS, formsOf, ftsExpression, isLinkOnly, matchTier, mergeRuns, namesType, phraseRuns, searchWords, termRuns, textLadder, textMatches, textTerms, TIER, typeWordsExpression, typeWordsIn, withoutExcluded} from '../domain/searchMatch.ts';
import type {RankedRow, SearchWord} from '../domain/searchMatch.ts';
import {localDay, zonedInstant} from '../domain/time.ts';
import {indexing, messageRows} from '../queries/mail.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {logSearch} from './log.ts';
import type {SearchReadingLog} from '../db/schema.ts';

export type SearchRequest = z.output<typeof searchInput>;

/** The organisations emails carry and the accounts, for the chip grammar. */
export function chipVocabulary(store: Store) {
  const organisations = (store.sqlite.prepare('SELECT DISTINCT organisation FROM messages WHERE organisation IS NOT NULL AND trashed_at IS NULL').all() as {organisation: string}[])
    .map(row => row.organisation);
  const accounts = store.db.select({id: t.accounts.id, label: t.accounts.label}).from(t.accounts).orderBy(asc(t.accounts.position)).all();
  return {organisations, accounts};
}

/** Organisations an organisation chip covers: those whose name starts with its words. */
export function organisationsFor(value: string, organisations: string[]): string[] {
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
function chipFilter(store: Store, chips: SearchChip[], accountId: number | undefined, organisations: string[], excluded: string[], readingTypes: boolean): Filter {
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
    const types = of('type').map(chip => chip.value);
    if (types.length && readingTypes && !negated) {
      filter.sql.push(`(m.type IN (${placeholders(types)}) OR m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?))`);
      filter.args.push(...types, typeWordsExpression(types));
    } else if (types.length) add('m.type', types);
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
  // Free text left after the chips, and the words the matches were found by.
  text: string;
  terms: string[];
  order: 'newest' | 'match';
  // No email had every word, so these have some of them (UX #10).
  partial: boolean;
  // Every match, in order.
  ids: number[];
  // How many of `ids`, from the top, are about the search; the rest only mention it.
  first: number;
  // A type chip also takes the type's word in an email's own fields (D386), and says which it found.
  readingTypes: boolean;
}

export interface MatchOptions {
  // 'ranked' is the field's search. 'broad' is Alfred's: every word counts, filler too, any one word
  // will do when no email has them all, the best field any word matched orders them, and its words
  // form every chip the grammar knows.
  matching?: 'ranked' | 'broad';
  // What the words of a ranked search form: nothing, as the field's typing and what's left of a
  // reading, or dates for what a suggestion might offer. A word naming a type also finds that type
  // (SV-137).
  chipsFromWords?: 'dates' | 'none';
  // Type chips are a reading's (D386), rather than the grammar's exact ones.
  readingTypes?: boolean;
  // The words as typed when a reading's chips stand for some of them. They rank as words do, none of
  // them required, so a reading narrows the list and what stays keeps its order (D392).
  rankText?: string;
}

interface Parsed {
  store: Store;
  filter: Filter;
  // Results with no ranking to do: the order of `none`.
  none: SearchMatches;
}

/** A word's emails: those the index has it for, and those of the type it names. */
function emailsWith(store: Store, filter: Filter, word: SearchWord): Set<number> {
  const type = TYPE_WORDS[word.term];
  const rows = store.sqlite.prepare(`
    SELECT m.id FROM messages m
    WHERE (m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)${type ? ' OR m.type = ?' : ''}) AND ${filter.sql.join(' AND ')}`)
    .all(ftsExpression([word.term], 'and'), ...(type ? [type] : []), ...filter.args) as {id: number}[];
  return new Set(rows.map(row => row.id));
}

type Ranked = Candidate & RankedRow;

function rankedRows(store: Store, ids: number[]): Ranked[] {
  return store.sqlite.prepare(`
    SELECT id, received_at, type, from_name AS fromName, from_address AS fromAddress, organisation, subject, summary, search_terms AS searchTerms, search_body AS searchBody
    FROM messages WHERE id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids)) as Ranked[];
}

/** Moves those of the emails that match only by a link's domain to the links' tier. */
function placeLinks(store: Store, emails: {row: Ranked; words: SearchWord[]; tier: number}[]) {
  const mentions = emails.filter(email => email.tier >= TIER.mention);
  const bodies = new Map((store.sqlite.prepare('SELECT id, body_text AS body FROM messages WHERE id IN (SELECT value FROM json_each(?))')
    .all(JSON.stringify(mentions.map(email => email.row.id))) as {id: number; body: string}[]).map(row => [row.id, row.body]));
  for (const email of mentions) if (isLinkOnly(email.row, email.words, withoutLinks(bodies.get(email.row.id) ?? ''))) email.tier = TIER.link;
}

/**
 * The words' matches in the field's order, by each one's tier, then a word the search names the type
 * of, then newest first. When no email has every word, the rarest words an email has rank it, and
 * only what has the rarest word found can be about the search. `ranking` is every word that ranks:
 * those beyond `words` no email has to have, since a reading's chip stands for them.
 */
function rankEmails({store, none}: Parsed, ranking: SearchWord[], words: SearchWord[], holders: Set<number>[], every: number[], partial: boolean): SearchMatches {
  const found = words.map((word, at) => ({word, emails: holders[at]!})).filter(({emails}) => emails.size);
  const rarest = [...found].sort((a, b) => a.emails.size - b.emails.size);
  const ids = partial ? [...new Set(found.flatMap(({emails}) => [...emails]))] : every;
  const required = new Set(words.map(word => word.term));
  const emails = rankedRows(store, ids).map(row => {
    // In the order typed, for a phrase.
    const had = ranking.filter(word => !required.has(word.term) || found.some(({word: {term}, emails}) => term === word.term && emails.has(row.id)));
    return {
      row, words: had, tier: matchTier(row, had),
      // Each rarer word outweighs all the commoner ones together.
      rarity: rarest.reduce((sum, {emails}) => sum * 2 + (emails.has(row.id) ? 1 : 0), 0),
      about: rarest[0]?.emails.has(row.id) ?? true,
      names: ranking.some(word => namesType(word, row)),
    };
  });
  placeLinks(store, emails);
  const isFirst = (email: (typeof emails)[number]) => email.about && email.tier < TIER.mention;
  const order = (a: (typeof emails)[number], b: (typeof emails)[number]) => Number(isFirst(b)) - Number(isFirst(a)) || b.rarity - a.rarity || a.tier - b.tier || Number(b.names) - Number(a.names) || newestFirst(a.row, b.row);
  return {...none, terms: ranking.map(word => word.term), partial, ids: emails.sort(order).map(email => email.row.id), first: emails.filter(isFirst).length};
}

/** The field's search: every word but filler, and failing that the rarest words any email has. */
function rankedSearch(parsed: Parsed, input: Pick<SearchRequest, 'text'>, text: string, {rankText}: MatchOptions): SearchMatches {
  const {store, filter, none} = parsed;
  const lastWord = (value: string) => fold(value).match(/[\p{L}\p{N}]+$/u)?.[0];
  const typing = lastWord(input.text) !== undefined && lastWord(input.text) === lastWord(text);
  const dropAllFiller = none.chips.some(chip => !isNot(chip));
  const words = searchWords(text, {typing, dropAllFiller});
  const ranking = rankText === undefined ? words : searchWords(withoutExcluded(rankText).text, {typing, dropAllFiller});
  const everyRow = () => (store.sqlite.prepare(`SELECT m.id, m.received_at FROM messages m WHERE ${filter.sql.join(' AND ')}`).all(...filter.args) as Candidate[]);
  if (!ranking.length) return inOrder(none, everyRow().sort(newestFirst));
  const holders = words.map(word => emailsWith(store, filter, word));
  const every = words.length ? [...holders[0]!].filter(id => holders.every(emails => emails.has(id))) : everyRow().map(row => row.id);
  const partial = !every.length && words.length > 0;
  if (partial && holders.every(emails => !emails.size)) return none;
  return rankEmails(parsed, ranking, words, holders, every, partial);
}

/** Matches with one section, in the order given. */
const inOrder = (none: SearchMatches, rows: Candidate[]): SearchMatches => ({...none, ids: rows.map(row => row.id), first: rows.length});

/** Alfred's search: every word, then any word but filler, by the best field any word matched. */
function broadSearch({store, filter, none}: Parsed, text: string): SearchMatches {
  const ladder = textLadder(text);
  if (!ladder.length) return inOrder(none, (store.sqlite.prepare(`SELECT m.id, m.received_at FROM messages m WHERE ${filter.sql.join(' AND ')}`).all(...filter.args) as Candidate[]).sort(newestFirst));
  for (const step of ladder) {
    const rows = textCandidates(store, filter, ftsExpression(step.terms, step.mode));
    if (!rows.length) continue;
    const partial = step.step !== 'all';
    if (none.order === 'newest') return {...inOrder(none, rows.sort(newestFirst)), terms: step.terms, partial};
    // Free text alone: the best field any word matched, then newest first.
    const tierOf = new Map<number, number>();
    FIELD_TIERS.forEach(({columns}, tier) => {
      for (const row of textCandidates(store, filter, ftsExpression(step.terms, 'or', columns))) if (!tierOf.has(row.id)) tierOf.set(row.id, tier);
    });
    const tier = (row: Candidate) => tierOf.get(row.id) ?? FIELD_TIERS.length;
    return {...inOrder(none, rows.sort((a, b) => tier(a) - tier(b) || newestFirst(a, b))), terms: step.terms, partial};
  }
  return none;
}

/** Every email a search matches, in its order. */
export function matchSearch(store: Store, input: Pick<SearchRequest, 'text' | 'chips' | 'account_id'>, options: MatchOptions = {}): SearchMatches {
  const {matching = 'ranked', chipsFromWords = 'none', readingTypes = false, rankText} = options;
  const broad = matching === 'broad';
  const vocabulary = chipVocabulary(store);
  const parsed = parseQuery(input.text, {...vocabulary, now: isoNow(store), timeZone: store.timeZone, fromWords: broad ? 'all' : chipsFromWords});
  const chips: SearchChip[] = [];
  for (const chip of [...input.chips, ...parsed.chips]) if (!chips.some(existing => sameChip(existing, chip))) chips.push(chip);
  const {text, excluded} = withoutExcluded(parsed.text);
  const filter = chipFilter(store, chips, input.account_id, vocabulary.organisations, excluded, readingTypes);
  const hasWords = textTerms(rankText ?? text).length > 0;
  // Chips leave the order to the words, a reading's as much as a date. Only Alfred's take it over,
  // and leaving out alone doesn't: words with only Not chips still order by the best field.
  const ordering = broad && chips.some(chip => !isNot(chip));
  const order = ordering || !hasWords ? 'newest' : 'match';
  const none: SearchMatches = {chips, text: parsed.text, terms: [], order, partial: false, ids: [], first: 0, readingTypes};
  if (filter.empty || (!chips.length && !hasWords && !excluded.length)) return none;
  const search = {store, filter, none};
  return broad ? broadSearch(search, text) : rankedSearch(search, input, text, options);
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
  const typeChips = chips.filter(chip => chip.kind === 'type');
  for (const chip of typeChips) if (chip.value === row.type) reasons.push({field: 'type', label: `Type ${chip.label}`, matched: []});
  if (chips.some(chip => chip.kind === 'date')) reasons.push({field: 'date', label: `Date ${dayLabel(localDay(row.receivedAt, store.timeZone), today)}`, matched: []});
  for (const chip of chips) if (chip.kind === 'account' && chip.value === row.accountId) reasons.push({field: 'account', label: `Account ${chip.label}`, matched: []});
  for (const chip of chips) if (chip.kind === 'kind' && chip.value === row.kind) reasons.push({field: 'kind', label: `Kind ${chip.label}`, matched: []});
  // Each word under the best field it matched: "Subject lease renewal · Body signed".
  const typed = typedWords(matches.text);
  const told = new Set<string>();
  const bodyTerms: string[] = [];
  const byText = textMatches(row, matches.terms).flatMap(({field, terms}) => {
    const fresh = terms.filter(term => !told.has(term));
    terms.forEach(term => told.add(term));
    if (field === 'body') bodyTerms.push(...fresh);
    const words = fresh.map(term => typed.get(term) ?? term);
    return words.length ? [{field, label: `${TEXT_LABELS[field]} ${words.join(' ')}`, matched: words}] : [];
  });
  // A word found only because it names the email's type (SV-137) has no text to point at.
  const named = new Set<MessageType>(matches.terms.flatMap(term => {
    const type = told.has(term) ? undefined : TYPE_WORDS[term];
    return type && type === row.type && !typeChips.some(chip => chip.value === type) ? [type] : [];
  }));
  for (const type of named) reasons.push({field: 'type', label: `Type ${TYPE_LABELS[type]}`, matched: []});
  reasons.push(...byText);
  // A reading's type chip that found its word, not the type (D386): where the word was.
  const typeWords: string[] = [];
  for (const chip of matches.readingTypes ? typeChips : []) {
    const found = chip.value === row.type ? null : typeWordsIn(row, chip.value);
    if (!found) continue;
    typeWords.push(...found.words);
    const fresh = found.words.filter(word => !formsOf(word).some(form => told.has(form)));
    if (fresh.length) reasons.push({field: found.field, label: `${TEXT_LABELS[found.field]} ${fresh.join(' ')}`, matched: fresh});
  }

  const runsIn = (value: string | null) => mergeRuns([...termRuns(value, [...matches.terms, ...typeWords]), ...orgPhrases.flatMap(phrase => phraseRuns(value, phrase))]);
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

export interface SearchOptions extends MatchOptions {
  // Alfred's searches aren't logged.
  log?: boolean;
}

/** The page of `matches` the request asks for, logged as `log` says, or left out of the log. */
export function answerSearch(store: Store, input: SearchRequest, matches: SearchMatches, reading: SearchReadingOut | null, log: {reading: SearchReadingLog | null} | null): SearchOut {
  const pageIds = matches.ids.slice(input.offset, input.offset + input.limit);
  const rows = messageRows(store, pageIds);
  const results = pageIds.flatMap(id => {
    const row = rows.get(id);
    return row ? [presentResult(store, row, matches)] : [];
  });
  const searchId = log ? logSearch(store, input, matches, pageIds, log.reading) : input.search_id ?? 0;
  const next = input.offset + input.limit;
  return {
    search_id: searchId, chips: matches.chips, text: matches.text, order: matches.order, total: matches.ids.length, first_section: matches.first, partial: matches.partial, results,
    next_offset: next < matches.ids.length ? next : null, indexing: indexing(store).indexing, reading,
  };
}

/** POST /api/search without `read`: a page of results, the chips in force, and the search log's id. */
export function searchMail(store: Store, input: SearchRequest, {log = true, ...options}: SearchOptions = {}): SearchOut {
  return answerSearch(store, input, matchSearch(store, input, options), null, log ? {reading: null} : null);
}
