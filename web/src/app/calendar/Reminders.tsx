// The editor's Reminders row (DESIGN.md › Editor; darma SV-109, D287–D289): a chip for each, a
// preset in its words ("10 min before") and any other as the moment it goes off with the offset
// quiet beside it, and Add reminder's menu of presets with Custom… last. Custom… opens a date and a
// time under the row, the moment picked kept as its offset from the item's moment so it moves with
// the item; past 4 weeks either side it's refused, saying why. A custom chip reopens it at its
// moment. A task with no date has no Custom…, and says reminders need one.
import {useEffect, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, ReactNode} from 'react';
import {dayTitle} from '../../logic/calendar.ts';
import {parseClock, parseDay, timeChoices} from '../../logic/compose.ts';
import {localDate, instantAt, minutesOf} from '../../logic/format.ts';
import {customProblem, inOrder, offsetAt, relativeLine, REMINDER_MAX, REMINDER_PRESETS, reminderMoment, reminderWords} from '../../logic/reminders.ts';
import {Icon} from '../../ui/Icon.tsx';
import {DateField, TimeField} from './Pickers.tsx';

export interface RemindersRowProps {
  reminders: number[];
  // The instant (ms) they count from; null for a task with no date.
  anchor: number | null;
  // What Custom… counts from, said for a task without a time ("Counts from 9:00 AM").
  countsFrom: string | null;
  timeZone: string;
  today: string;
  menuOpen: boolean;
  menuRef: (menu: HTMLElement | null) => void;
  onMenu: (open: boolean) => void;
  onChange: (reminders: number[]) => void;
  // Time to Leave's chip and its menu item, an event's (SV-31).
  chips?: ReactNode;
  // The glyph's class: the line's reminder tint when the line set some (SV-112).
  glyph?: string;
  menuItems?: ReactNode;
}

/** The moment being picked, and the reminder it replaces (null for a new one). */
interface Picking {
  replaces: number | null;
  date: string;
  minutes: number;
}

export function RemindersRow({reminders, anchor, countsFrom, timeZone, today, menuOpen, menuRef, onMenu, onChange, chips, menuItems, glyph}: RemindersRowProps) {
  const [picking, setPicking] = useState<Picking | null>(null);
  const dateField = useRef<HTMLDivElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  // Closed, focus goes back to Add reminder (or the editor, with no room for more), so ⌘Enter and Esc keep working.
  const close = () => {
    (addButton.current ?? dateField.current?.closest<HTMLElement>('form'))?.focus();
    setPicking(null);
  };
  const openAt = (replaces: number | null) => {
    if (anchor === null) return;
    const moment = reminderMoment(anchor, replaces ?? 0);
    setPicking({replaces, date: localDate(moment, timeZone), minutes: minutesOf(moment, timeZone)});
  };
  // Opened, the date takes focus, so Esc and typing go to the picker.
  const opened = picking !== null;
  useEffect(() => {
    if (opened) dateField.current?.querySelector('input')?.focus();
  }, [opened]);

  const offset = picking && anchor !== null ? offsetAt(anchor, Date.parse(instantAt(picking.date, picking.minutes, timeZone))) : null;
  const problem = offset === null ? null : customProblem(offset);
  const commit = () => {
    if (!picking || offset === null || problem) return;
    onChange(inOrder([...reminders.filter(one => one !== picking.replaces), offset]));
    close();
  };
  const onKeyDown = (event: ReactKeyboardEvent) => {
    // The fields' own lists take Esc first; then it closes the picker, not the editor.
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.defaultPrevented && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      commit();
    }
  };

  return (
    <>
      <Icon name="notifications" size={17} className={glyph} />
      <div className="prow reminders">
        {inOrder(reminders).map(minutes => {
          const words = reminderWords(minutes, anchor, timeZone);
          return (
            <span key={minutes} className={`qchip${words.custom ? ' custom' : ''}`}>
              {words.custom && anchor !== null ? (
                <button type="button" className="qchip-open num" aria-label={`Change reminder ${words.text}, ${words.quiet}`} onClick={() => openAt(minutes)}>
                  {words.text}<span className="ink3">{words.quiet}</span>
                </button>
              ) : <span className="num">{words.text}</span>}
              <button type="button" className="x" aria-label="Remove reminder" onClick={() => {
                if (picking?.replaces === minutes) setPicking(null);
                onChange(reminders.filter(one => one !== minutes));
              }}><Icon name="close" size={14} /></button>
            </span>
          );
        })}
        {chips}
        {anchor === null && <span className="ink3 none">Reminders need a date</span>}
        {reminders.length < REMINDER_MAX && (
          <span className="menu-host">
            <button ref={addButton} type="button" className="ibtn sm" aria-label="Add reminder" aria-expanded={menuOpen} onClick={() => onMenu(!menuOpen)}><Icon name="add" size={16} /></button>
            {menuOpen && (
              <div ref={menuRef} className="pop menu" role="menu">
                {REMINDER_PRESETS.filter(minutes => !reminders.includes(minutes)).map(minutes => (
                  <button key={minutes} type="button" role="menuitem" className="menu-i" onClick={() => {
                    onChange(inOrder([...reminders, minutes]));
                    onMenu(false);
                  }}>{reminderWords(minutes, anchor, timeZone).text}</button>
                ))}
                {menuItems}
                {anchor !== null && (
                  <button type="button" role="menuitem" className="menu-i" onClick={() => {
                    openAt(null);
                    onMenu(false);
                  }}>Custom…{countsFrom && <span className="ink3">{countsFrom}</span>}</button>
                )}
              </div>
            )}
          </span>
        )}
      </div>
      {picking && (
        <>
          <span />
          <div className="prow custom-reminder" role="group" aria-label="Custom reminder" onKeyDown={onKeyDown}>
            <div ref={dateField} className="custom-date">
              <DateField className="date" label="Reminder date" value={picking.date} shown={dayTitle(picking.date)} today={today}
                read={text => parseDay(text, today)} onValue={date => setPicking({...picking, date})} />
            </div>
            <TimeField className="time num" label="Reminder time" value={picking.minutes} choices={timeChoices()}
              read={text => parseClock(text, picking.minutes)} onValue={minutes => setPicking({...picking, minutes})} />
            <button type="button" className="btn sm" disabled={!!problem} onClick={commit}>{picking.replaces === null ? 'Add' : 'Done'}</button>
            <button type="button" className="ibtn sm" aria-label="Cancel custom reminder" title="Cancel · Esc" onClick={close}><Icon name="close" size={16} /></button>
          </div>
          <span />
          {/* How far the moment is from the item's, and what that counts from; or why it can't be. */}
          <span className={`field-note num${problem ? ' alert' : ' ink3'}`} role={problem ? 'alert' : undefined}>
            {problem ?? [offset !== null ? relativeLine(offset) : null, countsFrom].filter(Boolean).join(' · ')}
          </span>
        </>
      )}
    </>
  );
}
