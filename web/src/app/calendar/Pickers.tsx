// The fields the editor and the proposal card share (SV-25, D54), each typeable: Project, with its
// menu of Todoist's projects and New project; the date, with a month to pick from; a time, with its
// list in 15-minute steps. Each draws in its host's `.field` and `.menu` styles. The mini month is
// the sidebar's too.
import type {TodoistColour} from '@setpoint/shared';
import {TODOIST_COLOURS} from '@setpoint/shared';
import {useEffect, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode} from 'react';
import {addMonths, miniMonth, monthOf, rangePick} from '../../logic/calendar.ts';
import {clockLabel} from '../../logic/compose.ts';
import {addDays, daysBetween, monthName} from '../../logic/format.ts';
import {projectMenu} from '../../logic/search.ts';
import {Icon} from '../../ui/Icon.tsx';
import {placeMenu} from '../../ui/popover.ts';
import './pickers.css';

type ProjectChoice = ReturnType<typeof projectMenu>[number];

/** A Todoist project as its pickers know it: its colour, when Todoist gave one Setpoint knows. */
export interface ProjectOption {
  name: string;
  colour?: TodoistColour | null;
}

/** A project's dot in its own colour (SV-29), as a calendar's in the Calendar menu, clamped per theme as its tasks' rings (#175). */
export const ProjectDot = ({colour}: {colour: TodoistColour | null | undefined}) =>
  <span className="dot sm todoist" style={{'--c': colour ? TODOIST_COLOURS[colour] : 'var(--ink3)'} as CSSProperties} />;

/**
 * A menu that keeps focus in its field: ↑/↓ move `cur`, a click picks; ↵ marks the one Enter picks,
 * and a check the project the field holds (polish audit calflows-08).
 */
export function ProjectMenu({choices, projects, cur, value = null, onPick}: {choices: ProjectChoice[]; projects: ProjectOption[]; cur: number; value?: string | null; onPick: (choice: ProjectChoice) => void}) {
  return (
    <div ref={placeMenu} className="pop menu" role="listbox" aria-label="Projects">
      {choices.map((choice, index) => (
        <div key={`${choice.isNew}:${choice.name}`} role="option" aria-selected={index === cur} aria-checked={!choice.isNew && choice.name.toLowerCase() === value?.trim().toLowerCase()}
          className={`menu-i${index === cur ? ' cur' : ''}`} onMouseDown={event => event.preventDefault()} onClick={() => onPick(choice)}>
          {choice.isNew ? <><Icon name="add" size={16} />New project “{choice.name}”</> : <><ProjectDot colour={projects.find(one => one.name === choice.name)?.colour} />{choice.name}</>}
          {index === cur && <span className="kbd">↵</span>}
          {!choice.isNew && choice.name.toLowerCase() === value?.trim().toLowerCase() && <Icon name="check" size={16} />}
        </div>
      ))}
    </div>
  );
}

/** The next `cur` for ↑ or ↓ in a list of `count`, or null for another key. */
export const stepCursor = (key: string, cur: number, count: number) =>
  (key === 'ArrowDown' || key === 'ArrowUp' ? (cur + (key === 'ArrowDown' ? 1 : -1) + count) % count : null);

/**
 * Project (SV-25): what's typed, its menu the projects holding it and New project for a name none
 * has; a picked new one shows tagged New and isn't offered again. `line` is the editor's line typing
 * a #project: the menu shows for it, moved by the line's keys.
 */
