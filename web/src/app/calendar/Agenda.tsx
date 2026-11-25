// Calendar on the phone (board 21): the agenda, empty days collapsed (logic/phone.ts). It opens on
// today with the past week above it, and loads on a week at a time as it nears the end, until four
// empty weeks in a row leave a Show later row. The header's month, the day in view's, opens
// the month picker, which jumps to any day; older days than the week before are the picker's.
// Overdue tasks lead today as its Overdue group, each with how long it's overdue, and the
// detail of one snoozes it in the bottom sheet, as does swiping its line left (phone/swipe.tsx). The header's search button opens a plain field
// whose results take the list's place; its clear button leaves search.
// The routes are Calendar's: /calendar/item/3?at=… opens that item's detail over the agenda.
// /calendar/2026-10-07 brings that day to the top (or starts the agenda there when it's outside
// what's loaded). + in the header opens the editor sheet (phone/EditorSheet.tsx) on a new event on
// the day in view: the topmost day whose line is still showing. The detail offers Edit (the same
// sheet), a task's ring (its done check reopens it) and Delete with Undo, a repeating event's asking
// which of its events. Nothing drags: moving and resizing stay on the desktop's grids.
import type {CalendarOut, CalendarSearchResultOut, ItemOut, ItemsOut, WeatherDayOut} from '@setpoint/shared';
import {Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties} from 'react';
import {serverNow, timeZone} from '../../api/auth.ts';
import {useResource, useResources} from '../../api/client.ts';
import {CALENDARS_PATH, itemPath, itemsPath, weatherPath} from '../../api/items.ts';
import {dayTitle, itemDays, itemKey, itemsByDay, weatherOf} from '../../logic/calendar.ts';
import {addDays, clockTime, localDate} from '../../logic/format.ts';
import {SNOOZES} from '../../logic/overdueBanner.ts';
import {agendaAnchor, agendaChunks, agendaMonth, EMPTY_WEEKS, FIRST_WEEKS, loadsOn, overdueFor, PAST_DAYS, phoneAgenda, snoozeEnd, WEEK} from '../../logic/phone.ts';
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
import {SearchField} from '../search/Search.tsx';
import {useCalendarSearch} from '../search/state.ts';
import {readSnoozes, writeSnoozes} from '../overdueSnoozed.ts';
import {showToast} from '../toast.ts';
import {DetailContent} from './detail/DetailContent.tsx';
import type {DetailActions} from './detail/DetailContent.tsx';
import {BottomSheet, SheetChoice} from '../phone/BottomSheet.tsx';
import {openEditorSheet, removeItem} from '../phone/EditorSheet.tsx';
import {toggleDone, usePhoneChanges} from '../phone/itemActions.ts';
import {AgendaMonthPicker} from './AgendaMonthPicker.tsx';
import {AgendaSearch} from './AgendaSearch.tsx';
import {onAgendaToday} from './agendaToday.ts';
import {useOverdue, useSnoozeOverdue} from './overdueGroup.ts';
import {useSwipes} from '../phone/swipe.tsx';
import type {SwipeAct} from '../phone/swipe.tsx';
import './detail/detail.css';
import './agendaPhone.css';

type CalendarRoute = Extract<Route, {page: 'calendar'}>;

const AGENDA: CalendarRoute = {page: 'calendar', date: null, item: null, at: null};

// How near the end the next week starts loading.
const NEAR_END = '0px 0px 800px 0px';

