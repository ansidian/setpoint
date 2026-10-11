// An item on the grid and in the "+N" popover (DESIGN.md › Month grid): an event as a tinted chip
// in its colour (its own, else its calendar's: "7 AM Gym"), solid when selected, grey when past (#124); a
// task with its ring or done glyph. A change waiting for its provider shows at .5 with a spinner, and
// a failed one outlined in `alert` with an error glyph (board 19b). A task's ring takes its Todoist
// project's colour (SV-25, D54). While dragged, or while a drop
// waits on its scope, the item's own place shows a dashed ghost (boards 15 and 15b), as a new draft
// does (board 13). A click selects it (⌘, Ctrl or ⇧ adds it to the selection) and hands over the
// chip's box for the floating detail; a press starts a drag (MonthGrid).
import type {CalendarOut, ItemOut, TodoistProjectOut} from '@setpoint/shared';
import {TODOIST_COLOURS} from '@setpoint/shared';
import type {CSSProperties, MouseEvent, PointerEvent} from 'react';
import {useResource} from '../../api/client.ts';
import {TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {chipTime, isPast} from '../../logic/calendar.ts';
import {Icon, TaskGlyph} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';

/** How the grid draws an item besides its own state. */
export type ChipLook = 'ghost' | 'faded';

export interface ChipProps {
  item: ItemOut;
  calendar: CalendarOut | undefined;
  selected: boolean;
  look?: ChipLook;
  now: number;
  timeZone: string;
  onSelect: (item: ItemOut, chip: HTMLElement, additive: boolean) => void;
  onPress?: (item: ItemOut, event: PointerEvent<HTMLElement>) => void;
  // The week view's all-day row: a timed task's time before its title, and what it reads to assistive tech.
  time?: string | null;
  label?: string;
}

/** A task ring's style by its project's name: Todoist's colour as `--ring`, or none (the ring's own). */
export function useRingColour(): (project: string | null) => CSSProperties | undefined {
  const {data: projects} = useResource<TodoistProjectOut[]>(TODOIST_PROJECTS_PATH);
  return project => {
    const colour = project === null ? null : projects?.find(one => one.name === project)?.colour;
    return colour ? {'--ring': TODOIST_COLOURS[colour]} as CSSProperties : undefined;
  };
}

const Spinner = () => <span className="spin" aria-label="Saving"><Icon name="progress_activity" size={14} /></span>;

export function Chip({item, calendar, selected, look, now, timeZone, onSelect, onPress, time: shownTime, label}: ChipProps) {
  const ring = useRingColour();
  const onClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onSelect(item, event.currentTarget, event.metaKey || event.ctrlKey || event.shiftKey);
  };
  const onPointerDown = onPress ? (event: PointerEvent<HTMLElement>) => onPress(item, event) : undefined;
  const pending = item.command?.state === 'pending';
  const failed = item.command?.state === 'failed';
  const state = pending ? ' pending' : failed ? ' failed' : '';
  const ghost = look ? ` ghost${look === 'faded' ? ' faded' : ''}` : '';
  if (item.kind === 'task') {
    return (
      <div className={`tk${item.done ? ' done' : ''}${selected ? ' sel' : ''}${state}${ghost}`} role="button" data-key={item.key} title={item.title} aria-label={label} onClick={onClick} onPointerDown={onPointerDown}>
        {failed ? <Icon name="error" size={14} /> : item.done ? <TaskGlyph done size={12} /> : <span className="ring" style={ring(item.project)} />}
        {shownTime && <span className="t">{shownTime}</span>}
        {item.title}
        {pending && <Spinner />}
      </div>
    );
  }
  const time = shownTime === undefined ? chipTime(item, timeZone) : shownTime;
  return (
    <div className={`ev${selected && !look ? ' sel' : ''}${isPast(item, now, timeZone) && !look && !selected ? ' past' : ''}${state}${ghost}`} role="button" data-key={item.key} title={item.title} aria-label={label}
      style={{'--c': colourVar(item.colour ?? calendar?.colour ?? 'cool')} as CSSProperties} onClick={onClick} onPointerDown={onPointerDown}>
      {failed && <Icon name="error" size={14} />}
      {time && <span className="t">{time}</span>}
      {item.title}
      {pending && <Spinner />}
    </div>
  );
}
