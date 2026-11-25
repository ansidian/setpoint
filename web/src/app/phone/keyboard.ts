// The phone's shell and the keyboard. On the iPhone the keyboard covers the page rather than
// shortening it (Safari has no interactive-widget=resizes-content), so the lists would run on behind
// the keys and a toast would rise under them. While it's up the root says so (`data-keyboard`) and
// carries the part of the screen the user sees (`--vv-height`): phone.css ends the shell there and
// lets the tab bar give way. When it goes, a page Safari slid up to show a field comes back to the top.
// The full-screen sheet follows the same viewport itself (Sheet.tsx), measured the same way.
import {useEffect} from 'react';

/** Past this much of the screen covered, what covers it is the keyboard. */
export const KEYBOARD = 120;

/** Whether the keyboard covers part of the screen, the visual viewport that much shorter than the layout's. */
export const keyboardUp = (viewport: VisualViewport) => document.documentElement.clientHeight - viewport.height > KEYBOARD;

export function usePhoneKeyboard(phone: boolean) {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!phone || !viewport) return;
    const root = document.documentElement;
    let slid = false;
    const follow = () => {
      const up = keyboardUp(viewport);
      root.toggleAttribute('data-keyboard', up);
      if (up) {
        root.style.setProperty('--vv-height', `${viewport.height}px`);
        if (viewport.offsetTop > 0) slid = true;
        return;
      }
      root.style.removeProperty('--vv-height');
      if (slid) {
        slid = false;
        window.scrollTo(0, 0);
      }
    };
    follow();
    viewport.addEventListener('resize', follow);
    viewport.addEventListener('scroll', follow);
    return () => {
      viewport.removeEventListener('resize', follow);
      viewport.removeEventListener('scroll', follow);
      root.removeAttribute('data-keyboard');
      root.style.removeProperty('--vv-height');
    };
  }, [phone]);
}
