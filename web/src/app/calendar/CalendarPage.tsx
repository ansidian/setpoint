// The Calendar page (DESIGN.md › Calendar; boards 11 and 11b): the header ("October 2026", ‹ Today ›,
// Month | Week, search, New C), the month grid and the right pane. The selected day and item ride
// in the address (/calendar/2026-10-17, /calendar/item/3?at=…); a selected item turns solid and its
// day is selected. Keys: ← → or P N page by month, T today, C new event, D new task, E edit, Delete,
// ⌘C copy, ⌘V paste, ⌘Z undo, Esc closes the topmost thing (the "+N" popover, the editor, the selection).
// F6 (boards 13, 14, 15, 15b, 19b): the editor in the right pane (also at /calendar/new, the proposal
// card's More options), dragging items to other days with the recurring scope asked on the drop,
// Clone, Copy and Paste, Colour, Delete, multi-select (⌘, Ctrl or ⇧ click), and every change shown
// where it lands (a new one too, at once): pending at .5 with a spinner, failed in place with a card that says why, with Try
// again and Move back.
// SV-23 (DESIGN.md › Decided while building #24): the header's search button, `/` or ⌘F turn the
// header into Search, as mail's does, and the results take the day's agenda's place in the right pane
// while the grid stays. A click on a result, or J / K to it, selects it as a click on the grid does;
// ↓ or Enter in the field goes to the first; E hands it to the editor, and the results come back
// after Create or Cancel. Esc closes the floating detail, then the search.
// SV-18 (DESIGN.md › Week view): Month | Week, M and W, and the week view (WeekGrid), whose arrows
// page a week; a range dragged there opens the editor on it, and a move or resize is sent as a drop
// is, the recurring scope asked first. The view rides in the address (?view=week).
import type {CalendarOut, CalendarSearchResultOut, CommandOut, EventColour, ItemChanges, ItemCreateInput, ItemOut, ItemsOut, RecurringScope, WeatherDayOut} from '@setpoint/shared';
import {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, completeItem, createItems, deleteItem, itemPath, monthItemsPath, monthWeatherPath, moveBack, retryChange, updateItem} from '../../api/items.ts';
import {addMonths, dayTitle, FIRST_WEEK, hiddenOn, itemDays, itemKey, itemsByDay, monthOf, monthTopRow, timeRange, weekIndex} from '../../logic/calendar.ts';
import type {Rect} from '../../logic/calendar.ts';
import {addDays, localDate, monthName} from '../../logic/format.ts';
import {asRetried, copyOf, dayOf, deletes, dropChange, inverseOf, movedItem, pasteOn, pendingItem, selectWith, withCreating} from '../../logic/manipulate.ts';
import type {Creating} from '../../logic/manipulate.ts';
import type {Deleting} from '../../logic/manipulate.ts';
import {routePath} from '../../logic/route.ts';
import type {CalendarMode, Route} from '../../logic/route.ts';
import {DEFAULT_SCOPE, moveLine, scopeChoices} from '../../logic/scope.ts';
import {tabTitle} from '../../logic/title.ts';
import {movedLine, resizedLine, visibleItems, weekMonth, weekStart, weekTitle} from '../../logic/week.ts';
import {glide, layout, motion} from '../../tokens.ts';
import {Icon} from '../../ui/Icon.tsx';
import {segThumb} from '../../ui/seg.ts';
import {echoKey, isTyping, plainKey} from '../../ui/keys.ts';
import {useNow} from '../clock.ts';
import {navigate} from '../router.ts';
import {useCommands} from '../palette/commands.ts';
import {useCompact} from '../Phone.tsx';
import {SearchField} from '../search/Search.tsx';
import {useCalendarSearch} from '../search/state.ts';
import {dismissToast, showToast, toastFailure, UNDO_MS} from '../toast.ts';
import {AnchoredCard} from './AnchoredCard.tsx';
import {setVisible, showHidden} from './CalendarSidebar.tsx';
import './calendar.css';
import type {ChipLook} from './Chip.tsx';
import {DayPane, HealthLines} from './DayPane.tsx';
import type {DetailActions, DetailTarget} from './detail/FloatingDetail.tsx';
import {Editor} from './Editor.tsx';
import type {EditorOpen, KeptDrafts, Slot} from './Editor.tsx';
import {FailedCard} from './FailedCard.tsx';
import {expectLanding} from './landing.ts';
import {MonthGrid} from './MonthGrid.tsx';
import {ScopePrompt} from './ScopePrompt.tsx';
import {SearchPane} from './SearchPane.tsx';
import {rememberMode} from './mode.ts';
import {knownDay, pulseToday, rememberDay, revealDay, scrollToMonth, setAnchor, setSearchMatches, setSelectedDay, setShownMonth, showWeek, useCalendarView} from './view.ts';
import {WeekGrid} from './WeekGrid.tsx';

type CalendarRoute = Extract<Route, {page: 'calendar'}>;

/** The page's address, whichever view: the editor keeps to the address it opened on across Month | Week. */
const addressOf = (route: CalendarRoute) => routePath({...route, view: undefined});

/**
 * The key the grid draws solid (DESIGN.md › The glide › Selection): when the selection moves from
 * one item to another, the old one goes back to tinted at once and the new one turns solid 60 ms
 * into the glide.
 */
function useSolidKey(selectedKey: string | null): string | null {
  const [solid, setSolid] = useState(selectedKey);
  const previous = useRef(selectedKey);
  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = selectedKey;
    if (was && selectedKey && was !== selectedKey) {
      setSolid(null);
      const timer = setTimeout(() => setSolid(selectedKey), glide.selectionSolidAtMs);
      return () => clearTimeout(timer);
    }
    setSolid(selectedKey);
  }, [selectedKey]);
  return solid;
}

const EMPTY_ITEMS: ItemOut[] = [];

/** A deleted chip fades out (120 ms) and folds up (180 ms); one Undo restores unfolds (180 ms), then lands (420 ms). */
const FOLD_MS = motion.fast + motion.medium;
const RESTORE_MS = motion.medium + 420;

/**
 * Where the zoom between Month and Week centres (polish audit grids-09): the middle of the selected
 * week's row in the month's section, as the month shows it (leaving) or will (arriving, its month's
 * first row at the top), or the section's middle when that row is out of view.
 */
