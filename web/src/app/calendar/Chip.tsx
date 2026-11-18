// An item on the grid and in the "+N" popover. An event is a tinted chip in its colour (its own,
// else its calendar's: "7 AM Gym"), solid when selected, grey when past. A task has its ring or done
// glyph. A change waiting for its provider shows at .5 with a spinner, and a failed one is outlined
// in `alert` with an error glyph (board 19b). A task's ring takes its Todoist project's colour.
// While dragged, or while a drop waits on its scope, the item's own place shows a dashed ghost
// (boards 15 and 15b), as a new draft does (board 13). A click selects it (⌘, Ctrl or ⇧ adds it to
// the selection) and hands over the chip's box for the floating detail. A press starts a drag
// (MonthGrid). A task's ring, or its done check, completes or reopens it: the chip's full height
// over its first 20 px, never selecting or dragging. Chips have no tab stop, so it's the pointer's
// alone and stays out of the chip's name; the keyboard completes from the menu and the card.
import type {CalendarOut, ItemOut, TodoistProjectOut} from '@setpoint/shared';
import {TODOIST_COLOURS} from '@setpoint/shared';
import type {CSSProperties, MouseEvent, PointerEvent} from 'react';
import {useResource} from '../../api/client.ts';
import {TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {chipTime, isPast} from '../../logic/calendar.ts';
import {Icon, TaskGlyph} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';
import {useLanding} from './landing.ts';
import {Saving} from './Saving.tsx';
import {subtaskCount} from './Subtasks.tsx';
import {useCalendarFade, useSearchDim} from './view.ts';

/**
 * How the grid draws an item besides its own state: a ghost (a draft, a drag's origin), faded (a drop
 * waiting on its scope), or folding away as it's deleted and back as Undo restores it.
 */
export type ChipLook = 'ghost' | 'faded' | 'removing' | 'restoring';

/** A look that draws the item as a dashed ghost. */
export const ghostly = (look: ChipLook | undefined) => look === 'ghost' || look === 'faded';

export interface ChipProps {
  item: ItemOut;
  calendar: CalendarOut | undefined;
  selected: boolean;
  look?: ChipLook;
  now: number;
  timeZone: string;
  onSelect: (item: ItemOut, chip: HTMLElement, additive: boolean) => void;
  onPress?: (item: ItemOut, event: PointerEvent<HTMLElement>) => void;
  // A task's ring completes it, or reopens a done one (CalendarPage's `complete`).
  onComplete?: (task: ItemOut) => void;
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


export function Chip({item, calendar, selected, look, now, timeZone, onSelect, onPress, onComplete, time: shownTime, label}: ChipProps) {
  const ring = useRingColour();
  // A calendar just toggled fades its items out or in.
  const fade = useCalendarFade()(item.calendar_id);
  // An event's change arriving brightens its tint once.
  const landing = useLanding<HTMLDivElement>(item);
  // What a calendar search doesn't match dims.
  const dim = useSearchDim()(item.id);
  const onClick = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    onSelect(item, event.currentTarget, event.metaKey || event.ctrlKey || event.shiftKey);
  };
  const onPointerDown = onPress ? (event: PointerEvent<HTMLElement>) => onPress(item, event) : undefined;
  const pending = item.command?.state === 'pending';
  const failed = item.command?.state === 'failed';
  const state = `${pending ? ' pending' : failed ? ' failed' : ''}${fade ? ` ${fade}` : ''}${dim ? ' unmatched' : ''}`;
  const ghost = ghostly(look) ? ` ghost${look === 'faded' ? ' faded' : ''}` : look ? ` ${look}` : '';
  const plain = !ghostly(look);
  if (item.kind === 'task') {
    // A task with subtasks ends in their count, done of all. Its title gives way to it.
    const counted = item.subtasks.length > 0;
    // A timed task shows its time after its ring, as an event does ("9 AM"); the week's all-day row passes its own.
    const taskShown = shownTime === undefined ? chipTime(item, timeZone) : shownTime;
    const toggle = onComplete && !item.read_only && !item.command && (!item.done || item.can_reopen) ? onComplete : undefined;
    return (
      <div className={`tk${counted ? ' counted' : ''}${item.done ? ' done' : ''}${selected ? ' sel' : ''}${state}${ghost}`} role="button" data-key={item.key} data-tip={item.title} aria-label={label} onClick={onClick} onPointerDown={onPointerDown}>
        {failed ? <Icon name="error" size={14} /> : (
          // A read-only task, one with a change in flight, or a done one that can't reopen takes no
          // click here: its ring selects and drags as the rest of the chip does.
          <span className={`check${toggle ? '' : ' off'}`} aria-hidden="true" onPointerDown={toggle ? event => event.stopPropagation() : undefined}
            onClick={toggle ? event => {
              event.stopPropagation();
              toggle(item);
            } : undefined}>
            {item.done ? <TaskGlyph done size={12} /> : <span className="ring" style={ring(item.project)}><Icon name="check" size={10} /></span>}
          </span>
        )}
        {taskShown && <span className="t">{taskShown}</span>}
        {counted ? <span className="title">{item.title}</span> : item.title}
        {counted && <span className="count num"><Icon name="subtask" size={12} />{subtaskCount(item)}</span>}
        {pending && <Saving command={item.command} timeZone={timeZone} size={14} />}
      </div>
    );
  }
  const time = shownTime === undefined ? chipTime(item, timeZone) : shownTime;
  return (
    <div ref={landing} className={`ev${selected && plain ? ' sel' : ''}${isPast(item, now, timeZone) && plain && !selected ? ' past' : ''}${state}${ghost}`} role="button" data-key={item.key} data-tip={item.title} aria-label={label}
      style={{'--c': colourVar(item.colour ?? calendar?.colour ?? 'cool')} as CSSProperties} onClick={onClick} onPointerDown={onPointerDown}>
      {failed && <Icon name="error" size={14} />}
      {time && <span className="t">{time}</span>}
      {item.title}
      {pending && <Saving command={item.command} timeZone={timeZone} size={14} />}
    </div>
  );
}
