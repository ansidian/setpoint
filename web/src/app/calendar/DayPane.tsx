// The right pane (DESIGN.md › Right pane; boards 11 and 11b): the selected day, its forecast
// ("Sunny · 78° / 61°") or else what it holds ("6 events · 2 tasks"), its events (time, colour bar,
// title, "7:00 – 8:00 AM · Personal", the recurring glyph, "in 5h" on the next, "Leave by 2:05 PM
// · 18 min", in `caution` once it's time to go and gone once the event starts, SV-56), the now-line
// in `alert` today, and its tasks with their projects; the footer's keys. F6 adds the line under an
// event that starts during another ("Overlaps Study group until 8:30 PM", board 12b), "Moving to Thu,
// Oct 8" while a drop waits on its scope (board 15b), completing a task from its ring, and a change
// waiting for its provider (a spinner, board 19b). SV-20 adds the calendar's sources' stale and
// failing lines at the top (board 19b). A day whose items are only hidden says so, "4 hidden · Show
// all", rather than "No events" (SV-56). The editor (Editor.tsx) takes the pane's place.
import type {CalendarOut, ItemOut, SourceOut, WeatherDayOut} from '@setpoint/shared';
import type {CSSProperties, ReactNode} from 'react';
import {useResource} from '../../api/client.ts';
import {SOURCES_PATH} from '../../api/settings.ts';
import {clockTime} from '../../logic/format.ts';
import {agenda, dayCounts, dayTitle, tasksHeading, timeRange, weatherOf} from '../../logic/calendar.ts';
import {agendaOverlap} from '../../logic/conflict.ts';
import {leaveLine} from '../../logic/detail.ts';
import {calendarHealthLines} from '../../logic/health.ts';
import {Icon, TaskGlyph} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';
import {useRingColour} from './Chip.tsx';

interface DayPaneProps {
  date: string;
  today: string;
  items: ItemOut[];
  // The day's items the calendars toggled off hide.
  hidden: number;
  forecast: WeatherDayOut | undefined;
  calendars: CalendarOut[] | undefined;
  selected: Set<string>;
  now: number;
  timeZone: string;
  // Items whose drop waits on its scope, and the day each is going to.
  movingTo: Map<string, string>;
  onSelectItem: (item: ItemOut) => void;
  onNew: (kind: 'event' | 'task') => void;
  onComplete: (task: ItemOut) => void;
  // Turns every hidden calendar back on.
  onShowAll: () => void;
}

const Spinner = () => <span className="spin" aria-label="Saving"><Icon name="progress_activity" size={16} /></span>;

