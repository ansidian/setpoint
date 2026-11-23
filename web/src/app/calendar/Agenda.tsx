// Calendar on the phone (board 21): an agenda of today and the next 7 days, empty days collapsed
// (logic/phone.ts). The routes are Calendar's: /calendar/item/3?at=… opens that item's detail over
// the agenda. /calendar/2026-10-07 brings that day into view (or starts the agenda there when it's
// further out). + in the header opens the editor sheet (phone/EditorSheet.tsx) on a new event on the
// day in view: the topmost day whose line is still showing. The detail offers Edit (the same sheet),
// a task's ring (its done check reopens it) and Delete with Undo, a repeating event's asking which
// of its events. Nothing drags: moving and resizing stay on the desktop's grids.
import type {CalendarOut, ItemOut, ItemsOut, WeatherDayOut} from '@setpoint/shared';
import {Fragment, useEffect, useMemo} from 'react';
import type {CSSProperties} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, itemPath, itemsPath, weatherPath} from '../../api/items.ts';
import {dayTitle, itemDays, itemKey, itemsByDay, monthOf, weatherOf} from '../../logic/calendar.ts';
import {addDays, clockTime, localDate, monthName} from '../../logic/format.ts';
import {AGENDA_DAYS, agendaRange, agendaStart, phoneAgenda} from '../../logic/phone.ts';
import type {Route} from '../../logic/route.ts';
import {routePath} from '../../logic/route.ts';
import {placeName} from '../../logic/place.ts';
import {tabTitle} from '../../logic/title.ts';
import {Icon, Mark, TaskGlyph} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';
import {useRingColour} from './Chip.tsx';
import {useNow} from '../clock.ts';
import {navigate} from '../router.ts';
import {PhoneAgendaSkeleton} from '../states/Skeletons.tsx';
import {DetailContent} from './detail/DetailContent.tsx';
import type {DetailActions} from './detail/DetailContent.tsx';
import {openEditorSheet, removeItem} from '../phone/EditorSheet.tsx';
import {toggleDone, usePhoneChanges} from '../phone/itemActions.ts';
import './detail/detail.css';

type CalendarRoute = Extract<Route, {page: 'calendar'}>;

const AGENDA: CalendarRoute = {page: 'calendar', date: null, item: null, at: null};

