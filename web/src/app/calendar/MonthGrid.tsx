// The month grid (DESIGN.md › Month grid): the weekday row, then weeks as 176 px rows that scroll
// without end through months. Only the rows in view (and two each side) are drawn, placed by their
// week, so a row's top is always `row × 176` inside the track: the geometry F5 and F6 place cards
// and drags by. Days outside the month the grid shows take `panel` at 60%, weekends 40%, the
// selected day `sub`. What doesn't fit a cell folds into "+N", whose popover lists the day.
// F6 (DESIGN.md › Drag; board 15): a chip pressed and moved lifts (tilt −1.5°, scale 1.04, the
// popover shadow) and follows the pointer, its place becomes a dashed ghost, the day under it is
// marked and a tooltip names the day and time; letting go on another day drops it there.
// F6b: a drag held near the grid's top or bottom edge scrolls it (faster nearer the edge), and an
// item in the "+N" popover drags out of it onto another day.
// Polish audit grids-04: paging and Today glide the grid to their month over 260 ms (from five rows
// short when it's further than ten), a new page mid-glide going on from where it is; the wheel, a
// touch or a press stops it.
import type {CalendarOut, ItemOut, WeatherDayOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject} from 'react';
import {chipTime, dayHead, dayOfWeek, dayTitle, FIRST_WEEK, fitDay, glideStart, isWeekend, monthAtScroll, monthEdges, monthOf, monthTopRow, rowsInView, weatherOf, weekIndex, WEEK_COUNT} from '../../logic/calendar.ts';
import type {Rect} from '../../logic/calendar.ts';
import {standardEase} from '../../logic/glide.ts';
import {canMove, dropLabel, edgeScroll} from '../../logic/manipulate.ts';
import type {Point} from '../../logic/placement.ts';
import {drag as dragTokens, layout, monthPaging, motion} from '../../tokens.ts';
import {useExit} from '../../ui/exit.ts';
import {Icon} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';
import {Chip, useRingColour} from './Chip.tsx';
import type {ChipLook} from './Chip.tsx';
import {DayPopover} from './DayPopover.tsx';
import {FloatingDetail} from './detail/FloatingDetail.tsx';
import {pointIn, rectIn} from './geometry.ts';
import type {FloatingDetailProps} from './detail/FloatingDetail.tsx';
import {pulseToday, stopGliding} from './view.ts';
import type {ScrollRequest} from './view.ts';

const ROW = layout.monthRow;
const ease = standardEase(motion.ease);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface MonthGridProps {
  // The month the grid shows (its days aren't tinted as outside).
  shown: string;
  today: string;
  selectedDay: string;
  // Every item drawn solid: the selected one, or several (multi-select).
  selected: Set<string>;
  // Items drawn as ghosts: a draft, a drop's origin while it waits.
  looks: Map<string, ChipLook>;
  byDay: Map<string, ItemOut[]>;
  weather: Map<string, WeatherDayOut>;
  calendars: Map<number, CalendarOut>;
  now: number;
  timeZone: string;
  scroll: ScrollRequest | null;
  popover: string | null;
  onShownMonth: (month: string) => void;
  onSelectDay: (date: string) => void;
  onSelectItem: (item: ItemOut, date: string, rect: Rect, additive: boolean) => void;
  onPopover: (date: string | null) => void;
  // A chip dropped on another day.
  onDrop: (item: ItemOut, from: string, to: string) => void;
  // F5's floating detail, drawn in the month section over the grid and placed by its geometry.
  detail?: Omit<FloatingDetailProps, 'section' | 'scroller'>;
  // Overlays anchored to items (the drop prompt, the failed card), drawn in the month section.
  overlays?: ReactNode;
  // Arriving from Week: it settles out around this height in the section, the selected week's row (polish audit grids-09).
  enter?: number | null;
  onEntered?: () => void;
}

interface Drag {
  item: ItemOut;
  from: string;
  width: number;
  grab: Point;
  // The lifted chip's top left in the section.
  at: Point;
  to: string | null;
}

