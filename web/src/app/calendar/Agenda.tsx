// Calendar on the phone (DESIGN.md › Phone; board 21): a read-only agenda of today and the next 7
// days, empty days collapsed (logic/phone.ts). The routes are Calendar's: /calendar/item/3?at=…
// opens that item's detail, read-only, over the agenda; /calendar/2026-10-07 brings that day into
// view (or starts the agenda there when it's further out).
import type {CalendarOut, ItemOut, ItemsOut, WeatherDayOut} from '@setpoint/shared';
import {useEffect} from 'react';
import type {CSSProperties} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, itemPath, itemsPath, weatherPath} from '../../api/items.ts';
import {itemDays, itemKey, itemsByDay, monthOf, weatherOf} from '../../logic/calendar.ts';
import {addDays, localDate, monthName} from '../../logic/format.ts';
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
import {DetailContent} from './detail/DetailContent.tsx';
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
  const {data: items} = useResource<ItemsOut>(itemsPath(start, end));
  const {data: weather} = useResource<WeatherDayOut[]>(weatherPath(start, end));

  const forecast = new Map((weather ?? []).map(day => [day.date, day]));
  const sections = phoneAgenda(start, today, itemsByDay(items?.items ?? [], calendars, zone), now, zone, new Set(forecast.keys()));
  const colours = new Map((calendars ?? []).map(calendar => [calendar.id, calendar]));

  const selectedKey = route.item ? itemKey(route.item, route.at) : null;
  const selected = (selectedKey ? items?.items.find(item => item.key === selectedKey) : undefined)
    ?? (linkedItem && linkedItem.id === route.item && !route.at ? linkedItem : undefined);

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
        <span className="hd-title">Agenda</span>
        <span className="grow" />
        <span className="ph-range num">{agendaRange(start)}</span>
      </header>
      <div className="content">
        <section className="ph-agenda" aria-label="Agenda">
          {items && sections.map((section, index) => {
            const days = section.kind === 'day' ? section.date : daysOf(section.from, section.to).join(' ');
            const day = forecast.get(section.kind === 'day' ? section.date : section.from);
            const wx = day && (section.kind === 'day' || section.from === section.to) ? weatherOf(day) : null;
            return (
              <div key={days} className="ph-day" data-days={days}>
                <div className={index === 0 ? 'pday first' : 'pday'}>
                  {section.title}
                  {section.kind === 'empty' && <span className="none">No events</span>}
                  {wx && <span className={`pwx ${wx.tone}`} title={wx.line}><span className="temps num">{wx.temps}</span><Icon name={wx.icon} size={17} /></span>}
                </div>
                {section.kind === 'day' && section.lines.map(({item, when, past}) => {
                  const calendar = colours.get(item.calendar_id);
                  const to: CalendarRoute = {page: 'calendar', date: null, item: item.id, at: item.occurrence_start};
                  return (
                    <a key={item.key} className={['pitem', past && 'past', item.done && 'done', item.key === selectedKey && 'sel'].filter(Boolean).join(' ')} href={routePath(to)} data-key={item.key}
                      style={{'--c': colourVar(item.colour ?? calendar?.colour ?? 'cool')} as CSSProperties}
                      onClick={event => {
                        event.preventDefault();
                        navigate(to);
                      }}>
                      <span className="when">{when}</span>
                      <span className="mk">{item.kind === 'task' ? (item.done ? <TaskGlyph done size={13} /> : <span className="ring" style={ring(item.project)} />) : <span className="cbar" />}</span>
                      <span className="ell">{item.title}{placeName(item) && <span className="pl"> · {placeName(item)}</span>}</span>
                    </a>
                  );
                })}
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
                  <DetailContent target={{item: selected, date: linkedDay ?? today, calendar: colours.get(selected.calendar_id)}} timeZone={zone}
                    onClose={() => navigate(AGENDA)} onEdit={() => {}} />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

const reveal = (selector: string) => document.querySelector(selector)?.scrollIntoView({block: 'nearest'});

function daysOf(from: string, to: string): string[] {
  const days = [from];
  while (days.at(-1)! < to) days.push(addDays(days.at(-1)!, 1));
  return days;
}
