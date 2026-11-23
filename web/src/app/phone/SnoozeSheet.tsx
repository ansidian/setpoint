// The phone's Snooze, from the reader's More: a bottom sheet of the desktop's times (Tomorrow, Next
// weekday when it isn't tomorrow, each with its moment in `ink3`), then Pick a date…, which turns the
// sheet into iOS's own date and time pickers over a line saying the whole moment, or why it can't
// be, and Snooze, which waits until there is one. A pick hands the moment (ms) to `onPick` and closes
// the sheet. Its times are logic/snooze.ts's, at Settings' task time. On an email already snoozed
// (Snoozed's) the sheet is titled with its return and ends with Unsnooze, as the desktop's menu.
import type {Settings} from '@setpoint/shared';
import {useState} from 'react';
import {serverNow, timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {SETTINGS_PATH} from '../../api/items.ts';
import {localDate} from '../../logic/format.ts';
import {pickFields, pickFieldsOutcome, snoozedLine, snoozeOptions} from '../../logic/snooze.ts';
import {Icon} from '../../ui/Icon.tsx';
import {BottomSheet, SheetChoice} from './BottomSheet.tsx';
import './inbox.css';

export function SnoozeSheet({onPick, snoozed, onClose}: {
  onPick: (until: number) => void;
  // The email's return now, and ending its snooze: a snoozed email's sheet.
  snoozed?: {until: string; onUnsnooze: () => void};
  onClose: () => void;
}) {
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const taskTime = settings?.reminders.task_time ?? null;
  const zone = timeZone();
  const now = serverNow();
  const [picking, setPicking] = useState<{date: string; time: string} | null>(null);
  if (picking) {
    const outcome = pickFieldsOutcome(picking.date, picking.time, now, zone);
    return (
      <BottomSheet title="Pick a date" onClose={onClose}>
        <div className="ph-pick">
          <label className="ph-pick-field">
            <span>Day</span>
            <input type="date" min={localDate(now, zone)} value={picking.date} onChange={event => setPicking({...picking, date: event.target.value})} />
          </label>
          <label className="ph-pick-field">
            <span>Time</span>
            <input type="time" value={picking.time} onChange={event => setPicking({...picking, time: event.target.value})} />
          </label>
          <p className={'problem' in outcome ? 'ph-pick-line alert' : 'ph-pick-line'} role="status">{'problem' in outcome ? outcome.problem : `Until ${outcome.line}`}</p>
          <button className="btn ph-pick-go" type="button" disabled={'problem' in outcome} onClick={() => {
            if ('problem' in outcome) return;
            onPick(outcome.until);
            onClose();
          }}>Snooze</button>
        </div>
      </BottomSheet>
    );
  }
  return (
    <BottomSheet title={snoozed ? snoozedLine(snoozed.until, now, zone) : 'Snooze'} onClose={onClose}>
      {snoozeOptions(now, taskTime, zone).flatMap(option => (option.until === null ? [] : [
        <SheetChoice key={option.choice} icon="snooze" label={option.label} detail={option.when ?? undefined} onChoose={() => onPick(option.until!)} />,
      ]))}
      {/* Not a choice: it keeps the sheet up, as its pickers. */}
      <button className="ph-bs-i" type="button" onClick={() => setPicking(pickFields(now, taskTime, zone))}>
        <Icon name="calendar_month" /><span className="ell">Pick a date…</span>
      </button>
      {snoozed && <SheetChoice icon="inbox" label="Unsnooze" onChoose={snoozed.onUnsnooze} />}
    </BottomSheet>
  );
}
