// Alfred's open conversation, one for the whole app, so it outlives the page it was asked on: a
// question from Inbox search, Ask about this email, or from any page (⌘K on the desktop, the phone's
// Alfred button), which carries what was on screen with its first question. One is open at a time, and a new question
// replaces it. A follow-up continues it. Only × (or the card's Esc) closes it; clearing the search
// doesn't.
//
// Where it shows: inline, where it was asked, while that place is on screen and claims it (Inbox
// search while it's active, the reader on that email). Anywhere else on the desktop it's in
// Alfred's window (AlfredWindow.tsx), at the right of the composer windows' row. The phone has no
// windows: there it waits as a pill above the tab bar that opens it in a full-screen sheet
// (PhoneAlfred.tsx). The window's title folds it to its bar and back, as a composer window's does;
// it opens unfolded each time it comes to the window.
//
// A question in flight lands here wherever the user has gone. Answers aren't streamed: what Alfred
// is doing for it is asked again every STEP_POLL_MS. An answer to a thread since closed or
// replaced is dropped.
//
// A reload: the tab keeps the open conversation's id and origin (sessionStorage), and boot reads
// the thread back from the server, with no model call. The card shows at once, a skeleton holding
// its place until the read lands. One the server has ended, or no longer has, closes quietly.
//
// Ended: the server ends a thread four idle hours after its last question, and each answer says
// when (`ends_at`). The thread closes itself then, quietly, even with the tab left open, so it's
// never on screen once it has ended. A follow-up the server refuses as ended all the same (the Mac
// asleep past the moment) closes it with a toast, the question dropped.
import {ASK_PAGES} from '@setpoint/shared';
import type {AnswerOut, AskContext, AskStep} from '@setpoint/shared';
import {useLayoutEffect, useSyncExternalStore} from 'react';
import {serverNow} from '../../api/auth.ts';
import {ApiFailure} from '../../api/client.ts';
import {alfredConversation, alfredStep, askAlfred as sendQuestion} from '../../api/search.ts';
import type {ShownFix} from '../../api/search.ts';
import {withStep} from '../../logic/search.ts';
import {showToast} from '../toast.ts';
import type {Alfred} from './state.ts';

const STEP_POLL_MS = 400;
const STORAGE_KEY = 'alfred.thread';
export const ENDED_LINE = 'This conversation ended after 4 hours idle';

/** Where a thread was asked: Inbox search, Ask about this email, or a page (⌘K, the phone's button) with what was on screen. */
export type AlfredOrigin = {kind: 'search'} | {kind: 'email'; id: number} | {kind: 'page'; context: AskContext};

/** The email a thread is about: Ask about this email's, or the one open where ⌘K asked. */
export const scopedEmail = (origin: AlfredOrigin): number | null =>
  origin.kind === 'email' ? origin.id : origin.kind === 'page' ? origin.context.email_id ?? null : null;

export interface AlfredThread {
  origin: AlfredOrigin;
  turns: AnswerOut[];
  // The question on its way, the id the page gave it, and what Alfred is doing for it.
  waiting: string | null;
  asking: string | null;
  step: AskStep | null;
  // Every step Alfred has taken for the last question, kept after its answer so the card can fold them away.
  trail: AskStep[];
  // The server's words for the last question that failed, and that question, for the field again.
  error: string | null;
  failed: string | null;
  conversation: number | null;
  // Being read back from the server after a reload.
  restoring: boolean;
}

let thread: AlfredThread | null = null;
// Bumped when the thread closes or is replaced, so an answer to an earlier one is dropped.
let counter = 0;
// The places on screen that show the thread inline, by origin.
const claims = new Map<string, number>();
let poller: number | null = null;
// Closes the thread when the server ends it.
let ender: number | null = null;
// Alfred's window folded to its title bar.
let minimized = false;

const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function set(next: AlfredThread | null) {
  if (next === null) minimized = false;
  thread = next;
  endOnTime();
  notify();
}

/** Closes the thread at its last answer's `ends_at`; not while a question waits, whose answer moves it on. */
function endOnTime() {
  if (ender !== null) window.clearTimeout(ender);
  ender = null;
  const last = thread?.turns.at(-1);
  if (!thread || thread.waiting !== null || !last) return;
  ender = window.setTimeout(closeAlfred, Math.max(0, Date.parse(last.ends_at) - serverNow()));
}

// A page's thread is never shown inline: it's in the window or the phone's sheet.
const originKey = (origin: AlfredOrigin) => (origin.kind === 'email' ? `email:${origin.id}` : origin.kind);
const claimed = () => thread !== null && (claims.get(originKey(thread.origin)) ?? 0) > 0;
const fresh = (origin: AlfredOrigin): AlfredThread => ({origin, turns: [], waiting: null, asking: null, step: null, trail: [], error: null, failed: null, conversation: null, restoring: false});

/** The open thread, or null. */
export const useAlfredThread = () => useSyncExternalStore(subscribe, () => thread);
/** Whether a place on screen shows the open thread inline. */
export const useAlfredClaimed = () => useSyncExternalStore(subscribe, claimed);
/** Whether the open thread is in Alfred's window: open, and no place shows it. */
export const useAlfredWindowed = () => useSyncExternalStore(subscribe, () => thread !== null && !claimed());
export const alfredThread = () => thread;
/** Whether the open thread is in Alfred's window now, as the store has it. */
export const alfredWindowed = () => thread !== null && !claimed();
/** Whether Alfred's window is folded to its title bar. */
export const useAlfredMinimized = () => useSyncExternalStore(subscribe, () => minimized);

/** Folds Alfred's window to its title bar, or brings it back. */
export function toggleAlfredMinimized() {
  minimized = !minimized;
  notify();
}

