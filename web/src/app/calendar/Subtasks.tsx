// A task's subtasks as a checklist, in the floating detail and under the task's row in the day
// pane. Each is a ring that completes it alone, struck through once done, at .5 while Todoist hasn't
// confirmed. They sit a column in from the task, and that column holds each one's handle, shown
// under the pointer. Dragging it reorders them, live as Settings' lists do (order.ts), and ↑ ↓ on it
// move the subtask a place. A check Todoist refused stays in place, as every failed change does. The
// row says so in `alert`, with Todoist's words as its tip, and Try again and Undo. Without the
// actions (the phone) the rings are marks.
//
// A dated subtask's date follows its title in `ink3`, with the bell when it has reminders. Its
// title opens it in the editor, and a right-click opens its menu. A change Todoist can't take for
// now shows `warning` in `caution` in its ring's place, why as its tip ("Todoist is down (scheduled
// maintenance) as of 7:26 PM"), while it waits to try again. The last row adds one:
// "Add subtask", a field in place once clicked. Enter adds what's typed at the end, at .5 until the
// server has it, and the field clears for the next. Esc, or leaving it empty, puts the row back.
// Leaving it with text adds that first.
import type {ItemOut, SubtaskOut} from '@setpoint/shared';
import {useEffect, useRef, useState} from 'react';
import type {CSSProperties, MouseEvent as ReactMouseEvent} from 'react';
import {Burst} from '../../ui/Burst.tsx';
import {Icon, TaskGlyph} from '../../ui/Icon.tsx';
import {useJustDone} from './done.ts';
import {subtaskDue} from '../../logic/calendar.ts';
import {retryingLine} from '../../logic/providerWords.ts';
import {localDate} from '../../logic/format.ts';
import {useNow} from '../clock.ts';
import {useLiveOrder} from '../settings/order.ts';
import {refusalWords} from '../../logic/providerWords.ts';

interface SubtasksProps {
  task: ItemOut;
  // The task's ring colour, which its subtasks' rings take.
  ring: CSSProperties | undefined;
  timeZone: string;
  onComplete?: (subtask: SubtaskOut) => void;
  // A failed check's Try again, or its Undo (Move back).
  onSettle?: (subtask: SubtaskOut, how: 'retry' | 'move-back') => void;
  // Every subtask's id in the new order. It settles once the server has it, or refused it.
  onReorder?: (task: ItemOut, ids: number[]) => Promise<unknown>;
  // A new subtask at the end. It settles once the server has it, or refused it.
  onAdd?: (task: ItemOut, title: string) => Promise<unknown>;
  // The subtask in the editor, and its right-click menu.
  onOpen?: (subtask: SubtaskOut) => void;
  onMenu?: (event: ReactMouseEvent<HTMLElement>, subtask: SubtaskOut) => void;
}

