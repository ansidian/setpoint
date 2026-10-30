// The title, or the company, edited in place (DESIGN.md › Corrections; board 35a).
import {useEffect, useRef, useState} from 'react';

/**
 * A field in place (35a): the text swapped for a field on the same baseline, focused with its words
 * selected. Enter saves (an empty or unchanged one changes nothing) and Esc cancels, both at once;
 * leaving it cancels too.
 */
export function EditField({label, value, small = false, onSave, onCancel}: {label: string; value: string; small?: boolean; onSave: (value: string) => void; onCancel: () => void}) {
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(value);
  const done = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = text.trim();
    if (save && next && next !== value) onSave(next);
    else onCancel();
  };
  return (
    <label className={small ? 'jb-edit sm' : 'jb-edit'}>
      <input ref={input} aria-label={label} value={text} maxLength={small ? 200 : 300} onChange={event => setText(event.target.value)}
        onBlur={() => finish(false)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
            finish(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            finish(false);
          }
        }} />
    </label>
  );
}
