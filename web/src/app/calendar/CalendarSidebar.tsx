// The sidebar's section on Calendar (DESIGN.md › Sidebar on Calendar): the mini-month (26 px days,
// today a disc, the selected day `sub` or the week view's shown week, ‹ › stepping), and the Calendars toggles, each a 14 px
// checkbox in its calendar's colour, Todoist's too with no mark of its own (polish audit calpanes-13), which filter the grid and
// the agenda, a calendar's items fading out or in as it's toggled and its name `ink3` while it's off (calpanes-11).
import type {CalendarOut} from '@setpoint/shared';
import type {CSSProperties} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, setCalendarVisible} from '../../api/items.ts';
import {monthOf} from '../../logic/calendar.ts';
import {weekStart} from '../../logic/week.ts';
import {localDate} from '../../logic/format.ts';
import type {Route} from '../../logic/route.ts';
import {motion} from '../../tokens.ts';
import {colourVar} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {showToast, toastFailure} from '../toast.ts';
import {navigate} from '../router.ts';
import {CalendarsSkeleton} from '../states/Skeletons.tsx';
import {MiniMonth} from './Pickers.tsx';
import {fadeCalendar, revealDay, stepMini, useCalendarView} from './view.ts';

// Hides waiting out their items' fade, by calendar.
const hiding = new Map<number, number>();
const entered = new Map<number, number>();

/**
 * Shows or hides a calendar so the page sees it go (polish audit calpanes-11): hidden, its items fade
 * out over 120 ms before it's hidden here and at the server; shown, they fade back in over 180 ms.
 */
export function setVisible(calendar: Pick<CalendarOut, 'id' | 'name'>, visible: boolean): Promise<void> {
  window.clearTimeout(hiding.get(calendar.id));
  hiding.delete(calendar.id);
  window.clearTimeout(entered.get(calendar.id));
  const failed = toastFailure(`Couldn't ${visible ? 'show' : 'hide'} ${calendar.name}`);
  if (visible) {
    fadeCalendar(calendar.id, 'entering');
    entered.set(calendar.id, window.setTimeout(() => fadeCalendar(calendar.id, null), motion.medium));
    return setCalendarVisible(calendar.id, true).catch(failed);
  }
  fadeCalendar(calendar.id, 'leaving');
  return new Promise(done => hiding.set(calendar.id, window.setTimeout(() => {
    hiding.delete(calendar.id);
    fadeCalendar(calendar.id, null);
    void setCalendarVisible(calendar.id, false).catch(failed).finally(done);
  }, motion.fast)));
}

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
  hidden.forEach(calendar => {
    fadeCalendar(calendar.id, 'entering');
    entered.set(calendar.id, window.setTimeout(() => fadeCalendar(calendar.id, null), motion.medium));
  });
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
        {!calendars && <CalendarsSkeleton />}
        {calendars?.map(calendar => (
          <button key={calendar.id} className="calrow" aria-pressed={calendar.visible}
            style={{'--c': colourVar(calendar.colour ?? 'ink2')} as CSSProperties}
            onClick={() => void setVisible(calendar, !calendar.visible)}>
            <span className={calendar.visible ? 'chk' : 'chk off'} />
            <span className="grow">{calendar.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}
