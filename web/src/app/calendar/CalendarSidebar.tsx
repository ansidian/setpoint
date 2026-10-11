// The sidebar's section on Calendar (DESIGN.md › Sidebar on Calendar): the mini-month (26 px days,
// today a disc, the selected day `sub` or the week view's shown week, ‹ › stepping), and the Calendars toggles, each a 14 px
// checkbox in its calendar's colour (Todoist adds its ring), which filter the grid and the agenda.
import type {CalendarOut} from '@setpoint/shared';
import type {CSSProperties} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, setCalendarVisible} from '../../api/items.ts';
import {monthOf} from '../../logic/calendar.ts';
import {weekStart} from '../../logic/week.ts';
import {localDate} from '../../logic/format.ts';
import type {Route} from '../../logic/route.ts';
import {colourVar} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {showToast, toastFailure} from '../toast.ts';
import {navigate} from '../router.ts';
import {MiniMonth} from './Pickers.tsx';
import {revealDay, stepMini, useCalendarView} from './view.ts';

/**
 * Show all, from a day whose items are only hidden (SV-56): turns every hidden calendar back on, and
 * Undo in the toast turns the same ones off again.
 */
export function showHidden(calendars: CalendarOut[]) {
  const hidden = calendars.filter(calendar => !calendar.visible);
  if (!hidden.length) return;
  const what = hidden.length === 1 ? hidden[0]!.name : `${hidden.length} calendars`;
  const show = (visible: boolean) => Promise.all(hidden.map(calendar => setCalendarVisible(calendar.id, visible)));
  showToast(`Showed ${what}`, {label: 'Undo', run: () => void show(false).catch(toastFailure(`Couldn't hide ${what}`))});
  void show(true).catch(toastFailure(`Couldn't show ${what}`));
}

export function CalendarSidebar({route}: {route: Extract<Route, {page: 'calendar'}>}) {
  const now = useNow();
  const today = localDate(now, timeZone());
  const view = useCalendarView();
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const month = view.mini ?? monthOf(route.date ?? today);
  const selected = view.selected ?? route.date ?? today;

  const pick = (date: string) => {
    navigate({page: 'calendar', date, item: null, at: null});
    revealDay(date);
  };

  return (
    <>
      <div className="sb-sec">
        <MiniMonth headClass="sb-label" month={month} today={today} value={selected} week={route.view === 'week' ? view.week ?? weekStart(selected) : null} onMonth={stepMini} onPick={pick} />
      </div>

      <div className="sb-sec">
        <div className="sb-label">Calendars</div>
        {(calendars ?? []).map(calendar => (
          <button key={calendar.id} className="calrow" aria-pressed={calendar.visible}
            style={{'--c': colourVar(calendar.colour ?? 'ink2')} as CSSProperties}
            onClick={() => void setCalendarVisible(calendar.id, !calendar.visible).catch(toastFailure(`Couldn't ${calendar.visible ? 'hide' : 'show'} ${calendar.name}`))}>
            <span className={calendar.visible ? 'chk' : 'chk off'} />
            <span className="grow">{calendar.name}</span>
            {calendar.provider === 'todoist' && <span className="ring" />}
          </button>
        ))}
      </div>
    </>
  );
}
