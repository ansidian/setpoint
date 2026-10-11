// The "+N" popover (board 11b): the day's every item, hanging from its "+N" over the cells below so
// the cell stays readable, inside the grid. Every item can be selected, and dragged out onto another
// day (F6b; the popover closes as it lifts); Esc, the close button or a click elsewhere closes it.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {PointerEvent as ReactPointerEvent, RefObject} from 'react';
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
  const [place, setPlace] = useState<{left: number; top: number} | null>(null);

  useLayoutEffect(() => {
    const host = section.current;
    const anchor = host?.querySelector<HTMLElement>(`[data-more="${date}"]`);
    if (!host || !anchor || !card.current) return;
    const grid = rectIn(host.querySelector(CAL.scroll)!, host);
    setPlace(hangFrom(
      rectIn(anchor, host),
      {width: card.current.offsetWidth, height: card.current.offsetHeight},
      {left: 0, top: grid.top, width: host.offsetWidth, height: grid.height},
    ));
  }, [date, items.length, section]);

  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (card.current?.contains(target) || target?.closest(`[data-more="${date}"]`)) return;
      onClose();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [date, onClose]);

  return (
    <div className="pop daypop" role="dialog" aria-label={dayTitle(date)} ref={card}
      style={place ? {left: place.left, top: place.top} : {left: 0, top: 0, visibility: 'hidden'}}>
      <div className="daypop-head">
        <span className="grow">{dayTitle(date)}</span>
        <span className="kbd">Esc</span>
        <button className="ibtn sm" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
      </div>
      <div className="daypop-list">
        {items.map(item => (
          <Chip key={item.key} item={item} calendar={calendars.get(item.calendar_id)} selected={selected.has(item.key)} now={now} timeZone={timeZone} onSelect={onSelectItem} onPress={onPress} />
        ))}
      </div>
    </div>
  );
}
