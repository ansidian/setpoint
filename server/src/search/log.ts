// The search log (BRIEF.md › Search: "Searches and the position of the opened result are logged, so
// ranking can be measured against real searches rather than made-up ones"): each search's text, its
// chips, the ids it returned in order, each result opened with its position, and since SV-138 each
// chip taken off it, so wrong readings can be seen. Since D392, each suggestion offered, with whether
// it was shown and accepted, so suggestions can be judged.
//
// The field searches as the user types, so a search that only extends or trims the one before it, within
// a few seconds and with nothing opened from it, replaces that row rather than adding one: the log
// keeps "northwind rejection march", not "nor", "northw", "northwind r"….
import type {searchChipRemovedInput, SearchChip, searchInput, searchSuggestionLogInput} from '@setpoint/shared';
import {desc, eq} from 'drizzle-orm';
import type {z} from 'zod';
import * as t from '../db/schema.ts';
import type {SearchReadingLog} from '../db/schema.ts';
import {chipWords} from '../domain/searchChips.ts';
import {notFound} from '../errors.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import type {SearchMatches} from './search.ts';

const TYPING_MS = 10_000;

/** What the field shows: its chips' labels, then the free text. */
const fieldText = (chips: SearchChip[], text: string) => [...chips.map(chipWords), text.trim()].filter(Boolean).join(' ').toLowerCase();

/** Logs a search (or its next page, with `search_id`) and returns its id. */
export function logSearch(store: Store, input: z.output<typeof searchInput>, matches: SearchMatches, pageIds: number[], reading: SearchReadingLog | null = null): number {
  const now = isoNow(store);
  if (input.search_id) {
    const row = store.db.select().from(t.searchLog).where(eq(t.searchLog.id, input.search_id)).get();
    if (!row) throw notFound('No such search.');
    const resultIds = [...row.resultIds.slice(0, input.offset), ...pageIds];
    store.db.update(t.searchLog).set({resultIds, total: matches.ids.length}).where(eq(t.searchLog.id, row.id)).run();
    return row.id;
  }
  const values = {
    at: now, query: input.typed ?? input.text, freeText: matches.text, chips: matches.chips, accountId: input.account_id ?? null,
    order: matches.order, total: matches.ids.length, resultIds: pageIds, reading,
  };
  const last = store.db.select().from(t.searchLog).orderBy(desc(t.searchLog.id)).limit(1).get();
  if (last && Date.parse(now) - Date.parse(last.at) < TYPING_MS && last.accountId === values.accountId && input.offset === 0) {
    const before = fieldText(last.chips, last.freeText);
    // A read search is the field's words as they stood, whatever the reading made of them.
    const typed = input.read ? fieldText(input.chips, input.text) : fieldText(matches.chips, matches.text);
    const opened = store.db.select({id: t.searchOpens.id}).from(t.searchOpens).where(eq(t.searchOpens.searchId, last.id)).limit(1).get();
    if (!opened && (typed.startsWith(before) || before.startsWith(typed))) {
      store.db.update(t.searchLog).set(values).where(eq(t.searchLog.id, last.id)).run();
      return last.id;
    }
  }
  return store.db.insert(t.searchLog).values(values).returning({id: t.searchLog.id}).get().id;
}

/** A suggestion as the server offers it, not yet on screen. */
export function logSuggestion(store: Store, values: Pick<typeof t.searchSuggestions.$inferInsert, 'query' | 'accountId' | 'chips' | 'words' | 'hides' | 'total' | 'reading'>): number {
  return store.db.insert(t.searchSuggestions).values({...values, at: isoNow(store)}).returning({id: t.searchSuggestions.id}).get().id;
}

/** POST /api/search/suggestion-log: a suggestion reached the screen, or was accepted. */
export function recordSuggestion(store: Store, {id, event, search_id: searchId}: z.output<typeof searchSuggestionLogInput>) {
  const at = isoNow(store);
  const change = event === 'shown' ? {shownAt: at} : {acceptedAt: at, ...(searchId === undefined ? {} : {searchId})};
  if (!store.db.update(t.searchSuggestions).set(change).where(eq(t.searchSuggestions.id, id)).returning({id: t.searchSuggestions.id}).get()) throw notFound('No such suggestion.');
}

/** POST /api/search/opened: the user opened the result at `position` (0-based) of a logged search. */
export function recordOpened(store: Store, input: {search_id: number; message_id: number; position: number}) {
  const search = store.db.select({id: t.searchLog.id}).from(t.searchLog).where(eq(t.searchLog.id, input.search_id)).get();
  if (!search) throw notFound('No such search.');
  const message = store.db.select({id: t.messages.id}).from(t.messages).where(eq(t.messages.id, input.message_id)).get();
  store.db.insert(t.searchOpens).values({searchId: search.id, messageId: message?.id ?? null, position: input.position, at: isoNow(store)}).run();
}

/** POST /api/search/chip-removed: the user took a chip off a logged search. */
export function recordChipRemoved(store: Store, input: z.output<typeof searchChipRemovedInput>) {
  const search = store.db.select({id: t.searchLog.id}).from(t.searchLog).where(eq(t.searchLog.id, input.search_id)).get();
  if (!search) throw notFound('No such search.');
  store.db.insert(t.searchChipRemovals).values({searchId: search.id, chip: input.chip, at: isoNow(store)}).run();
}

/** A search's log row with its opens and removed chips, for tests and the CLI. */
export function searchLogEntry(store: Store, searchId: number) {
  const row = store.db.select().from(t.searchLog).where(eq(t.searchLog.id, searchId)).get();
  if (!row) return null;
  const opens = store.db.select({messageId: t.searchOpens.messageId, position: t.searchOpens.position}).from(t.searchOpens)
    .where(eq(t.searchOpens.searchId, searchId)).orderBy(t.searchOpens.id).all();
  const removed = store.db.select({chip: t.searchChipRemovals.chip}).from(t.searchChipRemovals).where(eq(t.searchChipRemovals.searchId, searchId)).orderBy(t.searchChipRemovals.id).all().map(({chip}) => chip);
  return {...row, opens, removed};
}
