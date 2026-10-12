// The "+N" popover (board 11b): the day's every item, hanging from its "+N" over the cells below so
// the cell stays readable, inside the grid. Every item can be selected, and dragged out onto another
// day (F6b; the popover closes as it lifts); Esc, the close button or a click elsewhere closes it. It
// grows from its "+N" over 180 ms and fades out over 120 ms (DESIGN.md › Motion).
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
  // Closed, fading out (ui/exit.ts): it stays where it was and takes nothing.
  closing?: boolean;
  onSelectItem: (item: ItemOut, chip: HTMLElement, additive: boolean) => void;
  onClose: () => void;
  onPress: (item: ItemOut, event: ReactPointerEvent<HTMLElement>) => void;
}

export function DayPopover({date, items, section, selected, calendars, now, timeZone, closing = false, onSelectItem, onClose, onPress}: DayPopoverProps) {
  const card = useRef<HTMLDivElement>(null);
  // Where it hangs, and the point it grows from: its "+N", at its top when it hangs below, its foot when above.
  const [place, setPlace] = useState<{left: number; top: number; from: {x: number; y: number}; up: boolean} | null>(null);

  useLayoutEffect(() => {
    const host = section.current;
    const anchor = host?.querySelector<HTMLElement>(`[data-more="${date}"]`);
    if (!host || !anchor || !card.current || closing) return;
    const grid = rectIn(host.querySelector(CAL.scroll)!, host);
    const at = rectIn(anchor, host);
    const size = {width: card.current.offsetWidth, height: card.current.offsetHeight};
    const {left, top} = hangFrom(at, size, {left: 0, top: grid.top, width: host.offsetWidth, height: grid.height});
    const up = top < at.top;
    setPlace({left, top, up, from: {x: Math.min(size.width, Math.max(0, at.left + at.width / 2 - left)), y: up ? size.height : 0}});
  }, [date, items.length, section, closing]);

  useEffect(() => {
    if (closing) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (card.current?.contains(target) || target?.closest(`[data-more="${date}"]`)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [date, onClose, closing]);

  return (
    <div className={closing ? 'pop daypop closing' : 'pop daypop'} role="dialog" aria-label={dayTitle(date)} ref={card} inert={closing} data-up={place?.up ? '' : undefined}
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
