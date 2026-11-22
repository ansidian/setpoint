// The sidebar's Today block on mail pages. It shows "Dentist" over "2:30 PM · in 5h" and the open
// tasks due today, a timed one over its time ("9:00 AM") and one with subtasks ending in their
// count ("1/3"), in one list by time with the untimed tasks after. Under a Tomorrow label of its own (none when nothing's on) come tomorrow's events and open
// tasks in the same order: the first two and "3 more due tomorrow" when there are more than three.
// Today's lines never fold.
// A line opens the floating detail's card beside the sidebar instead of leaving the page. Edit (E)
// goes to Calendar's editor, a task completes there or from its ring, an item that isn't a repeating
// event deletes, and Open in Calendar shows it there. Esc, the close button or a click elsewhere
// closes the card. It follows a click on another line. The event leads with its calendar's bar, and
// its "in 12m" warms to `caution` from 15 minutes before and `alert` once under way. A completed
// task plays the completion moment (styles.css), as everywhere a task completes. Then its line
// folds away as the mail list's rows do (app/fold.ts). Undo folds it back, a repeating task's too, and reopens the occurrence it completed.
// Folded to the rail, it's one slot instead: a clock over the time until today's next timed item,
// event or task alike. Its tooltip names that item with what else is left, and it opens the same
// card. The slot shows nothing once no timed item is left today.
import type {CalendarOut, ItemOut, ItemsOut} from '@setpoint/shared';
import {useMemo, useState} from 'react';
import type {MouseEvent, ReactNode} from 'react';
import {timeZone} from '../api/auth.ts';
import {useResource} from '../api/client.ts';
import {CALENDARS_PATH, completeItem, createSubtask, deleteItem, itemsPath, moveBack, reorderSubtasks, retryChange} from '../api/items.ts';
import type {Entry, FoldRules} from '../logic/fold.ts';
import type {Route} from '../logic/route.ts';
import {routePath} from '../logic/route.ts';
import {byTime, DONE_MOMENT_MS, nextUp, shownTomorrow, todayBlock, todayRange} from '../logic/today.ts';
import type {TodayEvent, TodayTask, TomorrowEvent} from '../logic/today.ts';
import {Burst} from '../ui/Burst.tsx';
import {Icon, TaskGlyph} from '../ui/Icon.tsx';
import {dotStyle} from './accounts.ts';
import {useRingColour} from './calendar/Chip.tsx';
import {subtaskCount} from './calendar/Subtasks.tsx';
import {readOnlyReason} from './calendar/detail/DetailContent.tsx';
import {ItemCard} from './calendar/detail/ItemCard.tsx';
import type {ItemCardProps} from './calendar/detail/ItemCard.tsx';
import type {DetailActions} from './calendar/detail/DetailContent.tsx';
import {rectIn} from './calendar/geometry.ts';
import {useNow} from './clock.ts';
import {openContextMenu} from './ContextMenu.tsx';
import type {MenuAction} from './ContextMenu.tsx';
import {foldIn, foldOut, useFold} from './fold.ts';
import {TodaySkeleton} from './states/Skeletons.tsx';
import {navigate} from './router.ts';
import {showToast, toastFailure} from './toast.ts';

const itemRoute = (item: ItemOut, edit = false): Route => ({page: 'calendar', date: null, item: item.id, at: item.occurrence_start, ...(edit ? {edit: true} as const : {})});

/** A line's click: the card, or with ⌘, Ctrl or ⇧ the item on Calendar in a new tab, as a link does. */
function follows(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0;
}

/** A task's line, and whether it's showing its done check. */
interface TaskLine extends TodayTask {
  done: boolean;
}

/** A line under the Tomorrow label: one of its events, or a task. */
type TomorrowLine = {event: TomorrowEvent} | {task: TaskLine};
const tomorrowItem = (line: TomorrowLine) => ('event' in line ? line.event.item : line.task.item);

// Every line that goes folds out, and one that comes back (Undo, a refused change) folds in.
const FOLDS: FoldRules<TaskLine> = {folds: () => true, arrives: () => true};

