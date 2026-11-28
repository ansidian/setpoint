// The app's one toast (DESIGN.md › Interaction rules: Trash offers Undo for 6 seconds,
// in the export's `.toast`, a 40 px pill at the bottom centre of the main area, 24 px up, as on the
// phone). App.tsx draws it once above every page and Settings. Any page shows a line with
// showToast("Added to Classes"), an error with showToast(error.message, null, 'failed'), or a line
// with its action:
// showToast("Moved to Trash", {label: 'Undo', run}) or {label: 'Try again', run}. One at a time: a new
// one replaces the last, whose action is then gone. A failed change says what failed and why with
// toastFailure("Failed to pin"), one line: "Failed to pin, can't reach Setpoint". A line leads with its
// tone's glyph in a disc (logic/toast.ts), its time a ring draining around it, and stays 6 seconds (a
// failure 8), the pointer resting on it or not. A failure with an action waits instead. Swiping it away ends it sooner.
// Going, it stays drawn for motion.fast to fade out, unless a new one takes its place. A caller that
// holds something back until the toast goes (Calendar's delete) passes `onGone`, run once however it
// goes: its time ended, swiped away, replaced, or its action run.
import {useSyncExternalStore} from 'react';
import {ApiFailure} from '../api/client.ts';
import {TOAST_MS, toastGlyph, toastMs, toastTone} from '../logic/toast.ts';
import type {ToastTone} from '../logic/toast.ts';
import {motion, viewport} from '../tokens.ts';
import type {IconName} from '../ui/glyphs.ts';
import {failureText} from '../logic/providerWords.ts';

/** Whether the page is laid out for the phone (Phone.tsx's isPhone, read here without its components). */
const isPhone = () => window.matchMedia(`(max-width: ${viewport.phoneBelow - 1}px)`).matches;

/** How long a toast, and its Undo, stays. */
export const UNDO_MS = TOAST_MS.line;

export interface ToastAction {
  label: string;
  run: () => void;
  // Its key, shown as a hint where the page already takes it: ⌘Z on the Inbox's and Sent's Undo.
  key?: string;
}

/** More than a tone: a glyph of the caller's. */
export interface ToastLook {
  tone?: ToastTone;
  glyph?: IconName;
}

export interface Toast {
  id: number;
  text: string;
  action: ToastAction | null;
  tone: ToastTone;
  glyph: IconName;
  // How long it stays, or null while it waits.
  ms: number | null;
  // Going: drawn for its fade only, taking no clicks.
  leaving: boolean;
}

let current: Toast | null = null;
let timer: number | undefined;
// What the shown toast runs once it goes, however it goes.
let gone: (() => void) | null = null;
let nextId = 1;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());

/**
 * Checks only: while the page's root has `data-hold-toast` the toast showing doesn't run out of time,
 * so a check can read the server before pressing Undo (the browser harness's holdToast). Nothing in
 * the app sets it. The toast's going clears it, so the next one runs its own time.
 */
const HOLD = 'data-hold-toast';
const heldForCheck = () => document.documentElement.hasAttribute(HOLD);

function ended() {
  document.documentElement.removeAttribute(HOLD);
  const then = gone;
  gone = null;
  then?.();
}

function startTimer(id: number, ms: number | null) {
  window.clearTimeout(timer);
  if (ms === null) return;
  timer = window.setTimeout(() => (heldForCheck() ? startTimer(id, ms) : dismissToast(id)), ms);
}

/**
 * Shows the line, replacing any other (whose `onGone` then runs), with its tone (by default the one its
 * words have), or a look: its tone and glyph. It answers its id, for
 * dismissToast(id). `onGone` runs once when this toast goes, however.
 */
export function showToast(text: string, action: ToastAction | null = null, look: ToastTone | ToastLook | null = null, onGone: (() => void) | null = null): number {
  const {tone = toastTone(text), glyph} = typeof look === 'string' ? {tone: look} : (look ?? {});
  return show({text, action, tone, glyph: glyph ?? toastGlyph(tone, text)}, onGone);
}

function show(said: Omit<Toast, 'id' | 'ms' | 'leaving'>, onGone: (() => void) | null): number {
  ended();
  const ms = toastMs({tone: said.tone, action: said.action !== null, phone: isPhone()});
  const toast: Toast = {...said, id: nextId++, ms, leaving: false};
  current = toast;
  gone = onGone;
  startTimer(toast.id, ms);
  notify();
  return toast.id;
}

/** A failed change's line, in the server's or the provider's words: "Failed to reorder rules, can’t reach Setpoint". */
export const failureLine = (what: string, error: unknown) => failureText(what, failureWhy(error));

/** Why a change failed, in the server's or the provider's words. */
export const failureWhy = (error: unknown) => (error instanceof ApiFailure ? error.message : 'Setpoint couldn\'t send it.');

/**
 * A change's `.catch` that says in the toast what failed and why: `.catch(toastFailure('Failed to pin'))`.
 * Not while Setpoint is offline: the offline pill already says changes are refused.
 */
export const toastFailure = (what: string) => (error: unknown) => {
  if (!(error instanceof ApiFailure && error.code === 'offline')) showToast(failureLine(what, error), null, 'failed');
};

/** Takes the toast away (its action with it). With an id, only if it's still that one. It fades out over motion.fast. */
export function dismissToast(id?: number) {
  if (!current || current.leaving || (id !== undefined && current.id !== id)) return;
  window.clearTimeout(timer);
  const going = {...current, leaving: true};
  current = going;
  timer = window.setTimeout(() => {
    if (current === going) {
      current = null;
      notify();
    }
  }, motion.fast);
  notify();
  ended();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useToast = () => useSyncExternalStore(subscribe, () => current);
