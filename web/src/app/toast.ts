// The app's one toast (DESIGN.md › Interaction rules: Trash offers Undo for 6 seconds, as v1 does,
// in the export's `.toast`, a 40 px pill at the top centre, at the bottom on the phone, #92), drawn
// once by App.tsx above every page and Settings. Any page shows a line with showToast("Added to
// Classes"), an error with showToast(error.message), or a line with its action: showToast("Moved to
// Trash", {label: 'Undo', run}) or {label: 'Try again', run}. One at a time: a new one replaces the
// last, whose action is then gone. A failed change says what failed and why with
// toastFailure("Couldn't pin it").
import {useSyncExternalStore} from 'react';
import {ApiFailure} from '../api/client.ts';

/** How long a toast, and its Undo, stays. */
export const UNDO_MS = 6000;

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  text: string;
  action: ToastAction | null;
}

let current: Toast | null = null;
let timer: number | undefined;
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

/** Shows the line, replacing any other; answers its id, for dismissToast(id). */
export function showToast(text: string, action: ToastAction | null = null): number {
  window.clearTimeout(timer);
  const toast = {id: nextId++, text, action};
  current = toast;
  timer = window.setTimeout(() => dismissToast(toast.id), UNDO_MS);
  notify();
  return toast.id;
}

/**
 * A failed change's line, its parts joined by a comma (DESIGN.md › Decided while building #25), in
 * the server's or the provider's words: "Couldn't reorder rules, Can’t reach Setpoint".
 */
export const failureLine = (what: string, error: unknown) => `${what}, ${error instanceof ApiFailure ? error.message : 'Setpoint couldn\'t send it.'}`;

/**
 * A change's `.catch` that says in the toast what failed and why: `.catch(toastFailure('Couldn\'t pin it'))`.
 * Not while Setpoint is offline: the offline pill already says changes are refused.
 */
export const toastFailure = (what: string) => (error: unknown) => {
  if (!(error instanceof ApiFailure && error.code === 'offline')) showToast(failureLine(what, error));
};

/** Takes the toast away (its action with it); with an id, only if it's still that one. */
export function dismissToast(id?: number) {
  if (!current || (id !== undefined && current.id !== id)) return;
  window.clearTimeout(timer);
  current = null;
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useToast = () => useSyncExternalStore(subscribe, () => current);
