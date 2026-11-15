// The reading pane's width (2026-10-09): dragged from its left edge, kept by this browser
// (localStorage, as the theme is), since how wide it should be depends on the screen. So it's
// kept per screen (2026-11-14): an external display and the laptop's own each have theirs.
import {useSyncExternalStore} from 'react';
import {paneWidth, paneWidths, READING_PANE, screenKey} from '../logic/reader.ts';

const KEY = 'setpoint.readingPane';

const here = () => screenKey(window.screen);

function stored(): Record<string, number> {
  try {
    return paneWidths(localStorage.getItem(KEY), here());
  } catch {
    return {};
  }
}

const widths = stored();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());

export function setReadingPaneWidth(next: number) {
  widths[here()] = paneWidth(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(widths));
  } catch {
    // Private windows may refuse; the width still holds for this page.
  }
  changed();
}

// The window moved to another screen: that screen's width takes over. The query names the screen
// it was made on, so each change watches the next one; a resize covers a browser that doesn't
// re-read the query on the move.
function watchScreen() {
  const query = window.matchMedia(`(device-width: ${window.screen.width}px) and (device-height: ${window.screen.height}px)`);
  query.addEventListener('change', () => {
    changed();
    watchScreen();
  }, {once: true});
}
watchScreen();
window.addEventListener('resize', changed);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useReadingPaneWidth = () => useSyncExternalStore(subscribe, () => widths[here()] ?? READING_PANE.start);
