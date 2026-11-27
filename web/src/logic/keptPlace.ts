// Every page keeps the user's place while the app is open. Going back to a page by its link, number
// key, palette or phone tab opens it at its kept place; the same way in from the page itself opens
// its fresh start, the way home. These are the rules for that: which address a way in goes to, and
// which row a kept scroll comes back to once the list has changed.
import type {Route} from './route.ts';

/** The pages that keep a place. Settings is a modal over them, and keeps none. */
export type PlacePage = Exclude<Route['page'], 'settings'>;

/** A page's fresh start: nothing open, no search, its default view, at its top. */
export function freshRoute(page: PlacePage): Route {
  switch (page) {
    case 'calendar':
      return {page, date: null, item: null, at: null};
    case 'news':
      return {page, view: 'all', story: null, article: null};
    default:
      return {page, open: null};
  }
}

/**
 * A kept address as it comes back. What only an arrival asks for doesn't come back with it: the
 * calendar's editor (kept by the page itself while a draft holds anything), and Jobs' query from mail
 * and From history's unfolding.
 */
export function keptRoute(route: Route): Route {
  if (route.page === 'calendar') {
    const {compose: _compose, edit: _edit, ...rest} = route;
    return rest;
  }
  if (route.page === 'jobs') {
    const {q: _q, history: _history, ...rest} = route;
    return rest;
  }
  return route;
}

/**
 * Where a way in to `page` goes from `here`: its fresh start from the page itself, else its kept
 * place, else its fresh start. `fresh` says whatever else the page kept is dropped.
 */
export function wayIn(page: PlacePage, here: Route, kept: Route | undefined): {route: Route; fresh: boolean} {
  if (here.page === page) return {route: freshRoute(page), fresh: true};
  return {route: kept ? keptRoute(kept) : freshRoute(page), fresh: false};
}

/** A list's kept scroll: the rows' keys in order around the top one, which is `at`, and how far its top was from the list's. */
export interface ScrollAnchor {
  keys: string[];
  at: number;
  offset: number;
}

/**
 * The row a kept scroll comes back to: the one that was at the top, or while it's gone the nearest
 * kept neighbour still there, the one after it first (it took the gone row's place), then the one
 * before. None when no kept row is left.
 */
export function anchorRow(anchor: ScrollAnchor, present: ReadonlySet<string>): string | null {
  const {keys, at} = anchor;
  for (let step = 0; step < keys.length; step++) {
    const after = keys[at + step];
    if (after !== undefined && present.has(after)) return after;
    const before = step > 0 ? keys[at - step] : undefined;
    if (before !== undefined && present.has(before)) return before;
    if (at + step >= keys.length && at - step < 0) break;
  }
  return null;
}
