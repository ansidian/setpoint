// The sidebar's Today block on mail pages (DESIGN.md › The Today block, Decided while building #78):
// "2:30 PM  Dentist  in 5h", then the open tasks due today and tomorrow by name ("Tomorrow" at the
// right of tomorrow's), the first two and "3 more due tomorrow" when there are more than three.
// A line opens the floating detail's card beside the sidebar instead of leaving the page: Edit (E)
// goes to Calendar's editor, a task completes there or from its ring, an item that isn't a repeating
// event deletes, and Open in Calendar shows it there. Esc, the close button or a click elsewhere
// closes it; it follows a click on another line. A completed task shows its done check for a moment,
// then its line folds away as the mail list's rows do (app/fold.ts), and Undo folds it back.
import type {CalendarOut, ItemOut, ItemsOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties, MouseEvent} from 'react';
import {createPortal} from 'react-dom';
import {timeZone} from '../api/auth.ts';
import {useResource} from '../api/client.ts';
import {CALENDARS_PATH, completeItem, deleteItem, itemsPath} from '../api/items.ts';
import type {Entry, FoldRules} from '../logic/fold.ts';
import {localDate} from '../logic/format.ts';
import type {Route} from '../logic/route.ts';
import {routePath} from '../logic/route.ts';
import {DONE_MOMENT_MS, shownTasks, todayBlock, todayRange} from '../logic/today.ts';
import type {TodayTask} from '../logic/today.ts';
import {TaskGlyph} from '../ui/Icon.tsx';
import {isTyping, plainKey} from '../ui/keys.ts';
import {useRingColour} from './calendar/Chip.tsx';
import {DetailContent} from './calendar/detail/DetailContent.tsx';
import type {DetailActions} from './calendar/detail/DetailContent.tsx';
import './calendar/detail/detail.css';
import {rectIn} from './calendar/geometry.ts';
import {useNow} from './clock.ts';
import {foldIn, foldOut, useFold} from './fold.ts';
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

// Every line that goes folds out, and one that comes back (Undo, a refused change) folds in.
const FOLDS: FoldRules<TaskLine> = {folds: () => true, arrives: () => true};