export function Agenda({route}: {route: CalendarRoute}) {
  const now = useNow();
  const zone = timeZone();
  const today = localDate(now, zone);
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const ring = useRingColour();
  // An item's address without an occurrence names its day only through the item.
  const {data: linkedItem} = useResource<ItemOut>(route.item && !route.at ? itemPath(route.item) : null);
  const linkedDay = route.date ?? (route.at ? localDate(route.at, zone) : linkedItem?.id === route.item && linkedItem ? itemDays(linkedItem, zone)[0] ?? null : null);
  const start = agendaStart(today, linkedDay);
  const end = addDays(start, AGENDA_DAYS);
  const {data: loaded} = useResource<ItemsOut>(itemsPath(start, end));
  // Deletes held by their toast are gone, and a task being checked or reopened shows as it will be.
  const {gone, ticking} = usePhoneChanges();
  const items = useMemo(() => loaded && {...loaded, items: loaded.items.flatMap(item => (gone(item) ? []
    : ticking.has(item.key) ? [{...item, done: ticking.get(item.key)!}] : [item]))}, [loaded, gone, ticking]);
  const {data: weather} = useResource<WeatherDayOut[]>(weatherPath(start, end));

  const forecast = new Map((weather ?? []).map(day => [day.date, day]));
  const sections = phoneAgenda(start, today, itemsByDay(items?.items ?? [], calendars, zone), now, zone, new Set(forecast.keys()));
  const colours = new Map((calendars ?? []).map(calendar => [calendar.id, calendar]));

  const selectedKey = route.item ? itemKey(route.item, route.at) : null;
  const selected = (selectedKey ? items?.items.find(item => item.key === selectedKey) : undefined)
    ?? (linkedItem && linkedItem.id === route.item && !route.at && !gone(linkedItem) ? linkedItem : undefined);
  // A deleted item's detail goes with it.
  const shown = selectedKey ? loaded?.items.find(item => item.key === selectedKey) ?? (linkedItem?.key === selectedKey ? linkedItem : undefined) : undefined;
  const deleted = !!shown && gone(shown);
  useEffect(() => {
    if (deleted) navigate(AGENDA, {replace: true});
  }, [deleted]);
  const actions: DetailActions = {
    // A repeating task's completion is an item of its own, and the task moves on to its next date:
    // the card it was in closes.
    complete: task => toggleDone(task, () => {
      if (task.recurring && !task.done) navigate(AGENDA, {replace: true});
    }),
    remove: removeItem,
  };

  const title = tabTitle({page: 'calendar', title: monthName(`${monthOf(start)}-01`)});
  useEffect(() => {
    document.title = title;
  }, [title]);

  // A linked day or item comes into view.
  const target = selectedKey ?? linkedDay;
  useEffect(() => {
    if (target) reveal(selectedKey ? `.ph-agenda [data-key="${CSS.escape(selectedKey)}"]` : `.ph-agenda [data-days~="${target}"]`);
  }, [target, selectedKey, items]);

  return (
    <>
      <header className="hd">
        <Mark />
        <h1 className="hd-title">Agenda</h1>
        <span className="grow" />
        <span className="ph-range num">{agendaRange(start)}</span>
        <button className="ibtn ph-new" type="button" aria-label="New event" onClick={() => openEditorSheet({kind: 'event', date: dayInView() ?? start})}><Icon name="add" /></button>
      </header>
      <div className="content">
        <section className="ph-agenda" aria-label="Agenda">
          {/* Until the days' items come, their skeleton. */}
          {!items && <PhoneAgendaSkeleton />}
          {items && sections.map((section, index) => {
            const days = section.kind === 'day' ? section.date : daysOf(section.from, section.to).join(' ');
            const day = forecast.get(section.kind === 'day' ? section.date : section.from);
            const wx = day && (section.kind === 'day' || section.from === section.to) ? weatherOf(day) : null;
            return (
              <div key={days} className="ph-day" data-days={days}>
                {/* Today reads "Today" in `ink` 500 before its date. */}
                <div className={['pday', index === 0 && 'first', section.today && 'today'].filter(Boolean).join(' ')}>
                  {section.today ? <span><span className="pd-today">Today</span> · {dayTitle(section.kind === 'day' ? section.date : section.from)}</span> : section.title}
                  {section.kind === 'empty' && <span className="none">No events</span>}
                  {wx && <span className={`pwx ${wx.tone}`} data-tip={wx.line}><span className="temps num"><span className="hi">{wx.high}</span> / {wx.low}</span><Icon name={wx.icon} size={17} /></span>}
                </div>
                {section.kind === 'day' && section.lines.map(({item, when, past}, at) => {
                  const calendar = colours.get(item.calendar_id);
                  const to: CalendarRoute = {page: 'calendar', date: null, item: item.id, at: item.occurrence_start};
                  // Events are their calendar's chip, as on the grids. Tasks keep their ring.
                  const chip = item.kind === 'event';
                  return (
                    <Fragment key={item.key}>
                      {section.nowAt === at && <NowLine now={now} timeZone={zone} />}
                      <a className={['pitem', chip && 'chip', past && 'past', item.done && 'done', item.key === selectedKey && 'sel'].filter(Boolean).join(' ')} href={routePath(to)} data-key={item.key}
                        style={{'--c': colourVar(item.colour ?? calendar?.colour ?? 'cool')} as CSSProperties}
                        onClick={event => {
                          event.preventDefault();
                          navigate(to);
                        }}>
                        <span className="when">{when}</span>
                        {!chip && <span className="mk">{item.done ? <TaskGlyph done size={13} /> : <span className="ring" style={ring(item.project)} />}</span>}
                        <span className="ell">{item.title}{placeName(item) && <span className="pl"> · {placeName(item)}</span>}</span>
                      </a>
                    </Fragment>
                  );
                })}
                {section.kind === 'day' && section.nowAt === section.lines.length && <NowLine now={now} timeZone={zone} />}
              </div>
            );
          })}
        </section>
        {selected && (
          <>
            <button className="ph-scrim" type="button" aria-label="Close" onClick={() => navigate(AGENDA)} />
            <div className="fd ph-detail" role="dialog" aria-label={selected.title}>
              <div className="card">
                <div className="fd-body">
                  <DetailContent target={{item: selected, date: linkedDay ?? today, calendar: colours.get(selected.calendar_id)}} timeZone={zone} actions={actions}
                    onClose={() => navigate(AGENDA)} onEdit={() => openEditorSheet({kind: selected.kind, date: itemDays(selected, zone)[0] ?? today, item: selected})} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Today's now-line, as the right pane's: the time in `alert` in the time column, a dot, then the line. */
function NowLine({now, timeZone}: {now: number; timeZone: string}) {
  return (
    <div className="ph-now" aria-label={`Now, ${clockTime(now, timeZone)}`}>
      <span className="t num">{clockTime(now, timeZone)}</span>
      <span className="dot" />
      <span className="line" />
    </div>
  );
}

/** The topmost day whose line still shows under the header, its first day for folded empty days. */
function dayInView(): string | null {
  const list = document.querySelector('.ph-agenda');
  if (!list) return null;
  const top = list.getBoundingClientRect().top;
  const day = [...list.querySelectorAll<HTMLElement>('.ph-day')].find(one => one.getBoundingClientRect().bottom > top + 1);
  return day?.dataset.days?.split(' ')[0] ?? null;
}

const reveal = (selector: string) => document.querySelector(selector)?.scrollIntoView({block: 'nearest'});

function daysOf(from: string, to: string): string[] {
  const days = [from];
  while (days.at(-1)! < to) days.push(addDays(days.at(-1)!, 1));
  return days;
}
