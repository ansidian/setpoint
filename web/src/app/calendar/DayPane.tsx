// The right pane (DESIGN.md › Right pane; boards 11 and 11b): the selected day, its forecast
// ("Sunny · 78° / 61°") or else what it holds ("6 events · 2 tasks"), its events (time, colour bar,
// title, "7:00 – 8:00 AM · Personal", the place on its own line, #125, the recurring glyph, the next lifted with "in 5h" or "45m left" under way (calpanes-01), "Leave by 2:05 PM
// · 18 min", in `caution` once it's time to go and gone once the event starts, SV-56), the now-line
// in `alert` today, riding the event under way (#321), and its tasks with their projects, a timed one
// over its start and in time order, the untimed last (D502); the footer's keys. F6 adds the line under an
// event that starts during another ("Overlaps Study group until 8:30 PM", board 12b), "Moving to Thu,
// Oct 8" while a drop waits on its scope (board 15b), completing a task from its ring, and a change
// waiting for its provider (a spinner, board 19b). SV-20 adds the calendar's sources' stale and
// failing lines at the top (board 19b). A day whose items are only hidden says so, "4 hidden · Show
// all", rather than "No events" (SV-56). The editor (Editor.tsx) takes the pane's place. Until the
// day's items and the calendars have come, its line and agenda are a skeleton, never "Nothing
// planned" (#227). SV-274 adds the day's USPS mail over the footer (MailStrip.tsx).
import type {CalendarOut, ItemOut, SourceOut, SubtaskOut, WeatherDayOut} from '@setpoint/shared';
import {Fragment, useState} from 'react';
import {MailStrip} from './MailStrip.tsx';
import {subtaskCount, Subtasks} from './Subtasks.tsx';
import type {CSSProperties, MouseEvent as ReactMouseEvent, ReactNode} from 'react';
import {useResource} from '../../api/client.ts';
import {SOURCES_PATH} from '../../api/settings.ts';
import {clockTime} from '../../logic/format.ts';
import {agenda, dayCounts, dayTitle, tasksHeading, timeRange, weatherOf} from '../../logic/calendar.ts';
import {agendaOverlap} from '../../logic/conflict.ts';
import {taskTime} from '../../logic/week.ts';
import {leaveLine} from '../../logic/detail.ts';
import {calendarHealthLines} from '../../logic/health.ts';
import type {SourceLine} from '../../logic/health.ts';
import type {LinePhase} from '../../logic/stateLines.ts';
import {Icon, TaskGlyph} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';
import {useCheckNow} from '../states/checkNow.ts';
import {CheckNow, useLinePhase, useShownLines} from '../states/States.tsx';
import {useArrival} from '../states/Loading.tsx';
import {AgendaSkeleton, DayLineSkeleton} from '../states/Skeletons.tsx';
import {useRingColour} from './Chip.tsx';
import {useJustDone} from './done.ts';
import {useCalendarFade} from './view.ts';

interface DayPaneProps {
  date: string;
  // The day's items or the calendars haven't come yet: its line and agenda are a skeleton, never
  // "Nothing planned" (calpanes-03, #227); `failed` says why they didn't come instead.
  loading: boolean;
  failed?: ReactNode;
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
  // SV-272: a subtask's check, and a task's subtasks in a new order.
  onCompleteSubtask: (subtask: SubtaskOut) => void;
  onSettleSubtask: (subtask: SubtaskOut, how: 'retry' | 'move-back') => void;
  onReorderSubtasks: (task: ItemOut, ids: number[]) => Promise<unknown>;
  // SV-273: a new subtask at the end of an open checklist (D566), one in the editor (D567), and one's menu (D569).
  onAddSubtask: (task: ItemOut, title: string) => Promise<unknown>;
  onOpenSubtask: (subtask: SubtaskOut) => void;
  onSubtaskMenu: (event: ReactMouseEvent<HTMLElement>, subtask: SubtaskOut) => void;
  // Turns every hidden calendar back on.
  onShowAll: () => void;
}

const Spinner = () => <span className="spin" aria-label="Saving"><Icon name="progress_activity" size={16} /></span>;