export function Subtasks({task, ring, timeZone, onComplete, onSettle, onReorder, onAdd, onOpen, onMenu}: SubtasksProps) {
  // The order just dropped, shown until the server's own arrives.
  const [dropped, setDropped] = useState<number[] | null>(null);
  // Subtasks just added, drawn at .5 until the server's list has them.
  const [added, setAdded] = useState<{id: number; title: string}[]>([]);
  const addSeq = useRef(0);
  const list = dropped?.length === task.subtasks.length && dropped.every(id => task.subtasks.some(subtask => subtask.id === id))
    ? dropped.map(id => task.subtasks.find(subtask => subtask.id === id)!) : task.subtasks;
  const save = (ids: number[]) => {
    if (!onReorder) return;
    setDropped(ids);
    void onReorder(task, ids).catch(() => undefined).finally(() => setDropped(null));
  };
  const order = useLiveOrder(list, 'text/x-setpoint-subtask', save, 'subtasks');
  // A subtask ticked off here plays the completion moment.
  const justDone = useJustDone(task.subtasks.map(subtask => ({key: String(subtask.id), done: subtask.done})));
  const move = (index: number, delta: 1 | -1) => {
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    const ids = list.map(subtask => subtask.id);
    [ids[index], ids[to]] = [ids[to]!, ids[index]!];
    save(ids);
  };
  const add = (title: string) => {
    if (!onAdd) return;
    const id = ++addSeq.current;
    setAdded(rows => [...rows, {id, title}]);
    void onAdd(task, title).catch(() => undefined).finally(() => setAdded(rows => rows.filter(row => row.id !== id)));
  };
  // One change to the task at a time: its subtasks wait while one is on its way.
  const movable = !!onReorder && list.length > 1 && !task.command && !added.length;
  const today = localDate(useNow(), timeZone);
  return (
    <div {...order.groupProps} role="group" aria-label="Subtasks">
      {list.map((subtask, index) => {
        const {dragging, ...drag} = order.rowProps(subtask, index);
        const played = justDone.has(String(subtask.id));
        const glyph = <>
          {subtask.done ? <TaskGlyph done size={13} /> : <span className="ring" style={ring}>{onComplete && <Icon name="check" size={11} />}</span>}
          {played && <Burst style={ring} />}
        </>;
        const failed = subtask.command?.state === 'failed';
        const retrying = retryingLine(subtask.command, timeZone);
        const due = subtaskDue(subtask, today, timeZone);
        const title = <><span className="done-tx">{subtask.title}</span>{due && <Due text={due} bell={subtask.reminders.length > 0} />}</>;
        return (
          <div key={subtask.id} className={`subtask${subtask.done ? ' done' : ''}${played ? ' just-done' : ''}${subtask.command?.state === 'pending' ? ' pending' : ''}${failed ? ' failed' : ''}${dragging ? ' dragging' : ''}`}
            draggable={movable} {...drag} data-subtask={subtask.id}
            onContextMenu={onMenu && (event => {
              event.stopPropagation();
              onMenu(event, subtask);
            })}>
            {movable ? (
              <button className="handle" type="button" aria-label={`Move ${subtask.title}`} data-tip="Drag to reorder" onKeyDown={event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                move(index, event.key === 'ArrowUp' ? -1 : 1);
              }}><Icon name="drag_indicator" size={16} /></button>
            ) : <span className="handle" />}
            {failed ? (
              <span className="fd-mark" role="img" aria-label="Failed" data-tip={refusalWords('todoist', subtask.command!.provider_message, 'It didn’t reach Todoist.')}><Icon name="error" size={15} /></span>
            ) : retrying ? (
              <span className="fd-mark retrying" role="img" aria-label={retrying} data-tip={retrying}><Icon name="warning" size={15} /></span>
            ) : onComplete ? (
              <button className="fd-mark check" type="button" aria-label={`${subtask.done ? 'Reopen' : 'Complete'} ${subtask.title}`} aria-disabled={!!subtask.command || undefined}
                data-tip={subtask.command ? 'Waiting for Todoist' : subtask.done ? 'Reopen' : 'Complete'}
                onClick={() => !subtask.command && onComplete(subtask)}>{glyph}</button>
            ) : <span className="fd-mark">{glyph}</span>}
            {/* One element whatever its change's state, so a change confirmed mid-moment doesn't start it over. */}
            {onOpen
              ? <button className="title" type="button" aria-label={`Edit ${subtask.title}`} disabled={!!subtask.command} onClick={() => onOpen(subtask)}>{title}</button>
              : <span className="title">{title}</span>}
            {failed && onSettle && (
              <span className="acts">
                {subtask.command!.can_retry && <button className="ibtn sm" type="button" aria-label={`Try again: ${subtask.title}`} data-tip="Try again" onClick={() => onSettle(subtask, 'retry')}><Icon name="refresh" size={15} /></button>}
                {subtask.command!.can_move_back && <button className="ibtn sm" type="button" aria-label={`Undo: ${subtask.title}`} data-tip="Undo" onClick={() => onSettle(subtask, 'move-back')}><Icon name="undo" size={15} /></button>}
              </span>
            )}
          </div>
        );
      })}
      {added.map(row => (
        <div key={`added-${row.id}`} className="subtask pending">
          <span className="handle" />
          <span className="fd-mark"><span className="ring" style={ring} /></span>
          <span className="title">{row.title}</span>
        </div>
      ))}
      {onAdd && <AddSubtask onAdd={add} />}
    </div>
  );
}

function Due({text, bell}: {text: string; bell: boolean}) {
  return <span className="due ink3 num">{text}{bell && <Icon name="notifications" size={12} />}</span>;
}

/** The checklist's last row: "Add subtask", a field in its place while adding. */
function AddSubtask({onAdd}: {onAdd: (title: string) => void}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  // What's typed, for the card closing on it: it's added, as leaving the field would.
  const typed = useRef('');
  const added = useRef(onAdd);
  useEffect(() => {
    added.current = onAdd;
  }, [onAdd]);
  useEffect(() => () => {
    if (typed.current.trim()) added.current(typed.current.trim());
  }, []);
  const close = () => {
    typed.current = '';
    setText('');
    setEditing(false);
  };
  if (!editing) {
    return (
      <button className="subtask add" type="button" onClick={() => setEditing(true)}>
        <span className="handle" />
        <span className="fd-mark"><Icon name="add" size={15} /></span>
        <span className="title">Add subtask</span>
      </button>
    );
  }
  return (
    <div className="subtask add editing">
      <span className="handle" />
      <span className="fd-mark"><Icon name="add" size={15} /></span>
      <input className="title" autoFocus aria-label="New subtask" placeholder="Add subtask" value={text} maxLength={500}
        onChange={event => {
          typed.current = event.target.value;
          setText(event.target.value);
        }}
        onKeyDown={event => {
          if (event.key === 'Escape') {
            // Esc puts the row back. The card stays.
            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
            close();
          } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (!text.trim()) close();
            else {
              onAdd(text.trim());
              typed.current = '';
              setText('');
            }
          }
        }}
        onBlur={() => {
          // `typed`, not `text`: Esc has already emptied it when the field goes.
          if (typed.current.trim()) onAdd(typed.current.trim());
          close();
        }} />
    </div>
  );
}

/** "1/4": a task's subtasks done, of all of them. */
export const subtaskCount = (task: ItemOut) => `${task.subtasks.filter(subtask => subtask.done).length}/${task.subtasks.length}`;