function zoomRow(selectedDay: string, to: CalendarMode): number {
  const section = document.querySelector<HTMLElement>('[data-cal-section]');
  const height = section?.clientHeight ?? 0;
  const rows = weekIndex(selectedDay) - FIRST_WEEK;
  const scrolled = to === 'week' ? document.querySelector<HTMLElement>('.cal-scroll')?.scrollTop ?? 0 : monthTopRow(monthOf(selectedDay)) * layout.monthRow;
  const y = rows * layout.monthRow - scrolled + layout.weekdayRow + layout.monthRow / 2;
  return y > layout.weekdayRow && y < height ? y : height / 2;
}

/** The items of a few months around the one shown, each month its own cached resource. */
function useMonths(months: string[]): {items: ItemOut[]; weather: Map<string, WeatherDayOut>} {
  // Always four, so the hooks keep their order.
  const [a, b, c, d] = months as [string, string, string, string];
  const items = [useResource<ItemsOut>(monthItemsPath(a)).data, useResource<ItemsOut>(monthItemsPath(b)).data, useResource<ItemsOut>(monthItemsPath(c)).data, useResource<ItemsOut>(monthItemsPath(d)).data];
  const weather = [useResource<WeatherDayOut[]>(monthWeatherPath(a)).data, useResource<WeatherDayOut[]>(monthWeatherPath(b)).data, useResource<WeatherDayOut[]>(monthWeatherPath(c)).data, useResource<WeatherDayOut[]>(monthWeatherPath(d)).data];
  const [i0, i1, i2, i3] = items;
  const [w0, w1, w2, w3] = weather;
  return useMemo(() => ({
    items: [i0, i1, i2, i3].flatMap(month => month?.items ?? EMPTY_ITEMS),
    weather: new Map([w0, w1, w2, w3].flatMap(month => month ?? []).map(day => [day.date, day])),
  }), [i0, i1, i2, i3, w0, w1, w2, w3]);
}

/** A change on its way, as the grid draws it until the server's answer is in. */
const sending = (item: ItemOut): ItemOut => ({
  ...item,
  command: {id: 0, target: 'item', target_id: item.id, kind: 'item_update', state: 'pending', provider: null, provider_message: null, can_retry: false, can_move_back: false,
    previous: null, created_at: new Date().toISOString(), settled_at: null} satisfies CommandOut,
});

/** A question about a recurring event's occurrences, anchored to it on the grid. */
type Ask =
  // `line`: what the toast says once it's moved.
  | {kind: 'move'; item: ItemOut; from: string; to: string; changes: ItemChanges; scope: RecurringScope; line: string}
  | {kind: 'resize'; item: ItemOut; from: string; to: string; changes: ItemChanges; scope: RecurringScope}
  | {kind: 'delete'; item: ItemOut; from: string; scope: RecurringScope}
  | {kind: 'colour'; item: ItemOut; from: string; colour: EventColour | null; scope: RecurringScope};

/**
 * Deletes waiting out their Undo (UNDO_MS) before they're sent, kept here so leaving Calendar
 * neither loses nor shows them again; one still waiting as the page goes away is sent then, kept
 * alive past it.
 */
const heldDeletes = new Map<Deleting, (keepalive?: boolean) => void>();
window.addEventListener('pagehide', () => [...heldDeletes.values()].forEach(send => send(true)));

type EditorState = EditorOpen & {handed: boolean; seq: number; at: string; place?: {day: string}};

// A started editor kept while the user is on another page, with its drafts, brought back on their return
// (UX #3): only Create, Save, Cancel or Esc end a draft (DESIGN.md › Decided while building #49).
let keptEditor: EditorState | null = null;

