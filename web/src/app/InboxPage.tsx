// The Inbox page: the header, the list (one list since SV-70: New, Attention, the Pinned shelf, then
// every email by day) and the reading pane, with mail's keys (DESIGN.md › Interaction rules). An email
// turns read only when opened, by a click or Enter (or Mark all as read); moving the cursor, scrolling
// and opening a Noise line never read anything. Each email keeps its place for the visit (D264), so
// one read in New stays there until the user leaves the Inbox.
// The keyboard cursor is a `sub2` fill that J and K move and the pointer takes (with an email open,
// J and K open the next and previous one instead); Enter opens; H Done,
// E Trash (each with Undo in the toast, and ⌘Z), P Pin, O Open in Gmail, ⇧I Mark all as read, ⇧U Mark unread, U to New's
// first email; Esc closes the reader. Done or Trash on the open email opens the next one (2026-10-07).
//
// Search (DESIGN.md › Search): while the header's field holds a search, its results replace the list
// and the header reads "Search"; the reading pane, J, K and Enter work the same, and each open is
// logged with its position. ⌘Enter asks Alfred, whose Answer card sits above the results. Esc closes
// the reader, then the card, then the search.
//
// On the phone (DESIGN.md › Phone; board 21) the header is the mark, Inbox and its counts, the
// account filter and Mark all as read, with a plain search field under it (no chips, no Alfred).
import type {AllOut, InboxGroupOut, InboxOut, ItemKind, MailCountsOut, MessageOut, MessageRowOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useState} from 'react';
import type {MouseEvent as ReactMouseEvent} from 'react';
import {flushSync} from 'react-dom';
import {serverNow, timeZone} from '../api/auth.ts';
import {getCached, getJson, prefetch, refreshIfShown, useResource, useResources} from '../api/client.ts';
import {
  allPath, answerPrompt, COUNTS_PATH, inboxPath, markAllRead, markRead, markUnread, messagePath, openMessage, PROMPTS_PATH, setDone, setPinned, trashMessage, untrashMessage,
} from '../api/mail.ts';
import {clearNew, dayStops, dayView, groupByDay, NEW, placeRows, splitInbox} from '../logic/all.ts';
import type {Place} from '../logic/all.ts';
import {readerMarks} from '../logic/search.ts';
import {
  allStops, codeExpired, keepCursor, keepShown, markAllReadIds, moveCursor, neighbour, nextAfterLeaving, nextCodeChange, stopOf, visiblePrompt, withHeld, withoutEmails, withoutExpiredCodes,
} from '../logic/inbox.ts';
import {readerActions} from '../logic/reader.ts';
import type {HeldRow, PatternPrompt, Stop} from '../logic/inbox.ts';
import type {Route} from '../logic/route.ts';
import {tabTitle} from '../logic/title.ts';
import {Icon, Mark} from '../ui/Icon.tsx';
import {echoKey, isTyping, plainKey} from '../ui/keys.ts';
import {useAccountColumn, useAccounts} from './accounts.ts';
import {AllList} from './AllList.tsx';
import {useNow} from './clock.ts';
import {beats, foldAway} from './fold.ts';
import type {Beat} from './fold.ts';
import {usePhone} from './Phone.tsx';
import {askCard, Reader} from './Reader.tsx';
import {openContextMenu} from './ContextMenu.tsx';
import {emailActions} from './emailActions.ts';
import type {Travel} from './Reader.tsx';
import {useCommands} from './palette/commands.ts';
import type {Command} from './palette/commands.ts';
import {navigate} from './router.ts';
import {AnswerCard} from './search/AnswerCard.tsx';
import {SearchField, SearchResults} from './search/Search.tsx';
import {LoadFailed, useAfter, useArrival, useLoadFailed} from './states/Loading.tsx';
import {AllSkeleton, SearchSkeleton} from './states/Skeletons.tsx';
import {skeleton} from '../tokens.ts';
import {useAlfred, useSearch} from './search/state.ts';
import {toInbox} from './toInbox.ts';
import {dismissToast, showToast, toastFailure} from './toast.ts';

type InboxRoute = Extract<Route, {page: 'inbox'}>;

/**
 * Whether any of the Pinned shelf shows in the list, where a pin lands; with no shelf yet, whether
 * the place it comes (above the first day) does. Below New and Attention it can be out of sight
 * either way (#243).
 */