export function DayPane({date, today, items, hidden, forecast, calendars, selected, now, timeZone, movingTo, onSelectItem, onNew, onComplete, onShowAll}: DayPaneProps) {
  const ring = useRingColour();
  const title = dayTitle(date);
  const colours = new Map((calendars ?? []).map(calendar => [calendar.id, calendar.colour]));
  const day = agenda(date, items, calendars, now, timeZone);
  const wx = forecast ? weatherOf(forecast) : null;
  const nowLine = (
    <div className="nowline" key="now">
      <span className="t num">{clockTime(now, timeZone)}</span>
      <span className="line" />
    </div>
  );

  return (
    <section className="rpane" aria-label={title}>
      <HealthLines now={now} timeZone={timeZone} />
      <div className="rp-head">
        <div className="grow">
          <div className="rp-date">{title}</div>
          {wx
            ? <div className="rp-sub ink2"><span className={wx.tone}><Icon name={wx.icon} size={16} /></span><span className="num">{wx.line}</span></div>
            : <div className="rp-sub ink3 num">{dayCounts(items)}</div>}
        </div>
        <button className="ibtn" aria-label={`New event on ${title.slice(5)}`} onClick={() => onNew('event')}><Icon name="add" /></button>
      </div>

      <div className="rp-scroll">
        {day.events.length > 0 && <div className="ag-day">Events</div>}
        {day.events.map((event, index) => (
          <AgendaRow key={event.item.key} {...{event, index, nowAt: day.nowAt, nowLine, selected, now, timeZone, onSelectItem}} colour={event.item.colour ?? colours.get(event.item.calendar_id) ?? null}
            overlap={agendaOverlap(event.item, items, timeZone)} movingTo={movingTo.get(event.item.key) ?? null} />
        ))}
        {day.events.length > 0 && day.nowAt === day.events.length && nowLine}
        {day.tasks.length > 0 && <div className="ag-day">{tasksHeading(date, today)}</div>}
        {day.tasks.map(task => (
          <a key={task.key} className={`ag-item ag-task${task.done ? ' done' : ''}${selected.has(task.key) ? ' sel' : ''}${task.command?.state === 'pending' ? ' pending' : ''}`} href="#" data-key={task.key}
            onClick={event => {
              event.preventDefault();
              onSelectItem(task);
            }}>
            <button className="check" aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`} disabled={!!task.command || (task.done && task.recurring)}
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                onComplete(task);
              }}>
              {task.done ? <TaskGlyph done size={15} /> : <span className="ring" style={ring(task.project)} />}
            </button>
            <span className="grow title">{task.title}</span>
            {task.command?.state === 'pending' ? <Spinner /> : task.project && <span className="ink3 project">{task.project}</span>}
          </a>
        ))}
        {!day.events.length && !day.tasks.length && (hidden > 0
          ? <div className="ag-empty"><Icon name="visibility_off" size={16} />{hidden} hidden · <button onClick={onShowAll}>Show all</button></div>
          : <div className="ag-empty">No events · <button onClick={() => onNew('event')}>New event</button></div>)}
      </div>

      <div className="rp-foot">
        <Icon name="keyboard" size={16} />
        <span className="hint">New event</span><span className="kbd">C</span>
        <span className="hint second">New task</span><span className="kbd">D</span>
      </div>
    </section>
  );
}

/**
 * SV-20: "Todoist, as of 8:40 AM" (board 19b), muted while stale, in `caution` with the reason while
 * failing, wrapping so the provider's words show in full (Decided while building #62).
 */
function HealthLines({now, timeZone}: {now: number; timeZone: string}) {
  const {data: sources} = useResource<SourceOut[]>(SOURCES_PATH);
  return calendarHealthLines(sources ?? [], now, timeZone).map(line => (
    <div key={line.text} className={`rp-health ${line.state}`}>
      <Icon name={line.state === 'failing' ? 'error' : 'history'} size={16} />
      <span className={line.state === 'failing' ? 'num' : 'num ell'} title={line.text}>{line.text}</span>
    </div>
  ));
}

interface AgendaRowProps {
  event: ReturnType<typeof agenda>['events'][number];
  index: number;
  nowAt: number | null;
  nowLine: ReactNode;
  colour: CalendarOut['colour'];
  selected: Set<string>;
  now: number;
  timeZone: string;
  overlap: string | null;
  movingTo: string | null;
  onSelectItem: (item: ItemOut) => void;
}

function AgendaRow({event, index, nowAt, nowLine, colour, selected, now, timeZone, overlap, movingTo, onSelectItem}: AgendaRowProps) {
  const {item} = event;
  const leave = leaveLine(item, timeZone, now);
  const line = movingTo ? `${timeRange(item, timeZone)} · Moving to ${dayTitle(movingTo)}` : event.line;
  return (
    <>
      {nowAt === index && nowLine}
      <a className={`ag-item${event.past ? ' past' : ''}${selected.has(item.key) ? ' sel' : ''}${item.command?.state === 'pending' ? ' pending' : ''}`} href="#" data-key={item.key}
        style={{'--c': colourVar(colour ?? 'cool')} as CSSProperties}
        onClick={click => {
          click.preventDefault();
          onSelectItem(item);
        }}>
        <span className="when num">{event.when}</span>
        <span className="cbar" />
        <span className="grow">
          <span className="title">{item.title}</span>
          <span className="ink3 num line">{line}</span>
          {leave && <span className={`leave${leave.state === 'due' ? ' due' : ''}`}><Icon name="directions_car" size={16} />{leave.text}</span>}
          {overlap && <span className="ink3 num overlap"><Icon name="layers" size={16} />{overlap}</span>}
        </span>
        {item.command?.state === 'pending' && <Spinner />}
        {event.startsIn && <span className="ink3 num in">{event.startsIn}</span>}
        {item.recurring && <span className="repeat"><Icon name="repeat" size={16} /></span>}
      </a>
    </>
  );
}
