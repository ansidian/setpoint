// A menu hanging under its button opens upward instead when it would run past the bottom of what
// clips or scrolls it (Settings' page, the editor's pane) and there's more room above (darma SV-21),
// and lines up with its anchor's right edge when it would run past the right (SV-29: the End list).
import {useCallback, useEffect, useRef} from 'react';

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

/**
 * A menu's ref: on opening, it's marked `data-up` when it fits better above its anchor (its parent),
 * and `data-right` when it would run past the right, to line up with the anchor's right edge.
 */
export function placeMenu(menu: HTMLElement | null) {
  if (!menu?.parentElement) return;
  // Measured as it will rest, not as its entrance starts it (smaller and higher); the entrance then
  // starts from the side it opens to.
  menu.style.animation = 'none';
  const rect = menu.getBoundingClientRect();
  menu.style.removeProperty('animation');
  const {top, bottom, right} = room(menu);
  const anchor = menu.parentElement.getBoundingClientRect();
  if (rect.right > right) menu.dataset.right = '';
  if (rect.bottom > bottom && anchor.top - top > bottom - anchor.bottom) menu.dataset.up = '';
}

/**
 * An open menu's ref, as `placeMenu`, that also closes it on a press outside it and the button that
 * opens it (their shared parent), so a menu never needs its own pick or Esc to go away (SV-24).
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
