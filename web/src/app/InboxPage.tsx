// The Inbox page: the header, the list (days first: Attention, the Pinned shelf, then every email by
// day, Today first) and the reading pane, with mail's keys (DESIGN.md › Interaction rules). An email
// turns read only when opened, by a click or Enter (or Mark all as read). Moving the cursor,
// scrolling and opening a Noise line never read anything. Unread mail sits in its day, so reading
// one never moves it.
// The keyboard cursor is a `sub2` fill that J and K move and the pointer takes. With an email open,
// J and K open the next and previous one instead. Enter opens, H Done, E Trash (each with Undo in
// the toast, and ⌘Z), P Pin, O Open in Gmail, R Reply, A Reply all and F Forward (the composer, desktop only),
// C a new message, ⇧I Mark all as read, ⇧U Mark unread, U to the next unread email. Esc closes the composer, then the
// reader. Done or Trash on the open email opens the next one.
//
// ⌘ or Ctrl-click and ⇧-click select several emails, and ⌘A every one the list holds (its reader
// giving way). The reading pane shows the selection (SelectionPane), and H, E, P, ⇧U, a selected row's right-click and ⌘K act on all of it. Each
// email's change is its own command, with one toast and one Undo. R, A and F on 2 to 5 open a
// composer window for each. A plain click or Enter ends the
// selection and opens the email. Esc ends it first.
//
// Search: while the header's field holds a search, its results replace the list and the header
// reads "Search". On the desktop it finds sent mail too, whose row reads "To Sam Ortiz" and whose
// email has Sent's tools (no Pin or Mark unread). The reading pane, J, K and Enter work the same, and each open is logged with its
// position. ⌘Enter asks Alfred, whose Answer card sits above the results while the search is
// active; cleared or left, the conversation goes on in Alfred's window. Esc closes the reader,
// then the card, then the search.
//
// Views: All | Unread | Attention | FYI | Noise in the header's segmented control. Tab and Shift-Tab
// step them. Unread's segment has the red unread badge and Attention's has its count. An email read
// in Unread stays there, drawn read, until the user leaves the view. Mark all as read follows the
// view, and Attention has none. An empty view says so, with Show All.
//
// On the phone (board 21) the header is the mark, the view's name as a menu ("Inbox ▾": All, Unread,
// Attention, FYI and Noise, then Sent, Drafts and Snoozed, then Settings: logic/mailMenu.ts), the
// Attention pill (on All and Attention; elsewhere the Inbox tab has it, so no count beside "Unread"
// reads as Unread's, which is in the menu), Mark all as read (as the view reads it), Select and New message, which opens the composer's sheet (no account filter). The Inbox tab goes back to All.
// A plain search field sits under it (no chips), taking sent mail in as the desktop's does, and Ask
// Alfred leads its results. A row swipes (logic/swipe.ts): right marks it read or unread, left offers
// Trash, Done and Pin or Unpin, a full swipe running Trash. Select in the header puts a circle on each
// row: a tap selects, Select all takes every row the list holds, and the tab bar gives way to Done,
// Pin, Read and Trash for all of them, with one toast and one Undo. Each of them ends it, as do
// Cancel, a view, a search or an email opening. No swipes meanwhile.
import type {AllOut, ConversationChangeOut, InboxGroupOut, MailConversationOut, InboxOut, ItemKind, MailCountsOut, MessageOut, MessageRowOut, RuleOut, Settings} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useState} from 'react';
import type {MouseEvent as ReactMouseEvent} from 'react';
import {flushSync} from 'react-dom';
import {serverNow, timeZone} from '../api/auth.ts';
import {getJson, prefetch, refreshIfShown, useResource, useResources} from '../api/client.ts';
import {SETTINGS_PATH} from '../api/items.ts';
import {
  allPath, answerPrompt, cachedEmail, changeEach, conversationPath, COUNTS_PATH, INBOX_PATH, markAllRead, markRead, markUnread, messagePath, openMessage, PROMPTS_PATH, refusals, setDone, setPinned, snooze, trashMessage, undoChange, undoPin, undoRead, unsnooze,
} from '../api/mail.ts';
import type {SearchScope} from '../api/search.ts';
import {RULES_PATH} from '../api/settings.ts';
import {attentionRows, dayStops, heldUnread, nextUnread, sameHold, unreadNotDone, viewList} from '../logic/all.ts';
import {rowHolding} from '../logic/conversation.ts';
import {leftOutSection, readerMarks, resultSections} from '../logic/search.ts';
import {
  codeExpired, inSight, keepCursor, letGo, markAllReadIds, markAllReads, moveCursor, neighbour, nextAfterLeaving, nextCodeChange, searchStops, stopOf, visiblePrompt, withHeld, withoutEmails, withoutExpiredCodes,
} from '../logic/inbox.ts';
import {phoneSlide, readerStep} from '../logic/phone.ts';
import {readerActions} from '../logic/reader.ts';
import {snoozeable, snoozedLine} from '../logic/snooze.ts';
import {broughtForward, counted, dropped, inListOrder, NO_SELECTION, ranged, selectedAll, selectionOffers, stacked, toggled} from '../logic/selection.ts';
import type {Selection} from '../logic/selection.ts';
import type {HeldRow, PatternPrompt, Stop} from '../logic/inbox.ts';
import type {InboxView, Route} from '../logic/route.ts';
import {INBOX_VIEWS} from '../logic/route.ts';
import {tabTitle} from '../logic/title.ts';
import {Icon, Mark} from '../ui/Icon.tsx';
import {Segmented} from '../ui/Segmented.tsx';
import {commandKey, echoKey, isTyping, plainKey} from '../ui/keys.ts';
import {useAccountColumn, useAccounts} from './accounts.ts';
import {AllList} from './AllList.tsx';
import {Count} from './Count.tsx';
import {UnreadBadge} from './UnreadBadge.tsx';
import {useNow} from './clock.ts';
import {beats, foldAway} from './fold.ts';
import type {Beat} from './fold.ts';
import {useCompact, usePhone} from './Phone.tsx';
import {TitleMenu} from './phone/TitleMenu.tsx';
import {useMailMenu} from './phone/mailMenu.ts';
import {mailTitle, VIEW_LABELS} from '../logic/mailMenu.ts';
import type {MailPlace} from './phone/mailMenu.ts';
import {showSelectBar} from './phone/selectBar.tsx';
import type {SwipeAct} from './phone/swipe.tsx';
import {rowSwipes} from '../logic/swipe.ts';
import type {RowSwipe} from '../logic/swipe.ts';
import {askCard, EmailCard, Reader} from './Reader.tsx';
import {answerEach, answerKey, closeComposer, newMessage, openComposer, useOpenComposer} from './compose/composer.ts';
import {NewMessagePane} from './compose/Composer.tsx';
import {openContextMenu} from './ContextMenu.tsx';
import {emailActions, selectionActions, snoozeItems} from './emailActions.ts';
import {openSnooze} from './SnoozeMenu.tsx';
import type {SelectionHandlers} from './emailActions.ts';
import {EmailTools, emailLines, SelectionPane} from './SelectionPane.tsx';
import {EmptyPaneButton, useEmptyPane} from './EmptyPane.tsx';
import {InboxDay, PANE_PATHS} from './InboxDay.tsx';
import type {Travel} from './Reader.tsx';
import {useCommands} from './palette/commands.ts';
import type {Command} from './palette/commands.ts';
import {back as historyBack, navigate, overList} from './router.ts';
import {AnswerCard} from './search/AnswerCard.tsx';
import {SearchField, SearchResults} from './search/Search.tsx';
import {LoadFailed, useAfter, useArrival, useLoadFailed} from './states/Loading.tsx';
import {AllSkeleton, SearchSkeleton} from './states/Skeletons.tsx';
import {skeleton} from '../tokens.ts';
import {useSearch} from './search/mailSearch.ts';
import {alfredOf, closeAlfred, startAlfred, useAlfredThread, useClaim} from './search/alfred.ts';
import {toInbox} from './toInbox.ts';
import {dismissToast, showToast, toastFailure} from './toast.ts';
import {EmptyView} from './EmptyView.tsx';

