// The phone's full-screen sheet: it slides up over the page (the reader and the tab bar too), with a
// top bar of Cancel or Back, its title and an optional action, and whatever it holds under it
// (the composer, the editor, Alfred, an attachment's preview). One is open at a time. Cancel, Back
// and Esc close it at once, as Settings closes.
import {useEffect, useRef} from 'react';
import type {ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {Icon} from '../../ui/Icon.tsx';
import {useFocusReturn} from '../../ui/focusReturn.ts';
import {keyboardUp} from './keyboard.ts';

export interface SheetAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/** A field's first line, with its padding. */
const LINE = 48;

/**
 * Keeps the sheet on the part of the screen the user sees. On the iPhone the keyboard covers the
 * page rather than shrinking it, and Safari slides the page up to show the caret, which takes the
 * sheet's bar off the top and leaves its foot (the format row) under the keys. So the sheet takes
 * the visual viewport's top and height as they change; inside it its own scroller moves instead.
 * With the keyboard up the home indicator's inset goes too (`data-keyboard`), so nothing gaps above
 * the keys. The caret, put out of sight by the sheet shrinking, is brought back into it. Its ground
 * covers the rest of the screen.
 */
function followViewport(element: HTMLElement, viewport: VisualViewport) {
  const follow = () => {
    const shrank = viewport.height < element.offsetHeight;
    element.style.setProperty('--sheet-top', `${viewport.offsetTop}px`);
    element.style.setProperty('--sheet-height', `${viewport.height}px`);
    element.toggleAttribute('data-keyboard', keyboardUp(viewport));
    if (shrank) revealCaret(element);
  };
  follow();
  viewport.addEventListener('resize', follow);
  viewport.addEventListener('scroll', follow);
  return () => {
    viewport.removeEventListener('resize', follow);
    viewport.removeEventListener('scroll', follow);
  };
}

/** Scrolls what holds the focused field so its caret shows, clear of a bar held at its foot. */
function revealCaret(element: HTMLElement) {
  const focused = document.activeElement;
  if (!(focused instanceof HTMLElement) || !element.contains(focused)) return;
  const selection = document.getSelection();
  const range = focused.isContentEditable && selection?.rangeCount ? selection.getRangeAt(0) : null;
  // A caret on an empty line has no box of its own: the field's first line stands in for it.
  const field = focused.getBoundingClientRect();
  const caret = range?.getClientRects()[0] ?? {top: field.top, bottom: Math.min(field.bottom, field.top + LINE)};
  let scroller = focused.parentElement;
  while (scroller && scroller !== element && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement;
  if (!scroller || scroller === element) return;
  const box = scroller.getBoundingClientRect();
  const foot = parseFloat(getComputedStyle(scroller).scrollPaddingBottom) || 0;
  const below = caret.bottom - (box.bottom - foot);
  if (below > 0) scroller.scrollTop += below;
  else if (caret.top < box.top) scroller.scrollTop -= box.top - caret.top;
}

/**
 * A full-screen sheet. `back` names where it goes back to ("Inbox") and shows Back in Cancel's place,
 * for a sheet pushed from another. `action` is the top bar's one solid button (Send, Save). `onCancel`,
 * when given, is Cancel's own tap (the composer asks what to do with its draft); Esc still closes.
 */
export function Sheet({title, onClose, onCancel, back, action, children}: {
  title: string;
  onClose: () => void;
  onCancel?: () => void;
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
    // It takes the focus, unless a field in it already has (one that opens ready to type).
    if (!sheet.current?.contains(document.activeElement)) sheet.current?.focus({preventScroll: true});
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      latest.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    const element = sheet.current;
    const viewport = window.visualViewport;
    if (!element || !viewport) return;
    return followViewport(element, viewport);
  }, []);
  return createPortal(
    <div ref={sheet} className="ph-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}>
      {/* The page's ground beyond the sheet, above and below it, past the whole screen: what Safari
          shows around the part the user sees (under its form bar and the keys, or while the page
          and the sheet move out of step) is the sheet's, never the page under it. It rides the
          sheet's slide in. */}
      <div className="ph-sheet-ground" aria-hidden="true" />
      <header className="ph-sheet-top">
        {back === undefined
          ? <button className="btn quiet ph-sheet-lead" type="button" onClick={onCancel ?? onClose}>Cancel</button>
          : <button className="btn quiet ph-sheet-lead ph-back" type="button" onClick={onClose}><Icon name="chevron_left" size={20} />{back}</button>}
        <h2 className="ph-sheet-title ell">{title}</h2>
        {action && <button className="btn ph-sheet-act" type="button" disabled={action.disabled} onClick={action.onClick}>{action.label}</button>}
      </header>
      <div className="ph-sheet-body">{children}</div>
    </div>,
    document.body,
  );
}
