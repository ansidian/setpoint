// SV-181: an .ics file's review in the right pane (D437), in place of the day's agenda as the editor
// and search take it. The file's name and its count; one calendar picker (the user's Google
// calendars) and "N already on <calendar> (will update)"; a row per event with its checkbox (in the
// chosen calendar's colour, as the sidebar's), title, day and time, and "repeats", "past" or "will
// update" after it, past events unticked; what the file had that's left out, last. The footer's
// Import N events runs them one at a time, the button giving way to "Importing 12 of 35"; a refused
// event stays in the list with Google's words and Retry. Esc or Cancel closes it.
import type {CalendarOut} from '@setpoint/shared';
import type {CSSProperties} from 'react';
import {alreadyLine, droppedLine, importLabel, progressLine, refusedLine, rowMarks, rowTitle, rowWhen, runCounts} from '../../logic/icsImport.ts';
import {Icon} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';
import {Select} from '../settings/parts.tsx';
import {closeReview, pickCalendar, retryRow, runImport, tick, tickAll} from './importRun.ts';
import type {ImportReview} from './importRun.ts';

interface ImportPaneProps {
  review: ImportReview;
  // The Google calendars an import can go into.
  calendars: CalendarOut[];
  // The one picked until the user picks another.
  fallback: number | null;
  timeZone: string;
}

export function ImportPane({review, calendars, fallback, timeZone}: ImportPaneProps) {
  const {read, ticked, rows, order, running} = review;
  const calendarId = review.calendarId ?? fallback;
  const calendar = calendars.find(one => one.id === calendarId) ?? null;
  const counts = order ? runCounts(order, rows) : null;
  const already = alreadyLine(read.events, ticked, calendarId, calendar?.name ?? null);
  const left = droppedLine(read.dropped);
  const all = ticked.size === read.events.length;
  // Once a run has gone, only its refused events can be sent again, by their Retry.
  const ran = order !== null && !running;
  return (
    <section className="rpane cal-import" aria-label="Import events" style={{'--c': colourVar(calendar?.colour ?? 'cool')} as CSSProperties}>
      <div className="rp-head">
        <div className="grow">
          <div className="rp-date ell" data-tip={review.name}>Import {review.name}</div>
          <div className="rp-sub ink3 num">{read.events.length.toLocaleString('en-US')} events</div>
        </div>
        <button className="ibtn" type="button" aria-label="Close the import" data-tip="Close · Esc" onClick={closeReview}><Icon name="close" /></button>
      </div>
      <div className="imp-to">
        <span className="ink2">Into</span>
        {calendar && (running || ran
          ? <span className="num">{calendar.name}</span>
          : <Select label="Calendar" align="left" value={calendar.id} options={calendars.map(one => ({value: one.id, label: one.name, colour: one.colour}))} onChange={pickCalendar} />)}
        {already && <span className="imp-already ink3 num">{already}</span>}
      </div>
      <div className="rp-scroll">
        <div className="imp-list" role="group" aria-label="Events in the file">
          <button type="button" className="imp-row imp-all" aria-pressed={all} disabled={running || ran} onClick={() => tickAll(!all)}>
            <span className={all ? 'chk' : 'chk off'} />
            <span className="grow ink2">{all ? 'Untick all' : 'Tick all'}</span>
          </button>
          {read.events.map(event => {
            const row = rows.get(event.ical_uid);
            const on = ticked.has(event.ical_uid);
            const marks = rowMarks(event, calendarId);
            return (
              <div key={event.ical_uid} className={['imp-item', row && `is-${row.state}`, !on && 'off'].filter(Boolean).join(' ')}>
                <button type="button" className="imp-row" aria-pressed={on} disabled={running || ran} onClick={() => tick(event.ical_uid, !on)}>
                  <span className={on ? 'chk' : 'chk off'} />
                  <span className="grow">
                    <span className="title">{rowTitle(event)}</span>
                    <span className="ink3 num line">{[rowWhen(event, timeZone), ...marks].join(' · ')}</span>
                  </span>
                  {row?.state === 'sending' && <span className="spin" aria-label="Importing"><Icon name="progress_activity" size={16} /></span>}
                  {row?.state === 'done' && <span className="imp-done" aria-label="Imported"><Icon name="check" size={16} /></span>}
                </button>
                {row?.state === 'failed' && (
                  <div className="imp-refused">
                    <Icon name="warning" size={16} />
                    <span className="grow num">{row.message}</span>
                    <button type="button" className="btn ghost sm" onClick={() => void retryRow(event.ical_uid, calendar?.name ?? '')}>Retry</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {left && <div className="imp-left ink3 num">{left}</div>}
      </div>
      <div className="rp-foot imp-foot">
        {running && counts
          ? <span className="imp-progress num" role="status">{progressLine(counts.settled, counts.total)}</span>
          : ran && counts && counts.failed
            ? <span className="imp-progress failing num" role="status">{refusedLine(counts.failed)}</span>
            : <button type="button" className="btn" disabled={!ticked.size || !calendar} onClick={() => calendar && void runImport(calendar.id, calendar.name)}>{importLabel(ticked.size)}</button>}
        <button type="button" className="btn quiet" onClick={closeReview}>{ran ? 'Close' : 'Cancel'}<span className="kbd">Esc</span></button>
      </div>
    </section>
  );
}
