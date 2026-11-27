// The reading pane's width: dragged from its left edge, kept by this browser
// (localStorage, as the theme is), since how wide it should be depends on the screen. So it's
// kept per screen: an external display and the laptop's own each have theirs.
import {useSyncExternalStore} from 'react';
import {paneWidth, paneWidths, READING_PANE} from '../logic/reader.ts';
import {here, onScreenChange} from './screen.ts';

const KEY = 'setpoint.readingPane';

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

// The window moved to another screen: that screen's width takes over.
onScreenChange(changed);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useReadingPaneWidth = () => useSyncExternalStore(subscribe, () => widths[here()] ?? READING_PANE.start);
