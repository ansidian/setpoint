// A menu hanging under its button opens upward instead when it would run past the bottom of what
// clips or scrolls it (Settings' page, the editor's pane) and there's more room above.
// It lines up with its anchor's right edge when it would run past the right (the End list).
import {useCallback, useEffect, useRef} from 'react';
import type {RefObject} from 'react';
import {opensUp} from '../logic/contextMenu.ts';

/** The area `element` can show in: its clipping ancestors' and the viewport's. */
function room(element: HTMLElement): {top: number; bottom: number; right: number} {
  let top = 0;
  let bottom = window.innerHeight;
  let right = window.innerWidth;
  for (let at = element.parentElement; at; at = at.parentElement) {
    const style = getComputedStyle(at);
    if (style.overflowY === 'visible' && style.overflowX === 'visible') continue;
    const rect = at.getBoundingClientRect();
    top = Math.max(top, rect.top);
    bottom = Math.min(bottom, rect.bottom);
    right = Math.min(right, rect.right);
  }
  return {top, bottom, right};
}

// Menus already placed. An inline ref runs again on every draw, and placing again replays the
// entrance, so a menu open while its page draws (the editor's line on a hover) flickered.
const placed = new WeakSet<HTMLElement>();

/**
 * A menu's ref: on opening, it's marked `data-up` when it fits better above its anchor (its parent),
 * and `data-right` when it would run past the right, to line up with the anchor's right edge.
 */
export function placeMenu(menu: HTMLElement | null) {
  if (!menu?.parentElement || placed.has(menu)) return;
  placed.add(menu);
  // Measured as it will rest, not as its entrance starts it (smaller and higher). The entrance then
  // starts from the side it opens to.
  menu.style.animation = 'none';
  const rect = menu.getBoundingClientRect();
  menu.style.removeProperty('animation');
  const {top, bottom, right} = room(menu);
  const anchor = menu.parentElement.getBoundingClientRect();
  if (rect.right > right) menu.dataset.right = '';
  if (opensUp(rect.bottom, anchor, {top, bottom})) menu.dataset.up = '';
}

/**
 * An open menu's ref, as `placeMenu`, that also closes it on a press outside it and the button that
 * opens it (their shared parent), so a menu never needs its own pick or Esc to go away.
 */
export function useMenuRef(open: unknown, close: () => void): (menu: HTMLElement | null) => void {
  const menu = useRef<HTMLElement | null>(null);
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      const anchor = menu.current?.parentElement;
      if (anchor && !anchor.contains(event.target as Node)) latest.current();
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return useCallback((element: HTMLElement | null) => {
    menu.current = element;
    placeMenu(element);
  }, []);
}

/**
 * Calls `close` on a click or a tap outside `box` while `open`, never on a blur. It waits for the
 * click, not the press, so what was pressed gets it before `box` goes and moves what's under it,
 * and it counts only a click whose press came while `box` was open, so the click that opens it
 * (focusing a field) doesn't close it again.
 */
export function useOutsideClick(box: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  const latest = useRef(close);
  useEffect(() => {
    latest.current = close;
  });
  useEffect(() => {
    if (!open) return;
    let pressed = false;
    const outside = (event: Event) => !!box.current && !box.current.contains(event.target as Node);
    const press = (event: PointerEvent) => {
      pressed = outside(event);
    };
    const away = (event: MouseEvent) => {
      if (pressed && outside(event)) latest.current();
      pressed = false;
    };
    document.addEventListener('pointerdown', press);
    document.addEventListener('click', away);
    return () => {
      document.removeEventListener('pointerdown', press);
      document.removeEventListener('click', away);
    };
  }, [box, open]);
}