export function DayPane({date, today, loading, failed, items, hidden, forecast, calendars, selected, now, timeZone, movingTo, onSelectItem, onNew, onComplete, onCompleteSubtask, onSettleSubtask, onReorderSubtasks, onAddSubtask, onOpenSubtask, onSubtaskMenu, onShowAll}: DayPaneProps) {
  const arrived = useArrival(!loading, date);
  // SV-272: the tasks whose checklists are open under their rows, by key.
  const [open, setOpen] = useState(new Set<string>());
  const ring = useRingColour();
  // A calendar just toggled fades its rows out or in, as its chips do (polish audit calpanes-11).
  const fade = useCalendarFade();
  // A task ticked off here lands its done check and draws its strike, the one completion moment (done.ts).
  const title = dayTitle(date);
  const colours = new Map((calendars ?? []).map(calendar => [calendar.id, calendar.colour]));
  const day = agenda(date, items, calendars, now, timeZone);
  const justDone = useJustDone(day.tasks);
  // Another day picked: its heading fades in, its items slide in 6 px from the side it lies on (polish
  // audit calpanes-06); the same day again, or an item changing, plays nothing.
  const [shownDay, setShownDay] = useState<{date: string; dir: 'next' | 'prev' | undefined}>({date, dir: undefined});
  if (shownDay.date !== date) setShownDay({date, dir: date > shownDay.date ? 'next' : 'prev'});
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
        <div className="grow" key={date} data-swap={shownDay.dir}>
          <div className="rp-date">{title}</div>
          {wx
            ? <div className="rp-sub ink2"><span className={wx.tone}><Icon name={wx.icon} size={16} /></span><span className="num">{wx.line}</span></div>
            : loading ? (failed ? null : <DayLineSkeleton />) : <div className="rp-sub ink3 num">{dayCounts(items)}</div>}
        </div>
        <button className="ibtn" aria-label={`New event on ${title.slice(5)}`} onClick={() => onNew('event')}><Icon name="add" /></button>
      </div>

      <div className={arrived ? 'rp-scroll sk-arrive' : 'rp-scroll'} key={date} data-dir={shownDay.dir}>
        {loading && (failed ?? <AgendaSkeleton />)}
        {!loading && <>
        {day.events.length > 0 && <div className="ag-day">Events</div>}
        {day.events.map((event, index) => (
          <AgendaRow key={event.item.key} {...{event, index, nowAt: day.nowAt, nowLine, selected, now, timeZone, onSelectItem}} fade={fade(event.item.calendar_id)} colour={event.item.colour ?? colours.get(event.item.calendar_id) ?? null}
            overlap={agendaOverlap(event.item, items, timeZone)} movingTo={movingTo.get(event.item.key) ?? null} />
        ))}
        {day.events.length > 0 && day.nowAt === day.events.length && nowLine}
        {day.tasks.length > 0 && <div className="ag-day">{tasksHeading(date, today)}</div>}
        {day.tasks.map(task => {
          const time = taskTime(task, timeZone);
          return (
            <Fragment key={task.key}>
            <a className={['ag-item ag-task', time && 'timed', task.done && 'done', justDone.has(task.key) && 'just-done', selected.has(task.key) && 'sel', task.command?.state === 'pending' && 'pending', fade(task.calendar_id)].filter(Boolean).join(' ')} href="#" data-key={task.key}
              onClick={event => {
                event.preventDefault();
                onSelectItem(task);
              }}>
              <button className="check" aria-label={task.done ? `Reopen ${task.title}` : `Complete ${task.title}`} disabled={!!task.command || (task.done && !task.can_reopen)}
                onClick={event => {
                  event.preventDefault();
                  event.stopPropagation();
                  onComplete(task);
                }}>
                {task.done ? <TaskGlyph done size={15} /> : <span className="ring" style={ring(task.project)}><Icon name="check" size={11} /></span>}
              </button>
              {time
                ? <span className="grow"><span className="title"><span>{task.title}</span></span><span className="ink3 num line">{time}</span></span>
                : <span className="grow title"><span>{task.title}</span></span>}
              {/* Waiting, the spinner comes before the project, which stays (polish audit calpanes-08). */}
              {task.command?.state === 'pending' && <Spinner />}
              {task.subtasks.length > 0 && (
                <button className="num count" type="button" aria-expanded={open.has(task.key)}
                  aria-label={`${task.subtasks.filter(subtask => subtask.done).length} of ${task.subtasks.length} subtasks done`} data-tip={open.has(task.key) ? 'Hide subtasks' : 'Show subtasks'}
                  onClick={event => {
                    event.preventDefault();
                    event.stopPropagation();
                    setOpen(keys => {
                      const next = new Set(keys);
                      if (!next.delete(task.key)) next.add(task.key);
                      return next;
                    });
                  }}>
                  <Icon name="format_list_bulleted" size={14} />{subtaskCount(task)}<Icon name={open.has(task.key) ? 'expand_less' : 'expand_more'} size={14} />
                </button>
              )}
              {task.project && <span className="ink3 project">{task.project}</span>}
            </a>
            {task.subtasks.length > 0 && open.has(task.key) && (
              <div className="ag-subtasks"><Subtasks task={task} ring={ring(task.project)} timeZone={timeZone} onComplete={task.read_only ? undefined : onCompleteSubtask} onSettle={onSettleSubtask}
                onReorder={task.read_only ? undefined : onReorderSubtasks} onAdd={task.read_only || (task.recurring && task.done) || task.parent_id !== null || task.command?.kind === 'item_create' ? undefined : onAddSubtask}
                onOpen={task.read_only ? undefined : onOpenSubtask} onMenu={onSubtaskMenu} /></div>
            )}
            </Fragment>
          );
        })}
        {/* An empty day is room to plan (polish audit calpanes-09): New event C and New task D as dashed ghost rows. */}
        {!day.events.length && !day.tasks.length && (hidden > 0
          ? <div className="ag-empty"><Icon name="visibility_off" size={16} />{hidden} hidden · <button onClick={onShowAll}>Show all</button></div>
          : (
            <div className="ag-ghosts">
              <button type="button" className="ag-ghost" onClick={() => onNew('event')}><Icon name="add" size={16} /><span className="grow">New event</span><span className="kbd">C</span></button>
              <button type="button" className="ag-ghost" onClick={() => onNew('task')}><span className="ring" /><span className="grow">New task</span><span className="kbd">D</span></button>
            </div>
          ))}
        </>}
      </div>

      {/* SV-274: the day's USPS mail, over the footer. */}
      <MailStrip date={date} />

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
 * failing, wrapping so the provider's words show in full (Decided while building #62), each with
 * Check now on it (states-08); folding in as they come and out as they go (states-13).
 */
export function HealthLines({now, timeZone}: {now: number; timeZone: string}) {
  const {data: sources} = useResource<SourceOut[]>(SOURCES_PATH);
  const {shown, moveOn} = useShownLines(calendarHealthLines(sources ?? [], now, timeZone).map(line => ({key: line.key, line})));
  return shown.map(({key, line, phase}) => <HealthLine key={key} line={line} phase={phase} onMoveOn={from => moveOn(key, from)} />);
}

function HealthLine({line, phase, onMoveOn}: {line: SourceLine; phase: LinePhase; onMoveOn: (from: 'done' | 'out') => void}) {
  const ref = useLinePhase(phase, onMoveOn);
  const check = useCheckNow(line.source === null ? undefined : {id: line.source, health: line.health}, SOURCES_PATH);
  return (
    <div ref={ref} className={`rp-health ${line.state}`}>
      <Icon name={line.state === 'failing' ? 'warning' : 'history'} size={16} />
      <span className={line.state === 'failing' ? 'num' : 'num ell'} data-tip={line.text}>{line.text}</span>
      {line.source !== null && <span className="rp-act"><CheckNow check={check} /></span>}
    </div>
  );
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
  fade: 'leaving' | 'entering' | null;
  onSelectItem: (item: ItemOut) => void;
}

function AgendaRow({event, index, nowAt, nowLine, colour, selected, now, timeZone, overlap, movingTo, fade, onSelectItem}: AgendaRowProps) {
  const {item} = event;
  const leave = leaveLine(item, timeZone, now);
  const line = movingTo ? `${timeRange(item, timeZone)} · Moving to ${dayTitle(movingTo)}` : event.line;
  // The next event is lifted out of the list, and one under way fills its bar as it goes (polish audit
  // calpanes-01) and carries the now-line (#321).
  const classes = ['ag-item', event.past && 'past', event.next && 'next', event.ongoing && 'ongoing', selected.has(item.key) && 'sel', item.command?.state === 'pending' && 'pending', fade].filter(Boolean).join(' ');
  return (
    <>
      {nowAt === index && !event.ongoing && nowLine}
      <a className={classes} href="#" data-key={item.key}
        style={{'--c': colourVar(colour ?? 'cool'), ...(event.progress === null ? {} : {'--gone': Math.round(event.progress * 1000) / 1000})} as CSSProperties}
        onClick={click => {
          click.preventDefault();
          onSelectItem(item);
        }}>
        <span className="when num">{event.when}</span>
        <span className="cbar" />
        {/* Under way, the now-line rides the bar at the time gone and goes on across the row at 35% (#321).
            Drawn only: the row still reads its start time. */}
        {event.ongoing && <span className="nowride" aria-hidden="true"><span className="t num">{clockTime(now, timeZone)}</span><span className="dot" /><span className="rule" /></span>}
        <span className="grow">
          <span className="title">{item.title}</span>
          <span className="ink3 num line">{line}</span>
          {event.place && <span className="place"><Icon name={event.place.video ? 'videocam' : 'location_on'} size={16} /><span className="ell">{event.place.text}</span></span>}
          {leave && <span className={`leave${leave.state === 'due' ? ' due' : ''}`}><Icon name="directions_car" size={16} />{leave.text}</span>}
          {overlap && <span className="ink3 num overlap"><Icon name="layers" size={16} />{overlap}</span>}
        </span>
        {item.command?.state === 'pending' && <Spinner />}
        {(event.left ?? event.startsIn) && <span className="ink3 num in">{event.left ?? event.startsIn}</span>}
        {item.recurring && <span className="repeat"><Icon name="repeat" size={16} /></span>}
      </a>
    </>
  );
}