function shelfInView(): boolean {
  const list = document.querySelector<HTMLElement>('.content > .list');
  if (!list) return true;
  const box = list.getBoundingClientRect();
  const shelf = [...list.querySelectorAll<HTMLElement>('.row.shelf:not(.leaving)')];
  const places = shelf.length ? shelf : [...list.querySelectorAll<HTMLElement>('.gh.day')].slice(0, 1);
  if (!places.length) return true;
  return places.some(place => {
    const at = place.getBoundingClientRect();
    return at.bottom > box.top + 1 && at.top < box.bottom - 1;
  });
}

// The email last opened, so the address following an open doesn't open it twice; a deep link,
// a reload or Back to an email opens it.
let lastOpened: number | null = null;

// ⌘Z: what undoes each Done and Trash made here, newest last; the toast's Undo runs the same one.
const undos: (() => void)[] = [];

// The slide under way, so one that a newer one cut short doesn't take the newer one's direction away.
let slides = 0;

/**
 * The phone's push and back (#139): the reader slides in over the list, which moves a little under it,
 * and slides back off it, as one 260 ms view transition (phone.css draws it, by the direction on the
 * root). Only the app's own opens and closes slide: the browser's Back (popstate) doesn't, as Safari's
 * edge swipe animates it already. Without the API it's the cut it was.
 */
function slide(direction: 'in' | 'back', update: () => void) {
  if (!('startViewTransition' in document)) return update();
  const root = document.documentElement;
  const token = ++slides;
  root.dataset.slide = direction;
  void document.startViewTransition(() => flushSync(update)).finished.finally(() => {
    if (token === slides) delete root.dataset.slide;
  });
}

/**
 * A visit's held rows, the server's list they were last worked out against, what was taken out here,
 * and where each email the visit has seen sits (D264). Answers asked for before the visit `began`
 * may be stale, so places worked out from them are only provisional, worked out afresh from what's
 * shown, until both lists have answered a load asked for since (`settled`); then they stay.
 */
interface Kept {
  visit: string;
  groups: InboxGroupOut[] | null;
  held: HeldRow[];
  out: ReadonlySet<number>;
  placed: ReadonlyMap<number, Place>;
  began: number;
  settled: boolean;
  // What the provisional places were worked out from.
  from: unknown[] | null;
}