export function ProjectField({value, isNew, projects, placeholder, className = '', lead, line = null, noNew = false, onText, onPick}: {
  value: string;
  isNew: boolean;
  projects: ProjectOption[];
  placeholder: string;
  className?: string;
  lead?: ReactNode;
  line?: {cur: number} | null;
  // Editing a task: Todoist's projects only (a project is made only with a new task).
  noNew?: boolean;
  onText: (text: string) => void;
  onPick: (name: string, isNew: boolean) => void;
}) {
  const [open, setOpen] = useState<{cur: number} | null>(null);
  const choices = projectMenu(value, projects, isNew || noNew);
  const shown = line ?? open;
  const cur = Math.min(shown?.cur ?? 0, choices.length - 1);
  const pick = (choice: ProjectChoice) => {
    setOpen(null);
    onPick(choice.name, choice.isNew);
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (!open || !choices.length) return;
    const next = stepCursor(event.key, cur, choices.length);
    if (next !== null) setOpen({cur: next});
    else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) pick(choices[cur]!);
    else if (event.key === 'Escape') setOpen(null);
    else if (event.key === 'Tab' && !event.shiftKey) {
      // Tab picks too (SV-29), and goes on to the next field.
      pick(choices[cur]!);
      return;
    } else return;
    event.preventDefault();
    event.stopPropagation();
  };
  return (
    <span className="menu-host menu-anchor">
      <label className={`field ${className}`}>
        {lead ?? <ProjectDot colour={projects.find(one => one.name.toLowerCase() === (value.trim() || placeholder).toLowerCase())?.colour} />}
        <input className="grow" aria-label="Project" placeholder={placeholder} value={value} autoComplete="off" onKeyDown={onKeyDown}
          onFocus={() => setOpen({cur: Math.max(0, choices.findIndex(choice => choice.name.toLowerCase() === value.trim().toLowerCase()))})}
          onBlur={() => setOpen(null)}
          onChange={event => {
            onText(event.target.value);
            setOpen({cur: 0});
          }} />
        {isNew && <span className="tag">New</span>}
      </label>
      {shown && choices.length > 0 && <ProjectMenu choices={choices} projects={projects} cur={cur} value={value} onPick={pick} />}
    </span>
  );
}

// ---------- The date and times ----------

const HEADS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The mini month (DESIGN.md › Sidebar on Calendar): ‹ › step it, a day picks; `cursor` is the one
 * Enter picks. An event's Date shows its days as a band (`range`, SV-29), following the pointer; the
 * week view's shown week is one band too, and stepping slides the days in from the side they come
 * from (polish audit calpanes-05). The date picker marks its `value` most strongly (calflows-08).
 */