type InboxRoute = Extract<Route, {page: 'inbox'}>;

// Search takes sent mail in.
const WITH_SENT: SearchScope = {sent: 'include'};


// What each of a phone row's swipes shows behind it.
const SWIPE_ACTS: Record<RowSwipe, SwipeAct> = {
  read: {id: 'read', label: 'Read', icon: 'mark_email_read', tone: 'accent'},
  unread: {id: 'unread', label: 'Unread', icon: 'mark_email_unread', tone: 'accent'},
  trash: {id: 'trash', label: 'Trash', icon: 'delete', tone: 'alert', leaves: true},
  done: {id: 'done', label: 'Done', icon: 'check', tone: 'good'},
  pin: {id: 'pin', label: 'Pin', icon: 'keep', tone: 'sun'},
  unpin: {id: 'unpin', label: 'Unpin', icon: 'keep_off', tone: 'sun'},
};

/**
 * Whether any of the Pinned shelf shows in the list, where a pin lands. With no shelf yet, whether
 * the place it comes (above the first day) does. Below Attention it can be out of sight either way.
 */
function shelfInView(): boolean {
  const list = document.querySelector<HTMLElement>('.content > .list');
  if (!list) return true;
  const shelf = [...list.querySelectorAll<HTMLElement>('.row.shelf:not(.leaving)')];
  const places = shelf.length ? shelf : [...list.querySelectorAll<HTMLElement>('.gh.day')].slice(0, 1);
  return inSight(places.map(place => place.getBoundingClientRect()), list.getBoundingClientRect());
}

// The email last opened, so the address following an open doesn't open it twice. A deep link,
// a reload or Back to an email opens it.
let lastOpened: number | null = null;

// ⌘Z: what undoes each Done and Trash made here, newest last. The toast's Undo runs the same one.
const undos: (() => void)[] = [];

// The slide under way, so one that a newer one cut short doesn't take the newer one's direction away.
let slides = 0;

/**
 * The phone's push and back: the reader slides in over the list, which moves a little under it,
 * and slides back off it, as one 260 ms view transition (phone.css draws it, by the direction on the
 * root). Only the app's own opens and closes slide. The browser's Back (popstate) doesn't, as Safari's
 * edge swipe animates it already. Without the API it's the cut it was. phoneSlide owns which way.
 */
function slide(direction: 'in' | 'back' | null, update: () => void | Promise<void>) {
  if (!direction || !('startViewTransition' in document)) return void update();
  const root = document.documentElement;
  const token = ++slides;
  root.dataset.slide = direction;
  // An update that waits (the history's Back) ends the old view once the route has followed it.
  void document.startViewTransition(() => flushSync(update)?.then(() => flushSync(() => {}))).finished.finally(() => {
    if (token === slides) delete root.dataset.slide;
  });
}

/**
 * The rows Undo put back in Attention or on the shelf before the server's list has them again, and
 * the list they were last checked against. Each is let go once the list holds it, or when it's taken
 * out again (Done, Trash).
 */
interface Kept {
  groups: InboxGroupOut[] | null;
  held: HeldRow[];
}

const SEARCH_ORIGIN = {kind: 'search'} as const;

