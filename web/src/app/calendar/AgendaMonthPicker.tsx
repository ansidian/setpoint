// The phone Agenda's month picker (D790): the header's month opens it in the bottom sheet, on the
// month of the day in view, that day marked and today in `alert`. ‹ › step the months, a day jumps
// the agenda to it and Today goes back to today; either closes the sheet.
import {useState} from 'react';
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
  return (
    <BottomSheet title="Go to a day" onClose={onClose}>
      <div className="ph-month">
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