export function MiniMonth({month, today, value, cursor = null, range = null, week = null, headClass = '', onMonth, onPick, onHover}: {
  month: string;
  today: string;
  value: string | null;
  cursor?: string | null;
  range?: {from: string; to: string} | null;
  // The week view's shown week (its Sunday), marked as the selected day is.
  week?: string | null;
  headClass?: string;
  onMonth: (month: string) => void;
  onPick: (date: string) => void;
  onHover?: (date: string | null) => void;
}) {
  // A month after the last slides in from the right, one before it from the left; the first doesn't.
  const [stepped, setStepped] = useState<{month: string; dir: 'next' | 'prev' | undefined}>({month, dir: undefined});
  if (stepped.month !== month) setStepped({month, dir: month > stepped.month ? 'next' : 'prev'});
  return (
    <>
      <div className={`${headClass} mini-head`.trim()}>
        <span className="name">{monthName(`${month}-01`)}</span>
        <span className="step">
          <button type="button" className="ibtn sm" aria-label="Previous month" onClick={() => onMonth(addMonths(month, -1))}><Icon name="chevron_left" size={16} /></button>
          <button type="button" className="ibtn sm" aria-label="Next month" onClick={() => onMonth(addMonths(month, 1))}><Icon name="chevron_right" size={16} /></button>
        </span>
      </div>
      <div className="mini num" key={month} data-dir={stepped.dir} onMouseLeave={onHover && (() => onHover(null))}>
        {HEADS.map((head, index) => <span key={index} className="h">{head}</span>)}
        {miniMonth(month, today, value, range, week).flat().map(day => (
          <button key={day.date} type="button"
            className={[day.out && 'o', day.today && 't', day.selected && 'vis', day.date === value && !range && 'val', day.date === cursor && 'cur', day.inRange && 'in', day.rangeStart && 'rs', day.rangeEnd && 're',
              day.inWeek && 'wk', day.weekStart && 'ws', day.weekEnd && 'we'].filter(Boolean).join(' ') || undefined}
            aria-label={day.date} aria-current={day.today ? 'date' : undefined}
            onClick={() => onPick(day.date)} onMouseEnter={onHover && (() => onHover(day.date))}>
            {day.day}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * A picker field's keys, kept from its host's (a suggestion list of its own): ↑/↓ `step`, Enter
 * commits what's typed or picks the cursor, and Esc closes an open picker first.
 */
function pickerKeys(event: ReactKeyboardEvent, open: boolean, typed: boolean, step: (down: boolean) => void, commit: () => void, pickCursor: () => void, close: () => void) {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') step(event.key === 'ArrowDown');
  else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
    if (typed) commit();
    else if (open) pickCursor();
  } else if (event.key === 'Escape' && open) close();
  else return;
  event.preventDefault();
  event.stopPropagation();
}

/** An event's days in its Date field (SV-29): its last day, what typing reads, and a pick of both. */
export interface DateRange {
  to: string;
  read: (text: string) => {from: string; to: string | null} | null;
  onRange: (from: string, to: string) => void;
}

/**
 * A day field (SV-25): it takes typing, read when it's left or on Enter (what doesn't read goes
 * back), and focusing it opens the month under it until typing starts. ↑/↓ move a week, Enter
 * picks, Esc closes. With a `range` (an event's, SV-29) the month picks one end, then the other,
 * either side of it (#103), the days between a band that follows the pointer; a lone day typed
 * keeps the length.
 */
export function DateField({className, label, value, shown, placeholder, today, read, onValue, range, onClear}: {
  className: string;
  label: string;
  value: string | null;
  // The day as the field shows it ("Fri, Oct 9"), or the days ("Fri, Oct 23 – Sun, Oct 25").
  shown: string;
  placeholder?: string;
  today: string;
  read: (text: string) => string | null;
  onValue: (date: string) => void;
  range?: DateRange;
  // An × in the field takes the day off (SV-74: a new task's due date); none without it.
  onClear?: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  // The month shown, its cursor, and with a range which day the next pick is and the day pointed at.
  const [open, setOpen] = useState<{month: string; cursor: string; phase: 'start' | 'end'; hover: string | null} | null>(null);
  const at = (cursor: string) => ({month: monthOf(cursor), cursor, phase: 'start' as const, hover: null});
  const pick = (date: string) => {
    if (range && value !== null && open) {
      const next = rangePick(open.phase, value, date);
      range.onRange(next.from, next.to);
      if (!next.done) {
        setOpen({...open, cursor: date, phase: 'end'});
        return;
      }
    } else if (date !== value) onValue(date);
    setText(null);
    setOpen(null);
  };
  const commit = () => {
    if (text === null) return;
    setText(null);
    if (range && value !== null) {
      const days = range.read(text);
      if (days) range.onRange(days.from, days.to ?? addDays(days.from, daysBetween(value, range.to)));
      setOpen(null);
      return;
    }
    const found = read(text);
    if (found !== null) pick(found);
  };
  // While its other end is picked, the band runs from the first day to the day pointed at (or the
  // cursor), whichever side of it that is.
  const reach = open?.phase === 'end' ? open.hover ?? open.cursor : null;
  const band = range && value !== null ? (reach !== null ? {from: reach < value ? reach : value, to: reach < value ? value : reach} : {from: value, to: range.to}) : null;
  return (
    <span className="menu-host menu-anchor pick-date">
      <label className={`field ${className}`}>
        <input className="grow" aria-label={label} placeholder={placeholder} value={text ?? shown} autoComplete="off"
          onFocus={() => setOpen(at(value ?? today))} onClick={() => open || setOpen(at(value ?? today))}
          onBlur={() => {
            commit();
            setOpen(null);
          }}
          onChange={event => {
            // Typing closes the month, so it never covers what's under it (the card's Create).
            setText(event.target.value);
            setOpen(null);
          }}
          onKeyDown={event => pickerKeys(event, !!open, text !== null, down => {
            setText(null);
            const cursor = addDays(open?.cursor ?? value ?? today, down ? 7 : -7);
            setOpen({...(open ?? at(cursor)), month: monthOf(cursor), cursor, hover: null});
          }, commit, () => pick(open!.cursor), () => setOpen(null))} />
        {onClear && value !== null && (
          <button type="button" className="ibtn sm clear" aria-label={`Remove ${label.toLowerCase()}`} title="No date" onMouseDown={event => event.preventDefault()} onClick={() => {
            setText(null);
            setOpen(null);
            onClear();
          }}><Icon name="close" size={16} /></button>
        )}
      </label>
      {open && (
        // A press inside keeps the field's focus, so its blur doesn't close the month first.
        <div ref={placeMenu} className="pop menu datepop" role="dialog" aria-label={`${label}: pick ${range ? open.phase === 'end' ? 'the last day' : 'the first day' : 'a day'}`}
          onMouseDown={event => event.preventDefault()}>
          <MiniMonth month={open.month} today={today} value={value} cursor={open.cursor} range={band} onMonth={month => setOpen({...open, month})} onPick={pick}
            onHover={range ? hover => setOpen(current => current && {...current, hover}) : undefined} />
        </div>
      )}
    </span>
  );
}

/**
 * A time field (SV-25): it takes typing as `read` does ("3p", "930a"), and focusing it opens its list
 * (`choices`), scrolled to its value, until typing starts. ↑/↓ move, Enter picks, Esc closes.
 */
export function TimeField({className, label, value, blank, choices, read, onValue}: {
  className: string;
  label: string;
  value: number;
  // What the field reads in `ink3` in place of its time, as the Date field's "No date": SV-78's No end.
  blank?: string;
  choices: {minutes: number; label: string}[];
  read: (text: string) => number | null;
  onValue: (minutes: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  // The list's cursor while it's open.
  const [cur, setCur] = useState<number | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const opened = useRef(false);
  // The list scrolls to put the cursor in its middle when it opens, then keeps it in view.
  useEffect(() => {
    const box = list.current;
    const row = box?.children[cur ?? -1] as HTMLElement | undefined;
    if (!box || !row) {
      opened.current = false;
      return;
    }
    if (!opened.current) box.scrollTop = row.offsetTop - (box.clientHeight - row.offsetHeight) / 2;
    else if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
    else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
    opened.current = true;
  }, [cur]);
  const near = () => Math.max(0, choices.findLastIndex(choice => choice.minutes <= value));
  const pick = (minutes: number) => {
    setText(null);
    setCur(null);
    if (minutes !== value) onValue(minutes);
  };
  const commit = () => {
    if (text === null) return;
    const found = read(text);
    setText(null);
    if (found !== null) pick(found);
  };
  return (
    <span className="menu-host menu-anchor pick-time">
      <label className={`field ${className}`}>
        <input className="grow" aria-label={label} placeholder={blank} value={text ?? (blank ? '' : clockLabel(value))} autoComplete="off"
          onFocus={() => setCur(near())} onClick={() => cur === null && setCur(near())}
          onBlur={() => {
            commit();
            setCur(null);
          }}
          onChange={event => {
            setText(event.target.value);
            setCur(null);
          }}
          onKeyDown={event => pickerKeys(event, cur !== null, text !== null, () => {
            setText(null);
            setCur(cur === null ? near() : stepCursor(event.key, cur, choices.length));
          }, commit, () => pick(choices[cur!]!.minutes), () => setCur(null))} />
      </label>
      {cur !== null && (
        <div ref={element => {
          list.current = element;
          placeMenu(element);
        }} className="pop menu timelist" role="listbox" aria-label={`${label} times`} onMouseDown={event => event.preventDefault()}>
          {choices.map((choice, index) => (
            <div key={choice.minutes} role="option" aria-selected={index === cur} className={`menu-i num${index === cur ? ' cur' : ''}`} onClick={() => pick(choice.minutes)}>{choice.label}</div>
          ))}
        </div>
      )}
    </span>
  );
}