export function InboxPage({route}: {route: InboxRoute}) {
  // The next moment a code row changes by itself, so its countdown and its leaving are on time.
  const [codeMoment, setCodeMoment] = useState<number | null>(null);
  const now = useNow(codeMoment);
  const zone = timeZone();
  const {list: accountList, byId: accounts} = useAccounts();
  const accountWidth = useAccountColumn(accountList);
  const phone = usePhone();
  const compact = useCompact();
  const view: InboxView = route.view ?? 'all';
  const inboxLoad = {path: INBOX_PATH, ...useResource<InboxOut>(INBOX_PATH)};
  const inbox = inboxLoad.data;
  const {data: counts} = useResource<MailCountsOut>(COUNTS_PATH);
  // The open email (the phone's reader), or on the desktop its conversation, whose row the tools act on.
  const {data: openMessageData} = useResource<MessageOut>(route.open && phone ? messagePath(route.open) : null);
  const {data: openConversation} = useResource<MailConversationOut>(route.open && !phone ? conversationPath(route.open) : null);
  const openRow = phone ? openMessageData : openConversation?.emails.some(email => email.id === route.open) ? openConversation.row : undefined;
  // Emails Trash took out here, hidden at once rather than when the server's list leaves them out.
  // Undo, or a refused Trash, lets one back.
  const [trashing, setTrashing] = useState<ReadonlySet<number>>(new Set());
  const untrashing = (id: number) => setTrashing(ids => new Set([...ids].filter(one => one !== id)));
  const search = useSearch(phone, WITH_SENT);
  // Alfred's thread from search shows above the results while the search is active; elsewhere it's in
  // Alfred's window, or the phone's pill and sheet (search/alfred.ts).
  // The place is claimed before any question, so a thread asked here never shows in the window first.
  const place = search.active;
  useClaim(place ? SEARCH_ORIGIN : null);
  const thread = useAlfredThread();
  const inline = place && thread?.origin.kind === 'search' ? thread : null;
  const alfred = alfredOf(inline);
  const searching = search.active || alfred.open;
  // A search's first answer on its way: the list stays, dimmed, then gives way to the results'
  // skeleton once it's taken a moment.
  const firstWait = search.active && search.out === null && search.error === null && !alfred.open;
  const waitedLong = useAfter(firstWait, skeleton.delayMs);

  // All's pages: the first, then one more each time the list nears its end.
  const [befores, setBefores] = useState<string[]>([]);
  const allPaths = [allPath(), ...befores.map(before => allPath(before))];
  const allPages = useResources<AllOut>(allPaths);
  const {error: allError} = useResource<AllOut>(allPath());
  const allRows = useMemo(() => allPages.flatMap(page => page?.days.flatMap(day => day.rows) ?? []).filter(row => !trashing.has(row.id)), [allPages, trashing]);
  // The days whose Noise the user opened here. Each starts folded.
  const [noiseOpen, setNoiseOpen] = useState<ReadonlySet<string>>(new Set());
  const toggleNoise = (date: string) => setNoiseOpen(dates => (dates.has(date) ? new Set([...dates].filter(one => one !== date)) : new Set(dates).add(date)));
  const loadMore = () => {
    const next = allPages.at(-1)?.next_before;
    if (next && !befores.includes(next)) setBefores([...befores, next]);
  };

  // The pattern prompt (triage's, and none while its route answers 404), and the ones answered here.
  const {data: prompts} = useResource<PatternPrompt[]>(PROMPTS_PATH);
  // Add to rule's rules to join, in the row's menu.
  const {data: rules} = useResource<RuleOut[]>(RULES_PATH);
  // The task time, for the right-click menu's Snooze times.
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const [answered, setAnswered] = useState<ReadonlySet<number>>(new Set());
  const prompt = visiblePrompt(prompts, answered);

  // A code's row leaves at its expiry, before the server's next answer says so.
  const groups = useMemo(() => (inbox ? withoutExpiredCodes(withoutEmails(inbox.groups, trashing), now) : null), [inbox, trashing, now]);
  // Nothing holds a row in place any more: the list is the server's, with each action's
  // change shown at once, and Undo's rows until the server's list has them again.
  const [kept, setKept] = useState<Kept>({groups: null, held: []});
  let current = kept;
  if (groups !== current.groups) current = {...current, groups, held: groups ? letGo(current.held, groups) : current.held};
  if (current !== kept) setKept(current);
  const ready = groups !== null && allPages[0] !== undefined;
  // A code's row leaves at its expiry all the same.
  const held = useMemo(() => current.held.filter(one => !codeExpired(one.row, now)), [current.held, now]);
  // A live code anywhere in the list counts down and turns to plain text at its expiry.
  const nextCode = nextCodeChange([...withHeld(groups ?? [], held).flatMap(group => group.rows), ...allRows], now);
  if (nextCode !== codeMoment) setCodeMoment(nextCode);
  const takeOut = (ids: number[]) => setKept(state => ({...state, held: state.held.filter(one => !ids.includes(one.row.id))}));
  const inboxGroups = useMemo(() => withHeld(groups ?? [], held), [groups, held]);
  // Unread's rows for this visit to it: one read here stays, drawn read, until the view changes.
  const holding = view === 'unread' && ready;
  const [unreadHold, setUnreadHold] = useState<{holding: boolean; rows: ReadonlyMap<number, MessageRowOut>}>({holding: false, rows: new Map()});
  const latestRows = useMemo(() => new Map([...allRows, ...inboxGroups.flatMap(group => group.rows)].map(row => [row.id, row])), [allRows, inboxGroups]);
  const was = unreadHold.holding === holding ? unreadHold.rows : new Map<number, MessageRowOut>();
  const next = !holding ? was : heldUnread(was, inboxGroups.flatMap(group => group.rows), latestRows, trashing);
  // The same map while its rows stay the same, so the list isn't worked out again for nothing.
  const unreadRows = unreadHold.holding === holding && sameHold(next, unreadHold.rows) ? unreadHold.rows : next;
  if (unreadRows !== unreadHold.rows || unreadHold.holding !== holding) setUnreadHold({holding, rows: unreadRows});
  // The list: what the view shows.
  const shown = useMemo(() => (ready ? viewList(view, {groups: inboxGroups, rows: allRows, unread: [...unreadRows.values()]}, zone, noiseOpen) : null),
    [ready, view, inboxGroups, allRows, unreadRows, zone, noiseOpen]);
  const attention = useMemo(() => shown?.attention ?? [], [shown]);
  const shelf = useMemo(() => shown?.shelf ?? [], [shown]);
  const dayViews = useMemo(() => shown?.days ?? [], [shown]);
  // The emails U can go to: the unread ones the list shows, not Done.
  const unreadShown = useMemo(() => new Set([...attention, ...shelf, ...dayViews.flatMap(day => day.lanes.flatMap(lane => lane.rows.map(({row}) => row)))].filter(unreadNotDone).map(row => row.id)),
    [attention, shelf, dayViews]);
  // Unread's badge counts every unread email. Attention's count is what's in it not Done.
  const unreadHere = counts?.unread ?? 0;
  const attentionHere = useMemo(() => attentionRows(inboxGroups, false).length, [inboxGroups]);
  // FYI's or Noise's Mark all as read: that view's unread mail, as Mark all as read reads it.
  const viewReadIds = useMemo(() => (view === 'fyi' || view === 'noise'
    ? [...new Set([...inboxGroups.flatMap(group => group.rows), ...allRows].filter(row => row.lane === view && markAllReads(row)).map(row => row.id))]
    : []), [view, inboxGroups, allRows]);
  // Whether Mark all as read has anything to read, in this view.
  const markable = view === 'attention' ? false : view === 'fyi' || view === 'noise' ? viewReadIds.length > 0 : markAllReadIds(inboxGroups, allRows).length > 0;
  // The phone's title menu: the views, then Sent, Drafts and Snoozed, then Settings.
  const menuPlace: MailPlace = {page: 'inbox', view, unread: unreadHere, attention: attentionHere, onView: switchView};
  const menuRows = useMailMenu(menuPlace);
  const markScope = view === 'fyi' || view === 'noise' ? `Mark ${VIEW_LABELS[view]} as read` : 'Mark all as read';
  // Results in Trash leave the search's list until Undo.
  const sections = useMemo(() => ({...resultSections(search.results, search.out, search.mentions, trashing), leftOut: leftOutSection(search.results, search.out, search.leftOut, trashing)}),
    [search.results, search.out, search.mentions, search.leftOut, trashing]);
  const stops = useMemo(() => (searching ? searchStops(sections) : dayStops(dayViews, shelf, attention)),
    [searching, sections, dayViews, shelf, attention]);
  // The cursor, kept with the stops it was set among, so when the list changes it lands on the stop
  // that took its place.
  const [track, setTrack] = useState<{stops: Stop[]; cursor: string | null}>({stops, cursor: null});
  let cursor = track.cursor;
  if (track.stops !== stops) {
    cursor = keepCursor(track.stops, stops, track.cursor);
    setTrack({stops, cursor});
  }
  const setCursor = (key: string | null) => setTrack(current => ({...current, cursor: key}));
  // The emails ⌘ or Ctrl-click and ⇧-click selected this visit: those still in the list, in its
  // order. On the phone, those Select's mode picked, and none outside it.
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const [selectMode, setSelectMode] = useState(false);
  // Select's mode lasts only on the phone, in the list: a search or an email opening ends it.
  const selecting = phone && selectMode && !search.active && route.open === null;
  if (selectMode && !selecting) {
    setSelectMode(false);
    setSelection(NO_SELECTION);
  }
  const selected = useMemo(() => (phone && !selecting ? [] : inListOrder(selection.ids, stops)), [phone, selecting, selection.ids, stops]);
  const select = setSelection;
  const clearSelection = () => setSelection(NO_SELECTION);
  const endSelecting = () => {
    setSelectMode(false);
    clearSelection();
  };

  const open = route.open;
  // The way the user last stepped to an email.
  const [travelled, setTravelled] = useState<{id: number; travel: Travel} | null>(null);
  // On the phone, the emails a thread's row (or the "You replied" line) was opened from, newest last.
  // The reader's Back goes back to each in turn, as Safari's does, before the list. Back to one takes
  // it off, and the list clears them.
  const [trail, setTrail] = useState<number[]>([]);
  if (trail.length && (open === null || open === trail.at(-1))) setTrail(open === null ? [] : trail.slice(0, -1));

  // An email the address opens (a deep link, a reload, Back) is opened: read, as a click would.
  useEffect(() => {
    if (open === null || open === lastOpened) return;
    lastOpened = open;
    void openMessage(open).catch(toastFailure('Failed to mark read'));
  }, [open]);

  // A code's row leaves the Inbox at its expiry: load it again then.
  const nextChange = inbox?.next_change_at ?? null;
  useEffect(() => {
    if (!nextChange) return;
    const timer = window.setTimeout(() => refreshIfShown(INBOX_PATH), Math.max(0, Date.parse(nextChange) - serverNow()) + 500);
    return () => window.clearTimeout(timer);
  }, [nextChange]);

  const go = (changes: Partial<InboxRoute>) => navigate({...route, ...changes});

  /** Another view, from its segment or Tab: the open email and the selection give way, and the list starts at its top. */
  function switchView(next: InboxView) {
    if (next === view) return;
    const {view: _was, ...rest} = route;
    endSelecting();
    navigate(next === 'all' ? {...rest, open: null} : {...rest, open: null, view: next});
  }

  /**
   * Opens an email. `travel` is the way the user stepped to it (J, K, the arrows, Done or Trash moving
   * on), so the reader's swap comes from that side. A click has none.
   */
  function openEmail(id: number, key?: string, travel: Travel | null = null) {
    if (selected.length) clearSelection();
    if (trail.length) setTrail([]);
    setTravelled(travel ? {id, travel} : null);
    const stop = (key ? stops.find(item => item.key === key) : null) ?? stopOf(stops, id);
    if (stop?.kind === 'row') setCursor(stop.key);
    lastOpened = id;
    if (searching) {
      search.opened(id);
      search.mark(id, {unread: false});
    }
    // On the phone the reader slides in over the list. The desktop's sits beside it.
    const step = readerStep(phone, open, id, travel !== null, overList());
    slide(phoneSlide(phone, open, id), () => navigate({...route, open: id}, {replace: step.how === 'replace', overList: step.overList}));
    void openMessage(id).catch(toastFailure('Failed to mark read'));
  }

  /**
   * A click on a row. With ⌘ or Ctrl it joins the selection or leaves it (the first one taking the
   * open email, whose reader gives way). With ⇧ every email from the last one clicked to it joins. A
   * plain click ends the selection and opens it. Selecting opens and reads nothing.
   */
  function clickRow(id: number, key: string, event?: ReactMouseEvent) {
    if (selecting) {
      select(toggled({...selection, ids: selected}, id, null));
      return;
    }
    const adding = !phone && !!event && !event.altKey && (event.metaKey || event.ctrlKey);
    const ranging = !phone && !!event && !event.altKey && !adding && event.shiftKey;
    if (!adding && !ranging) {
      openEmail(id, key);
      return;
    }
    const now = {...selection, ids: selected};
    select(adding ? toggled(now, id, open) : ranged(now, stops, id, open));
    setCursor(key);
    if (open !== null) go({open: null});
  }

  /** ⌘A: every email the list holds now is selected, the open one's reader giving way. */
  function selectAll() {
    select(selectedAll({...selection, ids: selected}, stops));
    if (open !== null) go({open: null});
  }

  /** Reply, Reply all or Forward on an email: it opens (if it isn't) with the composer under it. */
  function answerOn(id: number, key: string | null | undefined, kind: 'reply' | 'reply_all' | 'forward') {
    if (id !== listedOpen) openEmail(id, key ?? undefined);
    answerKey(id, kind);
  }

  /** ⌘Enter, or Ask Alfred: the Answer card above the results, asked what the field holds. */
  function askAlfred() {
    if (search.active) startAlfred(SEARCH_ORIGIN, search.question());
  }

  /** Back to an email Undo brought back, as it was. */
  function reopen(id: number) {
    lastOpened = id;
    slide(phoneSlide(phone, open, id), () => navigate({...route, open: id}));
  }

  /** Closes the reader: on the phone it slides back off the list (Back, Done, Trash). */
  function close() {
    const step = readerStep(phone, open, null, false, overList());
    slide(phoneSlide(phone, open, null), () => step.how === 'back' ? historyBack() : go({open: null}));
  }

  /** Another email from the open one's thread, its reply line or its Answer card. On the phone Back comes back here. */
  function openFromReader(id: number) {
    const from = open;
    openEmail(id);
    if (phone && from !== null && from !== id) setTrail([...trail, from]);
  }

  /** The reader's Back: to the email this one was opened from, else the list. */
  function back() {
    if (phone && trail.length) window.history.back();
    else close();
  }

  // Whether a composer answers the open email, or on the desktop any email of its conversation.
  const answersOpen = (messageId: number | null | undefined) => messageId === open || (!!messageId && !!openConversation?.emails.some(email => email.id === messageId));
  const cursorStop = stops.find(stop => stop.key === cursor) ?? null;
  // The open conversation's row in the list: the email opened, or the one that placed its row when it
  // was opened at another (an Alfred citation, a notification).
  const listedOpen = open === null ? null : latestRows.has(open) || unreadRows.has(open) || search.listed.some(row => row.id === open) ? open
    : rowHolding([...latestRows.values(), ...search.listed], open)?.id ?? open;
  // What H, E and P act on: the open conversation, else the row under the cursor.
  const target = listedOpen ?? (cursorStop?.kind === 'row' ? cursorStop.id : null);
  // A conversation's row, from the open one or the list it's in (the Inbox's, a day's, Unread's or search's).
  const rowOf = (id: number): MessageRowOut | undefined => (openRow?.id === id ? openRow : undefined)
    ?? latestRows.get(id) ?? unreadRows.get(id) ?? search.listed.filter(result => !trashing.has(result.id)).find(row => row.id === id)
    ?? rowHolding(latestRows.values(), id);
  // The open email's subject, from its row until the email itself is in.
  const subject = open !== null ? rowOf(open)?.subject ?? null : null;
  useEffect(() => {
    document.title = tabTitle({page: 'inbox', unread: counts?.unread ?? 0, subject});
  }, [counts?.unread, subject]);
  // Done (H) only on Attention mail not yet Done.
  const doneable = (id: number) => {
    const row = rowOf(id);
    return row !== undefined && readerActions(row).done;
  };

  /**
   * Done or Trash: the emails leave the list. On the open email the next one opens (and reads), or the
   * reader closes at the end (on the phone, always). From the cursor row or a selection nothing opens.
   * Each email's change is its own command, sent together (`changeEach`). The toast's Undo, or ⌘Z
   * later, puts them back where they were in the list, read or not, and an open email back in the
   * reader. `undo` puts one back on screen at once and gives what to send once its change is in.
   */
  function leave(ids: number[], beat: Beat, change: (id: number) => Promise<ConversationChangeOut>, toast: string, undo: (id: number) => void,
    failed: (n: number) => string, undoFailed: (n: number) => string) {
    const wasOpen = listedOpen !== null && ids.includes(listedOpen) ? listedOpen : null;
    // Their rows beat before they fold: ticked off, or thrown away.
    for (const id of ids) beats.set(id, beat);
    const places = withHeld(groups ?? [], held).flatMap(group => group.rows.flatMap((row, index) => (ids.includes(row.id) ? [{group: group.group, index, row}] : [])));
    if (wasOpen !== null) {
      // The phone goes back to the list, where the toast is: the next email isn't in view there, so
      // opening it would be a jump into an email the user didn't pick.
      const next = phone ? null : nextAfterLeaving(stops, cursor, wasOpen);
      // The next one down the list: the reader swaps as J does.
      if (next !== null) openEmail(next, undefined, 'next');
      else close();
    }
    takeOut(ids);
    // The emails the server took. Undo waits for them, as an untrash sent before the trash is refused.
    const sent = changeEach(ids, change).then(outcomes => {
      const refused = refusals(ids, outcomes);
      for (const {id} of refused) beats.delete(id);
      if (refused.length) toastFailure(failed(refused.length))(refused[0]!.error);
      return outcomes.flatMap((outcome, at) => (outcome.status === 'fulfilled' ? [{id: ids[at]!, undo: outcome.value.undo}] : []));
    });
    let toastId = 0;
    const back = () => {
      const at = undos.indexOf(back);
      if (at < 0) return;
      undos.splice(at, 1);
      dismissToast(toastId);
      for (const id of ids) beats.delete(id);
      for (const id of ids) undo(id);
      void sent.then(took => changeEach(took.map(one => one.id), id => undoChange(id, took.find(one => one.id === id)!.undo)).then(outcomes => {
        const refused = refusals(took.map(one => one.id), outcomes);
        if (refused.length) toastFailure(undoFailed(refused.length))(refused[0]!.error);
      }));
      setKept(state => ({...state, held: [...state.held, ...places]}));
      if (wasOpen !== null) reopen(wasOpen);
    };
    undos.push(back);
    toastId = showToast(toast, {label: 'Undo', run: back, key: '⌘Z'});
  }

  // What each action does to emails `ids`: one email for H, E, P and the rest on `target` or a row's
  // right-click menu, every selected one for a selection's.
  const on = {
    done: (ids: number[]) => {
      const can = ids.filter(doneable);
      if (!can.length) return;
      // Done ends a snooze (a snoozed conversation found by search), and its Undo snoozes it again.
      const snoozed = new Map(can.flatMap(id => {
        const until = rowOf(id)?.snoozed_until;
        return until ? [[id, until] as const] : [];
      }));
      leave(can, 'done', one => {
        search.mark(one, {done: true, snoozed_until: undefined});
        return setDone(one);
      }, counted(can.length, 'Marked Done', n => `Marked ${n} Done`), one => {
        const until = snoozed.get(one);
        search.mark(one, {done: false, ...(until ? {snoozed_until: until} : {})});
      }, n => counted(n, 'Failed to mark Done', m => `Failed to mark ${m} Done`), n => counted(n, 'Failed to undo Done', m => `Failed to undo Done on ${m}`));
    },
    trash: (ids: number[]) => {
      // Hidden at once, every one, rather than as each is answered.
      setTrashing(trashed => new Set([...trashed, ...ids]));
      leave(ids, 'trash', one => trashMessage(one).catch(error => {
        untrashing(one);
        throw error;
      }), counted(ids.length, 'Moved to Trash', n => `Moved ${n} to Trash`), untrashing, n => counted(n, 'Failed to move to Trash', m => `Failed to move ${m} to Trash`), n => counted(n, 'Failed to bring back', m => `Failed to bring ${m} back`));
    },
    // Snooze until `until` (ms): out of the list until it returns, with Undo as Done's. Sent mail has none.
    snooze: (ids: number[], until: number) => {
      const can = ids.filter(id => {
        const row = rowOf(id);
        return row !== undefined && snoozeable(row);
      });
      if (!can.length) return;
      const at = new Date(until).toISOString();
      leave(can, 'snooze', one => {
        search.mark(one, {snoozed_until: at});
        return snooze(one, until);
      }, snoozedLine(at, serverNow(), zone), one => search.mark(one, {snoozed_until: undefined}), n => counted(n, 'Failed to snooze', m => `Failed to snooze ${m}`), n => counted(n, 'Failed to unsnooze', m => `Failed to unsnooze ${m}`));
    },
    // Pin, or Unpin when every one is pinned already. `fromList`: picked on the phone's list (a swipe, Select).
    pin: (ids: number[], fromList = false) => {
      // Sent mail and snoozed mail have no Pin.
      const rows = ids.flatMap(id => rowOf(id) ?? []).filter(row => !row.sent_only && !row.snoozed_until);
      const pinning = rows.some(row => !row.pinned);
      const changing = rows.filter(row => row.pinned !== pinning).map(row => row.id);
      // Out of the shelf's sight, a pin says where it went, with Undo. From the phone's list the row
      // moves away from under the thumb either way, so a pin or unpin there always says so.
      const says = (phone && fromList) || (pinning && !phone && !shelfInView());
      void changeEach(changing, id => setPinned(id, pinning)).then(outcomes => {
        const refused = refusals(changing, outcomes);
        if (refused.length) toastFailure(pinning ? counted(refused.length, 'Failed to pin', n => `Failed to pin ${n}`) : counted(refused.length, 'Failed to unpin', n => `Failed to unpin ${n}`))(refused[0]!.error);
        // Only those still as asked once the last P is in: a pin taken back before it was answered says nothing.
        const moved = changing.flatMap((id, at) => {
          const outcome = outcomes[at]!;
          return outcome.status === 'fulfilled' && outcome.value.pinned === pinning ? [{id, pinned: outcome.value}] : [];
        });
        if (says && moved.length) {
          const line = pinning ? counted(moved.length, 'Pinned', n => `Pinned ${n}`) : counted(moved.length, 'Unpinned', n => `Unpinned ${n}`);
          // Undo puts each email back as it was: a pin some had before, a rule's waiting trash the pin spared.
          showToast(line, {label: 'Undo', run: () => void changeEach(moved.map(one => one.id), id => undoPin(id, moved.find(one => one.id === id)!.pinned)).then(results => {
            if (results.some(result => result.status === 'rejected')) toastFailure(pinning ? 'Failed to unpin' : 'Failed to pin')(results.find(result => result.status === 'rejected')!.reason);
          })});
        }
      });
    },
    // The email's Gmail link. The open one's is in. A row's comes with the email, asked for as its menu opened.
    openInGmail: (id: number) => {
      const url = cachedEmail(id)?.open_url;
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
    // ⇧U or ⌘K: the emails unread again. An open one's reader closes, so it stays unread.
    markUnread: (ids: number[]) => {
      // Sent mail has no read state to change.
      const unread = ids.filter(id => !rowOf(id)?.sent_only);
      if (!unread.length) return;
      if (listedOpen !== null && unread.includes(listedOpen)) close();
      void changeEach(unread, id => markUnread(id)).then(outcomes => {
        const refused = refusals(unread, outcomes);
        if (refused.length) toastFailure(counted(refused.length, 'Failed to mark unread', n => `Failed to mark ${n} unread`))(refused[0]!.error);
      });
    },
    // The unread ones of `ids` read, in place: they stay where they are and Attention's count doesn't
    // move. A copied code's email reads so, with nothing to say. The ids read, and each one's Undo
    // once the server has the change.
    read: (ids: number[]) => {
      const unread = ids.filter(id => rowOf(id)?.unread ?? true);
      if (!unread.length) return {unread, took: Promise.resolve([])};
      if (searching) for (const id of unread) search.mark(id, {unread: false});
      const took = changeEach(unread, id => markRead(id)).then(outcomes => {
        const refused = refusals(unread, outcomes);
        if (refused.length) toastFailure(counted(refused.length, 'Failed to mark read', n => `Failed to mark ${n} read`))(refused[0]!.error);
        return outcomes.flatMap((outcome, at) => (outcome.status === 'fulfilled' ? [{id: unread[at]!, undo: outcome.value.undo}] : []));
      });
      return {unread, took};
    },
    // The menu's Mark read on unread rows, as Mark all as read is for them: read in place, and
    // Undo or ⌘Z marks them unread again.
    markRead: (ids: number[]) => {
      const {unread, took} = on.read(ids);
      if (!unread.length) return;
      let toast = 0;
      const back = () => {
        const at = undos.indexOf(back);
        if (at < 0) return;
        undos.splice(at, 1);
        dismissToast(toast);
        if (searching) for (const id of unread) search.mark(id, {unread: true});
        // Once the read is in, only the emails that were unread go back so (an Undo sent before it is refused).
        void took.then(read => changeEach(read.map(one => one.id), id => undoRead(id, read.find(one => one.id === id)!.undo)).then(outcomes => {
          const refused = refusals(read.map(one => one.id), outcomes);
          if (refused.length) toastFailure(counted(refused.length, 'Failed to mark unread', n => `Failed to mark ${n} unread`))(refused[0]!.error);
        }));
      };
      undos.push(back);
      toast = showToast(counted(unread.length, 'Marked as read', n => `Marked ${n} as read`), {label: 'Undo', run: back, key: '⌘Z'});
    },
  };

  // The selection's actions, for its pane, its right-click menu, its keys and ⌘K. Done and Trash
  // end it. Pin, the read changes and Reply, Reply all and Forward (a window for each) keep it.
  const selectedRows = selected.flatMap(id => rowOf(id) ?? []);
  // The selection's front card in its pane.
  const stackFront = stacked(selection, selected)[0];
  const forSelection: SelectionHandlers = {
    done: () => {
      on.done(selected);
      clearSelection();
    },
    trash: () => {
      on.trash(selected);
      clearSelection();
    },
    pin: () => on.pin(selected),
    snooze: until => {
      on.snooze(selected, until);
      clearSelection();
    },
    markRead: () => on.markRead(selected),
    markUnread: () => on.markUnread(selected),
    reply: () => answerEach(selected, 'reply'),
    replyAll: () => answerEach(selected, 'reply_all'),
    forward: () => answerEach(selected, 'forward'),
    clear: clearSelection,
  };
  // Whether the keys act on the selection: while nothing's open over it.
  const onSelection = open === null && selected.length > 0;

  const actions = {
    done: () => (onSelection ? forSelection.done() : target !== null && on.done([target])),
    trash: () => (onSelection ? forSelection.trash() : target !== null && on.trash([target])),
    pin: () => (onSelection ? forSelection.pin() : target !== null && on.pin([target])),
    // On a snoozed email (found by search), a new time: it stays where it is, with Undo going back.
    snooze: (until: number) => {
      if (open === null) return;
      const was = rowOf(open)?.snoozed_until;
      if (!was) return on.snooze([open], until);
      const id = open;
      const at = new Date(until).toISOString();
      search.mark(id, {snoozed_until: at});
      void snooze(id, until).then(() => {
        let toast = 0;
        const back = () => {
          const index = undos.indexOf(back);
          if (index < 0) return;
          undos.splice(index, 1);
          dismissToast(toast);
          search.mark(id, {snoozed_until: was});
          void snooze(id, Date.parse(was)).catch(toastFailure('Failed to undo the snooze'));
        };
        undos.push(back);
        toast = showToast(snoozedLine(at, serverNow(), zone), {label: 'Undo', run: back, key: '⌘Z'});
      }, error => {
        search.mark(id, {snoozed_until: was});
        toastFailure('Failed to snooze')(error);
      });
    },
    // On a snoozed email (found by search): back in the Inbox, with Undo snoozing it again until the same time.
    // S opens the reader's snooze menu here, on the desktop.
    snoozeKey: !phone,
    unsnooze: () => {
      if (open === null) return;
      const was = rowOf(open)?.snoozed_until;
      if (!was) return;
      const id = open;
      search.mark(id, {snoozed_until: undefined});
      void unsnooze(id).then(() => {
        let toast = 0;
        const back = () => {
          const index = undos.indexOf(back);
          if (index < 0) return;
          undos.splice(index, 1);
          dismissToast(toast);
          search.mark(id, {snoozed_until: was});
          void snooze(id, Date.parse(was)).catch(toastFailure('Failed to snooze'));
        };
        undos.push(back);
        toast = showToast('Back in the Inbox', {label: 'Undo', run: back, key: '⌘Z'});
      }, error => {
        search.mark(id, {snoozed_until: was});
        toastFailure('Failed to unsnooze')(error);
      });
    },
    openInGmail: () => open !== null && on.openInGmail(open),
    step: (delta: 1 | -1) => {
      const next = listedOpen !== null ? neighbour(stops, listedOpen, delta) : null;
      if (next !== null) openEmail(next, undefined, delta > 0 ? 'next' : 'prev');
    },
    markUnread: () => (onSelection ? forSelection.markUnread() : target !== null && on.markUnread([target])),
    // The open email's code copied: read, quietly.
    codeCopied: () => open !== null && on.read([open]),
    // U: the cursor to the next unread email below it, from the top again past the last,
    // wherever the list is scrolled.
    toUnread: () => {
      const key = nextUnread(stops, cursor, unreadShown);
      if (!key) return;
      setCursor(key);
      requestAnimationFrame(() => document.querySelector(`[data-key="${key}"]`)?.scrollIntoView({block: 'nearest'}));
    },
    // "Marked 12 as read · Undo": Undo marks those same emails unread. Every row stays where it is.
    // In FYI or Noise only that view's mail. Attention has none.
    markAllRead: () => {
      if (view === 'attention') return;
      if (view === 'fyi' || view === 'noise') {
        on.markRead(viewReadIds);
        return;
      }
      const ids = markAllReadIds(withHeld(groups ?? [], held), allRows);
      void markAllRead().catch(toastFailure('Failed to mark all read'));
      if (!ids.length) return;
      // Undo, from the toast or ⌘Z as Done's and Trash's are, marks those same emails unread,
      // at once, before the server's list has them.
      let toast = 0;
      const back = () => {
        const at = undos.indexOf(back);
        if (at < 0) return;
        undos.splice(at, 1);
        dismissToast(toast);
        ids.forEach(id => void markUnread(id).catch(toastFailure('Failed to mark unread')));
      };
      undos.push(back);
      toast = showToast(`Marked ${ids.length} as read`, {label: 'Undo', run: back, key: '⌘Z'});
    },
    close: back,
  };

  // The pane beside the list: the open email, else the selection, else empty.
  // A new message has the pane to itself while no email is open.
  const composer = useOpenComposer();
  const writing = !phone && open === null && composer?.messageId === null && !composer.floating ? composer : null;
  const showsSelection = !phone && open === null && selected.length > 0 && !compact && !writing;
  const pane = useEmptyPane(open !== null || showsSelection || writing !== null, PANE_PATHS);
  // Without the selection's pane (where a pane covers the list, or a new message has it), its Snooze is
  // the first selected row's in the list, and snoozes them all.
  const selectionAnchor = !phone && onSelection && !showsSelection && selectionOffers(selectedRows).snooze
    ? stops.find(stop => stop.kind === 'row' && selected.includes(stop.id))?.key ?? null : null;
  const openSnoozeSelection = () => {
    if (selectionAnchor) document.querySelector(`[data-key="${selectionAnchor}"]`)?.scrollIntoView({block: 'nearest'});
    openSnooze('selection');
  };

  // Every row the list holds is selected: Select all turns to Deselect all.
  const allPicked = selecting && stops.some(stop => stop.kind === 'row') && stops.every(stop => stop.kind !== 'row' || selected.includes(stop.id));
  // A row's swipe, picked: read and unread change in place with nothing to say, as swiping back undoes
  // them; Trash and Done leave with their toast and Undo; Pin and Unpin move it on or off the shelf, with theirs.
  const swipeRun = (id: number, act: RowSwipe) => {
    if (act === 'read') on.read([id]);
    else if (act === 'unread') on.markUnread([id]);
    else if (act === 'trash') on.trash([id]);
    else if (act === 'done') on.done([id]);
    else on.pin([id], true);
  };

  // Select's bar in the tab bar's place, while its mode is on, its words following what's selected.
  // Every batch ends the mode: once it's done, the list shows what it did.
  const selectOffers = selectionOffers(selectedRows);
  const selectBar = selecting ? {
    // With nothing selected yet, Pin and Read, as they'll mostly be.
    count: selected.length, done: selectOffers.done > 0, pin: !selected.length || selectOffers.pin, read: !selected.length || selectOffers.read,
    on: {
      done: () => {
        on.done(selected);
        endSelecting();
      },
      trash: () => {
        on.trash(selected);
        endSelecting();
      },
      pin: () => {
        on.pin(selected, true);
        endSelecting();
      },
      read: () => {
        if (selectOffers.read) on.markRead(selected);
        else on.markUnread(selected);
        endSelecting();
      },
    },
  } : null;
  useLayoutEffect(() => showSelectBar(selectBar));
  useEffect(() => () => showSelectBar(null), []);

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
      // the highlight and what H, E and P act on are always the same email.
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
        else if (cursorStop?.kind === 'mentions') run(search.toggleMentions);
        else if (cursorStop?.kind === 'leftOut') run(search.toggleLeftOut);
      } else if (plainKey(event, 'h')) run(actions.done, 'h');
      else if (plainKey(event, 'c') && !phone) run(() => newMessage());
      else if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z' && undos.length) run(undos.at(-1)!);
      else if (commandKey(event, 'a') && !phone) run(selectAll);
      else if (plainKey(event, 'e')) run(actions.trash, 'e');
      else if (plainKey(event, 'p')) run(actions.pin, 'p');
      else if (plainKey(event, 'o')) run(actions.openInGmail, 'o');
      // S opens a snooze menu, on the desktop: the selection's, else the open email's, else the cursor row's.
      else if (plainKey(event, 's') && !phone) {
        if (onSelection) {
          if (selectionOffers(selectedRows).snooze) run(() => openSnoozeSelection(), 's');
        } else if (open !== null) run(() => openSnooze('reader'), 's');
        else if (cursorStop?.kind === 'row') run(() => openSnooze('row'));
      }
      // R, A and F answer the open email, or the one under the cursor, which opens with its composer.
      // On a selection they answer each one, in a window of its own, while it has 2 to 5 (else nothing).
      else if ((plainKey(event, 'r') || plainKey(event, 'a') || plainKey(event, 'f')) && !phone && (onSelection ? selectionOffers(selectedRows).answer : target !== null)) {
        const kind = plainKey(event, 'r') ? 'reply' : plainKey(event, 'a') ? 'reply_all' : 'forward';
        const hint = kind === 'reply' ? 'r' : kind === 'reply_all' ? 'a' : 'f';
        if (onSelection) run(() => answerEach(selected, kind), hint);
        else if (target !== null) run(() => answerOn(target, cursorStop?.kind === 'row' && cursorStop.id === target ? cursorStop.key : undefined, kind), hint);
      } else if (plainKey(event, 'i', {shift: true}) && view !== 'attention') run(actions.markAllRead, 'shift+i');
      else if (plainKey(event, 'u', {shift: true})) run(actions.markUnread);
      // U goes to the next unread email. 1, the Inbox's key elsewhere, goes back to All from a
      // search, another view or on the phone.
      else if (plainKey(event, 'u') && !searching) run(actions.toUnread);
      else if (plainKey(event, '1') && (searching || phone || view !== 'all')) run(() => navigate(toInbox()));
      else if (plainKey(event, 'Escape')) {
        if (selected.length) run(clearSelection, 'escape');
        else if (open !== null && answersOpen(openComposer()?.messageId) && !openComposer()?.floating) run(closeComposer);
        else if (writing) run(closeComposer);
        else if (open !== null) run(close);
        else if (pane.shown) run(pane.close);
        else if (alfred.open) run(() => {
          // The Answer card folds away, as its own Esc does (app/fold.ts).
          foldAway(document.querySelector('.search-list > .answer'));
          closeAlfred();
        });
        else if (searching) run(() => search.clear());
        else if (cursor !== null) run(() => setCursor(null));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // ⌘K's Mark all as read is this page's while it's on screen, as ⇧I is (the palette's own is for other pages).
  // A selection's are too, under its count, while its pane is up.
  useCommands(() => ({...(onSelection ? {context: {label: counted(selected.length, '1 email selected', n => `${n} emails selected`), colour: 'ink3' as const}} : {}), commands: [
    ...(onSelection ? selectionActions(selectedRows, forSelection, 'palette').map(action => ({...action, section: 'selection' as const})) : []),
    ...(searching || !unreadShown.size ? [] : [{id: 'to-unread', section: 'more', label: 'Go to next unread', icon: 'mark_email_unread', hint: 'U', keywords: 'unread new', run: actions.toUnread} satisfies Command]),
    // In FYI or Noise it reads that view's mail only, so the sidebar's Mark all as read isn't this one.
    ...(view === 'attention' ? [] : [{id: view === 'fyi' || view === 'noise' ? 'mark-view-read' : 'mark-all-read', section: 'more', label: markScope, icon: 'mark_email_read', hint: '⇧I', run: actions.markAllRead} satisfies Command]),
  ]}));

  // Until the list's first answers: its skeleton, or why they didn't come.
  const allLoad = {path: allPath(), data: allPages[0], error: allError};
  const listFailed = useLoadFailed([inboxLoad, allLoad]);
  const listArrived = useArrival(ready);
  // The days' next page on its way, as the list nears its end.
  const allMore = allPages.length > 1 && allPages.at(-1) === undefined;
  // The view has nothing in it, and nothing more to come: its empty state shows, and there's nothing to Select.
  const emptied = Boolean(shown && !attention.length && !dayViews.length && !allMore && (view === 'unread' || view === 'attention' || !allPages.at(-1)?.next_before));
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const unpin = (id: number) => void setPinned(id, false).catch(toastFailure('Failed to unpin'));

  /**
   * A right-click on an email's row (Attention, the shelf, a day, search's results or Alfred's
   * sources) opens its actions. The cursor moves there and nothing opens. Add to calendar, Add as
   * task and Ask open the email with their card.
   */
  function onContextMenu(event: ReactMouseEvent) {
    const target = event.target as Element;
    const element = target.closest<HTMLElement>('.list [data-key][data-id], .answer .src[data-id]');
    const id = element ? Number(element.dataset.id) : NaN;
    const row = rowOf(id);
    if (!element || !row) return;
    const key = element.dataset.key ?? stopOf(stops, id)?.key ?? null;
    // On a selected row, the selection's. On any other, its own, and the selection stays.
    if (selected.includes(id)) {
      const times = phone ? {} : {snoozeTimes: snoozeItems(serverNow(), settings?.reminders.task_time ?? null, zone, forSelection.snooze)};
      if (openContextMenu(event, element, selectionActions(selectedRows, {...forSelection, ...times}, 'menu')) && key && stops.some(stop => stop.key === key)) setCursor(key);
      return;
    }
    const provider = accounts.get(row.account_id)?.provider;
    const withCard = (card: ItemKind | 'ask') => {
      askCard(id, card);
      if (id !== listedOpen) openEmail(id, key ?? undefined);
    };
    const offered = emailActions(row, provider === undefined ? null : provider === 'gmail', {
      open: () => openEmail(id, key ?? undefined),
      done: () => on.done([id]),
      trash: () => on.trash([id]),
      pin: () => on.pin([id]),
      openInGmail: () => on.openInGmail(id),
      propose: withCard,
      ask: () => withCard('ask'),
      markRead: () => on.markRead([id]),
      markUnread: () => on.markUnread([id]),
      codeCopied: () => on.read([id]),
      // Reply: Reply all needs the email's recipients, so it's the reader's, ⌘K's and A's.
      ...(phone ? {} : {reply: () => answerOn(id, key, 'reply'), forward: () => answerOn(id, key, 'forward')}),
      // Snooze's times, on the desktop. A snoozed email (found by search) keeps the reader's menu for its new time.
      ...(phone || !snoozeable(row) ? {} : {snoozeTimes: snoozeItems(serverNow(), settings?.reminders.task_time ?? null, zone, until => on.snooze([id], until))}),
    }, 'menu', rules);
    if (!openContextMenu(event, element, offered)) return;
    if (key && stops.some(stop => stop.key === key)) setCursor(key);
    // Open in Gmail needs the email's own link: asked for now, so it's in by the time it's picked.
    if (provider === 'gmail' && id !== open) prefetch(messagePath(id));
  }

  return (
    <>
      {selecting ? (
        // Select's header: Cancel, how many are selected, and Select all or Deselect all.
        <header data-theme="night" className="hd ph-selecting">
          <button className="btn quiet ph-text" type="button" onClick={endSelecting}>Cancel</button>
          <h1 className="hd-title">{selected.length ? `${selected.length} selected` : 'Select emails'}</h1>
          <button className="btn quiet ph-text" type="button" disabled={!stops.some(stop => stop.kind === 'row')}
            onClick={() => (allPicked ? clearSelection() : selectAll())}>{allPicked ? 'Deselect all' : 'Select all'}</button>
        </header>
      ) : <header data-theme="night" className="hd">
        {phone && <Mark />}
        {phone && !searching ? <TitleMenu title={mailTitle(menuPlace)} rows={menuRows} /> : <h1 className="hd-title">{searching ? 'Search' : 'Inbox'}</h1>}
        {/* One count on the phone: Attention's, on All and Attention. On the other views the Inbox tab has it. */}
        {phone && !searching && (view === 'all' || view === 'attention') && counts && counts.attention > 0 && <span className="apill num" data-tip="Attention, not Done">{counts.attention}</span>}
        {/* The views, Unread's with the red unread badge and Attention's with its count. */}
        {!phone && !searching && (
          <Segmented className="ib-views" label="Views" value={view} onChange={switchView} onTab={switchView} segments={INBOX_VIEWS.map(one => ({value: one, label: <>
            {VIEW_LABELS[one]}
            {one === 'unread' && <UnreadBadge value={unreadHere} />}
            {one === 'attention' && attentionHere > 0 && <span className="n num"><Count value={attentionHere} /></span>}
          </>}))} />
        )}
        <span className="grow" />
        {!phone && !searching && markable && (
          // Its tooltip names what it reads. Below 1100 px it's the icon alone, beside the views.
          <button className="btn quiet sm mark-all" type="button" data-hint="shift+i" aria-label={markScope} data-tip={`${markScope} · ⇧I`} onClick={actions.markAllRead}>
            <Icon name="mark_email_read" size={16} /><span className="lbl">Mark all as read</span><span className="kbd">⇧I</span>
          </button>
        )}
        {phone && (
          <>
            {/* Not while searching: it would read the hidden Inbox's mail, not the results. */}
            {!searching && markable && <button className="ibtn ph-icon" type="button" aria-label={markScope} onClick={actions.markAllRead}><Icon name="done_all" size={20} /></button>}
            {/* Not on a view with nothing in it: there'd be no row to pick. */}
            {!searching && !emptied && <button className="btn quiet ph-text" type="button" onClick={() => setSelectMode(true)}>Select</button>}
            <button className="ibtn ph-icon" type="button" aria-label="New message" onClick={() => newMessage()}><Icon name="edit" size={20} /></button>
          </>
        )}
        <EmptyPaneButton pane={pane} />
        <SearchField search={search} operators onAsk={askAlfred} onEnter={first => setCursor(`all:${first.id}`)} />
      </header>}
      <div className="content" style={accountWidth} onContextMenu={onContextMenu}>
        {firstWait && waitedLong ? (
          <section className="list" aria-label="Search results"><SearchSkeleton immediate /></section>
        ) : searching && !firstWait ? (
          <SearchResults search={search} sections={sections} cursor={cursor} openId={listedOpen} selected={selectedSet} accounts={accounts} now={now} timeZone={zone}
            card={alfred.open ? <AnswerCard alfred={alfred} scoped={false} openId={open} accounts={accounts} now={now} timeZone={zone} onOpen={id => openEmail(id)} /> : null}
            onPoint={key => key !== cursor && setCursor(key)} onOpen={clickRow} onAsk={askAlfred} />
        ) : (
          // Until both answers are in, its skeleton, or why they didn't come. Rows not
          // shown before don't fold in then. A view starts afresh, at its top.
          <AllList key={view} attention={attention} days={dayViews} shelf={shelf} lanes={shown?.lanes ?? true} fill={view === 'fyi' || view === 'noise'}
            empty={view !== 'all' && emptied
              ? <EmptyView view={view} newest={(view === 'attention' ? allRows.find(row => row.lane === 'attention') : allRows[0])?.received_at ?? null} onAll={() => switchView('all')} /> : null}
            cursor={cursor} openId={listedOpen} selected={selectedSet} accounts={accounts} now={now} timeZone={zone} arrived={listArrived} more={allMore} dimmed={firstWait}
            loading={!ready ? (listFailed ? <LoadFailed what="the Inbox" loads={[inboxLoad, allLoad]} /> : <AllSkeleton account={false} />) : null} account={false} prompt={view === 'all' || view === 'attention' ? prompt : null}
            onPoint={key => key !== cursor && setCursor(key)} onOpen={clickRow} onToggleNoise={toggleNoise} onNearEnd={loadMore} onUnpin={unpin} onSnooze={phone ? undefined : (id, until) => on.snooze([id], until)}
            selectionSnooze={selectionAnchor ? {key: selectionAnchor, pick: forSelection.snooze} : null}
            selecting={selecting} swipe={phone && !selecting ? {acts: (row, key) => {
              const offered = rowSwipes(row);
              // Done takes a row out of Attention's band; in its day the row stays, ticked.
              const act = (one: RowSwipe) => (one === 'done' && key.startsWith('attention:') ? {...SWIPE_ACTS.done, leaves: true} : SWIPE_ACTS[one]);
              return {lead: offered.lead.map(act), trail: offered.trail.map(act)};
            }, run: (row, act) => swipeRun(row.id, act.id as RowSwipe)} : null}
            onCodeCopied={id => on.read([id])} onAnswer={(answer, yes) => {
              setAnswered(new Set([...answered, answer.id]));
              void answerPrompt(answer.id, yes).catch(toastFailure('Failed to answer'));
            }} />
        )}
        {open !== null && (
          <Reader id={open} travel={travelled?.id === open ? travelled.travel : null} row={rowOf(open)} accounts={accounts} now={now} timeZone={zone} actions={actions} onOpen={openFromReader} back={trail.length ? 'Back' : searching ? 'Search' : 'Inbox'}
            marks={searching ? readerMarks(open, search.listed, alfred.turns) : []}
            canStep={{previous: neighbour(stops, listedOpen ?? open, -1) !== null, next: neighbour(stops, listedOpen ?? open, 1) !== null}} />
        )}
        {/* From 640 to 1099 px a pane covers the list, so the selection shows only on its rows there. */}
        {writing && <NewMessagePane open={writing} />}
        {showsSelection && (
          <SelectionPane label="Selected emails" fit={[selectedRows.length, ...Object.values(selectionOffers(selectedRows))].join()} heading={counted(selectedRows.length, '1 email selected', n => `${n} emails selected`)} tools={<EmailTools rows={selectedRows} on={forSelection} />}
            lines={emailLines(stacked(selection, selected).flatMap(id => rowOf(id) ?? []))}
            front={stackFront !== undefined && <EmailCard id={stackFront} row={rowOf(stackFront)} accounts={accounts} now={now} timeZone={zone} />}
            onClear={clearSelection} onFront={id => select(broughtForward(selection, id))} onDrop={id => select(dropped(selection, selected, id))} />
        )}
        {pane.drawn && <InboxDay settle={pane.settle} />}
      </div>
    </>
  );
}
