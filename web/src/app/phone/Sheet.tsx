// The phone's full-screen sheet: it slides up over the page (the reader and the tab bar too), with a
// top bar of Cancel or Back, its title and an optional action, and whatever it holds under it
// (the composer, the editor, Alfred, an attachment's preview). One is open at a time. Cancel, Back
// and Esc close it at once, as Settings closes.
import {useEffect, useRef} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '../../ui/Icon.tsx';
import {useFocusReturn} from '../../ui/focusReturn.ts';

export interface SheetAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * A full-screen sheet. `back` names where it goes back to ("Inbox") and shows Back in Cancel's place,
 * for a sheet pushed from another. `action` is the top bar's one solid button (Send, Save).
 */
export function Sheet({title, onClose, back, action, children}: {
  title: string;
  onClose: () => void;
  back?: string;
  action?: SheetAction;
  children?: ReactNode;
}) {
  const sheet = useRef<HTMLDivElement>(null);
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  useFocusReturn();
  useEffect(() => {
    sheet.current?.focus({preventScroll: true});
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return createPortal(
    <div ref={sheet} className="ph-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      <header className="ph-sheet-top">
        {back === undefined
          ? <button className="btn quiet ph-sheet-lead" type="button" onClick={onClose}>Cancel</button>
          : <button className="btn quiet ph-sheet-lead ph-back" type="button" onClick={onClose}><Icon name="chevron_left" size={20} />{back}</button>}
        <h2 className="ph-sheet-title ell">{title}</h2>
        {action && <button className="btn ph-sheet-act" type="button" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>}
      </header>
      <div className="ph-sheet-body">{children}</div>
    </div>,
    document.body,
  );
}
