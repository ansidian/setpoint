// The floating detail's card off Calendar, for a line that names an item: the Today block's lines
// and the events and tasks under Alfred's answer. It's drawn over the page, in the shell, placed
// by the page from the line's box and kept on screen. Once drawn it moves to another line's place
// rather than jumping. Esc, the close button or a click outside it and its lines closes it; E
// edits and Delete deletes (when offered), before a mail page's own E and Esc see them.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties} from 'react';
import {createPortal} from 'react-dom';
import {localDate} from '../../../logic/format.ts';
import {isTyping, plainKey} from '../../../ui/keys.ts';
import {rectIn} from '../geometry.ts';
import type {Rect} from '../../../logic/calendar.ts';
import {DetailContent} from './DetailContent.tsx';
import type {DetailActions} from './DetailContent.tsx';
import './detail.css';

export interface ItemCardProps {
  item: ItemOut;
  calendar: CalendarOut | undefined;
  timeZone: string;
  actions: DetailActions;
  onClose: () => void;
  onEdit: () => void;
  // The line it's for, and every line a click on which doesn't close it (another line opens its own).
  line: string;
  lines: string;
  // Its place in the shell from the line's box and its own size, before it's kept on screen.
  at: (line: Rect, host: HTMLElement, size: {width: number; height: number}) => {left: number; top: number};
  className?: string;
}

export function ItemCard({item, calendar, timeZone, actions, onClose, onEdit, line, lines, at, className}: ItemCardProps) {
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{left: number; top: number} | null>(null);
  const [settled, setSettled] = useState(false);
  const host = document.querySelector<HTMLElement>('.app');

  const measure = () => {
    const anchor = document.querySelector(line);
    if (!host || !anchor || !card.current) return;
    const size = {width: card.current.offsetWidth, height: card.current.offsetHeight};
    const wanted = at(rectIn(anchor, host), host, size);
    const top = Math.max(12, Math.min(wanted.top, host.offsetHeight - 12 - size.height));
    const left = Math.max(12, Math.min(wanted.left, host.offsetWidth - 12 - size.width));
    setPlace(current => (current && current.left === left && current.top === top ? current : {left, top}));
  };
  // Every render, and as the window changes size.
  const placed = useRef(measure);
  useLayoutEffect(() => {
    placed.current = measure;
    measure();
  });
  useEffect(() => {
    if (!place || settled) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [place, settled]);
  useEffect(() => {
    const onResize = () => placed.current();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const latest = useRef({item, actions, onClose, onEdit, lines});
  useEffect(() => {
    latest.current = {item, actions, onClose, onEdit, lines};
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event)) return;
      const {item: shownItem, actions: offered, onClose: close, onEdit: edit} = latest.current;
      const take = (run: () => void) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        run();
      };
      if (plainKey(event, 'Escape')) take(close);
      else if (plainKey(event, 'e') && !shownItem.read_only) take(edit);
      else if ((plainKey(event, 'Delete') || plainKey(event, 'Backspace')) && offered.remove && !shownItem.read_only) take(() => offered.remove!(shownItem));
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (card.current?.contains(target) || target?.closest(latest.current.lines)) return;
      latest.current.onClose();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, []);

  if (!host) return null;
  return createPortal(
    <div ref={card} className={['fd item-card', className, settled && 'settled'].filter(Boolean).join(' ')} role="dialog" aria-label={item.title}
      style={(place ? {left: place.left, top: place.top} : {left: 0, top: 0, visibility: 'hidden'}) as CSSProperties}>
      <div className="card float">
        <DetailContent target={{item, date: dayOf(item, timeZone), calendar}} timeZone={timeZone} actions={actions} onClose={onClose} onEdit={onEdit} />
      </div>
    </div>,
    host,
  );
}

const dayOf = (item: ItemOut, timeZone: string) => item.due_date ?? item.start_date ?? (item.starts_at ? localDate(item.starts_at, timeZone) : '');
