// While you were away's state (#298; DESIGN.md › News › While you were away): the user on News, the
// recap on screen, Done and its Undo. The rule for the hour away is src/domain/news.ts's; its stories
// are src/queries/news.ts's. A change the page draws goes out as a `news` event naming every section,
// so All, in any tab, asks again.
import {NEWS_SECTIONS} from '@setpoint/shared';
import type {RecapUndoOut} from '@setpoint/shared';
import {and, eq, inArray} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {recapAt} from '../domain/news.ts';
import type {RecapState} from '../domain/news.ts';
import {isoNow, noteLive, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {recapCondition} from './store.ts';

const NONE: RecapState = {putAwayAt: null, shownAt: null, storyIds: null, hereAt: null};

/** The recap's state as stored, before the hour away is applied. */
function stored(store: Store): RecapState {
  const row = store.db.select().from(t.newsRecap).where(eq(t.newsRecap.id, 1)).get();
  return row ? {putAwayAt: row.putAwayAt, shownAt: row.shownAt, storyIds: row.storyIds, hereAt: row.hereAt} : NONE;
}

/** The recap's state now: put away once it has shown and the user has been away from News for an hour. */
export const recapState = (store: Store): RecapState => recapAt(stored(store), isoNow(store));

function save(store: Store, state: RecapState) {
  store.db.insert(t.newsRecap).values({id: 1, ...state}).onConflictDoUpdate({target: t.newsRecap.id, set: state}).run();
}

const redraw = (store: Store) => noteLive(store, {type: 'news', stories: [], sections: [...NEWS_SECTIONS], sources: []});

/**
 * The user is on News: a page on screen, or a story seen. `shown` is the recap's stories when it's on
 * screen: the first time, it's fixed with those (the ones that can still be in it), so nothing slides
 * in. Coming back after an hour away, the last recap is put away first.
 */
export function noteHere(store: Store, shown: readonly number[] | null) {
  transaction(store, () => {
    const before = stored(store);
    let state = recapAt(before, isoNow(store));
    if (shown?.length && state.shownAt === null) {
      const kept = new Set(store.db.select({id: t.newsStories.id}).from(t.newsStories)
        .where(and(inArray(t.newsStories.id, [...shown]), recapCondition(state.putAwayAt))).all().map(row => row.id));
      if (kept.size) state = {...state, shownAt: isoNow(store), storyIds: shown.filter(id => kept.has(id))};
    }
    save(store, {...state, hereAt: isoNow(store)});
    if (state.putAwayAt !== before.putAwayAt) redraw(store);
  });
}

/** Done: the recap put away at once, its stories still unseen (D426). Returns what Undo puts back. */
export function putRecapAway(store: Store): RecapUndoOut {
  return transaction(store, () => {
    const now = isoNow(store);
    const before = recapState(store);
    save(store, {putAwayAt: now, shownAt: null, storyIds: null, hereAt: now});
    redraw(store);
    return {put_away_at: before.putAwayAt, shown_at: before.shownAt, story_ids: before.storyIds};
  });
}

/** Done's Undo: the recap as it was. */
export function undoPutAway(store: Store, undo: RecapUndoOut) {
  transaction(store, () => {
    save(store, {putAwayAt: undo.put_away_at, shownAt: undo.shown_at, storyIds: undo.story_ids, hereAt: isoNow(store)});
    redraw(store);
  });
}
