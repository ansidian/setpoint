// An email's Snooze: a button with the `snooze` glyph and its menu (logic/snooze.ts): Tomorrow,
// Next weekday when it isn't tomorrow, each with its moment in `ink3`, and Pick a date and time.
// Pick turns the menu into its own panel: a month to pick the day from (days gone by can't be
// picked), then a time field, which takes the focus as a day is picked. The time is read as it's
// typed: the field ends in how it reads ("2:00 PM") or why it can't ("Add AM or PM", in `alert`),
// and the panel's last line says the whole moment by Snooze, which waits until there is one. Enter
// in the field snoozes, Esc goes back to the choices. A pick hands the moment (ms) to `onPick`.
// The button is a row's (an icon under the pointer, in the age's place) or the reader's tool. On a
// snoozed email the menu opens with its return in `ink3` (`title`), the choices change its time, and
// Unsnooze ends the list (`onUnsnooze`). The
// menu takes its own clicks and keys: ↑ ↓ move, Esc closes it, and a press outside closes it too,
// in the email's body as well (the window loses focus to its frame). A keyed menu (the reader's, the
// selection pane's, the cursor row's) also opens from S and ⌘K's Snooze, through `openSnooze`, as a
// click opens it, and S closes it again.
import type {Settings} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, ReactNode, SyntheticEvent} from 'react';
import {serverNow, timeZone} from '../api/auth.ts';
import {useResource} from '../api/client.ts';
import {SETTINGS_PATH} from '../api/items.ts';
import {addMonths, miniMonth, monthOf} from '../logic/calendar.ts';
import {localDate, monthName} from '../logic/format.ts';
import {pickOutcome, pickStart, readPickTime, snoozeOptions} from '../logic/snooze.ts';
import {Icon} from '../ui/Icon.tsx';
import {placeMenu} from '../ui/popover.ts';

const keep = (event: SyntheticEvent) => event.stopPropagation();
const HEADS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Which keyed menu S opens: the open email's, the selection's or the cursor row's. */
export type SnoozeTarget = 'reader' | 'selection' | 'row';
const openers = new Map<SnoozeTarget, () => void>();

/** Opens that keyed menu, its first choice focused, or closes it when it's open. False when no such menu is on screen. */
export function openSnooze(target: SnoozeTarget): boolean {
  const open = openers.get(target);
  open?.();
  return open !== undefined;
}

/**
 * Snooze's button and menu. `button` draws the button from whether the menu is open and what opens it.
 * `onOpen` hears the menu open and close, for a row to hold its pointer look meanwhile.
 */