export function TodayBlock() {
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
  const tasks = useMemo(() => {
    const listed: TaskLine[] = today.tasks.filter(task => !ticked.has(task.item.key)).map(task => ({...task, done: false}));
    for (const {line, at} of [...ticked.values()].sort((a, b) => a.at - b.at)) listed.splice(Math.min(at, listed.length), 0, {...line, done: true});
    return listed;
  }, [today, ticked]);
  const {shown, more} = useMemo(() => shownTasks(tasks, all), [tasks, all]);
  const entries = useMemo(() => shown.map((line): Entry<TaskLine> => ({key: line.item.key, id: line.item.id, item: line})), [shown]);
  const folded = useFold(entries, FOLDS);
  const lines = [...(today.event ? [today.event.item] : []), ...today.tasks.map(task => task.item)];
  const opened = lines.find(item => item.key === openKey) ?? null;

  if (!data || (!today.event && !folded.length)) return null;

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
   * Completes a task: its line shows the done check for a moment, then folds away, with Undo; a
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
      .then(() => showToast(`Completed ${task.title}`, task.recurring ? null : {
        label: 'Undo',
        run: () => void completeItem(task.id, false).catch(toastFailure(`Couldn't reopen ${task.title}`)),
      }))
      .catch(toastFailure(`Couldn't complete ${task.title}`))
      .finally(() => unhide(task));
  };

  const remove = (item: ItemOut) => {
    hide(item);
    void deleteItem(item.id, {occurrence_start: item.occurrence_start})
      .then(() => showToast(`Deleted ${item.title}`))
      .catch(toastFailure(`Couldn't delete ${item.title}`))
      .finally(() => unhide(item));
  };

  const actionsFor = (item: ItemOut): DetailActions => ({
    complete,
    open: one => navigate(itemRoute(one)),
    // A repeating event asks which of its events go; Calendar asks that.
    ...(item.kind === 'event' && item.recurring ? {} : {remove}),
  });

  const toggle = (item: ItemOut) => (event: MouseEvent) => {
    if (follows(event)) return;
    event.preventDefault();
    setOpenKey(key => (key === item.key ? null : item.key));
  };
  const lineClass = (item: ItemOut) => (item.key === openKey ? 'today-row on' : 'today-row');

  return (
    <div className="sb-sec today">
      <div className="sb-label">Today</div>
      {today.event && (
        <a className={lineClass(today.event.item)} data-key={today.event.key} href={routePath(itemRoute(today.event.item))} onClick={toggle(today.event.item)}
          aria-haspopup="dialog" aria-expanded={openKey === today.event.key}>
          <span className="t num">{today.event.time}</span>
          <span className="ell title">{today.event.title}</span>
          <span className="in num">{today.event.in}</span>
        </a>
      )}
      {folded.map(({key, item: {item, title, label, done}, fold}) => {
        // A line folding away keeps its look, without its key or the pointer.
        const leaving = fold === 'out';
        const classes = [lineClass(item), done && 'completing', leaving && 'leaving'].filter(Boolean).join(' ');
        return (
          <a key={key} ref={leaving ? foldOut : fold === 'in' ? foldIn : undefined} className={classes} data-key={leaving ? undefined : item.key}
            href={routePath(itemRoute(item))} onClick={toggle(item)} aria-haspopup="dialog" aria-expanded={openKey === item.key} aria-hidden={leaving || undefined}>
            <button className="check" type="button" aria-label={`Complete ${title}`} title="Complete"
              onClick={event => {
                event.preventDefault();
                event.stopPropagation();
                complete(item);
              }}>
              {done ? <TaskGlyph done size={13} /> : <span className="ring" style={ring(item.project)} />}
            </button>
            <span className="ell title" title={title}>{title}</span>
            {label && <span className="in">{label}</span>}
          </a>
        );
      })}
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

interface TodayCardProps {
  item: ItemOut;
  calendar: CalendarOut | undefined;
  timeZone: string;
  actions: DetailActions;
  onClose: () => void;
  onEdit: () => void;
}

/**
 * The floating detail's card for a Today line, 8 px right of the sidebar with its title level with
 * the line, kept on screen; drawn over the page, in the shell, as the sidebar clips.
 */
function TodayCard({item, calendar, timeZone, actions, onClose, onEdit}: TodayCardProps) {
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{left: number; top: number} | null>(null);
  // Once it's been drawn in place, it moves to another line's rather than jumping.
  const [settled, setSettled] = useState(false);
  const host = document.querySelector<HTMLElement>('.app');

  const measure = () => {
    const line = document.querySelector(`.sb .today-row[data-key="${CSS.escape(item.key)}"]`);
    const sidebar = document.querySelector('.sb');
    if (!host || !line || !sidebar || !card.current) return;
    const at = rectIn(line, host);
    const top = Math.max(12, Math.min(at.top - 12, host.offsetHeight - 12 - card.current.offsetHeight));
    const left = rectIn(sidebar, host).width + 8;
    setPlace(current => (current && current.left === left && current.top === top ? current : {left, top}));
  };
  // Every render, and as the window changes size.
  const placed = useRef(measure);
  useLayoutEffect(() => {
    placed.current = measure;
    measure();
  });
  useEffect(() => {
    if (!place || settled) return;
    const frame = requestAnimationFrame(() => setSettled(true));
    return () => cancelAnimationFrame(frame);
  }, [place, settled]);
  useEffect(() => {
    const onResize = () => placed.current();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Esc closes it; E edits and Delete deletes, before the Inbox's own E (Trash) and Esc see them.
  const latest = useRef({item, actions, onClose, onEdit});
  useEffect(() => {
    latest.current = {item, actions, onClose, onEdit};
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event)) return;
      const {item: shownItem, actions: offered, onClose: close, onEdit: edit} = latest.current;
      const take = (run: () => void) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        run();
      };
      if (plainKey(event, 'Escape')) take(close);
      else if (plainKey(event, 'e') && !shownItem.read_only) take(edit);
      else if ((plainKey(event, 'Delete') || plainKey(event, 'Backspace')) && offered.remove && !shownItem.read_only) take(() => offered.remove!(shownItem));
    };
    const onDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (card.current?.contains(target) || target?.closest('.sb .today-row')) return;
      latest.current.onClose();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown);
    };
  }, []);

  if (!host) return null;
  return createPortal(
    <div ref={card} className={settled ? 'fd today-card settled' : 'fd today-card'} role="dialog" aria-label={item.title}
      style={(place ? {left: place.left, top: place.top} : {left: 0, top: 0, visibility: 'hidden'}) as CSSProperties}>
      <div className="card float">
        <DetailContent target={{item, date: dayOf(item, timeZone), calendar}} timeZone={timeZone} actions={actions} onClose={onClose} onEdit={onEdit} />
      </div>
    </div>,
    host,
  );
}

const dayOf = (item: ItemOut, timeZone: string) => item.due_date ?? item.start_date ?? (item.starts_at ? localDate(item.starts_at, timeZone) : '');
