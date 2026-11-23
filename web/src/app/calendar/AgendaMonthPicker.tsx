// The phone Agenda's month picker: the header's month opens it in the bottom sheet, on the
// month of the day in view, that day marked and today in `alert`. ‹ › step the months, as a swipe
// left or right does (logic/monthSwipe.ts); a day jumps the agenda to it and Today goes back to
// today; either closes the sheet.
import {useRef, useState} from 'react';
import type {MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent} from 'react';
import {addMonths} from '../../logic/calendar.ts';
import {monthSwipe} from '../../logic/monthSwipe.ts';
import {swipeAxis} from '../../logic/swipe.ts';
import {BottomSheet} from '../phone/BottomSheet.tsx';
import {MiniMonth} from './Pickers.tsx';

export function AgendaMonthPicker({day, today, onPick, onToday, onClose}: {
  day: string;
  today: string;
  onPick: (date: string) => void;
  onToday: () => void;
  onClose: () => void;
}) {
  const [month, setMonth] = useState(day.slice(0, 7));
  const press = useRef<{id: number; x: number; y: number; sideways: boolean} | null>(null);
  // A swipe that ends on a day isn't a pick of it: the click a mouse sends after it is the swipe's.
  const swiped = useRef(false);
  const down = (event: ReactPointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    swiped.current = false;
    press.current = {id: event.pointerId, x: event.clientX, y: event.clientY, sideways: false};
  };
  // Once a drag goes sideways it's the picker's: a thumb drifting down doesn't drag the sheet too.
  const move = (event: ReactPointerEvent) => {
    const at = press.current;
    if (!at || at.id !== event.pointerId) return;
    if (!at.sideways && swipeAxis(event.clientX - at.x, event.clientY - at.y) === 'x') at.sideways = true;
    if (at.sideways) event.stopPropagation();
  };
  const up = (event: ReactPointerEvent) => {
    const at = press.current;
    if (!at || at.id !== event.pointerId) return;
    press.current = null;
    const turn = monthSwipe(at.x, event.clientX - at.x, event.clientY - at.y);
    if (turn === 0) return;
    swiped.current = true;
    setMonth(current => addMonths(current, turn));
  };
  const swallow = (event: ReactMouseEvent) => {
    if (!swiped.current) return;
    swiped.current = false;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <BottomSheet title="Go to a day" onClose={onClose}>
      <div className="ph-month" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => (press.current = null)} onClickCapture={swallow}>
        <MiniMonth month={month} today={today} value={day} headClass="ph-month-head" onMonth={setMonth} onPick={date => {
          onClose();
          onPick(date);
        }} />
        <button className="btn quiet ph-month-today" type="button" onClick={() => {
          onClose();
          onToday();
        }}>Today</button>
      </div>
    </BottomSheet>
  );
}
