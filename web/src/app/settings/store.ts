// Whether Settings is open, and on which page (a modal over the current page,
// not in the address bar). /settings/<page> still opens it, over the Inbox (App.tsx), so a
// reconnect link or a notification lands on the right page. The phone has no modal: there Settings
// is a page (PhoneSettings.tsx), and opening Settings goes to its address.
import {useSyncExternalStore} from 'react';
import type {SettingsPage} from '../../logic/route.ts';
import {viewport} from '../../tokens.ts';
import {navigate} from '../router.ts';

let page: SettingsPage | null = null;
// Add to rule's New rule from: Mail's Add rule, open and filled in, until it's added or
// cancelled or Settings closes.
let draft: RuleDraft | null = null;
// Sign out asking in Settings' nav foot (the phone's foot), until it's answered, another page is
// opened or Settings closes.
let signingOut = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach(listener => listener());

export function openSettings(next: SettingsPage = 'accounts') {
  if (window.matchMedia(`(max-width: ${viewport.phoneBelow - 1}px)`).matches) {
    navigate({page: 'settings', section: next});
    return;
  }
  if (page && page !== next) signingOut = false;
  page = next;
  changed();
}

/** Settings' foot asks "Sign out of Setpoint?" where it is. */
export function askSignOutHere() {
  signingOut = true;
  changed();
}

/** ⌘K's Sign out: Settings asks at its foot, opened on Accounts if it was closed. */
export function askSignOut() {
  signingOut = true;
  if (page) changed();
  else openSettings('accounts');
}

export function cancelSignOut() {
  if (!signingOut) return;
  signingOut = false;
  changed();
}

export function closeSettings() {
  page = null;
  draft = null;
  signingOut = false;
  changed();
}

export interface RuleDraft {
  from: string;
  // Send to's value: "attention", "fyi:money", "noise".
  destination: string;
}

export function openRuleDraft(next: RuleDraft) {
  draft = next;
  openSettings('mail');
}

export function clearRuleDraft() {
  draft = null;
  changed();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The open page, or null while Settings is closed. */
export const useSettingsPage = () => useSyncExternalStore(subscribe, () => page);

/** Add rule's draft from an email, while there is one. */
export const useRuleDraft = () => useSyncExternalStore(subscribe, () => draft);

/** Whether Sign out is asking at Settings' foot. */
export const useSigningOut = () => useSyncExternalStore(subscribe, () => signingOut);
