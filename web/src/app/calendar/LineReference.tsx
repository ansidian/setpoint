// SV-114 (D295): the small ? at the editor's line's trailing edge, and "What the line reads" it opens
// under it: one example of each kind of phrase and what it reads (shared/compose/reference.json, the
// iPhone's words too). The phrases should need no learning; this is the backup. Esc closes it and not
// the editor, focus going back to the ?; a press outside it, or focus leaving it, closes it too.
import {useEffect, useRef, useState} from 'react';
import {LINE_REFERENCE} from '../../logic/lineReference.ts';
import type {ReferenceRow} from '../../logic/lineReference.ts';
import {useMenuRef} from '../../ui/popover.ts';

const NAME = 'What the line reads';

/** An example as typed, its phrase kept as words (if any) underlined, as the note under it says. */
function Example({row}: {row: ReferenceRow}) {
  const at = row.plain ? row.example.indexOf(row.plain) : -1;
  if (at < 0) return <span className="lr-ex">{row.example}</span>;
  return (
    <span className="lr-ex">
      {row.example.slice(0, at)}<span className="lr-kept">{row.plain}</span>{row.example.slice(at + row.plain!.length)}
    </span>
  );
}

export function LineReference() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement | null>(null);
  const menuRef = useMenuRef(open, () => setOpen(false));
  // Opened, it takes focus, so Esc reaches it and a reader starts there.
  useEffect(() => {
    if (open) card.current?.focus();
  }, [open]);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <span className="line-ref"
      onKeyDown={event => {
        if (event.key !== 'Escape' || !open) return;
        // The editor's own Esc would close it: this one closes only the reference.
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
      onBlur={event => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}>
      <button ref={button} type="button" className="lr-q" aria-label={NAME} title={NAME} aria-haspopup="dialog" aria-expanded={open}
        // The press keeps focus where it is, so the card's blur doesn't close it before the click does.
        onMouseDown={event => event.preventDefault()}
        onClick={() => (open ? close() : setOpen(true))}>?</button>
      {open && (
        <div ref={element => {
          card.current = element;
          menuRef(element);
        }} className="pop right lr-pop" role="dialog" aria-label={NAME} tabIndex={-1}>
          <div className="lr-head">{NAME}</div>
          {LINE_REFERENCE.map(section => (
            <section key={section.title} className="lr-sec">
              <h3 className="lr-title">{section.title}</h3>
              {section.rows.some(row => row.plain) && <p className="lr-note">Click a lit phrase, or press ⌥⌫ inside it, and it stays words.</p>}
              <ul>
                {section.rows.map(row => (
                  <li key={row.example}>
                    <Example row={row} /><span className="lr-to" aria-hidden="true"> → </span><span className="lr-reads">{row.reads}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </span>
  );
}
