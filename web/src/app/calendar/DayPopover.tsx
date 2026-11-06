// The "+N" popover (board 11b): the day's every item, hanging from its "+N" over the cells below so
// the cell stays readable, inside the grid. Every item can be selected, and dragged out onto another
// day (F6b; the popover closes as it lifts). It stays open while what's in it is used (#324) and
// closes on Esc, its close button, a click elsewhere, C, D, New or a change of view. It
// grows from its "+N" over 180 ms and closes at once (DESIGN.md › Motion).
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, PointerEvent as ReactPointerEvent, RefObject} from 'react';
import {dayTitle, hangFrom} from '../../logic/calendar.ts';
import {Icon} from '../../ui/Icon.tsx';
import {Chip} from './Chip.tsx';
import {CAL, rectIn} from './geometry.ts';

interface DayPopoverProps {
  date: string;
  items: ItemOut[];
  section: RefObject<HTMLElement | null>;
  selected: Set<string>;
  calendars: Map<number, CalendarOut>;
  now: number;
  timeZone: string;
  onSelectItem: (item: ItemOut, chip: HTMLElement, additive: boolean) => void;
  onClose: () => void;
  onPress: (item: ItemOut, event: ReactPointerEvent<HTMLElement>) => void;
}

export function DayPopover({date, items, section, selected, calendars, now, timeZone, onSelectItem, onClose, onPress}: DayPopoverProps) {
  const card = useRef<HTMLDivElement>(null);
  // Where it hangs, and the point it grows from: its "+N", at its top when it hangs below, its foot when above.
  const [place, setPlace] = useState<{left: number; top: number; from: {x: number; y: number}; up: boolean} | null>(null);

  useLayoutEffect(() => {
    const host = section.current;
    const anchor = host?.querySelector<HTMLElement>(`[data-more="${date}"]`);
    if (!host || !anchor || !card.current) return;
    const grid = rectIn(host.querySelector(CAL.scroll)!, host);
    const at = rectIn(anchor, host);
    const size = {width: card.current.offsetWidth, height: card.current.offsetHeight};
    const {left, top} = hangFrom(at, size, {left: 0, top: grid.top, width: host.offsetWidth, height: grid.height});
    const up = top < at.top;
    setPlace({left, top, up, from: {x: Math.min(size.width, Math.max(0, at.left + at.width / 2 - left)), y: up ? size.height : 0}});
  }, [date, items.length, section]);

  // The day fits again (an item completed, deleted or moved off): there's no "+N" left to hang from.
  useEffect(() => {
    if (section.current && !section.current.querySelector(`[data-more="${date}"]`)) onClose();
  });

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      // Using what's in it doesn't close it (#324): its items, their floating detail and menus, and the
      // right pane, which shows the same day.
      if (card.current?.contains(target) || target?.closest(`[data-more="${date}"], .fd, .ctx-menu, .rpane`)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [date, onClose]);

  return (
    <div className="pop daypop" role="dialog" aria-label={dayTitle(date)} ref={card} data-date={date} data-up={place?.up ? '' : undefined}
      style={place ? {left: place.left, top: place.top, '--from-x': `${place.from.x}px`, '--from-y': `${place.from.y}px`} as CSSProperties : {left: 0, top: 0, visibility: 'hidden'}}>
      <div className="daypop-head">
        <span className="grow">{dayTitle(date)}</span>
        <span className="kbd">Esc</span>
        <button className="ibtn sm" aria-label="Close" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>
      <div className="daypop-list">
        {items.map(item => (
          <Chip key={item.key} item={item} calendar={calendars.get(item.calendar_id)} selected={selected.has(item.key)} now={now} timeZone={timeZone} onSelect={onSelectItem} onPress={onPress} />
        ))}
      </div>
    </div>
  );
}