export function MonthGrid(props: MonthGridProps) {
  const {shown, today, selectedDay, selected, looks, byDay, weather, calendars, now, timeZone, scroll, popover, onShownMonth, onSelectDay, onSelectItem, onPopover, onDrop, detail, overlays, enter = null, onEntered} = props;
  // The "+N" popover fades out once closed (ui/exit.ts).
  const {shown: shownPopover, closing: popoverClosing} = useExit(popover);
  const section = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(() => rowsInView(monthTopRow(monthOf(selectedDay)) * ROW, 1000));
  // Requests made before this grid was drawn are already answered by its first position.
  const handled = useRef(scroll?.seq ?? 0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const ring = useRingColour();
  const press = useRef<{item: ItemOut; from: string; chip: HTMLElement; x: number; y: number} | null>(null);
  const latestDrop = useRef(onDrop);
  useEffect(() => {
    latestDrop.current = onDrop;
  });

  function measure() {
    const element = scroller.current;
    if (!element) return;
    const next = rowsInView(element.scrollTop, element.clientHeight);
    setRows(current => (current.first === next.first && current.last === next.last ? current : next));
    onShownMonth(monthAtScroll(element.scrollTop, element.clientHeight));
  }

  // The first paint opens on the selected day's month, its 1st's row at the top.
  useLayoutEffect(() => {
    const element = scroller.current!;
    element.scrollTop = monthTopRow(monthOf(selectedDay)) * ROW;
    measure();
    stopGliding();
    // Only once: later moves come from scroll requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Paging's glide (polish audit grids-04): the frame it's on and the scroll it's going to.
  const gliding = useRef<{frame: number; to: number} | null>(null);
  const stopGlide = () => {
    if (!gliding.current) return;
    cancelAnimationFrame(gliding.current.frame);
    gliding.current = null;
    stopGliding();
  };
  useEffect(() => () => stopGlide(), []);
  // `landed` runs once it's there (Today's pulse), not when it's stopped or sent elsewhere.
  const glideTo = (element: HTMLElement, to: number, landed?: () => void) => {
    // Mid-glide it goes on from where it is; from rest, a far month is first brought within reach.
    const from = gliding.current ? element.scrollTop : glideStart(element.scrollTop, to);
    if (gliding.current) cancelAnimationFrame(gliding.current.frame);
    gliding.current = null;
    element.scrollTop = from;
    const land = () => {
      gliding.current = null;
      stopGliding();
      // The rows it lands on are drawn on the next frame's scroll.
      if (landed) requestAnimationFrame(landed);
    };
    if (from === to) {
      land();
      return;
    }
    const begin = performance.now();
    const step = (time: number) => {
      const progress = Math.min(1, Math.max(0, (time - begin) / monthPaging.glideMs));
      element.scrollTop = from + (to - from) * ease(progress);
      if (progress < 1) gliding.current = {frame: requestAnimationFrame(step), to};
      else land();
    };
    gliding.current = {frame: requestAnimationFrame(step), to};
  };

  // Paging, Today, the mini-month and links from elsewhere move the grid.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!scroll || !element || scroll.seq <= handled.current) return;
    handled.current = scroll.seq;
    if (scroll.kind === 'month') {
      const to = monthTopRow(scroll.month) * ROW;
      if (scroll.how === 'jump') {
        stopGlide();
        element.scrollTop = to;
      } else glideTo(element, to, scroll.how === 'today' ? pulseToday : undefined);
    } else {
      // A day already in view where a glide is going stays put (Today's day, as it lands).
      const at = gliding.current?.to ?? element.scrollTop;
      const top = (weekIndex(scroll.date) - FIRST_WEEK) * ROW;
      if (top < at || top + ROW > at + element.clientHeight) {
        stopGlide();
        element.scrollTop = monthTopRow(monthOf(scroll.date)) * ROW;
      }
    }
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scroll]);

  useEffect(() => {
    const element = scroller.current!;
    const observer = new ResizeObserver(() => measure());
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A press on a chip that moves past the threshold lifts it; letting go drops it on the day under
  // the pointer. The pointer is followed on the document, so a fast move off the chip still counts.
  useEffect(() => {
    let current: Drag | null = null;
    // The pointer as last seen, and the frame that scrolls the grid while it's held near an edge.
    const pointer = {x: 0, y: 0};
    let frame = 0;
    const update = (next: Drag | null) => {
      current = next;
      setDrag(next);
    };
    const dayAt = (x: number, y: number) => (document.elementFromPoint(x, y)?.closest('.cal-grid .cell') as HTMLElement | null)?.dataset.date ?? null;
    const edge = () => {
      frame = 0;
      const host = section.current;
      const element = scroller.current;
      if (!current || !host || !element) return;
      const box = rectIn(element, host);
      const step = edgeScroll(pointIn(pointer.x, pointer.y, host).top, box.top, box.top + box.height);
      if (step) {
        element.scrollTop += step;
        // The days move under a still pointer.
        update({...current, to: dayAt(pointer.x, pointer.y) ?? current.to});
      }
      frame = requestAnimationFrame(edge);
    };
    const stopEdge = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };
    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      const pressed = press.current;
      const host = section.current;
      if (!pressed || !host) return;
      if (!current) {
        if (Math.hypot(event.clientX - pressed.x, event.clientY - pressed.y) < dragTokens.thresholdPx) return;
        const box = rectIn(pressed.chip, host);
        const start = pointIn(pressed.x, pressed.y, host);
        current = {item: pressed.item, from: pressed.from, width: box.width, grab: {left: start.left - box.left, top: start.top - box.top}, at: {left: box.left, top: box.top}, to: pressed.from};
        onPopover(null);
        frame = requestAnimationFrame(edge);
      }
      const point = pointIn(event.clientX, event.clientY, host);
      update({...current, at: {left: point.left - current.grab.left, top: point.top - current.grab.top}, to: dayAt(event.clientX, event.clientY) ?? current.to});
    };
    const end = (event: PointerEvent, drop: boolean) => {
      const done = current;
      press.current = null;
      if (!done) return;
      stopEdge();
      update(null);
      // The click that ends a drag isn't a click on what's under it.
      const swallow = (click: MouseEvent) => click.stopPropagation();
      window.addEventListener('click', swallow, {capture: true, once: true});
      setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      const to = dayAt(event.clientX, event.clientY) ?? done.to;
      if (drop && to && to !== done.from) latestDrop.current(done.item, done.from, to);
    };
    const onUp = (event: PointerEvent) => end(event, true);
    const onCancel = (event: PointerEvent) => end(event, false);
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
  }, [onPopover]);

  const onPress = (item: ItemOut, date: string, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || !canMove(item) || item.id < 0) return;
    press.current = {item, from: date, chip: event.currentTarget, x: event.clientX, y: event.clientY};
  };

  const onScroll = () => {
    if (popover) onPopover(null);
    measure();
  };

  const cellLooks = drag ? new Map([...looks, [drag.item.key, 'ghost' as const]]) : looks;
  const cells = [];
  for (let row = rows.first; row <= rows.last; row += 1) {
    for (let day = 0; day < 7; day += 1) {
      const date = dayOfWeek(FIRST_WEEK + row, day);
      cells.push(
        <DayCell key={date} date={date} {...{shown, today, selectedDay, selected, now, timeZone, calendars, section}} looks={cellLooks}
          items={byDay.get(date) ?? []} forecast={weather.get(date)} open={popover === date} dropping={!!drag && drag.to === date && drag.to !== drag.from}
          onSelectDay={onSelectDay} onSelectItem={onSelectItem} onPopover={onPopover} onPress={onPress} />,
      );
    }
  }

  const popoverItems = shownPopover ? byDay.get(shownPopover) ?? [] : [];
  const liftedColour = drag ? colourVar(drag.item.colour ?? calendars.get(drag.item.calendar_id)?.colour ?? 'cool') : undefined;
  return (
    <section className="cal-month" aria-label="Month" ref={section} data-cal-section data-enter={enter === null ? undefined : 'out'}
      style={enter === null ? undefined : {'--zoom-y': `${enter}px`} as CSSProperties}
      onAnimationEnd={event => event.target === event.currentTarget && onEntered?.()}>
      <div className="cal-dow">{WEEKDAYS.map(name => <span key={name}>{name}</span>)}</div>
      <div className="cal-scroll" ref={scroller} onScroll={onScroll} onWheel={stopGlide} onTouchStart={stopGlide} onPointerDown={stopGlide} data-cal-scroll>
        <div className="cal-track" style={{height: WEEK_COUNT * ROW}}>
          <div className="cal-grid" style={{top: rows.first * ROW}} data-cal-grid>{cells}</div>
        </div>
      </div>
      {shownPopover && popoverItems.length > 0 && (
        <DayPopover key={shownPopover} date={shownPopover} items={popoverItems} section={section} closing={popoverClosing} {...{selected, calendars, now, timeZone}}
          onSelectItem={(item, chip, additive) => onSelectItem(item, shownPopover, rectIn(chip, section.current!), additive)} onClose={() => onPopover(null)}
          onPress={(item, event) => onPress(item, shownPopover, event)} />
      )}
      {detail && <FloatingDetail {...detail} section={section} scroller={scroller} />}
      {overlays}
      {drag && (
        <>
          <div className={drag.item.kind === 'task' ? 'tk sel lift' : 'ev sel lift'} aria-hidden="true"
            style={{left: drag.at.left, top: drag.at.top, width: drag.width, '--c': liftedColour} as CSSProperties}>
            {drag.item.kind === 'task'
              ? <><span className="ring" style={ring(drag.item.project)} />{drag.item.title}</>
              : <>{chipTime(drag.item, timeZone) && <span className="t">{chipTime(drag.item, timeZone)}</span>}{drag.item.title}</>}
          </div>
          <div className="drag-tip num" role="status" style={{left: drag.at.left + dragTokens.tipOffset.left, top: drag.at.top + dragTokens.tipOffset.top}}>
            {dropLabel(drag.item, drag.to ?? drag.from, timeZone)}
          </div>
        </>
      )}
    </section>
  );
}

