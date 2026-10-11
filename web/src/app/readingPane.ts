// The reading pane's width (2026-10-09): dragged from its left edge, kept by this browser
// (localStorage, as the theme is), since how wide it should be depends on the screen.
import {useSyncExternalStore} from 'react';
import {paneWidth} from '../logic/reader.ts';

const KEY = 'setpoint.readingPane';

function stored(): number {
  try {
    return paneWidth(localStorage.getItem(KEY));
  } catch {
    return paneWidth(null);
  }
}

let width = stored();
const listeners = new Set<() => void>();

export function setReadingPaneWidth(next: number) {
  width = paneWidth(next);
  try {
    localStorage.setItem(KEY, String(width));
  } catch {
    // Private windows may refuse; the width still holds for this page.
  }
  listeners.forEach(listener => listener());
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useReadingPaneWidth = () => useSyncExternalStore(subscribe, () => width);