/** The block, or three lines of skeleton until today's items come. In the rail, its next-up slot. */
export function TodayBlock({rail = false}: {rail?: boolean}) {
  const now = useNow();
  const zone = timeZone();
  const range = todayRange(now, zone);
  const {data} = useResource<ItemsOut>(itemsPath(range.from, range.to));
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const ring = useRingColour();
  // "3 more due tomorrow" opens every line until the page reloads.
  const [all, setAll] = useState(false);
  // The line whose card is open, by its item's key.
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Tasks being completed and items being deleted here, off the block until the server has the change.
  const [gone, setGone] = useState<Set<string>>(new Set());
  // Tasks just completed, by key, showing their done check where they were for DONE_MOMENT_MS,
  // whatever the server's list says meanwhile.
  const [ticked, setTicked] = useState<ReadonlyMap<string, {line: TodayTask; at: number}>>(new Map());

  const today = useMemo(() => todayBlock((data?.items ?? []).filter(item => !gone.has(item.key)), now, zone), [data, gone, now, zone]);
  const next = useMemo(() => (rail ? nextUp((data?.items ?? []).filter(item => !gone.has(item.key)), now, zone) : null), [rail, data, gone, now, zone]);
  const tasks = useMemo(() => {
    const listed: TaskLine[] = today.tasks.filter(task => !ticked.has(task.item.key)).map(task => ({...task, done: false}));
    for (const {line, at} of [...ticked.values()].sort((a, b) => a.at - b.at)) listed.splice(Math.min(at, listed.length), 0, {...line, done: true});
    return listed;
  }, [today, ticked]);
  // Tomorrow's lines fold to two and "N more", counted in time order with the untimed tasks
  // last, as Today's.
  const {shown: tomorrowShown, more} = useMemo(() => shownTomorrow<TomorrowLine>(byTime([
    ...today.tomorrowEvents.map(event => ({event})),
    ...tasks.filter(task => task.tomorrow).map(task => ({task})),
  ], tomorrowItem), all, line => 'event' in line), [today, tasks, all]);
  const tomorrowEvents = tomorrowShown.flatMap(line => ('event' in line ? [line.event] : []));
  const shown = useMemo(() => [
    ...tasks.filter(task => !task.tomorrow),
    ...tomorrowShown.flatMap(line => ('task' in line ? [line.task] : [])),
  ], [tasks, tomorrowShown]);
  const entries = useMemo(() => shown.map((line): Entry<TaskLine> => ({key: line.item.key, id: line.item.id, item: line})), [shown]);
  const folded = useFold(entries, FOLDS);
  const lines = [...(today.event ? [today.event.item] : []), ...today.tomorrowEvents.map(event => event.item), ...today.tasks.map(task => task.item)];
  const opened = lines.find(item => item.key === openKey) ?? null;

  if (!data) {
    if (rail) return null;
    return (
      <div className="sb-sec today">
        <div className="sb-label">Today</div>
        <TodaySkeleton lines={3} />
      </div>
    );
  }
  if (!today.event && !folded.length && !tomorrowEvents.length) return null;
  // Each day's events and tasks in one list by time, untimed tasks last. A task folding away
  // keeps the place its time gives it.
  type Folded = (typeof folded)[number];
  type Line = {event: TodayEvent | TomorrowEvent} | {task: Folded};
  const lineItem = (line: Line) => ('event' in line ? line.event.item : line.task.item.item);
  const todayLines = byTime<Line>([
    ...(today.event ? [{event: today.event}] : []),
    ...folded.filter(line => !line.item.tomorrow).map(task => ({task})),
  ], lineItem);
  const tomorrowLines = byTime<Line>([
    ...tomorrowEvents.map(event => ({event})),
    ...folded.filter(line => line.item.tomorrow).map(task => ({task})),
  ], lineItem);

  // The card goes with its item.
  const hide = (item: ItemOut) => {
    setGone(set => new Set(set).add(item.key));
    setOpenKey(key => (key === item.key ? null : key));
  };
  const unhide = (item: ItemOut) => setGone(set => {
    const next = new Set(set);
    next.delete(item.key);
    return next;
  });

  /**
   * Completes a task: its line shows the done check for a moment, then folds away, with Undo. A
   * refusal brings it back and says why. A repeating task's line then shows its next date, if due.
   */
  const complete = (task: ItemOut) => {
    // Already on its way: a second click (a double-click) completes nothing more.
    if (gone.has(task.key)) return;
    const line = tasks.find(one => one.item.key === task.key);
    if (line) {
      setTicked(map => new Map(map).set(task.key, {line, at: tasks.indexOf(line)}));
      window.setTimeout(() => setTicked(map => {
        const next = new Map(map);
        next.delete(task.key);
        return next;
      }), DONE_MOMENT_MS);
    }
    hide(task);
    void completeItem(task.id, true, task.recurring ? task.due_date : null)
      // A repeating task's Undo reopens the done occurrence the completion made.
      .then(done => showToast(`Completed ${task.title}`, {
        label: 'Undo',
        run: () => void completeItem(task.recurring ? done.target_id : task.id, false).catch(toastFailure('Failed to reopen')),
      }))
      .catch(toastFailure('Failed to complete'))
      .finally(() => unhide(task));
  };

  const remove = (item: ItemOut) => {
    hide(item);
    void deleteItem(item.id, {occurrence_start: item.occurrence_start})
      .then(() => showToast(`Deleted ${item.title}`))
      .catch(toastFailure('Failed to delete'))
      .finally(() => unhide(item));
  };

  const actionsFor = (item: ItemOut): DetailActions => ({
    complete,
    // A subtask's check says so with Undo, as its task's does.
    completeSubtask: subtask => void completeItem(subtask.id, !subtask.done)
      .then(done => showToast(`${subtask.done ? 'Reopened' : 'Completed'} ${subtask.title}`, {
        label: 'Undo',
        run: () => void completeItem(done.target_id, subtask.done).catch(toastFailure(subtask.done ? 'Failed to complete' : 'Failed to reopen')),
      }))
      .catch(toastFailure(subtask.done ? 'Failed to reopen' : 'Failed to complete')),
    settleSubtask: (subtask, how) => void (how === 'retry' ? retryChange : moveBack)(subtask.command!.id)
      .catch(toastFailure(how === 'retry' ? 'Failed to try again' : 'Failed to undo')),
    reorderSubtasks: (task, ids) => reorderSubtasks(task.id, ids).catch(toastFailure('Failed to reorder')),
    // Added here as on Calendar. Editing one and its menu are Calendar's, through Open.
    addSubtask: (task, title) => createSubtask({kind: 'task', calendar_id: task.calendar_id, title, parent_id: task.id}).catch(toastFailure('Failed to add')),
    open: one => navigate(itemRoute(one)),
    // A repeating event asks which of its events go. Calendar asks that.
    ...(item.kind === 'event' && item.recurring ? {} : {remove}),
  });

  const toggle = (item: ItemOut) => (event: MouseEvent) => {
    if (follows(event)) return;
    event.preventDefault();
    setOpenKey(key => (key === item.key ? null : item.key));
  };
  const lineClass = (item: ItemOut) => (item.key === openKey ? 'today-row on' : 'today-row');
  // A right-click: the card's actions at the pointer, in place of the card, so an open one goes.
  const lineMenu = (item: ItemOut) => (event: MouseEvent<HTMLElement>) => {
    const offers = actionsFor(item);
    const open = {id: 'open', label: 'Open in Calendar', icon: 'calendar_month', run: () => navigate(itemRoute(item))} satisfies MenuAction;
    // A read-only event leaves out what it can't do, saying why.
    const reason = {id: 'read-only', label: readOnlyReason(calendars?.find(calendar => calendar.id === item.calendar_id)), icon: 'lock', note: true, run: () => {}} satisfies MenuAction;
    const opened = openContextMenu(event, event.currentTarget, item.read_only ? [reason, open] : [
      {id: 'edit', label: 'Edit', icon: 'edit', hint: 'E', run: () => navigate(itemRoute(item, true))},
      ...(item.kind === 'task' && !item.done ? [{id: 'complete', label: 'Complete', icon: 'task_alt', run: () => complete(item)} satisfies MenuAction] : []),
      open,
      ...(offers.remove ? [{id: 'delete', group: 'delete', label: 'Delete', icon: 'delete', danger: true, run: () => remove(item)} satisfies MenuAction] : []),
    ]);
    if (opened) setOpenKey(null);
  };

  // An event's line leads with its calendar's bar (or its own colour's), as calendar chips and the
  // agenda draw it, where tasks have rings. Its title takes the whole width, then when, and neither
  // wraps.
  // Today's is the next event (`next`). Tomorrow's aren't.
  const eventLine = (item: ItemOut, key: string, title: string, when: ReactNode, next = false) => (
    <a key={key} className={`${lineClass(item)} event${next ? ' next' : ''}`} data-key={key} href={routePath(itemRoute(item))} onClick={toggle(item)} onContextMenu={lineMenu(item)}
      aria-haspopup="dialog" aria-expanded={openKey === key}>
      <span className="evbar" style={dotStyle(item.colour ?? calendars?.find(calendar => calendar.id === item.calendar_id)?.colour ?? undefined)}><i /></span>
      <span className="lines">
        <span className="ell title" data-tip={title}>{title}</span>
        <span className="when">{when}</span>
      </span>
    </a>
  );

  const taskLine = ({key, item: {item, title, time, passed, done}, fold}: Folded) => {
    // A line folding away keeps its look, without its key or the pointer.
    const leaving = fold === 'out';
    const classes = [lineClass(item), 'task', time && 'timed', done && 'completing just-done', leaving && 'leaving'].filter(Boolean).join(' ');
    return (
      <a key={key} ref={leaving ? foldOut : fold === 'in' ? foldIn : undefined} className={classes} data-key={leaving ? undefined : item.key}
        href={routePath(itemRoute(item))} onClick={toggle(item)} onContextMenu={leaving ? undefined : lineMenu(item)} aria-haspopup="dialog" aria-expanded={openKey === item.key} aria-hidden={leaving || undefined}>
        <button className="check" type="button" aria-label={`Complete ${title}`} data-tip="Complete"
          onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            complete(item);
          }}>
          {done ? <TaskGlyph done size={13} /> : <span className="ring" style={ring(item.project)}><Icon name="check" size={11} /></span>}
          {done && <Burst style={ring(item.project)} />}
        </button>
        {/* The title wraps to two lines, as the event's, over a timed task's time alone.
            The label says its day. */}
        <span className="lines">
          <span className="ell title" data-tip={title}><span className="done-tx">{title}</span></span>
          {time && <span className="when"><span className={passed ? 't num passed' : 't num'}>{time}</span></span>}
        </span>
        {/* A task with subtasks ends in their count, done of all, as its chip does. */}
        {item.subtasks.length > 0 && <span className="count num"><Icon name="subtask" size={12} />{subtaskCount(item)}</span>}
      </a>
    );
  };

  if (rail) {
    if (!next) return null;
    const tip = `${next.title} · ${next.time} · ${next.in === 'now' ? 'now' : `in ${next.in}`}${next.more ? ` · +${next.more} more today` : ''}`;
    return (
      <div className="sb-sec today next-up">
        <a className={`${lineClass(next.item)} next`} data-key={next.key} href={routePath(itemRoute(next.item))} onClick={toggle(next.item)} onContextMenu={lineMenu(next.item)}
          aria-haspopup="dialog" aria-expanded={openKey === next.key} aria-label={tip} data-tip={tip}>
          <Icon name="schedule" />
          <span className={next.urgency ? `in num ${next.urgency}` : 'in num'}>{next.in}</span>
        </a>
        {opened && (
          <TodayCard item={opened} calendar={calendars?.find(calendar => calendar.id === opened.calendar_id)} timeZone={zone}
            actions={actionsFor(opened)} onClose={() => setOpenKey(null)} onEdit={() => navigate(itemRoute(opened, true))} />
        )}
      </div>
    );
  }

  return (
    <div className="sb-sec today">
      {todayLines.length > 0 && <div className="sb-label">Today</div>}
      {todayLines.map(line => ('task' in line ? taskLine(line.task) : 'in' in line.event
        ? eventLine(line.event.item, line.event.key, line.event.title, <>
          <span className="t num">{line.event.time}</span> · <span className={line.event.urgency ? `in num ${line.event.urgency}` : 'in num'}>{line.event.in}</span>
        </>, true)
        : null))}
      {tomorrowLines.length > 0 && <div className="sb-label tomorrow">Tomorrow</div>}
      {tomorrowLines.map(line => ('task' in line ? taskLine(line.task) : eventLine(line.event.item, line.event.key, line.event.title, <span className="t num">{line.event.time}</span>)))}
      {more && (
        <button className="today-row today-more" type="button" onClick={() => setAll(true)}>
          <span className="ring-space" />
          <span className="ell">{more}</span>
        </button>
      )}
      {opened && (
        <TodayCard item={opened} calendar={calendars?.find(calendar => calendar.id === opened.calendar_id)} timeZone={zone}
          actions={actionsFor(opened)} onClose={() => setOpenKey(null)} onEdit={() => navigate(itemRoute(opened, true))} />
      )}
    </div>
  );
}

/** The card for a Today line: 8 px right of the sidebar, its title level with the line. */
function TodayCard(props: Omit<ItemCardProps, 'line' | 'lines' | 'at' | 'className'>) {
  return (
    <ItemCard {...props} className="today-card" line={`.sb .today-row[data-key="${CSS.escape(props.item.key)}"]`} lines=".sb .today-row"
      at={(line, host) => ({left: rectIn(host.querySelector('.sb')!, host).width + 8, top: line.top - 12})} />
  );
}