export function CalendarPage({route}: {route: CalendarRoute}) {
  const now = useNow();
  const zone = timeZone();
  const today = localDate(now, zone);
  const view = useCalendarView();
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  // The compact tier: the grid takes the width, and the right pane lies over it while it holds the
  // editor or search; the day's pane isn't drawn (#258).
  const compact = useCompact();
  // ⌘K shows or hides each calendar, as the sidebar's Calendars do, so the rail (which has none) keeps
  // the filter (#258).
  useCommands(() => ({commands: (calendars ?? []).map(calendar => ({
    id: `calendar-${calendar.id}`, section: 'more' as const, label: `${calendar.visible ? 'Hide' : 'Show'} ${calendar.name}`, icon: calendar.visible ? 'visibility_off' as const : 'visibility' as const,
    keywords: 'calendar calendars filter toggle',
    run: () => void setVisible(calendar, !calendar.visible),
  }))}));
  const selectedKey = route.item ? itemKey(route.item, route.at) : null;
  // A single event or a task's address has only its id: its day comes from the grid, else from it.
  const known = selectedKey ? knownDay(selectedKey) : null;
  const {data: detail} = useResource<ItemOut>(route.item && !route.at && !known ? itemPath(route.item) : null);
  const itemDay = route.item
    ? known ?? (route.at ? localDate(route.at, zone) : detail?.id === route.item ? itemDays(detail, zone)[0] ?? null : null)
    : null;
  const selectedDay = route.date ?? itemDay ?? today;
  const mode: CalendarMode = route.view === 'week' ? 'week' : 'month';
  const week = view.week ?? weekStart(selectedDay);
  const shown = mode === 'week' ? weekMonth(week) : view.shown ?? monthOf(selectedDay);
  useEffect(() => rememberMode(mode), [mode]);
  const [popover, setPopover] = useState<string | null>(null);
  // The editor, and the address it opened on: its draft's day is the selected day until the user picks another (choice 14).
  const [editor, setEditor] = useState<EditorState | null>(() => (keptEditor ? {...keptEditor, at: addressOf(route)} : null));
  // Whether its draft holds anything: E or New doesn't replace one that does.
  const [editorDirty, setEditorDirty] = useState(() => keptEditor !== null);
  // The open editor's drafts as they stand, and whether to keep them if the page is left.
  const editorDrafts = useRef<KeptDrafts | null>(null);
  const keepOnLeave = useRef<EditorState | null>(null);
  useEffect(() => {
    keepOnLeave.current = editor && editorDirty ? editor : null;
  }, [editor, editorDirty]);
  useEffect(() => {
    keptEditor = null;
    return () => {
      keptEditor = keepOnLeave.current && editorDrafts.current ? {...keepOnLeave.current, kept: editorDrafts.current} : null;
    };
  }, []);
  const keepDrafts = useCallback((kept: KeptDrafts) => {
    editorDrafts.current = kept;
  }, []);
  // Editors are numbered from the one brought back, so a new one never shares its key.
  const editorSeq = useRef(keptEditor?.seq ?? 0);
  const [selection, setSelection] = useState<string[]>([]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [sendingNow, setSending] = useState<Map<string, ItemOut>>(new Map());
  // New items drawn the moment they're asked for, until the server's own are in (withCreating).
  const [creating, setCreating] = useState<Creating[]>([]);
  // Deletes asked for here, off the grid until the provider confirms (or back, failed, if it refuses);
  // `sent` once the server has it, when the item's own pending delete keeps it off.
  const [deleting, setDeleting] = useState<(Deleting & {sent: boolean})[]>([]);
  // Items folding away as they're deleted here, and coming back as Undo restores them (polish audit calflows-11).
  const [removing, setRemoving] = useState<ReadonlySet<string>>(new Set());
  const [restoring, setRestoring] = useState<ReadonlySet<string>>(new Set());
  const forAWhile = (set: typeof setRemoving, keys: string[], ms: number) => {
    set(current => new Set([...current, ...keys]));
    window.setTimeout(() => set(current => new Set([...current].filter(key => !keys.includes(key)))), ms);
  };
  const newIds = useRef(0);
  // Failed changes Try again was asked of, with when each had failed: pending until the server lists them otherwise.
  const [retried, setRetried] = useState<ReadonlyMap<number, string | null>>(new Map());
  // ⌘Z: what puts back each change made here, newest last.
  const undos = useRef<(() => void)[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [previews, setPreviews] = useState<{items: ItemOut[]; day: string | null}>({items: [], day: null});
  const clipboard = useRef<ItemOut[]>([]);
  const [searching, setSearching] = useState(false);
  const search = useCalendarSearch();

  const {items, weather} = useMonths([addMonths(shown, -1), shown, addMonths(shown, 1), addMonths(shown, 2)]);
  const calendarsById = useMemo(() => new Map((calendars ?? []).map(calendar => [calendar.id, calendar])), [calendars]);

  // Items as they show: changes on their way where they're going, deletes on their way gone.
  const present = useCallback((list: ItemOut[]) => list.flatMap(item => {
    const shown = asRetried(sendingNow.get(item.key) ?? item, retried);
    const waiting = shown.command?.kind === 'item_delete' && shown.command.state === 'pending';
    // Deleted here, it folds away first.
    if ([...heldDeletes.keys()].some(entry => deletes(entry, shown))) return removing.has(shown.key) ? [shown] : [];
    return deleting.some(entry => deletes(entry, shown) && (!entry.sent || waiting)) ? [] : [shown];
  }), [sendingNow, deleting, retried, removing]);

  // What the grid draws: the items as they show, new items on their way, a drop waiting on its scope
  // at its new day (its origin a faded ghost), and the editor's drafts as ghosts.
  const drawn = useMemo(() => {
    const list = present(withCreating(items, creating));
    if (ask?.kind === 'move' || ask?.kind === 'resize') list.push({...movedItem(ask.item, ask.changes), id: -ask.item.id, key: `moving:${ask.item.key}`});
    return [...list, ...previews.items];
  }, [items, present, creating, ask, previews.items]);
  const byDay = useMemo(() => itemsByDay(drawn, calendars, zone), [drawn, calendars, zone]);
  const looks = useMemo(() => {
    const map = new Map<string, ChipLook>(previews.items.map(item => [item.key, 'ghost']));
    if (ask?.kind === 'move' || ask?.kind === 'resize') map.set(ask.item.key, 'faded');
    for (const key of removing) map.set(key, 'removing');
    for (const key of restoring) map.set(key, 'restoring');
    return map;
  }, [previews.items, ask, removing, restoring]);

  // The editor's active draft's day is the selected day while it's open (board 13).
  const paneDay = (editor && addressOf(route) === editor.at && previews.day) || selectedDay;
  // The pane reads the selected day's month itself, so a day far from the grid's still shows.
  const {data: dayMonth} = useResource<ItemsOut>(monthItemsPath(monthOf(selectedDay)));
  const {data: dayWeather} = useResource<WeatherDayOut[]>(monthWeatherPath(monthOf(selectedDay)));
  const paneItems = useMemo(() => itemsByDay(present(dayMonth?.items ?? EMPTY_ITEMS), calendars, zone).get(selectedDay) ?? EMPTY_ITEMS, [dayMonth, present, calendars, zone, selectedDay]);
  // What the calendars toggled off hide on that day, so its pane doesn't call it free (SV-56).
  const paneHidden = useMemo(() => hiddenOn(selectedDay, present(dayMonth?.items ?? EMPTY_ITEMS), calendars, zone), [dayMonth, present, calendars, zone, selectedDay]);
  // Every calendar off: the header says the view is filtered, whatever the day (SV-56).
  const allHidden = !!calendars?.length && calendars.every(calendar => !calendar.visible);

  const solidKey = useSolidKey(selectedKey);
  const selectedItem = useMemo(() => (selectedKey ? drawn.find(item => item.key === selectedKey) ?? paneItems.find(item => item.key === selectedKey) ?? null : null),
    [drawn, paneItems, selectedKey]);
  const selected = useMemo(() => {
    const keys = new Set(selection.length ? selection : solidKey ? [solidKey] : []);
    if (ask?.kind === 'move' || ask?.kind === 'resize') keys.add(`moving:${ask.item.key}`);
    return keys;
  }, [selection, solidKey, ask]);
  const selectedItems = useMemo(() => (selection.length ? drawn.filter(item => selection.includes(item.key)) : selectedItem ? [selectedItem] : []), [selection, drawn, selectedItem]);

  // A failed change shows its card: the selected item's, else the newest one on screen nobody closed.
  const failed = useMemo(() => {
    if (selectedItem?.command?.state === 'failed') return selectedItem;
    if (selectedItem || selection.length || ask || editor) return null;
    return drawn.filter(item => item.command?.state === 'failed' && !dismissed.has(item.command.id))
      .sort((a, b) => b.command!.created_at.localeCompare(a.command!.created_at))[0] ?? null;
  }, [selectedItem, selection.length, ask, editor, drawn, dismissed]);

  // The floating detail shows the one selected item while its chip is on the grid, the editor open
  // or not; Edit hands it to the pane's editor, and the card goes there.
  const handedKey = editor?.item?.key ?? null;
  const detailTarget = useMemo<DetailTarget | null>(() => (selectedItem && selectedItem.key !== handedKey && !ask && !selection.length && selectedItem.command?.state !== 'failed'
    ? {item: selectedItem, date: selectedDay, calendar: calendarsById.get(selectedItem.calendar_id)}
    : null), [selectedItem, handedKey, ask, selection.length, selectedDay, calendarsById]);

  useEffect(() => setSelectedDay(paneDay), [paneDay]);
  const title = mode === 'week' ? weekTitle(week) : monthName(`${shown}-01`);
  useEffect(() => {
    document.title = tabTitle({page: 'calendar', title});
  }, [title]);
  // The header's title swaps the way the grid went (polish audit grids-04): a later month rises in,
  // an earlier one falls, a week slides as its days do. A switch of view or Search just shows.
  const titleKey = searching ? 'search' : `${mode}:${mode === 'week' ? week : shown}`;
  const [titleMove, setTitleMove] = useState<{key: string; dir: 'next' | 'prev' | undefined}>({key: titleKey, dir: undefined});
  if (titleMove.key !== titleKey) {
    const [was, is] = [titleMove.key.split(':'), titleKey.split(':')];
    setTitleMove({key: titleKey, dir: was[0] === is[0] && was.length === 2 ? (is[1]! > was[1]! ? 'next' : 'prev') : undefined});
  }
  // The mini-month follows the week shown.
  useEffect(() => {
    if (mode === 'week') setShownMonth(weekMonth(week));
  }, [mode, week]);
  // A day chosen elsewhere (the Today block, a link, Back) comes into view.
  useEffect(() => revealDay(selectedDay), [selectedDay]);
  // So does the open editor's draft day, wherever it came from (an email's More options, the line),
  // so its ghost is on screen (UX #5).
  const draftDay = editor ? previews.day : null;
  useEffect(() => {
    if (draftDay) revealDay(draftDay);
  }, [draftDay]);

  // /calendar/new (the proposal card's More options, News's Add to calendar) opens the editor, from the
  // email or the Upcoming keynote when it names one.
  const compose = route.compose;
  useEffect(() => {
    if (!compose) return;
    editorSeq.current += 1;
    setEditor({kind: compose.kind, date: today, message: compose.message, upcoming: compose.upcoming ?? null, handed: false, seq: editorSeq.current, at: addressOf(route)});
    setEditorDirty(false);
    // Only when the address asks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compose?.kind, compose?.message, compose?.upcoming]);

  // /calendar/item/3/edit (the Today block's card's Edit, #78) opens the editor on the item once it's
  // drawn, and the address drops its /edit.
  const editing = route.edit ? selectedItem : null;
  useEffect(() => {
    if (!editing) return;
    const plain: CalendarRoute = {page: 'calendar', date: null, item: editing.id, at: editing.occurrence_start};
    navigate(plain, {replace: true});
    if (editing.read_only) return;
    editorSeq.current += 1;
    setEditor({kind: editing.kind, date: selectedDay, item: editing, handed: false, seq: editorSeq.current, at: addressOf(plain)});
    setEditorDirty(false);
    // Only when the address asks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing?.key]);

  const selectDay = useCallback((date: string) => {
    setSelection([]);
    navigate({page: 'calendar', date, item: null, at: null});
  }, []);
  // A click on a grid day selects it as usual and moves a new draft there (on the week's hours, to the
  // time clicked too); an edited item stays (choice 14, D56).
  const clickDay = useCallback((date: string, at?: number) => {
    setEditor(open => (open && !open.item ? {...open, place: {day: date, ...(at === undefined ? {} : {at})}} : open));
    selectDay(date);
  }, [selectDay]);

  const selectItem = useCallback((item: ItemOut, date: string, rect: Rect | null, additive = false) => {
    // A draft or a drop waiting on its scope isn't an item yet.
    if (item.id < 0) return;
    setPopover(null);
    setAsk(null);
    if (additive) {
      const next = selectWith(selection.length ? selection : selectedKey ? [selectedKey] : [], item.key, true);
      if (next.length > 1) {
        setSelection(next);
        navigate({page: 'calendar', date, item: null, at: null});
        return;
      }
    }
    setSelection([]);
    rememberDay(item.key, date);
    setAnchor(rect ? {key: item.key, rect} : null);
    navigate({page: 'calendar', date: null, item: item.id, at: item.occurrence_start});
  }, [selection, selectedKey]);

  // Paging glides the month (polish audit grids-04): pressed again mid-glide, it goes on from the
  // month it's gliding to, not the one passing by.
  const page = (delta: number) => {
    setPopover(null);
    if (mode === 'week') showWeek(addDays(week, 7 * delta), 'page');
    else scrollToMonth(addMonths(view.gliding ?? shown, delta), 'page');
  };
  // Today's disc swells as it lands (polish audit grids-11): the month's once its glide is there, the
  // week's once its days are drawn.
  const goToday = () => {
    setPopover(null);
    navigate({page: 'calendar', date: null, item: null, at: null});
    if (mode === 'week') {
      revealDay(today);
      requestAnimationFrame(() => requestAnimationFrame(pulseToday));
    } else scrollToMonth(monthOf(today), 'today');
  };
  // Week is Month zoomed in on the selected week (polish audit grids-09): it scales up into place from
  // that week's row, and Month settles back out around it.
  const [zoom, setZoom] = useState<{to: CalendarMode; y: number} | null>(null);
  /** Month | Week, M and W: Week opens on the selected day's week, Month on its month. */
  const switchMode = (next: CalendarMode) => {
    if (next === mode) return;
    setPopover(null);
    setZoom({to: next, y: zoomRow(selectedDay, next)});
    if (next === 'week') showWeek(weekStart(selectedDay), 'jump');
    else scrollToMonth(monthOf(selectedDay));
    navigate({...route, view: next});
  };
  const openEditor = (open: EditorOpen, handed = false, at = addressOf(route)) => {
    // A draft with something in it leaves only by Create, Save, Cancel or Esc: New, C, D and E say so
    // and leave it be (SV-29, replacing D56's second draft).
    if (editor && editorDirty) {
      showToast(editor.item ? 'Save or cancel your changes first' : 'Create or cancel the draft first');
      (document.querySelector<HTMLElement>('.editor .nl-input') ?? document.querySelector<HTMLElement>('.editor'))?.focus();
      return;
    }
    setPopover(null);
    setAsk(null);
    editorSeq.current += 1;
    setEditor({...open, handed, seq: editorSeq.current, at});
    setEditorDirty(false);
  };
  const newItem = (kind: 'event' | 'task') => openEditor({kind, date: selectedDay});
  // A day's + on the month: that day, selected, and a new event on it (polish audit grids-06).
  const newOn = (date: string) => {
    const there: CalendarRoute = {page: 'calendar', date, item: null, at: null};
    // A started draft stays, as New says (openEditor), and so does the day.
    if (!(editor && editorDirty)) selectDay(date);
    openEditor({kind: 'event', date}, false, addressOf(there));
  };
  // A range dragged on the week: a new event there, its line still to write.
  const createAt = (date: string, slot: Slot) => openEditor({kind: 'event', date, slot});
  const editItem = (item: ItemOut, handed = false) => openEditor({kind: item.kind, date: selectedDay, item}, handed);
  const closeEditor = () => {
    setEditor(null);
    setEditorDirty(false);
    if (route.compose) navigate({page: 'calendar', date: null, item: null, at: null}, {replace: true});
  };
  /**
   * Esc closes the topmost thing: the "+N" popover, the floating detail, a multi-selection (⌘ or Ctrl
   * alone turns the detail's item into one), then the editor (its draft goes), then the selection,
   * then a failed card. Also the editor's own Esc.
   */
  const escape = (): boolean => {
    if (popover) setPopover(null);
    else if (detailTarget) selectDay(selectedDay);
    else if (selection.length) setSelection([]);
    else if (editor) closeEditor();
    else if (searching) closeSearch();
    else if (route.item) selectDay(selectedDay);
    else if (failed) setDismissed(set => new Set(set).add(failed.command!.id));
    else return false;
    return true;
  };
  // A search with all its results shown dims the grid's other items (polish audit search-10); one with
  // more to load doesn't, so nothing it matches dims.
  const matchIds = searching && search.active && search.out && search.out.next_offset === null ? search.results.map(result => result.item.id).join(',') : null;
  useEffect(() => {
    setSearchMatches(matchIds === null ? null : new Set(matchIds ? matchIds.split(',').map(Number) : []));
    return () => setSearchMatches(null);
  }, [matchIds]);
  // Whether the open search has had a query: emptied again, it closes, as Esc does (SV-29).
  const [searched, setSearched] = useState(false);
  const closeSearch = () => {
    setSearching(false);
    setSearched(false);
    search.clear();
  };
  if (searching && search.active && !searched) setSearched(true);
  // Once the keystroke is over: typing over the whole query empties it a moment before its first letter.
  useEffect(() => {
    if (!searching || !searched || search.active) return;
    const timer = window.setTimeout(() => {
      setSearching(false);
      setSearched(false);
    });
    return () => window.clearTimeout(timer);
  }, [searching, searched, search.active]);
  /** A result: its day comes into view, it's selected, and the floating detail opens or glides to it. */
  const selectResult = (result: CalendarSearchResultOut) => {
    selectItem(result.item, result.date, null);
    requestAnimationFrame(() => document.querySelector(`.cal-search [data-key="${CSS.escape(result.item.key)}"]`)?.scrollIntoView({block: 'nearest'}));
  };
  const stepResult = (delta: 1 | -1) => {
    const {results} = search;
    const at = results.findIndex(result => result.item.key === selectedKey);
    const next = results[at < 0 ? (delta > 0 ? 0 : results.length - 1) : Math.min(results.length - 1, Math.max(0, at + delta))];
    if (next) selectResult(next);
  };

  const onPreview = useCallback((list: ItemOut[], day: string | null) => {
    setPreviews(current => (current.items === list || (!current.items.length && !list.length && current.day === day) ? current : {items: list, day}));
  }, []);

  // ---------- Changes ----------

  /**
   * Says what a change did, once the server has it, with an Undo that takes it back ("Moved Dentist to
   * Thu, Oct 8 · Undo", UX #6); ⌘Z runs the same Undo. Without one (a recurring event's
   * occurrences), the line alone.
   */
  const said = (text: string | null, undo: (() => void) | null) => {
    if (!undo) {
      if (text) showToast(text);
      return;
    }
    let toast = 0;
    let done = false;
    const once = () => {
      if (done) return;
      done = true;
      const at = undos.current.indexOf(once);
      if (at >= 0) undos.current.splice(at, 1);
      dismissToast(toast);
      undo();
    };
    undos.current.push(once);
    if (text) toast = showToast(text, {label: 'Undo', run: once});
  };

  /**
   * Shows `item` changed at once, sends the change, and lets the server's answer take over, saying
   * so when `line` is given. A change to a single item can be undone (the toast's Undo or ⌘Z); one to
   * a recurring event's occurrences can't.
   */
  const send = (item: ItemOut, changes: ItemChanges, scope: RecurringScope, what: string, line: string | null, undoing = false) => {
    const moved = movedItem(item, changes);
    setSending(map => new Map(map).set(item.key, sending(moved)));
    void updateItem(item.id, {changes, scope, occurrence_start: item.occurrence_start})
      .then(() => {
        if (!undoing) said(line, item.recurring ? null : () => send(moved, inverseOf(item, changes), 'this', `Couldn't undo ${item.title}`, null, true));
      })
      .catch(toastFailure(what))
      .finally(() => setSending(map => {
        const next = new Map(map);
        next.delete(item.key);
        return next;
      }));
  };

  const onDrop = (item: ItemOut, from: string, to: string) => {
    const changes = dropChange(item, to, zone);
    if (!changes) return;
    const line = `Moved ${item.title} to ${dayTitle(to)}`;
    if (item.kind === 'event' && item.recurring) setAsk({kind: 'move', item, from, to, changes, scope: DEFAULT_SCOPE, line});
    else send(item, changes, 'this', `Couldn't move ${item.title}`, line);
  };

  /** A block moved or resized on the week: sent as a drop is, a recurring event's scope asked first. */
  const onWeekChange = (item: ItemOut, changes: ItemChanges, from: string, to: string, kind: 'move' | 'resize') => {
    const recurring = item.kind === 'event' && item.recurring;
    if (kind === 'move') {
      const line = movedLine(item, changes, zone);
      if (recurring) setAsk({kind: 'move', item, from, to, changes, scope: DEFAULT_SCOPE, line});
      else send(item, changes, 'this', `Couldn't move ${item.title}`, line);
      return;
    }
    if (recurring) setAsk({kind: 'resize', item, from, to, changes, scope: DEFAULT_SCOPE});
    else send(item, changes, 'this', `Couldn't change ${item.title}`, resizedLine(item, changes, zone));
  };

  const remove = (targets: ItemOut[]) => {
    const [only] = targets;
    if (targets.length === 1 && only && only.kind === 'event' && only.recurring) {
      setAsk({kind: 'delete', item: only, from: dayOf(only, zone) ?? selectedDay, scope: DEFAULT_SCOPE});
      return;
    }
    setSelection([]);
    drop(targets.map(item => ({item, scope: 'this' as RecurringScope})));
  };

  /** Sends deletes, off the grid until the provider confirms; a refusal brings one back and says why. */
  const sendDeletes = (entries: (Deleting & {sent: boolean})[], titles: string[], keepalive = false) => {
    setDeleting(current => [...current, ...entries]);
    entries.forEach((entry, index) => {
      void deleteItem(entry.id, {scope: entry.scope, occurrence_start: entry.occurrence_start}, {keepalive})
        .then(() => setDeleting(current => current.map(one => (one === entry ? {...one, sent: true} : one))))
        .catch(error => {
          setDeleting(current => current.filter(one => one !== entry));
          toastFailure(`Couldn't delete ${titles[index]}`)(error);
        });
    });
  };

  /**
   * Takes the items off the grid at once and says so with Undo ("Deleted Dentist · Undo", UX #1);
   * the delete is sent once the Undo has gone, and a refusal brings it back. Undo, or ⌘Z meanwhile,
   * keeps it and sends nothing.
   */
  const drop = (list: {item: Pick<ItemOut, 'id' | 'key' | 'occurrence_start' | 'title'>; scope: RecurringScope}[]) => {
    if (!list.length) return;
    const entries = list.map(({item, scope}) => ({id: item.id, scope, occurrence_start: item.occurrence_start, sent: false}));
    if (list.some(({item}) => item.key === selectedKey)) selectDay(selectedDay);
    let timer = 0;
    const send = (keepalive = false) => {
      window.clearTimeout(timer);
      entries.forEach(entry => heldDeletes.delete(entry));
      const at = undos.current.indexOf(undo);
      if (at >= 0) undos.current.splice(at, 1);
      sendDeletes(entries, list.map(({item}) => item.title), keepalive);
    };
    const keys = list.map(({item}) => item.key);
    const undo = () => {
      if (!entries.some(entry => heldDeletes.has(entry))) return;
      window.clearTimeout(timer);
      entries.forEach(entry => heldDeletes.delete(entry));
      const at = undos.current.indexOf(undo);
      if (at >= 0) undos.current.splice(at, 1);
      dismissToast();
      // Back as it went, then its tint lands.
      forAWhile(setRestoring, keys, RESTORE_MS);
      setDeleting(current => [...current]);
    };
    entries.forEach(entry => heldDeletes.set(entry, send));
    timer = window.setTimeout(send, UNDO_MS);
    undos.current.push(undo);
    // Off the grid now, folding away first: the held entries are read by `present`.
    forAWhile(setRemoving, keys, FOLD_MS);
    setDeleting(current => [...current]);
    showToast(list.length === 1 ? `Deleted ${list[0]!.item.title}` : `Deleted ${list.length} items`, {label: 'Undo', run: undo});
  };

  /** Try again on a failed change: pending at once, as every change shows (SV-42); a refusal of the retry itself brings the failure back. */
  const retry = (item: ItemOut) => {
    const {id, settled_at: failedAt} = item.command!;
    setRetried(map => new Map(map).set(id, failedAt));
    return retryChange(id).catch(error => {
      setRetried(map => {
        const next = new Map(map);
        next.delete(id);
        return next;
      });
      toastFailure('Couldn\'t try again')(error);
    });
  };

  const recolour = (item: ItemOut, colour: EventColour | null) => {
    if (item.recurring) setAsk({kind: 'colour', item, from: dayOf(item, zone) ?? selectedDay, colour, scope: DEFAULT_SCOPE});
    else send(item, {colour}, 'this', `Couldn't colour ${item.title}`, `Changed the colour of ${item.title}`);
  };

  /** Draws the new items at once, pending, and creates them, saying so; Undo or ⌘Z deletes them again. */
  const create = (inputs: ItemCreateInput[], what: string, line: (drafts: ItemOut[]) => string) => {
    const at = new Date().toISOString();
    const drafts = inputs.map(input => pendingItem(input, -++newIds.current, at));
    const asked: Creating = {drafts, listed: new Set(items.map(item => item.id))};
    // An answered create is kept, with what it made, while another still waits; a failed one goes.
    const settle = (made?: number[]) => setCreating(list => {
      const next = list.flatMap(one => (one !== asked ? [one] : made ? [{...one, made}] : []));
      return next.some(one => !one.made) ? next : [];
    });
    setCreating(list => [...list, asked]);
    void createItems(inputs)
      .then(commands => {
        settle(commands.map(command => command.target_id));
        // The server's own copies land as they're drawn settled (polish audit calflows-02).
        expectLanding(commands.map(command => command.target_id));
        said(line(drafts), () => {
          sendDeletes(commands.map(command => ({id: command.target_id, scope: 'this', occurrence_start: null, sent: false})), commands.map(() => 'it'));
        });
      }, error => {
        settle();
        toastFailure(what)(error);
      });
  };

  /** Copy and ⌘C say what they took: "Copied Dinner with Sam, ⌘V pastes on the selected day" ("Copied 3 items, …"). */
  const copy = (list: ItemOut[]) => {
    clipboard.current = list;
    showToast(`Copied ${list.length === 1 ? list[0]!.title : `${list.length} items`}, ⌘V pastes on the selected day`);
  };

  const paste = () => {
    if (!clipboard.current.length) return;
    const list = clipboard.current;
    create(pasteOn(list, selectedDay, zone), 'Couldn\'t paste', () => `Pasted ${list.length === 1 ? list[0]!.title : `${list.length} items`} on ${dayTitle(selectedDay)}`);
  };

  const answer = () => {
    if (!ask) return;
    setAsk(null);
    if (ask.kind === 'move') send(ask.item, ask.changes, ask.scope, `Couldn't move ${ask.item.title}`, ask.line);
    else if (ask.kind === 'resize') send(ask.item, ask.changes, ask.scope, `Couldn't change ${ask.item.title}`, resizedLine(ask.item, ask.changes, zone));
    else if (ask.kind === 'colour') send(ask.item, {colour: ask.colour}, ask.scope, `Couldn't colour ${ask.item.title}`, `Changed the colour of ${ask.item.title}`);
    else drop([{item: ask.item, scope: ask.scope}]);
  };

  const actions: DetailActions = {
    complete: task => complete(task),
    clone: item => create([copyOf(item, 0, zone)], `Couldn't clone ${item.title}`, () => `Cloned ${item.title}`),
    copy: item => copy([item]),
    colour: recolour,
    remove: item => remove([item]),
  };

  const complete = (task: ItemOut, undoing = false) => {
    setSending(map => new Map(map).set(task.key, sending({...task, done: !task.done})));
    void completeItem(task.id, !task.done, task.recurring ? task.due_date : null)
      .then(() => {
        if (!undoing) said(`${task.done ? 'Reopened' : 'Completed'} ${task.title}`, task.recurring ? null : () => complete({...task, done: !task.done}, true));
      })
      .catch(toastFailure(`Couldn't complete ${task.title}`))
      .finally(() => setSending(map => {
        const next = new Map(map);
        next.delete(task.key);
        return next;
      }));
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // `/` or ⌘F (even from another field) opens the search; once it's open, the App focuses its field.
      const find = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f';
      if (!searching && (find || (plainKey(event, '/') && !isTyping(event) && !event.defaultPrevented))) {
        event.preventDefault();
        setSearching(true);
        return;
      }
      if (isTyping(event) || event.defaultPrevented) return;
      // ⌘ or Ctrl alone puts the floating detail away, keeping its item selected, to make room for ⌘-click.
      if (event.key === 'Meta' || event.key === 'Control') {
        if (detailTarget && selectedItem) setSelection([selectedItem.key]);
        return;
      }
      const plain = !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
      const command = (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
      const writable = selectedItems.filter(item => !item.read_only && !item.command);
      let handled = true;
      if ((plain && event.key === 'ArrowLeft') || plainKey(event, 'p')) page(-1);
      else if ((plain && event.key === 'ArrowRight') || plainKey(event, 'n')) page(1);
      else if (plainKey(event, 't')) {
        echoKey('t');
        goToday();
      }
      else if (plainKey(event, 'm')) switchMode('month');
      else if (plainKey(event, 'w')) switchMode('week');
      else if (plainKey(event, 'c')) {
        echoKey('c');
        newItem('event');
      }
      else if (plainKey(event, 'd')) newItem('task');
      else if (plainKey(event, 'e') && selectedItem && selectedItem.key !== handedKey && !selectedItem.read_only && !selection.length) {
        echoKey('e');
        editItem(selectedItem, true);
      }
      else if (plain && (event.key === 'Delete' || event.key === 'Backspace') && writable.length && !editor) remove(writable);
      else if (command && event.key.toLowerCase() === 'c' && selectedItems.length && !window.getSelection()?.toString()) copy(selectedItems);
      else if (command && event.key.toLowerCase() === 'v' && clipboard.current.length && !editor) paste();
      else if (command && event.key.toLowerCase() === 'z' && undos.current.length && !editor) undos.current.pop()!();
      else if (searching && !editor && (plainKey(event, 'j') || plainKey(event, 'k'))) stepResult(plainKey(event, 'j') ? 1 : -1);
      else if (event.key === 'Escape') handled = escape();
      else handled = false;
      if (handled) event.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const movingTo = useMemo(() => new Map(ask?.kind === 'move' ? [[ask.item.key, ask.to]] : []), [ask]);
  const askAnchor = ask ? (ask.kind === 'move' || ask.kind === 'resize' ? {date: ask.to, key: `moving:${ask.item.key}`} : {date: ask.from, key: ask.item.key}) : null;
  const askTitle = ask ? {move: 'Move recurring event', resize: 'Change recurring event', delete: 'Delete recurring event', colour: 'Colour recurring event'}[ask.kind] : '';
  const askLine = ask?.kind === 'move' ? moveLine(ask.item.title, ask.from, ask.to, ask.changes.starts_at ?? null, zone)
    : ask?.kind === 'resize' ? `${ask.item.title} · ${timeRange(movedItem(ask.item, ask.changes), zone)}` : undefined;
  const weekItems = useMemo(() => (mode === 'week' ? visibleItems(drawn, calendars) : EMPTY_ITEMS), [mode, drawn, calendars]);
  const detailProps = {target: detailTarget, exit: handedKey && handedKey === selectedKey ? 'edit' as const : 'close' as const, timeZone: zone, actions,
    onClose: () => selectDay(selectedDay), onEdit: (target: DetailTarget) => editItem(target.item, true)};

  // Overlays anchored to items, drawn in whichever grid shows: the recurring prompt and the failed card.
  const overlays = (
    <>
      {ask && askAnchor && (
        <AnchoredCard key={`${ask.kind}:${ask.item.key}`} className="pop scope-card" label={askTitle} anchor={askAnchor}>
          <ScopePrompt small title={askTitle} line={askLine}
            choices={scopeChoices(ask.from, ask.kind === 'move' || ask.kind === 'resize' ? ask.to : ask.from)} value={ask.scope}
            action={ask.kind === 'move' ? 'Move' : ask.kind === 'delete' ? 'Delete' : 'Save'}
            onChange={scope => setAsk({...ask, scope})} onConfirm={answer} onCancel={() => setAsk(null)} />
        </AnchoredCard>
      )}
      {failed && (
        <AnchoredCard key={`failed:${failed.command!.id}`} className="card float failed-card" label={failed.title}
          anchor={{date: dayOf(failed, zone) ?? selectedDay, key: failed.key}}>
          <FailedCard item={failed} calendar={calendarsById.get(failed.calendar_id)} timeZone={zone}
            onRetry={() => retry(failed)}
            onMoveBack={() => moveBack(failed.command!.id).catch(toastFailure('Couldn\'t move it back'))}
            onClose={() => {
              setDismissed(set => new Set(set).add(failed.command!.id));
              if (selectedItem?.key === failed.key) selectDay(selectedDay);
            }} />
        </AnchoredCard>
      )}
    </>
  );

  return (
    <>
      <header className="hd">
        <span className="hd-title cal-title num" key={titleKey} data-dir={titleMove.dir} data-view={mode}>
          {searching ? 'Search' : title}
          {!searching && allHidden && <span className="cal-hidden ink3" title="Every calendar is hidden"><Icon name="visibility_off" size={16} /></span>}
        </span>
        <span className="cal-step">
          <button className="ibtn sm" aria-label={`Previous ${mode}`} title={`Previous ${mode} · ←`} onClick={() => page(-1)}><Icon name="chevron_left" /></button>
          <button className="btn ghost sm" title="Today · T" data-hint="t" onClick={goToday}>Today</button>
          <button className="ibtn sm" aria-label={`Next ${mode}`} title={`Next ${mode} · →`} onClick={() => page(1)}><Icon name="chevron_right" /></button>
        </span>
        {/* Search hides Month | Week, as mail's hides Unread | All (D48); the grid still pages. */}
        {!searching && (
          <span className="seg" ref={segThumb} style={{marginLeft: 8}}>
            <button type="button" className={mode === 'month' ? 'on' : undefined} aria-pressed={mode === 'month'} title="Month · M" onClick={() => switchMode('month')}>Month</button>
            <button type="button" className={mode === 'week' ? 'on' : undefined} aria-pressed={mode === 'week'} title="Week · W" onClick={() => switchMode('week')}>Week</button>
          </span>
        )}
        <span className="grow" />
        {searching
          ? <SearchField search={{...search, active: true}} label="Search calendar" arrowDown autoFocus onEnter={selectResult} onEscape={escape} />
          : <button className="ibtn" aria-label="Search calendar" title="Search · /" onClick={() => setSearching(true)}><Icon name="search" /></button>}
        <button className="btn" data-hint="c" onClick={() => newItem('event')}><Icon name="add" size={17} />New<span className="kbd">C</span></button>
      </header>
      <div className="content cal-content">
        {/* In the compact tier the day's pane isn't drawn (calendar.css): its sources' health lines
            sit atop the grid instead, so a failing one still shows (#258). */}
        {compact && <div className="cal-health"><HealthLines now={now} timeZone={zone} /></div>}
        {mode === 'week' ? (
          <WeekGrid enter={zoom?.to === 'week' ? zoom.y : null} onEntered={() => setZoom(null)} week={week} weekJump={view.weekJump} today={today} selectedDay={paneDay} selected={selected} looks={looks} items={weekItems} byDay={byDay} weather={weather}
            calendars={calendarsById} now={now} timeZone={zone} scroll={view.scroll} popover={popover} onSelectDay={clickDay} onSelectItem={selectItem} onPopover={setPopover}
            onWeek={showWeek} onCreate={createAt} onChange={onWeekChange} detail={detailProps} overlays={overlays} />
        ) : (
          <MonthGrid enter={zoom?.to === 'month' ? zoom.y : null} onEntered={() => setZoom(null)} shown={shown} today={today} selectedDay={paneDay} selected={selected} looks={looks} byDay={byDay} weather={weather} calendars={calendarsById}
            now={now} timeZone={zone} scroll={view.scroll} popover={popover} onShownMonth={setShownMonth} onSelectDay={clickDay}
            onSelectItem={selectItem} onPopover={setPopover} onDrop={onDrop} onNew={newOn} detail={detailProps} overlays={overlays} />
        )}
        {editor ? (
          <Editor key={editor.seq} open={editor} calendars={calendars} today={today} timeZone={zone} handed={editor.handed}
            dayItems={date => byDay.get(date) ?? EMPTY_ITEMS} onPreview={onPreview}
            onCreate={inputs => {
              closeEditor();
              create(inputs, inputs.length > 1 ? 'Couldn\'t create them' : `Couldn't create ${inputs[0]!.title}`, drafts => {
                const day = drafts.length === 1 ? dayOf(drafts[0]!, zone) : null;
                return drafts.length === 1 ? `Created ${drafts[0]!.title}${day ? `, ${dayTitle(day)}` : ''}` : `Created ${drafts.length} items`;
              });
            }}
            onSave={(item, changes, scope) => {
              closeEditor();
              send(item, changes, scope, `Couldn't change ${item.title}`, null);
            }}
            onDelete={item => {
              closeEditor();
              remove([item]);
            }}
            onClose={closeEditor} onEscape={escape} onDirty={setEditorDirty} onKeep={keepDrafts} place={editor.place} />
        ) : searching ? (
          <SearchPane search={search} calendars={calendarsById} selected={selected} today={today} timeZone={zone} onSelect={selectResult} />
        ) : compact ? null : (
          <DayPane date={selectedDay} today={today} items={paneItems} hidden={paneHidden} forecast={dayWeather?.find(day => day.date === selectedDay)} calendars={calendars}
            selected={selected} now={now} timeZone={zone} movingTo={movingTo} onSelectItem={item => selectItem(item, selectedDay, null)} onNew={newItem} onComplete={task => complete(task)}
            onShowAll={() => showHidden(calendars ?? [])} />
        )}
      </div>
    </>
  );
}
