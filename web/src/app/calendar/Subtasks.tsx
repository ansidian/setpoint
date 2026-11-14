// A task's subtasks as a checklist (SV-272, D558), in the floating detail and under the task's row in
// the day pane: each a ring that completes it alone, struck through once done, at .5 while Todoist
// hasn't confirmed. They sit a column in from the task, and that column holds each one's handle,
// shown under the pointer: dragging it reorders them, live as Settings' lists do (order.ts), and
// ↑ ↓ on it move the subtask a place. Without the actions (the phone) the rings are marks.
import type {ItemOut, SubtaskOut} from '@setpoint/shared';
import {useState} from 'react';
import type {CSSProperties} from 'react';
import {Icon, TaskGlyph} from '../../ui/Icon.tsx';
import {useLiveOrder} from '../settings/order.ts';

interface SubtasksProps {
  task: ItemOut;
  // The task's ring colour, which its subtasks' rings take.
  ring: CSSProperties | undefined;
  onComplete?: (subtask: SubtaskOut) => void;
  // Every subtask's id in the new order; settles once the server has it, or refused it.
  onReorder?: (task: ItemOut, ids: number[]) => Promise<unknown>;
}

export function Subtasks({task, ring, onComplete, onReorder}: SubtasksProps) {
  // The order just dropped, shown until the server's own arrives.
  const [dropped, setDropped] = useState<number[] | null>(null);
  const list = dropped?.length === task.subtasks.length && dropped.every(id => task.subtasks.some(subtask => subtask.id === id))
    ? dropped.map(id => task.subtasks.find(subtask => subtask.id === id)!) : task.subtasks;
  const save = (ids: number[]) => {
    if (!onReorder) return;
    setDropped(ids);
    void onReorder(task, ids).catch(() => undefined).finally(() => setDropped(null));
  };
  const order = useLiveOrder(list, 'text/x-setpoint-subtask', save, 'subtasks');
  const move = (index: number, delta: 1 | -1) => {
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    const ids = list.map(subtask => subtask.id);
    [ids[index], ids[to]] = [ids[to]!, ids[index]!];
    save(ids);
  };
  // One change to the task at a time: its subtasks wait while one is on its way.
  const movable = !!onReorder && list.length > 1 && !task.command;
  return (
    <div {...order.groupProps} role="group" aria-label="Subtasks">
      {list.map((subtask, index) => {
        const {dragging, ...drag} = order.rowProps(subtask, index);
        const glyph = subtask.done ? <TaskGlyph done size={13} /> : <span className="ring" style={ring}>{onComplete && <Icon name="check" size={11} />}</span>;
        return (
          <div key={subtask.id} className={`subtask${subtask.done ? ' done' : ''}${subtask.command?.state === 'pending' ? ' pending' : ''}${dragging ? ' dragging' : ''}`}
            draggable={movable} {...drag}>
            {movable ? (
              <button className="handle" type="button" aria-label={`Move ${subtask.title}`} data-tip="Drag to reorder" onKeyDown={event => {
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                move(index, event.key === 'ArrowUp' ? -1 : 1);
              }}><Icon name="drag_indicator" size={16} /></button>
            ) : <span className="handle" />}
            {onComplete ? (
              <button className="fd-mark check" type="button" aria-label={`${subtask.done ? 'Reopen' : 'Complete'} ${subtask.title}`} aria-disabled={!!subtask.command || undefined}
                data-tip={subtask.command ? 'Waiting for Todoist' : subtask.done ? 'Reopen' : 'Complete'}
                onClick={() => !subtask.command && onComplete(subtask)}>{glyph}</button>
            ) : <span className="fd-mark">{glyph}</span>}
            <span className="title">{subtask.title}</span>
          </div>
        );
      })}
    </div>
  );
}

/** "1/4": a task's subtasks done, of all of them. */
export const subtaskCount = (task: ItemOut) => `${task.subtasks.filter(subtask => subtask.done).length}/${task.subtasks.length}`;
