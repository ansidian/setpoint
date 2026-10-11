// Whether Settings is open, and on which page (DESIGN.md › Settings: a modal over the current page,
// not in the address bar). /settings/<page> still opens it, over the Inbox (App.tsx), so a
// reconnect link or a notification lands on the right page.
import {useSyncExternalStore} from 'react';
import type {SettingsPage} from '../../logic/route.ts';

let page: SettingsPage | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());

export function openSettings(next: SettingsPage = 'accounts') {
  page = next;
  changed();
}

export function closeSettings() {
  page = null;
  changed();
}

/** The open page, or null while Settings is closed. */
export const useSettingsPage = () => useSyncExternalStore(listener => {
  listeners.add(listener);
  return () => listeners.delete(listener);
}, () => page);