export function Agenda({route}: {route: CalendarRoute}) {
  const now = useNow();
  const zone = timeZone();
  const today = localDate(now, zone);
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const ring = useRingColour();
  // An item's address without an occurrence names its day only through the item.
  const {data: linkedItem} = useResource<ItemOut>(route.item && !route.at ? itemPath(route.item) : null);
  const linkedDay = route.date ?? (route.at ? localDate(route.at, zone) : linkedItem?.id === route.item && linkedItem ? itemDays(linkedItem, zone)[0] ?? null : null);

  const [searching, setSearching] = useState(false);
  const search = useCalendarSearch(true);
  // The field's clear button leaves search, as does the header's search button again.
  const leaveSearch = () => {
    search.clear();
    setSearching(false);
  };
  const field = {...search, clear: leaveSearch};
  const results = searching && search.active;
  // The result whose detail is open, for an occurrence the agenda hasn't loaded.
  const [picked, setPicked] = useState<ItemOut | null>(null);

  // The day the agenda opens on, and the weeks loaded after it. A day to bring to the top (`focus`):
  // a link's, the picker's or today's, each once, by its count.
  // `glide`: scrolled there smoothly, as the tab bar takes the Inbox and News to their tops.
  const [focus, setFocus] = useState({day: linkedDay ?? today, n: 0, glide: false});
  const [seenLink, setSeenLink] = useState(linkedDay);
  if (seenLink !== linkedDay) {
    setSeenLink(linkedDay);
    if (linkedDay && !route.item) setFocus({day: linkedDay, n: focus.n + 1, glide: false});
  }
  const [{anchor, weeks}, setWindow] = useState(() => ({anchor: agendaAnchor(today, FIRST_WEEKS, linkedDay ?? today), weeks: FIRST_WEEKS}));
  const go = (day: string, glide = false) => {
    setFocus({day, n: focus.n + 1, glide});
    navigate(day === today ? AGENDA : {...AGENDA, date: day}, {replace: true});
  };
  const goRef = useRef(go);
  useEffect(() => {
    goRef.current = go;
  });
  // The tab again glides to today when it's in what's loaded; further off, the agenda opens there.
  const loadedRef = useRef({anchor: '', weeks: 0});
  useEffect(() => onAgendaToday(() => {
    const day = localDate(serverNow(), timeZone());
    const {anchor: at, weeks: count} = loadedRef.current;
    goRef.current(day, agendaAnchor(at, count, day) === at);
  }), []);

  useEffect(() => {
    loadedRef.current = {anchor, weeks};
  });

  const chunks = agendaChunks(anchor, weeks);
  const start = chunks[0]!.from;
  const loadedChunks = useResources<ItemsOut>(chunks.map(chunk => itemsPath(chunk.from, chunk.to)));
  // Forecasts reach a few days out: the first weeks' are asked for, no later ones.
  const weatherChunks = useResources<WeatherDayOut[]>(chunks.slice(0, FIRST_WEEKS + 1).map(chunk => weatherPath(chunk.from, chunk.to)));
  // The chunks in from the start, up to the first still on its way.
  const loadedCount = loadedChunks.findIndex(chunk => !chunk) === -1 ? chunks.length : loadedChunks.findIndex(chunk => !chunk);
  // The week before and the first week come together, so the day it opens on is placed once.
  const ready = loadedCount >= 2;
  // Deletes held by their toast are gone, and a task being checked or reopened shows as it will be.
  const {gone, ticking} = usePhoneChanges();
  const seen = new Set<string>();
  const items = !ready ? undefined : loadedChunks.slice(0, loadedCount).flatMap(chunk => chunk!.items).flatMap(item => {
    if (seen.has(item.key) || gone(item)) return [];
    seen.add(item.key);
    return ticking.has(item.key) ? [{...item, done: ticking.get(item.key)!}] : [item];
  });
  const weekCounts = loadedChunks.slice(1, loadedCount).map(chunk => chunk!.items.length);
  const allLoaded = loadedCount === chunks.length;
  const more = allLoaded && !loadsOn(weekCounts);

  const overdue = useOverdue();
  const overdueKeys = useMemo(() => new Set(overdue.map(item => item.key)), [overdue]);
  const {snooze, until} = useSnoozeOverdue();
  const [snoozing, setSnoozing] = useState<ItemOut | null>(null);
  // An Overdue line swiped left offers Snooze, and all the way opens its sheet.
  const swipes = useSwipes({
    enabled: true,
    acts: key => (overdue.some(item => item.key === key) ? {lead: [], trail: [SNOOZE_ACT]} : null),
    run: key => setSnoozing(overdue.find(item => item.key === key) ?? null),
  });

  // A link to an item already on screen (its Overdue line, a result) leaves the agenda where it is.
  const routeKey = route.item ? itemKey(route.item, route.at) : null;
  const onScreen = !!routeKey && (overdueKeys.has(routeKey) || picked?.key === routeKey || !!items?.some(item => item.key === routeKey));
  const moved = agendaAnchor(anchor, weeks, route.item ? (onScreen ? null : linkedDay) : focus.day, results);
  if (moved !== anchor) setWindow({anchor: moved, weeks: FIRST_WEEKS});

  const forecast = new Map(weatherChunks.flatMap(chunk => chunk ?? []).map(day => [day.date, day]));
  const days = PAST_DAYS + (loadedCount - 1) * WEEK;
  const sections = phoneAgenda(start, today, itemsByDay(items ?? [], calendars, zone), now, zone, new Set(forecast.keys()), {days, overdue: overdueKeys, opens: anchor});
  const colours = new Map((calendars ?? []).map(calendar => [calendar.id, calendar]));

  const selectedKey = route.item ? itemKey(route.item, route.at) : null;
  const selected = (selectedKey ? items?.find(item => item.key === selectedKey) ?? overdue.find(item => item.key === selectedKey) : undefined)
    ?? (picked && picked.key === selectedKey && !gone(picked) ? picked : undefined)
    ?? (linkedItem && linkedItem.id === route.item && !route.at && !gone(linkedItem) ? linkedItem : undefined);
  // A deleted item's detail goes with it.
  const shown = selectedKey ? loadedChunks.flatMap(chunk => chunk?.items ?? []).find(item => item.key === selectedKey)
    ?? (picked?.key === selectedKey ? picked : undefined) ?? (linkedItem?.key === selectedKey ? linkedItem : undefined) : undefined;
  const deleted = !!shown && gone(shown);
  useEffect(() => {
    if (deleted) navigate(AGENDA, {replace: true});
  }, [deleted]);
  const isOverdue = !!selected && overdueKeys.has(selected.key);
  const actions: DetailActions = {
    // A repeating task's completion is an item of its own, and the task moves on to its next date:
    // the card it was in closes.
    complete: task => toggleDone(task, () => {
      if (task.recurring && !task.done) navigate(AGENDA, {replace: true});
    }),
    remove: removeItem,
    ...(isOverdue ? {snooze: (task: ItemOut) => setSnoozing(task)} : {}),
  };

  // The header's month: the day in view's, followed as the list scrolls.
  const list = useRef<HTMLElement>(null);
  const [viewDay, setViewDay] = useState(focus.day);
  const follow = () => {
    const day = dayInView();
    if (day) setViewDay(day);
  };

  const title = tabTitle({page: 'calendar', title: agendaMonth(viewDay, '')});
  useEffect(() => {
    document.title = title;
  }, [title]);

  // The day to bring to the top, once its days are in: on opening, from a link, the picker or today.
  // Until enough is loaded under it to reach the top, it's tried again as more comes, unless the
  // user takes the list first or nothing more loads by itself.
  const revealed = useRef(-1);
  useLayoutEffect(() => {
    if (!ready || revealed.current === focus.n) return;
    const scroller = list.current;
    const day = scroller?.querySelector<HTMLElement>(`[data-days~="${focus.day}"]`);
    if (!scroller || !day) return;
    const off = () => day.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    // A glide is asked for once: the frames it scrolls through mustn't set it again. Short of
    // what's under the day to bring it to the top, it jumps and tries again as more loads.
    if (focus.glide && scroller.scrollTop + off() <= scroller.scrollHeight - scroller.clientHeight + 1) {
      revealed.current = focus.n;
      scroller.scrollTo({top: scroller.scrollTop + off(), behavior: 'smooth'});
    } else {
      scroller.scrollTop += off();
      if (Math.abs(off()) <= 1 || (allLoaded && more)) revealed.current = focus.n;
    }
    follow();
  });
  const takeList = () => {
    revealed.current = focus.n;
  };
  // A linked item comes into view, unless a line of it shows already: an overdue task has its day's
  // line and its Overdue group's.
  useEffect(() => {
    const scroller = list.current;
    if (!selectedKey || results || !scroller) return;
    const lines = [...scroller.querySelectorAll<HTMLElement>(`[data-key="${CSS.escape(selectedKey)}"]`)];
    const box = scroller.getBoundingClientRect();
    if (lines.some(line => line.getBoundingClientRect().top >= box.top && line.getBoundingClientRect().bottom <= box.bottom)) return;
    lines[0]?.scrollIntoView({block: 'nearest'});
  }, [selectedKey, ready, results]);

  // Nearing the end loads the next week, until four empty ones in a row.
  const end = useRef<HTMLDivElement>(null);
  const [nearEnd, setNearEnd] = useState(false);
  useEffect(() => {
    const element = end.current;
    if (!element || !list.current) return;
    const watch = new IntersectionObserver(([entry]) => setNearEnd(entry?.isIntersecting ?? false), {root: list.current, rootMargin: NEAR_END});
    watch.observe(element);
    return () => watch.disconnect();
  }, [ready, anchor]);
  // Asked again as each week comes, since the end can stay in sight while it does: a week a frame.
  useEffect(() => {
    if (!nearEnd || results || !allLoaded || more) return;
    const frame = requestAnimationFrame(() => setWindow(current => ({...current, weeks: current.weeks + 1})));
    return () => cancelAnimationFrame(frame);
  }, [nearEnd, results, allLoaded, more, anchor, loadedCount]);

  const [picking, setPicking] = useState(false);
  const todayAt = sections.findIndex(section => section.today);

  return (
    <>
      <header data-theme="night" className="hd">
        <Mark />
        <h1 className="hd-title">Agenda</h1>
        <span className="grow" />
        <button className="ph-month-btn" type="button" aria-haspopup="dialog" aria-label={`${agendaMonth(viewDay, today)}, go to a day`} onClick={() => setPicking(true)}>
          {agendaMonth(viewDay, today)}<Icon name="expand_more" size={16} />
        </button>
        <button className={searching ? 'ibtn ph-find on' : 'ibtn ph-find'} type="button" aria-label="Search" aria-pressed={searching}
          onClick={() => (searching ? leaveSearch() : setSearching(true))}><Icon name="search" /></button>
        <button className="ibtn ph-new" type="button" aria-label="New event" onClick={() => openEditorSheet({kind: 'event', date: dayInView() ?? today})}><Icon name="add" /></button>
        {searching && <SearchField search={field} label="Search events and tasks" autoFocus onEnter={() => {}} />}
      </header>
      <div className="content">
        {/* The agenda stays under the results, hidden, where it was scrolled to. */}
        {results && <AgendaSearch search={search} calendars={colours} selectedKey={selectedKey} today={today} timeZone={zone} onSelect={result => openResult(result, setPicked)} />}
        <section ref={list} className="ph-agenda" aria-label="Agenda" hidden={results} onScroll={follow} onTouchStart={takeList} onWheel={takeList}>
            {/* Until the days' items come, their skeleton. */}
            {!items && <PhoneAgendaSkeleton />}
            {items && sections.map((section, index) => {
              const days = section.kind === 'day' ? section.date : daysOf(section.from, section.to).join(' ');
              const day = forecast.get(section.kind === 'day' ? section.date : section.from);
              const wx = day && (section.kind === 'day' || section.from === section.to) ? weatherOf(day) : null;
              const group = index === todayAt ? overdue : [];
              return (
                <div key={days} className="ph-day" data-days={days}>
                  {/* Today reads "Today" in `ink` 500 before its date. */}
                  <div className={['pday', index === 0 && 'first', section.today && 'today'].filter(Boolean).join(' ')}>
                    {section.today ? <span><span className="pd-today">Today</span> · {dayTitle(section.kind === 'day' ? section.date : section.from)}</span> : section.title}
                    {section.kind === 'empty' && !group.length && <span className="none">No events</span>}
                    {wx && <span className={`pwx ${wx.tone}`} data-tip={wx.line}><span className="temps num"><span className="hi">{wx.high}</span> / {wx.low}</span><Icon name={wx.icon} size={17} /></span>}
                  </div>
                  {group.length > 0 && (
                    <div className="ph-overdue" role="group" aria-label="Overdue" {...swipes.handlers}>
                      <div className="ph-overdue-h">Overdue<span className="num">{group.length}</span></div>
                      {group.map(item => (
                        // Its swipe's box: the tray beside the line's link.
                        <div key={item.key} className="ph-swipe" data-swipe-key={item.key}>
                          {swipes.tray(item.key)}
                          <AgendaLine item={item} when={`${overdueFor(item, now, zone)} overdue`} past={false} overdue
                            calendar={colours.get(item.calendar_id)} selected={item.key === selectedKey} ring={ring} />
                        </div>
                      ))}
                    </div>
                  )}
                  {section.kind === 'day' && section.lines.map(({item, when, past}, at) => (
                    <Fragment key={item.key}>
                      {section.nowAt === at && <NowLine now={now} timeZone={zone} />}
                      <AgendaLine item={item} when={when} past={past} calendar={colours.get(item.calendar_id)} selected={item.key === selectedKey} ring={ring} />
                    </Fragment>
                  ))}
                  {section.kind === 'day' && section.nowAt === section.lines.length && <NowLine now={now} timeZone={zone} />}
                </div>
              );
            })}
            {/* The next week on its way, its rows' skeleton; after four empty weeks, Show later. */}
            {items && !allLoaded && <PhoneAgendaSkeleton />}
            {/* It leaves a screen's room under it, so a day just above can still come to the top. */}
            {items && more && (
              <div className="ph-later">
                <button type="button" onClick={() => setWindow(current => ({...current, weeks: current.weeks + EMPTY_WEEKS}))}>Show later</button>
              </div>
            )}
            {items && <div ref={end} className="ph-end" aria-hidden="true" />}
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
      {picking && <AgendaMonthPicker day={viewDay} today={today} onPick={go} onToday={() => go(today)} onClose={() => setPicking(false)} />}
      {snoozing && (
        <BottomSheet title={`Snooze ${snoozing.title}`} onClose={() => setSnoozing(null)}>
          {SNOOZES.map(({choice, label}) => (
            <SheetChoice key={choice} icon="snooze" label={label} detail={snoozeEnd(until(choice), now, zone)} onChoose={() => {
              const task = snoozing;
              const before = readSnoozes();
              snooze(task, choice);
              navigate(AGENDA, {replace: true});
              showToast(`Snoozed ${task.title}`, {label: 'Undo', run: () => writeSnoozes(before)});
            }} />
          ))}
        </BottomSheet>
      )}
    </>
  );
}

