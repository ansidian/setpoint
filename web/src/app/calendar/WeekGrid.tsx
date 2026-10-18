// The week view (DESIGN.md › Week view; board 16, Sunday first): the day heads and the all-day row
// held at the top while 24 hours scroll under them, each day's events as blocks in lanes, today's
// now-line, and the selected day's column in `sub`. A drag over empty hours makes a new event's range
// (over the all-day row, its days), a drag on a block moves it in 15-minute steps to any day (a bar or
// a task by whole days), and a block's top or bottom edge (a bar's ends) resizes it; held at the
// left or right edge a drag pages the week, at the top or bottom it scrolls. The page says what each
// drop does (CalendarPage); the floating detail and the anchored cards are drawn here as the month's
// are, and find their items by the same marks (geometry.ts).
import type {CalendarOut, ItemChanges, ItemOut, WeatherDayOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent} from 'react';
import type {Rect} from '../../logic/calendar.ts';
import {dayTitle, isPast, isWeekend, timeRange, weatherOf} from '../../logic/calendar.ts';
import {addDays, clockTime, daysBetween, instantAt, localDate, minutesOf} from '../../logic/format.ts';
import {canMove, dropChange, edgeScroll, movedItem} from '../../logic/manipulate.ts';
import type {Point} from '../../logic/placement.ts';
import {
  allDayLayout, blockBox, blockLabel, blockLines, createRange, laneTime, dayBlocks, dayRange, isShort, minuteTop, movedTo, offersTop, openingScroll, rangeLabel, resizedDays, resizedTo,
  segments, startInWeek, taskTime, weekDays, weekMinutes, weekStart,
} from '../../logic/week.ts';
import type {Block as BlockLayout, Edge, Segment} from '../../logic/week.ts';
import {drag as dragTokens, week as tokens} from '../../tokens.ts';
import {useExit} from '../../ui/exit.ts';
import {Icon} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';
import {Chip, ghostly} from './Chip.tsx';
import type {ChipLook} from './Chip.tsx';
import {DayPopover} from './DayPopover.tsx';
import {FloatingDetail} from './detail/FloatingDetail.tsx';
import type {FloatingDetailProps} from './detail/FloatingDetail.tsx';
import type {Slot} from './Editor.tsx';
import {pointIn, rectIn, zoomOf} from './geometry.ts';
import {useLanding} from './landing.ts';
import {useCalendarFade, useSearchDim} from './view.ts';
import type {ScrollRequest} from './view.ts';
import './week.css';

const HOURS = Array.from({length: 23}, (_, index) => index + 1);
const DAY = 1440;

export interface WeekGridProps {
  // The week's Sunday, and a count that rises each time it's shown afresh (not paged).
  week: string;
  weekJump: number;
  today: string;
  selectedDay: string;
  selected: Set<string>;
  looks: Map<string, ChipLook>;
  // The items drawn, calendars toggled off already left out.
  items: ItemOut[];
  byDay: Map<string, ItemOut[]>;
  weather: Map<string, WeatherDayOut>;
  calendars: Map<number, CalendarOut>;
  now: number;
  timeZone: string;
  scroll: ScrollRequest | null;
  popover: string | null;
  // A day head or empty slot clicked: the day, and on the hours the time (15-minute steps).
  onSelectDay: (date: string, at?: number) => void;
  onSelectItem: (item: ItemOut, date: string, rect: Rect, additive: boolean) => void;
  onPopover: (date: string | null) => void;
  // Paging (a held drag or a swipe) and a day shown from elsewhere.
  onWeek: (start: string, how: 'page' | 'jump') => void;
  // A range dragged over empty hours or days.
  onCreate: (date: string, slot: Slot) => void;
  // A block moved or resized: the change, the day it was on and the day it's on now.
  onChange: (item: ItemOut, changes: ItemChanges, from: string, to: string, kind: 'move' | 'resize') => void;
  // A right-click on empty hours (#248): the day and the 15-minute step under the pointer.
  onSlotMenu?: (event: ReactMouseEvent<HTMLElement>, date: string, minutes: number) => void;
  detail?: Omit<FloatingDetailProps, 'section' | 'scroller'>;
  overlays?: ReactNode;
  // Arriving from Month: it zooms in from this height in the section, the selected week's row there (polish audit grids-09).
  enter?: number | null;
  onEntered?: () => void;
}

