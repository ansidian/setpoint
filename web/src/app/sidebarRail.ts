// The sidebar's rail (logic/sidebar.ts; D507, SV-245): folded or open by the window's width, until
// `` ` `` or a click on its edge chooses, which this browser keeps (localStorage, as the reading pane's
// width is). It follows the window across 1100 and 1600 px as it's resized.
import {useSyncExternalStore} from 'react';
import {sidebarChoice, sidebarFoldable, sidebarFolded} from '../logic/sidebar.ts';
import type {SidebarChoice} from '../logic/sidebar.ts';
import {viewport} from '../tokens.ts';

// Not `setpoint.sidebar`, which forgetShape.ts removes.
const KEY = 'setpoint.sidebarRail';

function stored(): SidebarChoice | null {
  try {
    return sidebarChoice(localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

let choice = stored();
const listeners = new Set<() => void>();
const queries = [viewport.compactBelow, viewport.railBelow].map(width => window.matchMedia(`(min-width: ${width}px)`));

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  queries.forEach(query => query.addEventListener('change', listener));
  return () => {
    listeners.delete(listener);
    queries.forEach(query => query.removeEventListener('change', listener));
  };
};

/** Whether the sidebar is the rail now. */
export const isRail = () => sidebarFolded(window.innerWidth, choice);
/** The same, followed. */
export const useRail = () => useSyncExternalStore(subscribe, isRail);
/** Whether `` ` `` and the rail's edge do anything at this width. */
export const useSidebarFoldable = () => useSyncExternalStore(subscribe, () => sidebarFoldable(window.innerWidth));

/** `` ` `` or the edge: opens the rail or folds the sidebar, and keeps that; false under 1100 px, where it's always the rail. */
export function toggleSidebar(): boolean {
  if (!sidebarFoldable(window.innerWidth)) return false;
  choice = isRail() ? 'open' : 'rail';
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Private windows may refuse; the choice still holds for this page.
  }
  listeners.forEach(listener => listener());
  return true;
}
