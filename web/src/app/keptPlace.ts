// Each page's kept place (logic/keptPlace.ts has the rules), in memory while the app is open: its last
// address, and what the page wrote there while it showed (scroll, search, folds, cursor). A page reads
// it back as it mounts. The router drops a page's place when the page is arrived at any other way
// than a way back to it, and a fresh start drops it and draws the page anew.
//
// A place belongs to one visit at a time: a dropped place is replaced by a new one, so whatever the
// page that kept it still writes goes nowhere. What only matters as the page is left (scroll) is
// written then, by the leave hooks, while the page is still on screen.
import {createContext, createElement, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import type {Dispatch, ReactNode, SetStateAction} from 'react';
import {anchorRow} from '../logic/keptPlace.ts';
import type {PlacePage, ScrollAnchor} from '../logic/keptPlace.ts';
import type {Route} from '../logic/route.ts';

export interface Place {
  id: number;
  values: Map<string, unknown>;
  /** What to write as the page is left. */
  leaving: Set<() => void>;
}

let ids = 0;
const places = new Map<PlacePage, Place>();
const routes = new Map<PlacePage, Route>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const newPlace = (): Place => ({id: ++ids, values: new Map(), leaving: new Set()});
const placeOf = (page: PlacePage) => places.get(page) ?? places.set(page, newPlace()).get(page)!;
const placePage = (page: Route['page']): PlacePage | null => (page === 'settings' ? null : page);

/** The page's address as it was last, for a way back to it. */
export const keptAddress = (page: PlacePage) => routes.get(page);

/** The address showing, kept as its page's. */
export function keepAddress(route: Route) {
  const page = placePage(route.page);
  if (page) routes.set(page, route);
}

/** Drops what the page kept. While it shows, it's drawn anew. */
export function dropPlace(page: Route['page']) {
  const one = placePage(page);
  if (!one) return;
  routes.delete(one);
  places.set(one, newPlace());
  listeners.forEach(listener => listener());
}

const PlaceContext = createContext<Place | null>(null);

function Visit({place, children}: {place: Place; children: ReactNode}) {
  useLayoutEffect(() => () => place.leaving.forEach(leave => leave()), [place]);
  return createElement(PlaceContext.Provider, {value: place}, children);
}

/** A page with its place: drawn anew when the place is dropped. */
export function KeptPlace({page, children}: {page: Route['page']; children: ReactNode}) {
  const one = placePage(page);
  const place = useSyncExternalStore(subscribe, () => (one ? placeOf(one) : null));
  if (!place) return children;
  return createElement(Visit, {key: `${one}:${place.id}`, place, children});
}

/** The place of the page this is drawn in, or none outside one. */
export const usePlace = () => useContext(PlaceContext);

/** Runs `leave` as the page is left, while it's still on screen. */
export function useOnLeave(leave: () => void) {
  const place = usePlace();
  const latest = useRef(leave);
  useLayoutEffect(() => {
    latest.current = leave;
  });
  useLayoutEffect(() => {
    if (!place) return;
    const one = () => latest.current();
    place.leaving.add(one);
    return () => void place.leaving.delete(one);
  }, [place]);
}

/**
 * useState, kept in the page's place: it comes back with the page. Outside a page it's plain state.
 * A change is kept as it's made, so one made as the page goes (find folding back what it opened) is too.
 */
export function useKept<T>(key: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const place = usePlace();
  const [value, setValue] = useState<T>(() => (place?.values.has(key) ? place.values.get(key) as T : typeof initial === 'function' ? (initial as () => T)() : initial));
  const latest = useRef({key, value});
  const [set] = useState(() => (action: SetStateAction<T>) => {
    const next = typeof action === 'function' ? (action as (now: T) => T)(latest.current.value) : action;
    latest.current = {...latest.current, value: next};
    place?.values.set(latest.current.key, next);
    setValue(next);
  });
  return [value, set];
}

/** What names a list's rows: the Inbox's and search's `data-key`, or the smaller lists' `data-id`. */
export type RowName = 'key' | 'id';
const keyed = (list: HTMLElement, by: RowName) => [...list.querySelectorAll<HTMLElement>(`[data-${by}]`)].map(row => ({row, key: row.dataset[by]!}));

// How many keys either side of the top row a kept scroll holds, to find a neighbour by.
const NEIGHBOURS = 60;

/** Where a list is scrolled, by the row at its top. None at its top, so mail arriving above shows. */
export function scrollAnchor(list: HTMLElement, by: RowName = 'key'): ScrollAnchor | null {
  if (list.scrollTop <= 0) return null;
  const top = list.getBoundingClientRect().top;
  const rows = keyed(list, by);
  const at = rows.findIndex(({row}) => row.getBoundingClientRect().bottom > top + 1);
  const first = rows[at];
  if (!first) return null;
  const from = Math.max(0, at - NEIGHBOURS);
  return {keys: rows.slice(from, at + NEIGHBOURS).map(({key}) => key), at: at - from, offset: first.row.getBoundingClientRect().top - top};
}

/** Scrolls a list back to its kept row, at the distance from the list's top it was: the row it came back to. */
export function scrollToAnchor(list: HTMLElement, anchor: ScrollAnchor, by: RowName = 'key'): string | null {
  const rows = new Map(keyed(list, by).map(({row, key}) => [key, row]));
  const key = anchorRow(anchor, new Set(rows.keys()));
  const row = key ? rows.get(key) : undefined;
  if (row) list.scrollTop += row.getBoundingClientRect().top - list.getBoundingClientRect().top - anchor.offset;
  return row ? key : null;
}

/**
 * Calls `give` at the user's own first scroll of `box` (the wheel, a touch, the scrollbar, a key), to
 * which a kept place on its way back gives way. Returns how to stop listening.
 */
export function onUserScroll(box: HTMLElement, give: () => void): () => void {
  const pointers = ['wheel', 'touchstart', 'pointerdown'] as const;
  const once = () => {
    stop();
    give();
  };
  const stop = () => {
    for (const kind of pointers) box.removeEventListener(kind, once);
    document.removeEventListener('keydown', once, true);
  };
  for (const kind of pointers) box.addEventListener(kind, once, {passive: true});
  document.addEventListener('keydown', once, true);
  return stop;
}

/**
 * A list's scroll, kept in the page's place under `key` as the page is left, and brought back to its
 * row once `ready` (its rows are there). Until the user scrolls, it stays at that row as the list
 * changes (the kept list's fresh answer, new mail above), so nothing pushes them off their spot.
 */
export function useKeptScroll(key: string, list: () => HTMLElement | null, ready: boolean, by: RowName = 'key') {
  const place = usePlace();
  const pending = useRef(place?.values.get(key) as ScrollAnchor | undefined);
  const held = useRef<{list: HTMLElement; anchor: ScrollAnchor; let: () => void} | null>(null);
  const find = useRef(list);
  useLayoutEffect(() => {
    find.current = list;
  });
  useLayoutEffect(() => {
    const element = find.current();
    if (held.current && held.current.list !== element) held.current.let();
    if (held.current) {
      scrollToAnchor(held.current.list, held.current.anchor, by);
      return;
    }
    if (!pending.current || !ready || !element) return;
    const anchor = pending.current;
    pending.current = undefined;
    const row = scrollToAnchor(element, anchor, by);
    if (!row) return;
    const kept = {keys: [row], at: 0, offset: anchor.offset};
    // A row folding in or out moves what's under it without the page drawing again: its part of the
    // list resizing puts the kept row back.
    const resized = new ResizeObserver(() => scrollToAnchor(element, kept, by));
    const watch = () => [...element.children].forEach(child => resized.observe(child));
    const added = new MutationObserver(watch);
    watch();
    added.observe(element, {childList: true});
    const release = () => {
      stopListening();
      resized.disconnect();
      added.disconnect();
      held.current = null;
    };
    const stopListening = onUserScroll(element, release);
    held.current = {list: element, anchor: kept, let: release};
  });
  useLayoutEffect(() => () => held.current?.let(), []);
  useOnLeave(() => {
    if (!place) return;
    const element = find.current();
    const anchor = element ? scrollAnchor(element, by) : null;
    const kept = anchor ?? (element && ready ? null : pending.current ?? null);
    if (kept) place.values.set(key, kept);
    else place.values.delete(key);
  });
}

/**
 * The email or item a page kept open, closed once it's back if the list no longer has it (it was
 * archived, deleted or snoozed meanwhile): the page comes back with nothing open, at its kept scroll.
 * It's watched until the user opens something else, as the list may first show from before.
 */
export function useKeptOpen(open: number | null, listed: (id: number) => boolean, ready: boolean, close: () => void) {
  const place = usePlace();
  const [kept] = useState(() => place?.values.get('open') as number | undefined);
  const [watching, setWatching] = useState(kept !== undefined);
  if (watching && open !== kept) setWatching(false);
  // Closing it ends the watch, as the open email is then none.
  const gone = watching && ready && kept !== undefined && !listed(kept);
  const closing = useRef(close);
  useLayoutEffect(() => {
    closing.current = close;
  });
  useLayoutEffect(() => {
    if (gone) closing.current();
  }, [gone]);
  useOnLeave(() => {
    if (!place) return;
    if (open !== null && listed(open)) place.values.set('open', open);
    else place.values.delete('open');
  });
}