export function InboxPage({route}: {route: InboxRoute}) {
  // The next moment a code row changes by itself, so its countdown and its leaving are on time.
  const [codeMoment, setCodeMoment] = useState<number | null>(null);
  const now = useNow(codeMoment);
  const zone = timeZone();
  const {list: accountList, byId: accounts} = useAccounts();
  const filteredTo = route.account ? accounts.get(route.account)?.label ?? null : null;
  const accountWidth = useAccountColumn(accountList);
  const phone = usePhone();
  const inboxLoad = {path: inboxPath(route.account), ...useResource<InboxOut>(inboxPath(route.account))};
  const inbox = inboxLoad.data;
  const {data: counts} = useResource<MailCountsOut>(COUNTS_PATH);
  const {data: openMessageData} = useResource<MessageOut>(route.open ? messagePath(route.open) : null);
  // Emails Trash took out here, hidden at once rather than when the server's list leaves them out;
  // Undo, or a refused Trash, lets one back.
  const [trashing, setTrashing] = useState<ReadonlySet<number>>(new Set());
  const untrashing = (id: number) => setTrashing(ids => new Set([...ids].filter(one => one !== id)));
  const search = useSearch(route.account, phone);
  const alfred = useAlfred();
  const searching = search.active || alfred.open;
  // A search's first answer on its way: the list stays, dimmed, then gives way to the results'
  // skeleton once it's taken a moment (search-03, #235).
  const firstWait = search.active && search.out === null && search.error === null && !alfred.open;
  const waitedLong = useAfter(firstWait, skeleton.delayMs);

  // All's pages: the first, then one more each time the list nears its end.
  const [befores, setBefores] = useState<string[]>([]);
  const allPaths = [allPath(route.account), ...befores.map(before => allPath(route.account, before))];
  const allPages = useResources<AllOut>(allPaths);
  const {error: allError, askedAt: allAskedAt} = useResource<AllOut>(allPath(route.account));
  const allRows = useMemo(() => allPages.flatMap(page => page?.days.flatMap(day => day.rows) ?? []).filter(row => !trashing.has(row.id)), [allPages, trashing]);
  // The days whose Noise the user opened here, and New's (NEW); each starts folded.
  const [noiseOpen, setNoiseOpen] = useState<ReadonlySet<string>>(new Set());
  const toggleNoise = (date: string) => setNoiseOpen(dates => (dates.has(date) ? new Set([...dates].filter(one => one !== date)) : new Set(dates).add(date)));
  const loadMore = () => {
    const next = allPages.at(-1)?.next_before;
    if (next && !befores.includes(next)) setBefores([...befores, next]);
  };

  // The pattern prompt (B3's; none until its route exists), and the ones answered here.
  const {data: prompts} = useResource<PatternPrompt[]>(PROMPTS_PATH);
  const [answered, setAnswered] = useState<ReadonlySet<number>>(new Set());
  const prompt = visiblePrompt(prompts, answered);

  // A code's row leaves at its expiry, before the server's next answer says so.
  const groups = useMemo(() => (inbox ? withoutExpiredCodes(withoutEmails(inbox.groups, trashing), now) : null), [inbox, trashing, now]);
  // This visit to the Inbox (its account): what left the server's list keeps its place until the user
  // leaves it, unless they took it out here (2026-10-09), and each email keeps the place it first had
  // (D264). Settings and search don't end it.
  const visit = String(route.account ?? '');
  const begin = (): Kept => ({visit, groups: null, held: [], out: new Set(), placed: new Map(), began: Date.now(), settled: false, from: null});
  const [kept, setKept] = useState<Kept>(begin);
  let current = kept.visit === visit ? kept : begin();
  // Rows that leave the server's list are held only once the visit has settled: what a stale answer
  // showed for a moment isn't kept.
  if (groups !== current.groups) {
    current = {...current, groups, held: current.settled && current.groups && groups ? keepShown(withHeld(current.groups, current.held), groups, current.held, current.out) : current.held};
  }
  // Places are set once both lists are in, so an email's first place is the one the whole list agrees
  // on, and only stay once both have answered this visit.
  const ready = groups !== null && allPages[0] !== undefined;
  if (ready) {
    const rows = [...withHeld(groups, current.held).flatMap(group => group.rows), ...allRows];
    if (current.settled) {
      const placed = placeRows(current.placed, rows);
      if (placed !== current.placed) current = {...current, placed};
    } else if (current.from?.[0] !== groups || current.from[1] !== allRows || current.from[2] !== current.held) {
      const answered = (inboxLoad.askedAt ?? 0) >= current.began && (allAskedAt ?? 0) >= current.began;
      current = {...current, placed: placeRows(new Map(), rows), settled: answered, from: [groups, allRows, current.held]};
    }
  }
  if (current !== kept) setKept(current);
  // A code's row leaves at its expiry all the same.
  const held = useMemo(() => current.held.filter(one => !codeExpired(one.row, now)), [current.held, now]);
  const nextCode = nextCodeChange(withHeld(groups ?? [], held).flatMap(group => group.rows), now);
  if (nextCode !== codeMoment) setCodeMoment(nextCode);
  const takeOut = (ids: number[]) => setKept(state => ({...state, out: new Set([...state.out, ...ids]), held: state.held.filter(one => !ids.includes(one.row.id))}));
  // The list: New and Attention from the Inbox's groups, the Pinned shelf, then the days without
  // anything above them (D264, D105).
  const placed = current.placed;
  const {fresh, attention} = useMemo(() => (ready ? splitInbox(withHeld(groups, held), placed) : {fresh: [], attention: []}), [ready, groups, held, placed]);
  const freshView = useMemo(() => (fresh.length ? dayView({date: NEW, rows: fresh}, noiseOpen.has(NEW)) : null), [fresh, noiseOpen]);
  const shelf = useMemo(() => (ready ? groups.find(group => group.group === 'pinned')?.rows ?? [] : []), [ready, groups]);
  const days = useMemo(() => (ready ? groupByDay(allRows, zone, new Set([...fresh, ...attention].map(row => row.id))) : []), [ready, allRows, zone, fresh, attention]);
  const dayViews = useMemo(() => days.map(day => dayView(day, noiseOpen.has(day.date))), [days, noiseOpen]);
  // Results in Trash leave the search's list until Undo (UX #9).
  const results = useMemo(() => search.results.filter(result => !trashing.has(result.id)), [search.results, trashing]);
  const stops = useMemo(() => (searching ? allStops(results) : dayStops(dayViews, shelf, {fresh: freshView, attention})),
    [searching, results, dayViews, shelf, freshView, attention]);
  // The cursor, kept with the stops it was set among, so when the list changes it lands on the stop
  // that took its place.
  const [track, setTrack] = useState<{stops: Stop[]; cursor: string | null}>({stops, cursor: null});
  let cursor = track.cursor;
  if (track.stops !== stops) {
    cursor = keepCursor(track.stops, stops, track.cursor);
    setTrack({stops, cursor});
  }
  const setCursor = (key: string | null) => setTrack(current => ({...current, cursor: key}));

  const open = route.open;
  // The way the user last stepped to an email (reader-03).
  const [travelled, setTravelled] = useState<{id: number; travel: Travel} | null>(null);

  // An email the address opens (a deep link, a reload, Back) is opened: read, as a click would.
  useEffect(() => {
    if (open === null || open === lastOpened) return;
    lastOpened = open;
    void openMessage(open).catch(toastFailure('Couldn\'t mark it read'));
  }, [open]);

  // A code's row leaves the Inbox at its expiry: load it again then.
  const nextChange = inbox?.next_change_at ?? null;
  useEffect(() => {
    if (!nextChange) return;
    const timer = window.setTimeout(() => refreshIfShown(inboxPath(route.account)), Math.max(0, Date.parse(nextChange) - serverNow()) + 500);
    return () => window.clearTimeout(timer);
  }, [nextChange, route.account]);

  const go = (changes: Partial<InboxRoute>) => navigate({...route, ...changes});

  /**
   * Opens an email. `travel` is the way the user stepped to it (J, K, the arrows, Done or Trash moving
   * on), so the reader's swap comes from that side (reader-03); a click has none.
   */
  function openEmail(id: number, key?: string, travel: Travel | null = null) {
    setTravelled(travel ? {id, travel} : null);
    const stop = (key ? stops.find(item => item.key === key) : null) ?? stopOf(stops, id);
    if (stop?.kind === 'row') setCursor(stop.key);
    lastOpened = id;
    if (searching) {
      search.opened(id);
      search.mark(id, {unread: false});
    }
    // On the phone the reader slides in over the list; the desktop's sits beside it.
    if (phone && open === null) slide('in', () => go({open: id}));
    else go({open: id});
    void openMessage(id).catch(toastFailure('Couldn\'t mark it read'));
  }

  /** ⌘Enter, or Ask Alfred: the Answer card above the results, asked what the field holds. */
  function askAlfred() {
    if (search.active) alfred.start(search.question());
  }

  /** Back to an email Undo brought back, as it was. */
  function reopen(id: number) {
    lastOpened = id;
    if (phone) slide('in', () => navigate({...route, open: id}));
    else navigate({...route, open: id});
  }

  /** Closes the reader: on the phone it slides back off the list (Back, Done, Trash). */
  function close() {
    if (phone && open !== null) slide('back', () => go({open: null}));
    else go({open: null});
  }

  const cursorStop = stops.find(stop => stop.key === cursor) ?? null;
  // What H, E and P act on: the open email, else the row under the cursor.
  const target = open ?? (cursorStop?.kind === 'row' ? cursorStop.id : null);
  // An email's row, from the open email or the list it's in (the Inbox's, a day's or search's).
  const rowOf = (id: number): MessageRowOut | undefined => (openMessageData?.id === id ? openMessageData : undefined)
    ?? [...withHeld(groups ?? [], held).flatMap(group => group.rows), ...days.flatMap(day => day.rows), ...results].find(row => row.id === id);
  // The open email's subject, from its row until the email itself is in (#229).
  const subject = open !== null ? rowOf(open)?.subject ?? null : null;
  useEffect(() => {
    document.title = tabTitle({page: 'inbox', attention: counts?.attention ?? 0, subject});
  }, [counts?.attention, subject]);
  // Done (H) only on Attention mail not yet Done (#93).
  const doneable = (id: number) => {
    const row = rowOf(id);
    return row !== undefined && readerActions(row).done;
  };

  /**
   * Done or Trash: it leaves the list. On the open email the next one opens (and reads), or the
   * reader closes at the end (on the phone, always); from the cursor row nothing opens. The toast's Undo, or ⌘Z later, puts
   * it back where it was in this visit's list, read or not, and an open email back in the reader.
   * `undo` puts it back on screen at once and gives what to send once the change itself is in.
   */
  function leave(id: number, beat: Beat, change: (id: number) => Promise<unknown>, toast: string, undo: (id: number) => () => Promise<unknown>, failed: string, undoFailed: string) {
    const wasOpen = id === open;
    // Its row beats before it folds: ticked off, or thrown away (inbox-05).
    beats.set(id, beat);
    const from = visit;
    const places = withHeld(groups ?? [], held).flatMap(group => {
      const index = group.rows.findIndex(row => row.id === id);
      return index < 0 ? [] : [{group: group.group, index, row: group.rows[index]!}];
    });
    if (wasOpen) {
      // The phone goes back to the list, where the toast is: the next email isn't in view there, so
      // opening it would be a jump into an email the user didn't pick (UX #12).
      const next = phone ? null : nextAfterLeaving(stops, cursor, id);
      // The next one down the list: the reader swaps as J does.
      if (next !== null) openEmail(next, undefined, 'next');
      else close();
    }
    takeOut([id]);
    // Whether the server took the change; Undo waits for it, as an untrash sent before the trash is refused.
    const sent = change(id).then(() => true, (error: unknown) => {
      beats.delete(id);
      toastFailure(failed)(error);
      return false;
    });
    const back = () => {
      const at = undos.indexOf(back);
      if (at < 0) return;
      undos.splice(at, 1);
      dismissToast();
      beats.delete(id);
      const send = undo(id);
      void sent.then(done => done && send().catch(toastFailure(undoFailed)));
      setKept(state => (state.visit === from ? {...state, out: new Set([...state.out].filter(one => one !== id)), held: [...state.held, ...places]} : state));
      if (wasOpen) reopen(id);
    };
    undos.push(back);
    showToast(toast, {label: 'Undo', run: back});
  }

  // What each action does to email `id`: H, E, P and the rest act on `target`, a row's right-click
  // menu on its own email (DESIGN.md #248).
  const on = {
    done: (id: number) => doneable(id) && leave(id, 'done', one => {
      search.mark(one, {done: true});
      return setDone(one);
    }, 'Marked Done', one => {
      search.mark(one, {done: false});
      return () => setDone(one, false);
    }, 'Couldn\'t mark it Done', 'Couldn\'t undo Done'),
    trash: (id: number) => leave(id, 'trash', one => {
      setTrashing(ids => new Set(ids).add(one));
      return trashMessage(one).catch(error => {
        untrashing(one);
        throw error;
      });
    }, 'Moved to Trash', one => {
      untrashing(one);
      return () => untrashMessage(one);
    }, 'Couldn\'t move it to Trash', 'Couldn\'t bring it back from Trash'),
    pin: (id: number) => {
      const pinned = rowOf(id)?.pinned ?? false;
      // Out of the shelf's sight, a pin says where it went, with Undo (inbox-09).
      const unseen = !pinned && !phone && !shelfInView();
      // Only if it's still pinned once the last P is in: a pin taken back before it was answered says nothing (SV-80).
      void setPinned(id, !pinned).then(message => {
        if (unseen && message.pinned) showToast('Pinned', {label: 'Undo', run: () => void setPinned(id, false).catch(toastFailure('Couldn\'t unpin it'))});
      }, toastFailure(pinned ? 'Couldn\'t unpin it' : 'Couldn\'t pin it'));
    },
    // The email's Gmail link: the open one's is in; a row's comes with the email, asked for as its menu opened.
    openInGmail: (id: number) => {
      const url = getCached<MessageOut>(messagePath(id))?.open_url;
      if (url) window.open(url, '_blank', 'noopener');
      else if (id !== open) {
        const tab = window.open('about:blank', '_blank');
        void getJson<MessageOut>(messagePath(id)).then(message => {
          if (!tab || !message.open_url) return tab?.close();
          tab.opener = null;
          tab.location.href = message.open_url;
        }, () => tab?.close());
      }
    },
    // ⇧U or ⌘K: the email unread again; an open one's reader closes, so it stays unread (UX #11).
    markUnread: (id: number) => {
      if (id === open) close();
      void markUnread(id).catch(toastFailure('Couldn\'t mark it unread'));
    },
    // The menu's Mark read on an unread row, as Mark all as read is for one email (#248): it stays where
    // it is for the visit, the attention pill doesn't move, and Undo or ⌘Z marks it unread again.
    markRead: (id: number) => {
      if (searching) search.mark(id, {unread: false});
      void markRead(id).catch(toastFailure('Couldn\'t mark it read'));
      const back = () => {
        const at = undos.indexOf(back);
        if (at < 0) return;
        undos.splice(at, 1);
        dismissToast();
        if (searching) search.mark(id, {unread: true});
        void markUnread(id).catch(toastFailure('Couldn\'t mark it unread'));
      };
      undos.push(back);
      showToast('Marked as read', {label: 'Undo', run: back});
    },
  };

  const actions = {
    done: () => target !== null && on.done(target),
    trash: () => target !== null && on.trash(target),
    pin: () => target !== null && on.pin(target),
    openInGmail: () => open !== null && on.openInGmail(open),
    step: (delta: 1 | -1) => {
      const next = open ? neighbour(stops, open, delta) : null;
      if (next !== null) openEmail(next, undefined, delta > 0 ? 'next' : 'prev');
    },
    markUnread: () => target !== null && on.markUnread(target),
    // U: the cursor to New's first email, wherever the list is scrolled (D264).
    toNew: () => {
      const first = freshView ? dayStops([], [], {fresh: freshView})[0] : undefined;
      if (!first) return;
      setCursor(first.key);
      requestAnimationFrame(() => document.querySelector(`[data-key="${first.key}"]`)?.scrollIntoView({block: 'nearest'}));
    },
    // "Marked 12 as read · Undo": Undo marks those same emails unread. New empties (D264).
    markAllRead: () => {
      const shown = withHeld(groups ?? [], held);
      const ids = markAllReadIds(shown);
      const from = visit;
      const places = shown.filter(group => group.group !== 'pinned')
        .flatMap(group => group.rows.flatMap((row, index) => (ids.includes(row.id) ? [{group: group.group, index, row}] : [])));
      takeOut(shown.flatMap(group => group.rows.map(row => row.id)));
      const before = kept.placed;
      setKept(state => (state.visit === from ? {...state, placed: clearNew(state.placed, shown.flatMap(group => group.rows))} : state));
      void markAllRead(route.account).catch(toastFailure('Couldn\'t mark all as read'));
      if (!ids.length) return;
      // Undo, from the toast or ⌘Z as Done's and Trash's are (UX #17), marks those same emails unread
      // and puts them back in their places at once, before the server's list has them (SV-37).
      const back = () => {
        const at = undos.indexOf(back);
        if (at < 0) return;
        undos.splice(at, 1);
        dismissToast();
        setKept(state => (state.visit === from ? {...state, out: new Set([...state.out].filter(one => !ids.includes(one))), held: [...state.held, ...places], placed: before} : state));
        ids.forEach(id => void markUnread(id).catch((error: Error) => showToast(error.message, null, 'failed')));
      };
      undos.push(back);
      showToast(`Marked ${ids.length} as read`, {label: 'Undo', run: back});
    },
    close,
  };

  // Attached again with each render as it's drawn, before any key can come: a passive effect can
  // wait until after a hover's render is on screen, and a key then would act on the render before.
  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || event.defaultPrevented) return;
      // A key with a visible button presses it too (`hint`, ui/keys.ts › echoKey).
      const run = (action: () => void, hint?: string) => {
        event.preventDefault();
        if (hint) echoKey(hint);
        action();
      };
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.altKey && search.active) {
        run(askAlfred);
        return;
      }
      // With an email open, J and K open the next and previous one (as the reader's arrows do), so
      // the highlight and what H, E and P act on are always the same email (UX #2).
      const move = (delta: 1 | -1) => run(() => {
        if (open !== null) {
          actions.step(delta);
          return;
        }
        const key = moveCursor(stops, cursor, delta);
        setCursor(key);
        if (key) requestAnimationFrame(() => document.querySelector(`[data-key="${key}"]`)?.scrollIntoView({block: 'nearest'}));
      });
      if (plainKey(event, 'j')) move(1);
      else if (plainKey(event, 'k')) move(-1);
      else if (plainKey(event, 'Enter')) {
        if (cursorStop?.kind === 'row') run(() => openEmail(cursorStop.id, cursorStop.key));
        else if (cursorStop?.kind === 'noise') run(() => toggleNoise(cursorStop.date));
      } else if (plainKey(event, 'h')) run(actions.done, 'h');
      else if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z' && undos.length) run(undos.at(-1)!);
      else if (plainKey(event, 'e')) run(actions.trash, 'e');
      else if (plainKey(event, 'p')) run(actions.pin, 'p');
      else if (plainKey(event, 'o')) run(actions.openInGmail, 'o');
      else if (plainKey(event, 'i', {shift: true})) run(actions.markAllRead, 'shift+i');
      else if (plainKey(event, 'u', {shift: true})) run(actions.markUnread);
      // U goes to New's first email (D264); 1, the Inbox's key elsewhere, only goes back to it from a
      // search or on the phone.
      else if (plainKey(event, 'u') && !searching) run(actions.toNew);
      else if (plainKey(event, '1') && (searching || phone)) run(() => navigate(toInbox()));
      else if (plainKey(event, 'Escape')) {
        if (open !== null) run(close);
        else if (alfred.open) run(() => {
          // The Answer card folds away, as its own Esc does (app/fold.ts).
          foldAway(document.querySelector('.search-list > .answer'));
          alfred.close();
        });
        else if (searching) run(() => search.clear());
        else if (cursor !== null) run(() => setCursor(null));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // ⌘K's Mark all as read is this page's while it's on screen, as ⇧I is (the palette's own is for other pages).
  useCommands(() => ({commands: [
    ...(searching || !freshView ? [] : [{id: 'to-new', section: 'more', label: 'Go to New', icon: 'mark_email_unread', hint: 'U', keywords: 'unread new', run: actions.toNew} satisfies Command]),
    {id: 'mark-all-read', section: 'more', label: 'Mark all as read', icon: 'mark_email_read', hint: '⇧I', run: actions.markAllRead},
  ]}));

  // Until the list's first answers: its skeleton, or why they didn't come (DESIGN.md #225, #228).
  const allLoad = {path: allPath(route.account), data: allPages[0], error: allError};
  const listFailed = useLoadFailed([inboxLoad, allLoad]);
  const listArrived = useArrival(ready, visit);
  // The days' next page on its way, as the list nears its end.
  const allMore = allPages.length > 1 && allPages.at(-1) === undefined;
  const unpin = (id: number) => void setPinned(id, false).catch(toastFailure('Couldn\'t unpin it'));

  /**
   * A right-click (DESIGN.md #248): on an email's row (New, Attention, the shelf, a day, search's results
   * or Alfred's sources) its actions, the cursor moving there and nothing opening; on New's band, Mark
   * all as read. Add to calendar, Add as task and Ask open the email with their card.
   */
  function onContextMenu(event: ReactMouseEvent) {
    const target = event.target as Element;
    const band = target.closest('.gh.new');
    if (band) {
      if (markAllReadIds(withHeld(groups ?? [], held)).length) {
        openContextMenu(event, band, [{id: 'mark-all-read', label: 'Mark all as read', icon: 'mark_email_read', hint: '⇧I', run: actions.markAllRead}]);
      }
      return;
    }
    const element = target.closest<HTMLElement>('.list [data-key][data-id], .answer .src[data-id]');
    const id = element ? Number(element.dataset.id) : NaN;
    const row = rowOf(id);
    if (!element || !row) return;
    const key = element.dataset.key ?? stopOf(stops, id)?.key ?? null;
    const provider = accounts.get(row.account_id)?.provider;
    const withCard = (card: ItemKind | 'ask') => {
      askCard(id, card);
      if (id !== open) openEmail(id, key ?? undefined);
    };
    const offered = emailActions(row, provider === undefined ? null : provider === 'gmail', {
      open: () => openEmail(id, key ?? undefined),
      done: () => on.done(id),
      trash: () => on.trash(id),
      pin: () => on.pin(id),
      openInGmail: () => on.openInGmail(id),
      propose: withCard,
      ask: () => withCard('ask'),
      markRead: () => on.markRead(id),
      markUnread: () => on.markUnread(id),
    }, 'menu');
    if (!openContextMenu(event, element, offered)) return;
    if (key && stops.some(stop => stop.key === key)) setCursor(key);
    // Open in Gmail needs the email's own link: asked for now, so it's in by the time it's picked.
    if (provider === 'gmail' && id !== open) prefetch(messagePath(id));
  }

  return (
    <>
      <header className="hd">
        {phone && <Mark />}
        {/* A filtered Inbox names its account, so the filter isn't only the sidebar's (UX #15); the phone's account button already does. */}
        <span className="hd-title">{searching ? 'Search' : filteredTo && !phone ? `Inbox · ${filteredTo}` : 'Inbox'}</span>
        {phone && !searching && counts && counts.attention > 0 && <span className="apill num" title="Attention, not Done">{counts.attention}</span>}
        {phone && !searching && counts && counts.unread > 0 && <span className="ph-count num">{counts.unread}</span>}
        <span className="grow" />
        {phone && (
          <>
            <label className="btn ghost sm ph-account">
              {route.account ? accounts.get(route.account)?.label : 'All accounts'}<Icon name="expand_more" size={16} />
              <select aria-label="Account" value={route.account ?? ''} onChange={event => go({account: event.target.value ? Number(event.target.value) : null, open: null})}>
                <option value="">All accounts</option>
                {accountList.map(account => <option key={account.id} value={account.id}>{account.label}</option>)}
              </select>
            </label>
            {/* Not while searching: it would read the hidden Inbox's mail, not the results (#141). */}
            {!searching && <button className="ibtn ph-icon" type="button" aria-label="Mark all as read" onClick={actions.markAllRead}><Icon name="done_all" size={20} /></button>}
          </>
        )}
        <SearchField search={search} onAsk={askAlfred} onEnter={first => setCursor(`all:${first.id}`)} />
      </header>
      {/* Filtered to one account, the rows drop the account they'd all repeat (inbox-12). */}
      <div className={route.account && !phone ? 'content filtered' : 'content'} style={accountWidth} onContextMenu={onContextMenu}>
        {firstWait && waitedLong ? (
          <section className="list" aria-label="Search results"><SearchSkeleton immediate /></section>
        ) : searching && !firstWait ? (
          <SearchResults search={{...search, results}} cursor={cursor} openId={open} accounts={accounts} now={now} timeZone={zone}
            card={alfred.open ? <AnswerCard alfred={alfred} scoped={false} openId={open} accounts={accounts} now={now} timeZone={zone} onOpen={id => openEmail(id)} /> : null}
            onPoint={key => key !== cursor && setCursor(key)} onOpen={openEmail} onAsk={askAlfred} />
        ) : (
          // Another account's list starts afresh: its rows don't fold. Until both answers are in, its
          // skeleton, or why they didn't come (#225, #228); rows not shown before don't fold in then.
          <AllList key={visit} fresh={freshView} freshUnread={fresh.filter(row => row.unread).length} attention={attention} days={dayViews} shelf={shelf}
            cursor={cursor} openId={open} accounts={accounts} now={now} timeZone={zone} arrived={listArrived} more={allMore} dimmed={firstWait}
            loading={!ready ? (listFailed ? <LoadFailed what="the Inbox" loads={[inboxLoad, allLoad]} /> : <AllSkeleton />) : null} prompt={prompt} markable={markAllReadIds(withHeld(groups ?? [], held)).length > 0}
            onPoint={key => key !== cursor && setCursor(key)} onOpen={openEmail} onToggleNoise={toggleNoise} onNearEnd={loadMore} onUnpin={unpin}
            onMarkAllRead={actions.markAllRead} onAnswer={(answer, yes) => {
              setAnswered(new Set([...answered, answer.id]));
              void answerPrompt(answer.id, yes).catch(toastFailure('Couldn\'t answer it'));
            }} />
        )}
        {open !== null && (
          <Reader id={open} travel={travelled?.id === open ? travelled.travel : null} row={rowOf(open)} accounts={accounts} now={now} timeZone={zone} actions={actions} onOpen={id => openEmail(id)} back={searching ? 'Search' : 'Inbox'}
            marks={searching ? readerMarks(open, search.results, alfred.turns) : []}
            canStep={{previous: neighbour(stops, open, -1) !== null, next: neighbour(stops, open, 1) !== null}} />
        )}
      </div>
    </>
  );
}
