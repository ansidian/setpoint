// The phone's Find in email (from the reader's More), at the top of the reader where Back and Pin
// were: the field "Search <subject>", the count, ↑ and ↓ to step, and Done, which ends it (the phone
// has no Esc). Its buttons keep the keys in the field. The rules are find.ts's.
import {useEffect, useRef} from 'react';
import type {KeyboardEvent, SyntheticEvent} from 'react';
import {findCount, findLabel} from '../../logic/find.ts';
import {Icon} from '../../ui/Icon.tsx';
import {closeFind, setFindFocused, setFindText, stepFindBy, useFind} from './find.ts';

const keepKeys = (event: SyntheticEvent) => event.preventDefault();

export function FindBar() {
  const find = useFind();
  const input = useRef<HTMLInputElement>(null);
  // It opens with the keys, and takes them again on each ⌘F from a hardware keyboard.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [find.focus]);
  if (!find.open) return null;
  const label = findLabel(find.open.subject);
  const counted = findCount(find.current, find.total, find.text);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      stepFindBy(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeFind();
    }
  };
  return (
    <div className="ph-top ph-finding">
      <label className="search finding">
        <span className="glass"><Icon name="search" size={16} /></span>
        <input ref={input} className="grow" placeholder={label} aria-label={label} value={find.text} enterKeyHint="search"
          onChange={event => setFindText(event.target.value)} onKeyDown={onKeyDown} onFocus={() => setFindFocused(true)} onBlur={() => setFindFocused(false)} />
        {counted && <span className={find.total ? 'find-count num' : 'find-count none'} aria-live="polite">{counted}</span>}
      </label>
      <button className="ibtn ph-icon" type="button" aria-label="Previous match" disabled={!find.total} onMouseDown={keepKeys} onClick={() => stepFindBy(-1)}><Icon name="keyboard_arrow_up" size={20} /></button>
      <button className="ibtn ph-icon" type="button" aria-label="Next match" disabled={!find.total} onMouseDown={keepKeys} onClick={() => stepFindBy(1)}><Icon name="keyboard_arrow_down" size={20} /></button>
      <button className="btn quiet ph-text" type="button" onClick={() => {
        closeFind();
        setFindFocused(false);
      }}>Done</button>
    </div>
  );
}