interface DayCellProps {
  date: string;
  shown: string;
  today: string;
  selectedDay: string;
  selected: Set<string>;
  looks: Map<string, ChipLook>;
  items: ItemOut[];
  forecast: WeatherDayOut | undefined;
  calendars: Map<number, CalendarOut>;
  now: number;
  timeZone: string;
  open: boolean;
  dropping: boolean;
  section: RefObject<HTMLElement | null>;
  onSelectDay: (date: string) => void;
  onSelectItem: (item: ItemOut, date: string, rect: Rect, additive: boolean) => void;
  onPopover: (date: string | null) => void;
  onPress: (item: ItemOut, date: string, event: ReactPointerEvent<HTMLElement>) => void;
}

function DayCell({date, shown, today, selectedDay, selected, looks, items, forecast, calendars, now, timeZone, open, dropping, section, onSelectDay, onSelectItem, onPopover, onPress}: DayCellProps) {
  const head = dayHead(date);
  const {shown: fits, more} = fitDay(items.length);
  const out = monthOf(date) !== shown;
  const edges = monthEdges(date, today);
  const className = ['cell', out && 'out', isWeekend(date) && 'weekend', date < today && 'past', date === selectedDay && 'sel', dropping && 'drop', edges.top && 'edge-top', edges.left && 'edge-left', edges.now && 'edge-now'].filter(Boolean).join(' ');
  const wx = forecast ? weatherOf(forecast) : null;
  return (
    <div className={className} data-date={date} onClick={() => onSelectDay(date)}>
      <div className="dhead">
        <span className={`dn${date === today ? ' today' : ''}${head.monthStart ? ' month' : ''}`}>{head.label}</span>
        {wx && <span className={`wx ${wx.tone}`} title={wx.line}><span className="temps num"><span className="hi">{wx.high}</span> / {wx.low}</span><Icon name={wx.icon} size={16} /></span>}
      </div>
      {items.slice(0, fits).map(item => (
        <Chip key={item.key} item={item} calendar={calendars.get(item.calendar_id)} selected={selected.has(item.key)} look={looks.get(item.key)} now={now} timeZone={timeZone}
          onSelect={(one, chip, additive) => onSelectItem(one, date, rectIn(chip, section.current!), additive)} onPress={(one, event) => onPress(one, date, event)} />
      ))}
      {more > 0 && (
        <button className={`more num${open ? ' open' : ''}`} aria-expanded={open} aria-label={`${more} more on ${dayTitle(date)}`} data-more={date}
          onClick={event => {
            event.stopPropagation();
            onSelectDay(date);
            onPopover(open ? null : date);
          }}>
          +{more}
          <FoldedDots items={items.slice(fits)} calendars={calendars} />
        </button>
      )}
    </div>
  );
}

/**
 * What "+N" folds, without words (DESIGN.md › Month grid › Overflow): up to three 6 px dots, an event's
 * filled in its colour, a task's a ring in its project's.
 */
function FoldedDots({items, calendars}: {items: ItemOut[]; calendars: Map<number, CalendarOut>}) {
  const ring = useRingColour();
  return (
    <span className="more-dots" aria-hidden="true">
      {items.slice(0, 3).map(item => (item.kind === 'task'
        ? <span key={item.key} className="md task" style={ring(item.project)} />
        : <span key={item.key} className="md" style={{'--c': colourVar(item.colour ?? calendars.get(item.calendar_id)?.colour ?? 'cool')} as CSSProperties} />))}
    </span>
  );
}