export function SnoozeMenu({button, keyed, onPick, onOpen, onUnsnooze, title}: {
  button: (open: boolean, toggle: () => void) => ReactNode;
  keyed?: SnoozeTarget;
  onPick: (until: number) => void;
  onOpen?: (open: boolean) => void;
  onUnsnooze?: () => void;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  // The row hears it in the same change, so its button shows as the menu takes the focus.
  const set = (next: boolean) => {
    setOpen(next);
    onOpen?.(next);
  };
  // A key's toggle, current from the moment each render is drawn.
  const latest = useRef(() => {});
  useLayoutEffect(() => {
    latest.current = () => set(!open);
  });
  useLayoutEffect(() => {
    if (!keyed) return;
    const opener = () => latest.current();
    openers.set(keyed, opener);
    return () => {
      if (openers.get(keyed) === opener) openers.delete(keyed);
    };
  }, [keyed]);
  return (
    <span className="menu-anchor snooze-menu" onClick={keep} onMouseDown={keep} onDoubleClick={keep} onContextMenu={keep}>
      {button(open, () => set(!open))}
      {open && <Menu onClose={() => set(false)} onPick={until => {
        set(false);
        onPick(until);
      }} title={title} onUnsnooze={onUnsnooze && (() => {
        set(false);
        onUnsnooze();
      })} />}
    </span>
  );
}

function Menu({onClose, onPick, onUnsnooze, title}: {onClose: () => void; onPick: (until: number) => void; onUnsnooze?: () => void; title?: string}) {
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const taskTime = settings?.reminders.task_time ?? null;
  const zone = timeZone();
  const now = serverNow();
  const options = snoozeOptions(now, taskTime, zone);
  const [picking, setPicking] = useState(false);
  const menu = useRef<HTMLDivElement | null>(null);
  const latest = useRef(onClose);
  useLayoutEffect(() => {
    latest.current = onClose;
  });
  // Listening from the moment it's on screen, so nothing that closes it can come first.
  useLayoutEffect(() => {
    const away = (event: PointerEvent) => !menu.current?.parentElement?.contains(event.target as Node) && latest.current();
    // A click in the email's body goes to its frame: the window loses focus instead.
    const blur = () => latest.current();
    document.addEventListener('pointerdown', away);
    window.addEventListener('blur', blur);
    return () => {
      document.removeEventListener('pointerdown', away);
      window.removeEventListener('blur', blur);
    };
  }, []);
  // Opened, and back from Pick, the first choice takes the focus.
  useEffect(() => {
    if (!picking) menu.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [picking]);
  const onKeyDown = (event: ReactKeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      if (picking) setPicking(false);
      else onClose();
      return;
    }
    // S, which opened it, closes it again. In Pick's panel it's typed into the time.
    if (!picking && event.key.toLowerCase() === 's' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      onClose();
      return;
    }
    if (picking || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
    event.preventDefault();
    const items = [...menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []];
    const at = items.indexOf(document.activeElement as HTMLElement);
    items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  };
  const ref = (element: HTMLDivElement | null) => {
    menu.current = element;
    placeMenu(element);
  };
  if (picking) {
    return (
      <div ref={ref} className="pop snooze-pick" role="dialog" aria-label="Snooze until" onKeyDown={onKeyDown}>
        <Pick start={pickStart(now, taskTime, zone)} now={now} timeZone={zone} onBack={() => setPicking(false)} onPick={onPick} />
      </div>
    );
  }
  return (
    <div ref={ref} className="pop menu snooze-list" role="menu" aria-label="Snooze" onKeyDown={onKeyDown}>
      {title && <div className="snz-now">{title}</div>}
      {options.map(option => (
        <button key={option.choice} type="button" role="menuitem" className="menu-i"
          onClick={() => (option.until === null ? setPicking(true) : onPick(option.until))}>
          <span className="grow">{option.label}{option.choice === 'pick' ? '…' : ''}</span>
          {option.when && <span className="ink3 num">{option.when}</span>}
        </button>
      ))}
      {onUnsnooze && (
        <button type="button" role="menuitem" className="menu-i" onClick={onUnsnooze}>
          <span className="grow">Unsnooze</span>
        </button>
      )}
    </div>
  );
}

/** Pick's panel: the month, the time as typed and how it reads, and the moment by Snooze. */
function Pick({start, now, timeZone, onBack, onPick}: {
  start: {date: string; text: string};
  now: number;
  timeZone: string;
  onBack: () => void;
  onPick: (until: number) => void;
}) {
  const today = localDate(now, timeZone);
  const [date, setDate] = useState(start.date);
  const [month, setMonth] = useState(monthOf(start.date));
  const [text, setText] = useState(start.text);
  const time = useRef<HTMLInputElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  const read = readPickTime(text);
  const outcome = pickOutcome(date, text, now, timeZone);
  // The chosen day has the focus as it opens, so the arrows and Enter can work the month.
  useEffect(() => {
    grid.current?.querySelector<HTMLElement>('.val')?.focus();
  }, []);
  const pickDay = (day: string) => {
    setDate(day);
    if (monthOf(day) !== month) setMonth(monthOf(day));
    // On to the time, its words selected so typing replaces them.
    time.current?.focus();
    time.current?.select();
  };
  const snooze = () => {
    if ('until' in outcome) onPick(outcome.until);
  };
  return (
    <>
      <div className="snz-head">
        <button type="button" className="ibtn sm" aria-label="Back to the choices" data-tip="Back · Esc" onClick={onBack}><Icon name="chevron_left" size={16} /></button>
        <span className="snz-title">Pick a date and time</span>
      </div>
      <div className="snz-month">
        <div className="snz-month-head">
          <span className="name">{monthName(`${month}-01`)}</span>
          <span className="grow" />
          <button type="button" className="ibtn sm" aria-label="Previous month" disabled={month <= monthOf(today)} onClick={() => setMonth(addMonths(month, -1))}><Icon name="chevron_left" size={16} /></button>
          <button type="button" className="ibtn sm" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))}><Icon name="chevron_right" size={16} /></button>
        </div>
        <div ref={grid} className="snz-days num">
          {HEADS.map((head, index) => <span key={index} className="h">{head}</span>)}
          {miniMonth(month, today, date).flat().map(day => (
            <button key={day.date} type="button" disabled={day.date < today}
              className={[day.out && 'o', day.today && 't', day.date === date && 'val'].filter(Boolean).join(' ') || undefined}
              aria-label={day.date} aria-pressed={day.date === date} aria-current={day.today ? 'date' : undefined}
              onClick={() => pickDay(day.date)}>
              {day.day}
            </button>
          ))}
        </div>
      </div>
      <label className={'problem' in read ? 'snz-time problem' : 'snz-time'}>
        <Icon name="schedule" size={16} />
        <input ref={time} className="grow" aria-label="Snooze time" value={text} autoComplete="off" spellCheck={false}
          aria-invalid={'problem' in read} aria-describedby="snz-read"
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              snooze();
            }
          }} />
        {/* How the typed time reads, as it's typed. */}
        <span id="snz-read" className="snz-read num" aria-live="polite">{'problem' in read ? read.problem : read.label === text.trim() ? '' : read.label}</span>
      </label>
      <div className="snz-foot">
        <span className={'problem' in outcome ? 'snz-when alert' : 'snz-when num'}>
          {'problem' in outcome ? ('problem' in read ? 'No time yet' : outcome.problem) : outcome.line}
        </span>
        <button type="button" className="btn sm" disabled={!('until' in outcome)} onClick={snooze}>Snooze<span className="kbd">↵</span></button>
      </div>
    </>
  );
}