type Area = 'hours' | 'all';

type Press =
  // `onto`: dragged out of the "+N" popover, it goes to the day under the pointer rather than by how far it moved.
  | {kind: 'move'; item: ItemOut; from: string; area: Area; x: number; y: number; week: string; at: {column: number; minutes: number}; grab: number; onto: boolean}
  | {kind: 'resize'; item: ItemOut; from: string; area: Area; edge: Edge; x: number; y: number; week: string}
  | {kind: 'create'; area: Area; date: string; minutes: number; x: number; y: number; week: string};

interface Drag {
  press: Press;
  // A move or resize: the change so far (null while it's where it was), and the day it's on.
  changes: ItemChanges | null;
  to: string;
  // A create: the range so far.
  create: {date: string; slot: Slot} | null;
  tip: string;
  pointer: Point;
}

/** Whether an item's edges resize it: a timed or all-day event that can move. */
const resizable = (item: ItemOut) => item.kind === 'event' && canMove(item) && item.id > 0;

export function WeekGrid(props: WeekGridProps) {
  const {week, weekJump, today, selectedDay, selected, looks, items, byDay, weather, calendars, now, timeZone, scroll, popover, onSelectDay, onSelectItem, onPopover, onWeek, detail, overlays, enter = null, onEntered} = props;
  // The "+N" popover fades out once closed (ui/exit.ts).
  const {shown: shownPopover, closing: popoverClosing} = useExit(popover);
  const section = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const cols = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const days = useMemo(() => weekDays(week), [week]);

  // The latest of what the document's handlers read.
  const latest = useRef({props, week});
  useEffect(() => {
    latest.current = {props, week};
  });

  // The new event's colour: the first calendar shown, as the editor's default.
  const newColour = useMemo(() => [...calendars.values()].find(calendar => calendar.provider !== 'todoist' && calendar.visible)?.colour ?? 'cool', [calendars]);

  // ---------- What's drawn, a drag's preview in it ----------
  const preview = useMemo(() => {
    const keys = new Set<string>();
    if (!drag) return {list: items, lifted: keys, ghosts: new Map<string, ChipLook>()};
    const ghosts = new Map<string, ChipLook>();
    const {press} = drag;
    if (press.kind === 'create' && drag.create) {
      const {date, slot} = drag.create;
      const fresh = {
        ...press, key: 'drag:new', id: -1, kind: 'event', title: 'New event', calendar_id: -1, colour: newColour, all_day: slot.start === null,
        starts_at: slot.start === null ? null : instantAt(date, slot.start, timeZone), ends_at: slot.end === null ? null : instantAt(date, slot.end, timeZone),
        start_date: slot.start === null ? date : null, end_date: slot.start === null ? addDays(date, slot.days) : null, due_date: null, due_at: null, recurring: false,
        read_only: false, command: null, occurrence_start: null, done: false,
      } as unknown as ItemOut;
      ghosts.set(fresh.key, 'ghost');
      return {list: [...items, fresh], lifted: keys, ghosts};
    }
    if (press.kind === 'create' || !drag.changes) return {list: items, lifted: keys, ghosts};
    const moved = movedItem(press.item, drag.changes);
    if (press.kind === 'resize') {
      keys.add(press.item.key);
      return {list: items.map(one => (one.key === press.item.key ? moved : one)), lifted: keys, ghosts};
    }
    const lifted = {...moved, key: `drag:${press.item.key}`};
    keys.add(lifted.key);
    ghosts.set(press.item.key, 'ghost');
    return {list: [...items, lifted], lifted: keys, ghosts};
  }, [drag, items, newColour, timeZone]);

  const allDay = useMemo(() => allDayLayout(preview.list, week, timeZone), [preview.list, week, timeZone]);
  const timed = useMemo(() => segments(preview.list, week, timeZone), [preview.list, week, timeZone]);
  const perDay = useMemo(() => days.map(date => dayBlocks(timed.filter(segment => segment.date === date))), [days, timed]);
  const lookOf = (key: string) => preview.ghosts.get(key) ?? looks.get(key);

  // ---------- Scrolling ----------
  const hoursHeight = () => (scroller.current?.clientHeight ?? 0) - (top.current?.offsetHeight ?? 0);
  // The hours open where DESIGN.md says on the first paint and whenever the week is shown afresh; paging keeps them.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    element.scrollTop = openingScroll(week, today, now, timed, timeZone, hoursHeight());
    // Only when shown afresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekJump]);

  // A day shown from elsewhere (the mini-month, Today, a link): its week, opened afresh.
  const handled = useRef(scroll?.seq ?? 0);
  useEffect(() => {
    if (!scroll || scroll.seq <= handled.current) return;
    handled.current = scroll.seq;
    const date = scroll.kind === 'day' ? scroll.date : `${scroll.month}-01`;
    if (!weekDays(latest.current.week).includes(date)) onWeek(weekStart(date), 'jump');
  }, [scroll, onWeek]);

  // Paging slides the days in from the side they come from; the first paint doesn't.
  const [paged, setPaged] = useState<{week: string; slide: 'next' | 'prev' | undefined}>({week, slide: undefined});
  if (paged.week !== week) setPaged({week, slide: week > paged.week ? 'next' : 'prev'});
  const slide = paged.slide;

  // A two-finger horizontal swipe pages a week, then rests a moment.
  const swipe = useRef({distance: 0, resting: 0, idle: 0});
  const onWheel = (event: ReactWheelEvent) => {
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    const state = swipe.current;
    window.clearTimeout(state.idle);
    state.idle = window.setTimeout(() => {
      state.distance = 0;
    }, 160);
    if (Date.now() < state.resting) return;
    state.distance += event.deltaX;
    if (Math.abs(state.distance) < tokens.swipePx) return;
    onWeek(addDays(latest.current.week, state.distance > 0 ? 7 : -7), 'page');
    state.distance = 0;
    state.resting = Date.now() + tokens.swipeRestMs;
  };

  // ---------- Drags ----------
  const press = useRef<Press | null>(null);
  const remake = useRef(() => {});

  /** The column and minutes under the pointer, in the week's days (the minutes may run past either end). */
  const whereAt = (x: number, y: number): {column: number; minutes: number; outside: -1 | 0 | 1} => {
    const element = cols.current!;
    const box = element.getBoundingClientRect();
    const zoom = zoomOf(element);
    const width = box.width / 7;
    const raw = Math.floor((x - box.left) / width);
    return {column: Math.max(0, Math.min(6, raw)), minutes: ((y - box.top) / zoom / tokens.hourPx) * 60, outside: x < box.left ? -1 : x > box.right ? 1 : 0};
  };

  useEffect(() => {
    let current: Drag | null = null;
    const pointer = {x: 0, y: 0};
    let frame = 0;
    let edgeTimer = 0;
    let edgeSide: -1 | 0 | 1 = 0;
    const update = (next: Drag | null) => {
      current = next;
      setDrag(next);
    };

    /** The drag as the pointer now makes it. */
    const make = (pressed: Press): Drag => {
      const {week: shown} = latest.current;
      const {timeZone: zone} = latest.current.props;
      const at = whereAt(pointer.x, pointer.y);
      const host = section.current!;
      const point = pointIn(pointer.x, pointer.y, host);
      const day = addDays(shown, at.column);
      const base = {press: pressed, pointer: point, changes: null, to: 'from' in pressed ? pressed.from : pressed.date, create: null, tip: ''};
      if (pressed.kind === 'create') {
        if (pressed.area === 'all') {
          const range = dayRange(pressed.date, day);
          const length = daysBetween(range.from, range.to) + 1;
          return {...base, create: {date: range.from, slot: {start: null, end: null, days: length}}, tip: length === 1 ? dayTitle(range.from) : `${dayTitle(range.from)} – ${dayTitle(range.to)}`};
        }
        const range = createRange(pressed.minutes, Math.max(0, Math.min(DAY, at.minutes)));
        return {...base, create: {date: pressed.date, slot: {...range, days: 1}}, tip: rangeLabel(pressed.date, range.start, range.end, zone)};
      }
      const {item} = pressed;
      // Paged since the press: the week's first midnight moved this many minutes.
      const paged = daysBetween(pressed.week, shown);
      if (pressed.kind === 'move') {
        if (pressed.area === 'all' || item.kind === 'task' || item.all_day || !item.starts_at) {
          const to = pressed.onto ? day : addDays(pressed.from, paged + at.column - pressed.at.column);
          const changes = dropChange(item, to, zone);
          return {...base, changes, to, tip: changes ? dayTitle(to) : dayTitle(pressed.from)};
        }
        const startMinutes = weekMinutes(at.column, Math.max(0, Math.min(DAY, at.minutes))) - pressed.grab;
        const changes = movedTo(item, shown, startMinutes, zone);
        const starts = changes?.starts_at ?? item.starts_at;
        return {...base, changes, to: localDate(starts, zone), tip: `${dayTitle(localDate(starts, zone))} · ${clockTime(starts, zone)}`};
      }
      if (item.all_day) {
        const changes = resizedDays(item, pressed.edge, day);
        const after = changes ? movedItem(item, changes) : item;
        const last = addDays(after.end_date!, -1);
        return {...base, changes, to: after.start_date!, tip: last === after.start_date ? dayTitle(last) : `${dayTitle(after.start_date!)} – ${dayTitle(last)}`};
      }
      const changes = resizedTo(item, pressed.edge, shown, weekMinutes(at.column, Math.max(0, Math.min(DAY, at.minutes))), zone);
      const after = changes ? movedItem(item, changes) : item;
      return {...base, changes, tip: timeRange(after, zone)};
    };

    const stopEdge = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      window.clearTimeout(edgeTimer);
      edgeTimer = 0;
      edgeSide = 0;
    };
    // While held near the hours' top or bottom the grid scrolls; at the left or right edge, it pages.
    const edge = () => {
      frame = 0;
      const host = section.current;
      const element = scroller.current;
      const pressed = press.current;
      if (!current || !host || !element || !pressed) return;
      if (pressed.area === 'hours') {
        const box = rectIn(element, host);
        const heads = top.current ? rectIn(top.current, host) : box;
        const step = edgeScroll(pointIn(pointer.x, pointer.y, host).top, heads.top + heads.height, box.top + box.height);
        if (step) {
          element.scrollTop += step;
          update(make(pressed));
        }
      }
      if (pressed.kind === 'move') {
        const side = whereAt(pointer.x, pointer.y).outside;
        if (side !== edgeSide) {
          window.clearTimeout(edgeTimer);
          edgeSide = side;
          const page = () => {
            const {week: shown, props: current} = latest.current;
            current.onWeek(addDays(shown, edgeSide * 7), 'page');
            edgeTimer = window.setTimeout(page, tokens.edgePageMs);
          };
          edgeTimer = side ? window.setTimeout(page, tokens.edgePageMs) : 0;
        }
      }
      frame = requestAnimationFrame(edge);
    };

    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      const pressed = press.current;
      if (!pressed || !section.current) return;
      if (!current) {
        if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < dragTokens.thresholdPx) return;
        latest.current.props.onPopover(null);
        frame = requestAnimationFrame(edge);
      }
      update(make(pressed));
    };
    const end = (drop: boolean) => {
      const done = current;
      const pressed = press.current;
      press.current = null;
      if (!done || !pressed) return;
      stopEdge();
      update(null);
      // The click that ends a drag isn't a click on what's under it.
      const swallow = (click: MouseEvent) => click.stopPropagation();
      window.addEventListener('click', swallow, {capture: true, once: true});
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      if (!drop) return;
      const latestDrag = make(pressed);
      const {onCreate, onChange} = latest.current.props;
      if (pressed.kind === 'create' && latestDrag.create) onCreate(latestDrag.create.date, latestDrag.create.slot);
      else if (pressed.kind !== 'create' && latestDrag.changes) onChange(pressed.item, latestDrag.changes, pressed.from, latestDrag.to, pressed.kind);
    };
    const onUp = () => end(true);
    const onCancel = () => end(false);
    // Paged mid-drag: the days moved under a still pointer.
    remake.current = () => {
      if (current && press.current) update(make(press.current));
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && current) {
        event.preventDefault();
        event.stopPropagation();
        press.current = null;
        stopEdge();
        update(null);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onCancel);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      document.removeEventListener('pointercancel', onCancel);
      document.removeEventListener('keydown', onKey, true);
      stopEdge();
    };
  }, []);

  // A drag that paged recomputes against the new week once it's drawn.
  useLayoutEffect(() => remake.current(), [week]);

  const startPress = (event: ReactPointerEvent<HTMLElement>) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

  const pressItem = (item: ItemOut, from: string, area: Area, event: ReactPointerEvent<HTMLElement>, edge?: Edge, onto = false) => {
    // A press on an item never starts a new event's range under it.
    event.stopPropagation();
    if (!startPress(event) || !canMove(item) || item.id < 0) return;
    const at = whereAt(event.clientX, event.clientY);
    const base = {item, from, area, x: event.clientX, y: event.clientY, week};
    if (edge) {
      press.current = {...base, kind: 'resize', edge};
      return;
    }
    // A timed block keeps the pointer where it held it, in minutes from its start.
    const grab = area === 'hours' && item.starts_at && !item.all_day ? weekMinutes(at.column, at.minutes) - startInWeek(item, week, timeZone) : 0;
    press.current = {...base, kind: 'move', at: {column: at.column, minutes: at.minutes}, grab, onto};
  };

  const pressEmpty = (date: string, area: Area, event: ReactPointerEvent<HTMLElement>) => {
    if (!startPress(event)) return;
    const at = whereAt(event.clientX, event.clientY);
    press.current = {kind: 'create', area, date, minutes: Math.max(0, Math.min(DAY, at.minutes)), x: event.clientX, y: event.clientY, week};
  };

  // Where a press on empty hours would start (polish audit grids-07): the 15-minute step under the
  // pointer, as a 30-minute slot holding + and its time; gone over a block, off the hours, on a press.
  const [hovered, setHovered] = useState<{date: string; minutes: number; shown: boolean} | null>(null);
  const hoverSlot = (date: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'mouse' || press.current || event.target !== event.currentTarget) {
      if (hovered?.shown) setHovered({...hovered, shown: false});
      return;
    }
    const at = whereAt(event.clientX, event.clientY);
    const minutes = Math.max(0, Math.min(DAY - 2 * tokens.snapMinutes, Math.floor(at.minutes / tokens.snapMinutes) * tokens.snapMinutes));
    if (hovered?.date !== date || hovered.minutes !== minutes || !hovered.shown) setHovered({date, minutes, shown: true});
  };
  const leaveSlot = () => setHovered(current => (current?.shown ? {...current, shown: false} : current));

  const clickSlot = (date: string, event: ReactMouseEvent<HTMLElement>) => {
    const at = whereAt(event.clientX, event.clientY);
    onSelectDay(date, Math.max(0, Math.min(DAY - tokens.snapMinutes, Math.floor(at.minutes / tokens.snapMinutes) * tokens.snapMinutes)));
  };

  const selectFrom = (item: ItemOut, date: string, element: HTMLElement, additive: boolean) => onSelectItem(item, date, rectIn(element, section.current!), additive);

  // ---------- Drawing ----------
  const nowMinutes = minutesOf(now, timeZone);
  const nowTop = minuteTop(nowMinutes);
  const todayColumn = days.indexOf(today);
  const lines = allDay.lines;
  const allDayHeight = 2 * tokens.allDayPadPx + lines * tokens.linePx + (lines - 1) * tokens.lineGapPx;
  const columnClass = (date: string) => [isWeekend(date) && 'wk-weekend', date === selectedDay && 'wk-sel'].filter(Boolean).join(' ');
  // The day a move would land on takes the item's colour (polish audit calflows-09).
  const dropDay = drag && drag.press.kind === 'move' && drag.changes && drag.to !== drag.press.from ? drag.to : null;
  const dropColour = drag && drag.press.kind === 'move' ? (drag.press.item.kind === 'task' ? 'var(--ink3)' : colourVar(drag.press.item.colour ?? calendars.get(drag.press.item.calendar_id)?.colour ?? 'cool')) : undefined;
  const popoverItems = shownPopover ? byDay.get(shownPopover) ?? [] : [];
  const calendarName = (item: ItemOut) => calendars.get(item.calendar_id)?.name;

  return (
    <section className={`cal-week${drag ? ` dragging ${drag.press.kind}` : ''}`} aria-label="Week" ref={section} data-cal-section data-enter={enter === null ? undefined : 'in'}
      style={enter === null ? undefined : {'--zoom-y': `${enter}px`} as CSSProperties}
      onAnimationEnd={event => event.target === event.currentTarget && onEntered?.()}>
      {/* Focusable, so the hours scroll from the keyboard too (axe's scrollable-region-focusable, SV-99). */}
      <div className="wk-scroll" ref={scroller} onWheel={onWheel} data-cal-scroll tabIndex={0} aria-label="Hours">
        <div className="wk-grid" data-cal-grid>
          <div className="wk-top" ref={top}>
            <div className="wk-row wk-head">
              <div className="wk-gut-cell" />
              <div className="wk-days" data-dir={slide} key={`head:${week}`}>
                {days.map(date => {
                  const wx = weather.get(date);
                  const look = wx ? weatherOf(wx) : null;
                  return (
                    <div key={date} className={`wk-dhead ${columnClass(date)}`} data-date={date} onClick={() => onSelectDay(date)}>
                      <span className="dw">{new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {weekday: 'short', timeZone: 'UTC'})}</span>
                      <span className={`dn${date === today ? ' today' : ''}`}>{Number(date.slice(8))}</span>
                      {look && <span className={`wx ${look.tone}`} title={look.line}><Icon name={look.icon} size={16} /></span>}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="wk-row wk-all" style={{height: allDayHeight + 1}}>
              <div className="wk-gut-cell">All day</div>
              <div className="wk-days" data-dir={slide} key={`all:${week}`}>
                <div className="wk-all-bg">
                  {days.map(date => (
                    <div key={date} className={`wk-acell ${columnClass(date)}`} data-date={date} onPointerDown={event => pressEmpty(date, 'all', event)} onClick={() => onSelectDay(date)} />
                  ))}
                </div>
                <div className="wk-all-items" style={{gridTemplateRows: `repeat(${lines}, var(--weekLine))`}}>
                  {allDay.pieces.map(piece => {
                    const look = lookOf(piece.item.key);
                    return (
                      <div key={`${piece.item.key}:${piece.from}`} className={`wk-piece${piece.before ? ' cont-l' : ''}${piece.after ? ' cont-r' : ''}${preview.lifted.has(piece.item.key) ? ' lift' : ''}`}
                        data-date={piece.date} style={{gridColumn: `${piece.from + 1} / ${piece.to + 2}`, gridRow: piece.lane + 1}}>
                        <Chip item={piece.item} calendar={calendars.get(piece.item.calendar_id)} selected={selected.has(piece.item.key)} look={look} now={now} timeZone={timeZone}
                          label={blockLabel(piece.item, piece.date, calendarName(piece.item), timeZone)}
                          onSelect={(one, chip, additive) => selectFrom(one, piece.date, chip, additive)} onPress={(one, event) => pressItem(one, piece.date, 'all', event)} />
                        {resizable(piece.item) && piece.item.all_day && !look && (
                          <>
                            {!piece.before && <span className="wk-edge l" aria-hidden="true" onPointerDown={event => pressItem(piece.item, piece.date, 'all', event, 'start')} />}
                            {!piece.after && <span className="wk-edge r" aria-hidden="true" onPointerDown={event => pressItem(piece.item, piece.date, 'all', event, 'end')} />}
                          </>
                        )}
                      </div>
                    );
                  })}
                  {allDay.tasks.map(line => (
                    <div key={line.item.key} className="wk-line" data-date={line.date} style={{gridColumn: line.column + 1, gridRow: line.line + 1}}>
                      <Chip item={line.item} calendar={calendars.get(line.item.calendar_id)} selected={selected.has(line.item.key)} look={lookOf(line.item.key)} now={now} timeZone={timeZone}
                        time={taskTime(line.item, timeZone)} label={blockLabel(line.item, line.date, calendarName(line.item), timeZone)}
                        onSelect={(one, chip, additive) => selectFrom(one, line.date, chip, additive)} onPress={(one, event) => pressItem(one, line.date, 'all', event)} />
                    </div>
                  ))}
                  {allDay.more.map(more => (
                    <div key={`more:${more.date}`} className="wk-line" style={{gridColumn: more.column + 1, gridRow: more.line + 1}}>
                      <MoreButton date={more.date} count={more.count} open={popover === more.date} onSelectDay={onSelectDay} onPopover={onPopover} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="wk-body" role="region" aria-label="Hours">
            <div className="wk-gutter" aria-hidden="true">
              {HOURS.map(hour => {
                const near = todayColumn >= 0 && Math.abs(minuteTop(hour * 60) - nowTop) < 16;
                return near ? null : <span key={hour} className="wk-gut" style={{top: minuteTop(hour * 60) - 7}}>{clockTime(instantAt(today, hour * 60, timeZone), timeZone).replace(':00 ', ' ')}</span>;
              })}
              {todayColumn >= 0 && <span className="wk-gut now num" style={{top: nowTop - 7}}>{clockTime(now, timeZone)}</span>}
            </div>
            <div className="wk-cols" ref={cols} data-dir={slide} key={`cols:${week}`}>
              {/* Now, faintly across the week, under today's own line (polish audit grids-08). */}
              {todayColumn >= 0 && <div className="wk-nowx" style={{top: nowTop}} aria-hidden="true" />}
              {days.map((date, column) => (
                <div key={date} className={`wk-col ${columnClass(date)}${date === dropDay ? ' drop' : ''}`} data-date={date} onClick={event => clickSlot(date, event)}
                  style={date === dropDay ? {'--dc': dropColour} as CSSProperties : undefined}
                  onPointerDown={event => {
                    leaveSlot();
                    pressEmpty(date, 'hours', event);
                  }}
                  onPointerMove={event => hoverSlot(date, event)} onPointerLeave={leaveSlot}
                  onContextMenu={event => {
                    // Empty hours only: a block's right-click goes on up to the page, as its click does.
                    if (event.target !== event.currentTarget && !(event.target as Element).closest('.wk-hover')) return;
                    const at = whereAt(event.clientX, event.clientY);
                    props.onSlotMenu?.(event, date, Math.max(0, Math.min(DAY - 2 * tokens.snapMinutes, Math.floor(at.minutes / tokens.snapMinutes) * tokens.snapMinutes)));
                  }}>
                  {hovered?.date === date && !drag && (
                    <div className={`wk-hover num${hovered.shown ? '' : ' gone'}`} style={{transform: `translateY(${minuteTop(hovered.minutes)}px)`}} aria-hidden="true">
                      <Icon name="add" size={12} />{clockTime(instantAt(date, hovered.minutes, timeZone), timeZone)}
                    </div>
                  )}
                  {perDay[column]!.blocks.map(block => (
                    <TimedBlock key={`${block.item.key}:${block.date}`} block={block} calendar={calendars.get(block.item.calendar_id)} selected={selected.has(block.item.key)}
                      look={lookOf(block.item.key)} lifted={preview.lifted.has(block.item.key)} now={now} timeZone={timeZone}
                      onSelect={(one, element, additive) => selectFrom(one, date, element, additive)}
                      onPress={(event, edge) => pressItem(block.item, date, 'hours', event, edge)} />
                  ))}
                  {perDay[column]!.more.map(more => {
                    const box = blockBox(more.start, more.start + 30);
                    return (
                      <div key={`more:${more.start}`} className="wk-lanemore" style={laneStyle(more.lane, more.lanes, box.top, tokens.minBlockPx)}>
                        <MoreButton date={date} count={more.count} open={popover === date} onSelectDay={onSelectDay} onPopover={onPopover} />
                      </div>
                    );
                  })}
                  {date === today && (
                    <div className="wk-now" style={{top: nowTop}} aria-hidden="true" />
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      {shownPopover && popoverItems.length > 0 && (
        <DayPopover key={shownPopover} date={shownPopover} items={popoverItems} section={section} closing={popoverClosing} {...{selected, calendars, now, timeZone}}
          onSelectItem={(item, chip, additive) => onSelectItem(item, shownPopover, rectIn(chip, section.current!), additive)} onClose={() => onPopover(null)}
          onPress={(item, event) => pressItem(item, shownPopover, 'all', event, undefined, true)} />
      )}
      {detail && <FloatingDetail {...detail} section={section} scroller={scroller} />}
      {overlays}
      {drag && drag.press.kind !== 'create' && (
        <div className="drag-tip num" role="status" style={{left: drag.pointer.left + dragTokens.tipOffset.left, top: drag.pointer.top + dragTokens.tipOffset.top / 2}}>
          {drag.tip}
        </div>
      )}
      {drag && drag.press.kind === 'create' && drag.press.area === 'all' && (
        <div className="drag-tip num" role="status" style={{left: drag.pointer.left + dragTokens.tipOffset.left, top: drag.pointer.top + dragTokens.tipOffset.top / 2}}>
          {drag.tip}
        </div>
      )}
    </section>
  );
}

/** A block's place across its day's lanes: board 16's 3 px in from the left and 5 px from the right, 2 px between lanes. */
function laneStyle(lane: number, lanes: number, top: number, height: number): CSSProperties {
  const gap = lanes > 1 ? 2 : 0;
  return {top, height, left: `calc(3px + (100% - 8px) * ${lane} / ${lanes})`, width: `calc((100% - 8px) / ${lanes} - ${gap}px)`};
}

function MoreButton({date, count, open, onSelectDay, onPopover}: {date: string; count: number; open: boolean; onSelectDay: (date: string) => void; onPopover: (date: string | null) => void}) {
  return (
    <button className={`more num${open ? ' open' : ''}`} aria-expanded={open} aria-label={`${count} more on ${dayTitle(date)}`} data-more={date}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => {
        event.stopPropagation();
        onSelectDay(date);
        onPopover(open ? null : date);
      }}>
      +{count}
    </button>
  );
}

interface TimedBlockProps {
  block: BlockLayout;
  calendar: CalendarOut | undefined;
  selected: boolean;
  look: ChipLook | undefined;
  lifted: boolean;
  now: number;
  timeZone: string;
  onSelect: (item: ItemOut, element: HTMLElement, additive: boolean) => void;
  onPress: (event: ReactPointerEvent<HTMLElement>, edge?: Edge) => void;
}

/** One event's block in its day (board 16's `.wb`): the title, then its times and place; short ones on one line. */
function TimedBlock({block, calendar, selected, look, lifted, now, timeZone, onSelect, onPress}: TimedBlockProps) {
  const {item} = block;
  const box = blockBox(block.start, block.end);
  const short = isShort(block.start, block.end);
  const pending = item.command?.state === 'pending';
  const failed = item.command?.state === 'failed';
  const time = timeRange(item, timeZone);
  // Sharing its column, it gives its start alone and its title may take two lines; nothing is drawn half cut.
  const narrow = block.lanes > 1;
  const lines = blockLines(box.height, narrow);
  const fade = useCalendarFade()(item.calendar_id);
  const landing = useLanding<HTMLDivElement>(item);
  const dim = useSearchDim()(item.id);
  const ghost = ghostly(look);
  const classes = ['wb', fade, dim && 'unmatched', short && 'short', narrow && 'narrow', lines.title === 2 && 'two', selected && !ghost && 'sel', isPast(item, now, timeZone) && !ghost && !selected && !lifted && 'past', pending && 'pending', failed && 'failed',
    ghost && 'ghost', look === 'faded' && 'faded', !ghost && look, lifted && 'lift', block.continued && 'cont-t', block.continues && 'cont-b'].filter(Boolean).join(' ');
  const edges = resizable(item) && !look && !lifted;
  return (
    <div ref={landing} className={classes} role="button" data-key={item.key} title={`${item.title} · ${time}`} aria-label={blockLabel(item, block.date, calendar?.name, timeZone)}
      style={{...laneStyle(block.lane, block.lanes, box.top, box.height), '--c': colourVar(item.colour ?? calendar?.colour ?? 'cool')} as CSSProperties}
      onClick={event => {
        event.stopPropagation();
        onSelect(item, event.currentTarget, event.metaKey || event.ctrlKey || event.shiftKey);
      }}
      onPointerDown={event => onPress(event)}>
      {failed && <Icon name="error" size={14} />}
      <span className="wb-title">{item.title}</span>
      {short ? <span className="t">, {clockTime(item.starts_at!, timeZone)}</span> : <span className="t">{narrow ? laneTime(item, timeZone) : time}</span>}
      {!short && item.place && lines.place && <span className="t">{item.place}</span>}
      {pending && <span className="spin" aria-label="Saving"><Icon name="progress_activity" size={14} /></span>}
      {edges && offersTop(block as Segment) && <span className="wk-edge t" aria-hidden="true" onPointerDown={event => onPress(event, 'start')} />}
      {edges && !block.continues && <span className="wk-edge b" aria-hidden="true" onPointerDown={event => onPress(event, 'end')} />}
    </div>
  );
}
