// The phone's bottom sheet: a short list of choices rising from the bottom over a scrim (snooze's
// times, the month picker). A tap outside, Esc or a drag down far enough (logic/sheet.ts) closes it;
// a shorter drag settles it back. A choice runs and closes the sheet. It sits over the full-screen
// sheet, under the toast.
import {createContext, useContext, useEffect, useRef} from 'react';
import type {PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent, ReactNode} from 'react';
import {createPortal} from 'react-dom';
import {dragCloses} from '../../logic/sheet.ts';
import {Icon} from '../../ui/Icon.tsx';
import type {IconName} from '../../ui/glyphs.ts';
import {useFocusReturn} from '../../ui/focusReturn.ts';

const Close = createContext<() => void>(() => {});
// A press that moves this far down is a drag, not a tap on a choice.
const SLOP = 6;

/** A bottom sheet under its `title`, holding its choices (`SheetChoice`) or a panel of its own. */
export function BottomSheet({title, onClose, children}: {title: string; onClose: () => void; children?: ReactNode}) {
  const sheet = useRef<HTMLDivElement>(null);
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  const drag = useRef<{id: number; from: number; by: number; moved: boolean} | null>(null);
  // A drag ends in a click on what it started on: that click isn't a choice.
  const dragged = useRef(false);
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

  const follow = (by: number, settling: boolean) => {
    const element = sheet.current;
    if (!element) return;
    element.style.transition = settling ? 'transform var(--dur-medium) var(--ease)' : 'none';
    element.style.transform = by > 0 ? `translateY(${by}px)` : '';
  };
  const down = (event: ReactPointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    dragged.current = false;
    drag.current = {id: event.pointerId, from: event.clientY, by: 0, moved: false};
  };
  const move = (event: ReactPointerEvent) => {
    const at = drag.current;
    if (!at || at.id !== event.pointerId) return;
    at.by = Math.max(0, event.clientY - at.from);
    if (!at.moved && at.by < SLOP) return;
    if (!at.moved) {
      at.moved = true;
      // A pointer that's already gone can't be captured; the drag goes on without it.
      try {
        sheet.current?.setPointerCapture(event.pointerId);
      } catch {
        // Nothing to hold on to: the moves still reach the sheet while the press stays on it.
      }
    }
    follow(at.by, false);
  };
  const up = (event: ReactPointerEvent) => {
    const at = drag.current;
    if (!at || at.id !== event.pointerId) return;
    drag.current = null;
    if (!at.moved) return;
    dragged.current = true;
    if (dragCloses(at.by, sheet.current?.offsetHeight ?? 0)) latest.current();
    else follow(0, true);
  };
  const cancel = () => {
    if (drag.current?.moved) follow(0, true);
    drag.current = null;
  };
  const swallow = (event: ReactMouseEvent) => {
    if (!dragged.current) return;
    dragged.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return createPortal(
    <>
      <div className="ph-bs-scrim" onClick={onClose} />
      <div ref={sheet} className="ph-bs" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onClickCapture={swallow}>
        <div className="ph-bs-grab" aria-hidden="true" />
        <h2 className="ph-bs-title">{title}</h2>
        <Close.Provider value={onClose}>{children}</Close.Provider>
      </div>
    </>,
    document.body,
  );
}

/** One of a bottom sheet's choices: its glyph, its words and what it says on the right (a time). Choosing it closes the sheet. */
export function SheetChoice({icon, label, detail, onChoose}: {icon?: IconName; label: string; detail?: string; onChoose: () => void}) {
  const close = useContext(Close);
  return (
    <button className="ph-bs-i" type="button" onClick={() => {
      onChoose();
      close();
    }}>
      {icon && <Icon name={icon} />}
      <span className="ell">{label}</span>
      {detail && <span className="ph-bs-detail">{detail}</span>}
    </button>
  );
}