// An Overdue line's one swipe.
const SNOOZE_ACT: SwipeAct = {id: 'snooze', label: 'Snooze', icon: 'snooze', tone: 'violet'};

/** A result's detail: its item, kept for an occurrence outside what the agenda has loaded. */
function openResult(result: CalendarSearchResultOut, setPicked: (item: ItemOut) => void) {
  setPicked(result.item);
  navigate({page: 'calendar', date: null, item: result.item.id, at: result.item.occurrence_start});
}

/** One of the agenda's lines: its time (or how long it's overdue), an event's calendar chip or a task's ring, its title and place. */
function AgendaLine({item, when, past, overdue = false, calendar, selected, ring}: {
  item: ItemOut;
  when: string;
  past: boolean;
  overdue?: boolean;
  calendar: CalendarOut | undefined;
  selected: boolean;
  ring: ReturnType<typeof useRingColour>;
}) {
  const to: CalendarRoute = {page: 'calendar', date: null, item: item.id, at: item.occurrence_start};
  // Events are their calendar's chip, as on the grids. Tasks keep their ring.
  const chip = item.kind === 'event';
  return (
    <a className={['pitem', chip && 'chip', past && 'past', item.done && 'done', overdue && 'late', selected && 'sel'].filter(Boolean).join(' ')} href={routePath(to)} data-key={item.key}
      style={{'--c': colourVar(item.colour ?? calendar?.colour ?? 'cool')} as CSSProperties}
      onClick={event => {
        event.preventDefault();
        navigate(to);
      }}>
      <span className="when">{when}</span>
      {!chip && <span className="mk">{item.done ? <TaskGlyph done size={13} /> : <span className="ring" style={ring(item.project)} />}</span>}
      <span className="ell">{item.title}{placeName(item) && <span className="pl"> · {placeName(item)}</span>}</span>
    </a>
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

function daysOf(from: string, to: string): string[] {
  const days = [from];
  while (days.at(-1)! < to) days.push(addDays(days.at(-1)!, 1));
  return days;
}
