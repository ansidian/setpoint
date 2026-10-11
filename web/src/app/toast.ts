// The app's one toast (DESIGN.md › Interaction rules: Trash offers Undo for 6 seconds, as v1 does,
// in the export's `.toast`, a 40 px pill at the top centre, at the bottom on the phone, #92), drawn
// once by App.tsx above every page and Settings. Any page shows a line with showToast("Added to
// Classes"), an error with showToast(error.message, null, 'failed'), or a line with its action:
// showToast("Moved to Trash", {label: 'Undo', run}) or {label: 'Try again', run}. One at a time: a new
// one replaces the last, whose action is then gone. A failed change says what failed and why with
// toastFailure("Couldn't pin it"). A line leads with its tone's glyph (logic/toast.ts), stays 6
// seconds (a failure 8), and waits while the pointer rests on it; going, it stays drawn for
// motion.fast to fade out, unless a new one takes its place.
import {useSyncExternalStore} from 'react';
import {ApiFailure} from '../api/client.ts';
import {TOAST_MS, toastMs, toastTone} from '../logic/toast.ts';
import type {ToastTone} from '../logic/toast.ts';
import {motion} from '../tokens.ts';

/** How long a toast, and its Undo, stays. */
export const UNDO_MS = TOAST_MS.line;

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface Toast {
  id: number;
  text: string;
  action: ToastAction | null;
  tone: ToastTone | null;
  // How long it stays, unheld.
  ms: number;
  // While the pointer rests on it: its time, and its Undo hairline, wait.
  held: boolean;
  // Going: drawn for its fade only, taking no clicks.
  leaving: boolean;
}

let current: Toast | null = null;
let timer: number | undefined;
// When the shown toast goes, unheld; while held, the time it had left.
let endsAt = 0;
let left = 0;
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

function startTimer(id: number, ms: number) {
  window.clearTimeout(timer);
  endsAt = Date.now() + ms;
  timer = window.setTimeout(() => dismissToast(id), ms);
}

/** Shows the line, replacing any other, with its tone (by default the one its words have); answers its id, for dismissToast(id). */
export function showToast(text: string, action: ToastAction | null = null, tone: ToastTone | null = toastTone(text)): number {
  const ms = toastMs(tone);
  const toast: Toast = {id: nextId++, text, action, tone, ms, held: false, leaving: false};
  current = toast;
  startTimer(toast.id, ms);
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
  if (!(error instanceof ApiFailure && error.code === 'offline')) showToast(failureLine(what, error), null, 'failed');
};

/** Takes the toast away (its action with it); with an id, only if it's still that one. It fades out over motion.fast. */
export function dismissToast(id?: number) {
  if (!current || current.leaving || (id !== undefined && current.id !== id)) return;
  window.clearTimeout(timer);
  const going = {...current, held: false, leaving: true};
  current = going;
  timer = window.setTimeout(() => {
    if (current === going) {
      current = null;
      notify();
    }
  }, motion.fast);
  notify();
}

/** The pointer rests on the toast (true) or leaves it: its time stops, then runs on with what it had left. */
export function holdToast(id: number, held: boolean) {
  if (!current || current.id !== id || current.leaving || current.held === held) return;
  if (held) {
    window.clearTimeout(timer);
    left = Math.max(0, endsAt - Date.now());
  } else {
    startTimer(id, left);
  }
  current = {...current, held};
  notify();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useToast = () => useSyncExternalStore(subscribe, () => current);
