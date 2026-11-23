// A phone header's title as a menu: "Title ▾" opens a short menu under it (the Inbox's views, News's
// sections), each row with an optional count and the current one checked, apart by dividers. A
// choice closes it, as do Esc and a tap anywhere else, which the tap spends: it opens nothing under it.
import {useEffect, useRef, useState} from 'react';
import {Icon} from '../../ui/Icon.tsx';
import {placeMenu} from '../../ui/popover.ts';

export type TitleMenuRow = {label: string; count?: number; checked?: boolean; onChoose: () => void} | 'divider';

/** The header's title (`hd-title`) and its menu of `rows`. */
export function TitleMenu({title, rows}: {title: string; rows: TitleMenuRow[]}) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      button.current?.focus({preventScroll: true});
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="hd-title ph-title">
      {/* The page's heading, as the plain title is. */}
      <h1 className="ph-title-h">
        <button ref={button} className="ph-title-btn" type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="ell">{title}</span><Icon name="expand_more" size={18} />
        </button>
      </h1>
      {open && (
        <>
          <div className="ph-title-catch" onClick={() => setOpen(false)} />
          <div ref={placeMenu} className="pop menu ph-title-pop" role="menu" aria-label={title}>
            {rows.map((row, index) => (row === 'divider'
              ? <div key={`divider-${index}`} className="menu-sep" role="separator" />
              : (
                <button key={row.label} className="menu-i" type="button" role="menuitemradio" aria-checked={row.checked ?? false} onClick={() => {
                  setOpen(false);
                  row.onChoose();
                }}>
                  <span className="ell">{row.label}</span>
                  {row.count !== undefined && <span className="ph-title-count num">{row.count}</span>}
                  <Icon name="check" size={16} className="ph-title-check" />
                </button>
              )))}
          </div>
        </>
      )}
    </div>
  );
}