/** While mounted with an origin, this place shows the thread inline when it's that origin's. */
export function useClaim(origin: AlfredOrigin | null) {
  const key = origin ? originKey(origin) : null;
  useLayoutEffect(() => {
    if (key === null) return;
    claims.set(key, (claims.get(key) ?? 0) + 1);
    // Shown inline, it comes back to the window unfolded.
    if (claimed()) minimized = false;
    notify();
    return () => {
      const left = (claims.get(key) ?? 1) - 1;
      if (left) claims.set(key, left);
      else claims.delete(key);
      notify();
    };
  }, [key]);
}

// ---- The tab's copy (sessionStorage) ----

function remember(conversation: number, origin: AlfredOrigin) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({conversation, origin}));
  } catch {
    // Without storage the thread just doesn't survive a reload.
  }
}

function forget() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // As above.
  }
}

function remembered(): {conversation: number; origin: AlfredOrigin} | null {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return null;
    const {conversation, origin} = saved as {conversation?: unknown; origin?: {kind?: unknown; id?: unknown; context?: {page?: unknown; email_id?: unknown}}};
    if (!Number.isSafeInteger(conversation) || !origin) return null;
    if (origin.kind === 'search') return {conversation: conversation as number, origin: {kind: 'search'}};
    if (origin.kind === 'email' && Number.isSafeInteger(origin.id)) return {conversation: conversation as number, origin: {kind: 'email', id: origin.id as number}};
    // A page's: only its page and open email matter once asked (the scope, and Back's page).
    const context = origin.context;
    if (origin.kind === 'page' && context && (ASK_PAGES as readonly unknown[]).includes(context.page)) {
      const email = Number.isSafeInteger(context.email_id) ? {email_id: context.email_id as number} : {};
      return {conversation: conversation as number, origin: {kind: 'page', context: {page: context.page as AskContext['page'], ...email}}};
    }
    return null;
  } catch {
    return null;
  }
}

/** At boot: the thread the tab had open, read back from the server. Ended or gone, it closes quietly. */
export function restoreAlfred() {
  const saved = remembered();
  if (!saved) return;
  counter += 1;
  const id = counter;
  set({...fresh(saved.origin), conversation: saved.conversation, restoring: true});
  alfredConversation(saved.conversation).then(out => {
    // Closed, or replaced by a new question, while it was read.
    if (id !== counter) return;
    if (out.ended || !out.turns.length) return closeAlfred();
    set({...fresh(saved.origin), turns: out.turns, conversation: out.conversation_id});
  }, (failure: Error) => {
    if (id !== counter) return;
    // Gone from the server: it closes. Otherwise (offline, say) it stays for the next reload.
    if (failure instanceof ApiFailure && failure.status === 404) return closeAlfred();
    counter += 1;
    set(null);
  });
}

// ---- Asking ----

function stopPolling() {
  if (poller !== null) window.clearInterval(poller);
  poller = null;
}

function poll(askId: string) {
  stopPolling();
  poller = window.setInterval(() => {
    alfredStep(askId).then(out => {
      if (thread?.asking !== askId) return;
      set({...thread, step: out.step, trail: withStep(thread.trail, out.step)});
    }, () => {});
  }, STEP_POLL_MS);
}

function send(question: string, anew: boolean, fix: ShownFix | null = null) {
  const asked = question.trim();
  if (!thread || !asked || thread.restoring || (thread.waiting !== null && !anew)) return;
  const id = counter;
  const askId = `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const {origin} = thread;
  const conversation = anew ? null : thread.conversation;
  set({...thread, waiting: asked, asking: askId, step: null, trail: [], error: null, failed: null});
  poll(askId);
  // A thread's first question carries what was on screen where it was asked.
  const context = conversation === null && origin.kind === 'page' ? origin.context : null;
  sendQuestion(asked, {conversation, message: scopedEmail(origin), context, fix, ask: askId}).then(answer => {
    if (id !== counter || !thread) return;
    stopPolling();
    remember(answer.conversation_id, origin);
    set({...thread, conversation: answer.conversation_id, turns: [...thread.turns, answer], waiting: null, asking: null, step: null});
  }, (failure: Error) => {
    if (id !== counter || !thread) return;
    stopPolling();
    if (failure instanceof ApiFailure && failure.code === 'conversation_ended') {
      closeAlfred();
      showToast(ENDED_LINE);
      return;
    }
    set({...thread, error: failure.message, failed: asked, waiting: null, asking: null, step: null});
  });
}

/** Opens a thread at `origin`, replacing any open one: empty (Ask about this email, the phone's button), or with a first question. */
export function startAlfred(origin: AlfredOrigin, question?: string) {
  counter += 1;
  stopPolling();
  forget();
  minimized = false;
  set(fresh(origin));
  if (question) send(question, true);
}

/** A follow-up in the open thread, with the fix on screen when one is. */
export const askAlfred = (question: string, fix: ShownFix | null = null) => send(question, false, fix);

/** Closes the open thread: × or Esc. */
export function closeAlfred() {
  if (!thread) return;
  counter += 1;
  stopPolling();
  forget();
  set(null);
}

/** The thread as the Answer card takes it. Null, it's closed. */
export function alfredOf(open: AlfredThread | null): Alfred {
  return {
    open: open !== null, loading: open?.restoring ?? false, turns: open?.turns ?? [], waiting: open?.waiting ?? null, step: open?.step ?? null, trail: open?.trail ?? [],
    error: open?.error ?? null, failed: open?.failed ?? null,
    start: question => startAlfred(open?.origin ?? {kind: 'search'}, question),
    ask: askAlfred,
    close: closeAlfred,
  };
}

/** For component tests: no thread, no claims, nothing remembered. */
export function resetAlfred() {
  counter += 1;
  stopPolling();
  claims.clear();
  forget();
  set(null);
}
