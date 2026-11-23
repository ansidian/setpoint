// The composers' state, one for the whole app: at most one composer is in the reading pane, under
// its email, and any number more in windows. Opening another email leaves the draft where it is (its row carries the draft
// mark), and its composer opens again when the email is shown again. Esc closes it, keeping the
// draft, and it stays closed while that email stays shown.
//
// Saving: each field's change is queued and sent DRAFT_SAVE_MS after the last one, one save after
// another so the last write wins. Send, Esc, opening another draft and leaving the page save at once.
// Nothing shows while it works. A change whose save failed stays owed: it goes out again with the
// next save, under whatever was changed since, and the composer says the save failed until every
// owed change has landed. Send saves first and stops there while a change is owed and still fails.
//
// Send: the composer closes and the toast reads "Sending" with Undo. The toast shows at the press,
// before the server's hold has begun, so its 6 seconds end before the server's: Undo is never
// offered once the server would refuse it. An Undo the server refuses all the same (a slow answer)
// says it was too late. Undo opens the composer again, everything in place. The hold over, the
// draft is gone once the provider took it. If the provider refused it, the draft comes back with
// its words and Try again: on its email, in the toast (Open), and in Drafts.
//
// Discard has no key: the draft goes at once, and the toast's Undo starts it again as it was. A
// draft still as the server filled it (logic/composer.ts › emptyDraft) goes quietly when its
// composer closes or its tab does, and the server leaves it out of Drafts. Drafts discards rows too, one
// or several under one toast ("Discarded 3 drafts"): Undo starts each again in its place in the
// list, and opens again only those that were open, where they were. Drafts' Pop out and its
// selection's Open put drafts straight into windows.
//
// Waiting: C, R, A and F open the composer at the key, before the server has started the draft.
// It has no draft id until the answer comes (`draftId` null). The field with the caret is live from
// the start (To for a new message and a forward, the body for a reply) and what's typed meanwhile is
// kept here by the opening, then saved into the draft that arrives, around what the server filled
// (logic/composer.ts › fillAround). What needs the draft (Send, Discard, files, help me write, the
// menus, moving it) waits for it. Esc meanwhile is Esc: the draft that then arrives is let go of
// as the composer would have let go of it. A start that fails closes the composer with its toast.
//
// A new message (C) has no email to stay with: it opens in a window of its own. Docked into the
// pane, it has the pane by itself, and showing an email closes it into Drafts. On Drafts, the open
// draft is the page's own (its address names it).
//
// The phone: its one composer is in the pane, never a window, and a full-screen sheet shows it over
// whatever page is up, Send and Cancel in the sheet's bar. Opening another takes its place. An email
// shown there doesn't open its draft by itself: Reply takes it up again (the server answers with it).
//
// Popping out: the composer leaves the pane for a window in the main area's bottom right corner,
// which stays up over other mail and every other page. Windows line up leftward in the order they
// popped out. It is one composer in two places: each stays mounted in a host element of its own
// (place.ts) that the pane and its window take in turn, so what's typed, the fold, Cc and Bcc and
// the caret carry across. A window's title (the subject, or "New message") folds it to its title
// bar and back; when the windows don't all fit, the one touched longest ago folds first, and once
// even the bars don't fit the oldest go into a "+N" chip (logic/composer.ts › arrangeWindows). A
// window's × closes it as Esc does, except on a reply or forward whose own email the reader shows
// (not a selection's stack, which shows no one email): there it docks, the composer under that
// email, and the pane's composer, if another, gives way. A new message's × always closes it. Esc
// in a window closes it, the draft kept, as in the pane; Esc outside the windows leaves them alone.
// R, A and F open in the pane, beside any windows. On a selection of a few emails they open popped
// out, a window for each in the list's order (answerEach).
//
// Files: the attach button, a drop on the composer or a pasted image uploads each file to the draft
// at once, a chip showing it while it goes; one that would take the attachments over 25 MB (with a
// forward's kept originals) is refused before it leaves, and the server refuses it again, the
// reason on the composer either way. Send waits for the uploads under way, and stops, the composer
// back, if one failed. A draft with a file or an upload is never empty. Discard's Undo and the
// reply-type menu take the files onto the new draft by id (the server keeps a gone draft's files a
// few minutes for that).
import {ATTACHMENTS_MAX_BYTES, attachmentsTotal, megabytes} from '@setpoint/shared';
import type {DraftCreateInput, DraftKind, DraftOut, DraftRowOut, DraftUpdateInput, FromOut, MessageOut} from '@setpoint/shared';
import {isEmpty} from '@setpoint/shared/richText';
import {useSyncExternalStore} from 'react';
import {serverNow, timeZone} from '../../api/auth.ts';
import {ApiFailure, getCached, getJson, refresh, setCached} from '../../api/client.ts';
import {discardDraft, draftPath, DRAFTS_PATH, FROM_PATH, loadDraft, removeDraftFile, saveDraft, sendDraft, startDraft, takeDraftFiles, undoSend, uploadDraftFile, writeDraft} from '../../api/drafts.ts';
import {messagePath} from '../../api/mail.ts';
import {emptyDraft, fillAround, hasOthers, NO_VERSIONS, recordVersion} from '../../logic/composer.ts';
import {broughtBackLine, counted, discardedLine, discardFailedLine, scheduledAt} from '../../logic/selection.ts';
import {scheduledWhen} from '../../logic/snooze.ts';
import type {Block} from '../../logic/description.ts';
import {currentRoute, navigate} from '../router.ts';
import {isPhone} from '../Phone.tsx';
import {dismissToast, failureLine, showToast, toastFailure} from '../toast.ts';
import {composerHost, whenPlaced} from './place.ts';
import {failureText, refusalWords} from '../../logic/providerWords.ts';

/** How long after the last change a draft is saved. */
export const DRAFT_SAVE_MS = 600;

export interface OpenComposer {
  // Null while the server is starting the draft.
  draftId: number | null;
  messageId: number | null;
  kind: DraftKind;
  // Where the caret lands: the body when it already has someone to go to, else To. None when it
  // opened again by itself on its email, so J and K go on stepping through the list.
  focus: 'body' | 'to' | null;
  // Opened by Edit subject: its subject is a field, and the reply-type menu is gone.
  subjectEdited: boolean;
  // A new one for each opening, so a composer opened again draws the draft afresh.
  key: number;
  // Popped out into the floating window, else in the reading pane.
  floating: boolean;
  // The window folded to its title bar (a click on the title, or to make room for another).
  minimized: boolean;
  // When it was last opened, popped out or brought back, so the window touched longest ago is the
  // first to fold when they don't all fit.
  touched: number;
}

// Every open composer: at most one in the reading pane, the rest in windows, in the order they
// popped out (the first at the right).
let composers: OpenComposer[] = [];
let touches = 0;
/** The composer in the reading pane, if one is. */
const docked = (): OpenComposer | null => composers.find(one => !one.floating) ?? null;
const byDraft = (draftId: number): OpenComposer | null => composers.find(one => one.draftId === draftId) ?? null;
const byKey = (key: number): OpenComposer | null => composers.find(one => one.key === key) ?? null;
function setComposers(next: OpenComposer[]) {
  composers = next;
  notify();
}
const without = (draftId: number) => composers.filter(one => one.draftId !== draftId);
// The email whose composer the user closed, so it doesn't open again by itself while it's shown.
let closedOn: number | null = null;
let opened = 0;
const saveErrors = new Map<number, string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The composer in the reading pane. */
export const useOpenComposer = () => useSyncExternalStore(subscribe, docked);
/** Every open composer, the windows in the order they popped out. */
export const useComposers = () => useSyncExternalStore(subscribe, () => composers);
export const useSaveError = (draftId: number | null) => useSyncExternalStore(subscribe, () => (draftId === null ? null : saveErrors.get(draftId) ?? null));
export const openComposer = docked;
/** Every open composer, as useComposers has them. */
export const openComposers = () => composers;

// ---- Saving ----

const queued = new Map<number, DraftUpdateInput>();
// Changes whose save failed, owed to the server until a save carrying them lands.
const owed = new Map<number, DraftUpdateInput>();
const timers = new Map<number, number>();
// Each draft's saves, one after another.
const chains = new Map<number, Promise<void>>();

/** Queues a change to the draft, saved a moment after the last one. */
export function queueSave(draftId: number, changes: DraftUpdateInput) {
  queued.set(draftId, {...queued.get(draftId), ...changes});
  window.clearTimeout(timers.get(draftId));
  timers.set(draftId, window.setTimeout(() => void flushSave(draftId), DRAFT_SAVE_MS));
}

/**
 * Saves what's queued now, with any change still owed from a save that failed, and answers once
 * every save of the draft so far has run. It fails when this save failed, so Send stops there.
 */
export function flushSave(draftId: number, {keepalive = false} = {}): Promise<void> {
  window.clearTimeout(timers.get(draftId));
  timers.delete(draftId);
  const next = (chains.get(draftId) ?? Promise.resolve()).then(() => saveOwed(draftId, keepalive));
  chains.set(draftId, next.catch(() => {}));
  return next;
}

/** What the server is owed for a draft: changes whose save failed, under those queued since. */
const owedOf = (draftId: number): DraftUpdateInput => ({...owed.get(draftId), ...queued.get(draftId)});

/** The changes the server is still owed, for a composer drawing the draft again. */
export const unsaved = (draftId: number): DraftUpdateInput => owedOf(draftId);

async function saveOwed(draftId: number, keepalive: boolean) {
  // Taken when its turn comes, so it carries everything changed until then.
  const changes = owedOf(draftId);
  owed.delete(draftId);
  queued.delete(draftId);
  if (!Object.keys(changes).length) return;
  try {
    await saveDraft(draftId, changes, {keepalive});
  } catch (error) {
    // A draft that's sending or gone has nothing left to keep.
    if (error instanceof ApiFailure && (error.status === 404 || error.code === 'draft_held' || error.code === 'draft_sending')) return;
    // Owed again, under anything queued meanwhile, which is newer.
    owed.set(draftId, changes);
    saveErrors.set(draftId, failureLine('Failed to save the draft', error));
    notify();
    throw error;
  }
  if (!owed.has(draftId) && saveErrors.delete(draftId)) notify();
}

/** A draft's help-me-write line and versions as the composer last had them: owed to the server, else saved. */
function writeNow(draft: DraftOut): DraftOut['write'] {
  const owedWrite = owedOf(draft.id).write;
  if (owedWrite !== undefined) return owedWrite;
  return getCached<DraftOut>(draftPath(draft.id))?.write ?? draft.write ?? null;
}

/** Drops what's queued for a draft that's going away. */
function forgetSaves(draftId: number) {
  window.clearTimeout(timers.get(draftId));
  timers.delete(draftId);
  queued.delete(draftId);
  owed.delete(draftId);
  saveErrors.delete(draftId);
}

// A closing tab: its open drafts still as they were filled go at once, and every change still
// queued or owed goes as a last request.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const one of composers) if (one.draftId !== null) discardIfEmpty(one.draftId, {keepalive: true});
    for (const draftId of new Set([...queued.keys(), ...owed.keys()])) void flushSave(draftId, {keepalive: true}).catch(() => {});
  });
}

// ---- Opening and closing ----

/**
 * Discards the draft quietly when it is still as the server filled it (logic/composer.ts ›
 * emptyDraft) with no upload under way, its queued changes dropped. Answers whether it went.
 */
function discardIfEmpty(draftId: number, {keepalive = false} = {}): boolean {
  const draft = getCached<DraftOut>(draftPath(draftId));
  if (!draft || uploadsOf(draftId).length) return false;
  const now = {...draft, ...owedOf(draftId)} as DraftOut;
  const message = now.message_id === null ? undefined : getCached<MessageOut>(messagePath(now.message_id));
  if (!emptyDraft(now, message, getCached<FromOut>(FROM_PATH))) return false;
  forgetSaves(draftId);
  discarded.add(draftId);
  void discardDraft(draftId, now.message_id, {keepalive}).catch(() => {}).finally(() => discarded.delete(draftId));
  return true;
}

/**
 * The composer gives up its draft (closed, or another opening): saved now, or, when it is still as
 * the server filled it, discarded quietly, so an R or C let go of leaves nothing in Drafts.
 */
function letGo(draftId: number) {
  if (!discardIfEmpty(draftId)) void flushSave(draftId).catch(() => {});
}

/** A composer gives way: its draft let go of, or, still waiting, the draft once it arrives (arrive). */
function release(one: OpenComposer) {
  if (one.draftId !== null) letGo(one.draftId);
}

/** Opens the draft in the pane (the one there gives way) or in a window of its own. */
function show(draft: Pick<DraftOut, 'id' | 'message_id' | 'kind' | 'to' | 'cc' | 'bcc'>, {caret = true, floating: asked = false, subject = false} = {}) {
  // The phone has no windows: its one composer is in the pane, which its sheet shows.
  const floating = asked && !isPhone();
  let rest = without(draft.id);
  const pane = rest.find(one => !one.floating);
  if (!floating && pane) {
    release(pane);
    rest = rest.filter(one => one !== pane);
  }
  const someone = draft.to.length + draft.cc.length + draft.bcc.length > 0;
  // A window leaves the pane as it is: an email's draft closed there stays closed.
  if (!floating) closedOn = null;
  setComposers([...rest, {
    draftId: draft.id, messageId: draft.message_id, kind: draft.kind, focus: caret ? (subject || someone ? 'body' : 'to') : null, subjectEdited: subject,
    key: ++opened, floating, minimized: false, touched: ++touches,
  }]);
}

/** Changes one open composer. */
function change(draftId: number, changes: Partial<OpenComposer>) {
  setComposers(composers.map(one => (one.draftId === draftId ? {...one, ...changes} : one)));
}

/**
 * Starts (or takes up again) a draft of `kind` on an email, or a new message: its composer opens at
 * once, waiting, and takes the draft when the server answers. A new message starts popped out, so
 * the page stays as it is under it, and so does each answer to a selection (`floating`).
 */
export function startComposer(input: DraftCreateInput, {floating: asked = input.kind === 'new'} = {}) {
  // The phone has no windows: each opening takes the pane, which its sheet shows, one at a time.
  const floating = asked && !isPhone();
  const already = input.kind === 'new' ? null : composers.find(one => one.messageId === input.message_id && one.kind === input.kind);
  if (already) {
    // Already open: R again brings its window back and puts the caret in it. Asked for in a window
    // (a selection's), one in the pane pops out, last in line, as the others open.
    if (already.floating) setComposers(composers.map(one => (one === already ? {...one, minimized: false, touched: ++touches} : one)));
    else if (floating) setComposers([...composers.filter(one => one !== already), {...already, floating: true, minimized: false, touched: ++touches}]);
    whenPlaced(already.key, () => composerHost(already.key).querySelector<HTMLElement>('.desc-edit')?.focus());
    return;
  }
  let rest = composers;
  const pane = floating ? null : docked();
  if (pane) {
    release(pane);
    rest = rest.filter(one => one !== pane);
  }
  const key = ++opened;
  // What a refused start puts back: the pane's composer it took the place of, and the closed mark.
  const gaveWay = pane?.draftId ?? null;
  const wasClosedOn = closedOn;
  if (!floating) closedOn = null;
  setComposers([...rest, {
    draftId: null, messageId: input.kind === 'new' ? null : input.message_id ?? null, kind: input.kind,
    focus: input.kind === 'reply' || input.kind === 'reply_all' ? 'body' : 'to', subjectEdited: false, key, floating, minimized: false, touched: ++touches,
  }]);
  void startDraft(input).then(draft => arrive(key, draft), (error: unknown) => {
    const typed = takeTyped(key);
    const waiting = byKey(key);
    // It took another start's draft meanwhile (Esc, then R again): nothing was lost.
    if (waiting && waiting.draftId !== null) return;
    if (waiting) {
      setComposers(composers.filter(one => one.key !== key));
      if (closedOn === null) closedOn = wasClosedOn;
      if (gaveWay !== null) bringBack(gaveWay);
    } else if (!wroteIn(typed)) {
      // Closed with nothing written: there's nothing to say.
      return;
    }
    toastFailure(input.kind === 'forward' ? 'Failed to start the forward' : input.kind === 'new' ? 'Failed to start the message' : 'Failed to start the reply')(error);
  });
}

/** Whether anything was written in a waiting composer: words, a recipient or a subject. */
const wroteIn = (typed: DraftUpdateInput) => !isEmpty(typed.body ?? []) || (typed.to?.length ?? 0) + (typed.cc?.length ?? 0) + (typed.bcc?.length ?? 0) > 0 || !!typed.subject?.trim();

/** A refused start gives the pane back: the draft it took the place of opens again, if it was kept. */
function bringBack(draftId: number) {
  if (discarded.has(draftId)) return;
  void loadDraft(draftId).then(draft => {
    if (docked() || byDraft(draftId) || discarded.has(draftId) || sending.has(draftId)) return;
    show(draft, {caret: false});
  }, () => {});
}

// What was typed in each waiting composer, by its opening, until its draft arrives.
const typedWhileWaiting = new Map<number, DraftUpdateInput>();

/** A change made in a composer still waiting for its draft: kept until the draft arrives. */
export function queueTyped(key: number, changes: DraftUpdateInput) {
  typedWhileWaiting.set(key, {...typedWhileWaiting.get(key), ...changes});
}

function takeTyped(key: number): DraftUpdateInput {
  const typed = typedWhileWaiting.get(key) ?? {};
  typedWhileWaiting.delete(key);
  return typed;
}

/**
 * The server answered composer `key` with its draft: what was typed meanwhile is saved into it, and
 * the composer takes it where it is. One closed meanwhile hands it to a composer still waiting for
 * the same email and kind (Esc, then R again), else lets it go as Esc would have: kept with words,
 * discarded quietly without.
 */
function arrive(key: number, draft: DraftOut) {
  const own = byKey(key);
  const taker = own ?? (draft.message_id === null ? null : composers.find(one => one.draftId === null && one.messageId === draft.message_id && one.kind === draft.kind) ?? null);
  // Each composer's words go in turn around the draft as this tab has it (the cache, which a late
  // answer doesn't replace, with what it still owes): the closed one's first, then the taker's.
  const typed = [takeTyped(key), ...(taker && taker !== own ? [takeTyped(taker.key)] : [])];
  let now = {...getCached<DraftOut>(draftPath(draft.id)) ?? draft, ...owedOf(draft.id)} as DraftOut;
  let fill: DraftUpdateInput = {};
  for (const words of typed) {
    const more = fillAround(now, words);
    fill = {...fill, ...more};
    now = {...now, ...more} as DraftOut;
  }
  const filled = Object.keys(fill).length > 0;
  if (filled) queueSave(draft.id, fill);
  if (taker && taker.draftId === null) {
    setComposers(composers.map(one => (one === taker ? {...one, draftId: draft.id, messageId: draft.message_id} : one)));
    return;
  }
  const open = byDraft(draft.id);
  // Open in a composer already (it opened again by itself meanwhile): it draws what came in.
  if (open) {
    if (filled) fillComposer(open.key);
    return;
  }
  if (!taker) letGo(draft.id);
}

// Each open composer's count of fills from outside it (words typed before Esc arriving with its
// draft), so it draws them.
const fills = new Map<number, number>();
function fillComposer(key: number) {
  fills.set(key, (fills.get(key) ?? 0) + 1);
  notify();
}
/** How many times composer `key` was filled from outside it. */
export const useFills = (key: number) => useSyncExternalStore(subscribe, () => fills.get(key) ?? 0);

/** Whether email `id` has anyone for Reply all, from the email and From as they've loaded, else null. */
export function canReplyAll(id: number): boolean | null {
  const message = getCached<MessageOut>(messagePath(id));
  const from = getCached<FromOut>(FROM_PATH);
  return message && from ? hasOthers(message, from) : null;
}

/** R, A or F on an email (open, or under the cursor): Reply all only when it has others to reply to. */
export function answerKey(id: number, kind: 'reply' | 'reply_all' | 'forward') {
  if (kind !== 'reply_all') return startComposer({kind, message_id: id});
  const known = canReplyAll(id);
  if (known !== null) {
    if (known) startComposer({kind, message_id: id});
    return;
  }
  void Promise.all([getJson<MessageOut>(messagePath(id)), getJson<FromOut>(FROM_PATH)]).then(([message, from]) => {
    if (hasOthers(message, from)) startComposer({kind, message_id: id});
  }, () => {});
}

/**
 * R, A or F on a selection: one composer per email, each in a window of its own, in the order
 * given (the list's). Reply all only on those with others to reply to, as A on one email; an email
 * that can't be read for it is left out.
 */
export function answerEach(ids: readonly number[], kind: 'reply' | 'reply_all' | 'forward') {
  const start = (id: number) => startComposer({kind, message_id: id}, {floating: true});
  if (kind !== 'reply_all') {
    ids.forEach(start);
    return;
  }
  void Promise.all(ids.map(id => {
    const known = canReplyAll(id);
    if (known !== null) return known;
    return Promise.all([getJson<MessageOut>(messagePath(id)), getJson<FromOut>(FROM_PATH)]).then(([message, from]) => hasOthers(message, from), () => false);
  })).then(others => ids.forEach((id, at) => others[at] && start(id)));
}

/** The email the reading pane shows, on the Inbox or Sent (none while a selection's stack is up). */
export function shownEmail(route = currentRoute()): number | null {
  return route.page === 'inbox' || route.page === 'sent' ? route.open : null;
}

/** Esc, or the page's Esc on the pane's composer: it closes, the draft kept. */
export function closeComposer(draftId?: number) {
  const target = draftId === undefined ? docked() : byDraft(draftId);
  if (target) closeOne(target);
}

function closeOne(target: OpenComposer) {
  release(target);
  // A window closing leaves the pane as it is: the email shown there doesn't open its own draft now.
  closedOn = target.floating ? shownEmail() : target.messageId;
  setComposers(composers.filter(one => one.key !== target.key));
}

/** Closes the composer opened as `key`, as Esc does. */
export function closeComposerAt(key: number) {
  const target = byKey(key);
  if (target) closeOne(target);
}

/** The composer's pop-out: it leaves the pane for a window of its own, as it is. */
export function popOut(draftId: number) {
  const target = byDraft(draftId);
  if (!target || target.floating) return;
  // Taken out and put last, so it lines up after the windows already up.
  setComposers([...without(draftId), {...target, floating: true, minimized: false, touched: ++touches}]);
}

/** A click on a window's title folds it to the title bar, or brings it back. */
export function toggleMinimized(draftId: number) {
  const target = byDraft(draftId);
  if (!target?.floating) return;
  change(draftId, target.minimized ? {minimized: false, touched: ++touches} : {minimized: true});
}

/** The windows don't all fit: these fold to their title bars, the oldest touched first. */
export function foldWindows(keys: number[]) {
  if (!keys.length) return;
  setComposers(composers.map(one => (keys.includes(one.key) ? {...one, minimized: true} : one)));
}

/** A window's × over its own email: the composer goes back into the reading pane, under that email. */
export function dock(draftId: number) {
  const target = byDraft(draftId);
  if (!target?.floating) return;
  const pane = docked();
  if (pane) release(pane);
  showPaneFor({id: draftId, message_id: target.messageId});
  // The pane opens on that email now: its draft is this one.
  closedOn = null;
  setComposers(composers.filter(one => one !== pane).map(one => (one === target ? {...one, floating: false, minimized: false, touched: ++touches} : one)));
}

/** Whether a draft can open by itself: not while its send is held or under way, or it's going. */
const openable = (row: DraftRowOut) => row.send_state !== 'held' && row.send_state !== 'sending' && !sending.has(row.id) && !discarded.has(row.id);

/**
 * The reader shows `messageId`: its draft's composer opens again in the pane, the latest one when
 * it has more than one, unless the user closed it here or it's up in a window. Showing another
 * email lets the closed one open again.
 */
export function showEmail(messageId: number, drafts: DraftRowOut[] | undefined) {
  if (closedOn !== null && closedOn !== messageId) closedOn = null;
  // A new message in the pane gives it to the email, kept in Drafts.
  const pane = docked();
  if (pane && pane.messageId === null) closeOne(pane);
  const taken = () => closedOn === messageId || composers.some(one => one.messageId === messageId);
  if (!drafts || taken()) return;
  const draft = drafts.filter(row => row.message_id === messageId && openable(row)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (!draft) return;
  void loadDraft(draft.id).then(full => {
    // Something else opened meanwhile, or it was sent or discarded.
    if (taken() || sending.has(full.id) || discarded.has(full.id)) return;
    show(full, {caret: false});
  }, () => {});
}

/**
 * C: a new message, from the account asked for (Sent's selected one), else the one last sent from.
 * It opens popped out, over whatever the page shows.
 */
export function newMessage(accountId?: number) {
  startComposer({kind: 'new', ...(accountId ? {account_id: accountId} : {})});
}

/**
 * Drafts' row: its draft opens in Drafts' pane, the caret in it. One up in a window docks there.
 * One scheduled to send later opens on Scheduled instead, to read; Cancel send there edits it.
 */
export function openDraft(draftId: number) {
  const target = byDraft(draftId);
  if (target) {
    if (!target.floating) return;
    const pane = docked();
    if (pane) release(pane);
    setComposers(composers.filter(one => one !== pane).map(one => (one === target ? {...one, floating: false, minimized: false, touched: ++touches} : one)));
    return;
  }
  void loadDraft(draftId).then(draft => {
    if (draft.send && scheduledAt({send_state: draft.send.state, send_at: draft.send.send_at}, serverNow())) navigate({page: 'scheduled', open: draft.id}, {replace: true});
    else show(draft);
  }, toastFailure('Failed to open the draft'));
}

/**
 * Scheduled's Cancel send: the draft comes off the schedule and opens in Drafts' pane to edit, as
 * Undo would. Too late once the provider has it.
 */
export function cancelScheduled(draftId: number, onRefused: () => void = () => {}) {
  void undoSend(draftId).then(() => navigate({page: 'drafts', open: draftId}), (error: unknown) => {
    onRefused();
    if (error instanceof ApiFailure && error.code === 'draft_not_held') showToast('Too late to cancel, it\'s already sending', null, 'failed');
    else toastFailure('Failed to cancel the send')(error);
  });
}

/**
 * The reply-type menu: the draft becomes a reply, a reply to all or a forward of the same email,
 * keeping what was written and From, in the same place. The draft it was goes, and a draft of the
 * new kind the email already had takes the text. Edit subject is a forward that keeps the
 * recipients too, its subject shown as a field and the menu gone, the caret in the body.
 */
export function switchKind(current: DraftOut, kind: Exclude<DraftKind, 'new'>, {editSubject = false} = {}) {
  // A forward's own Edit subject only shows the field (the composer does that).
  if (current.message_id === null || current.kind === kind) return;
  const messageId = current.message_id;
  const {body, from, to, cc, bcc} = current;
  // Help me write's line and versions are the words' history, so they go with them.
  const write = writeNow(current);
  // The user's files go with the words, once any upload under way has landed.
  const settled = settledUploads(current.id);
  void startDraft({kind, message_id: messageId}).then(async next => {
    await saveDraft(next.id, editSubject ? {body, from, to, cc, bcc, write} : {body, from, write});
    await settled;
    const files = filesNow(current.id, current);
    try {
      await takeDraftFiles(next.id, files.map(file => file.id));
    } catch (error) {
      // Refused (over the limit as a forward, with the originals): the draft stays as it was.
      void discardDraft(next.id, messageId).catch(() => {});
      throw error;
    }
    const floating = byDraft(current.id)?.floating ?? false;
    forgetSaves(current.id);
    discarded.add(current.id);
    composers = without(current.id);
    void discardDraft(current.id, messageId).catch(() => {}).finally(() => discarded.delete(current.id));
    show(editSubject ? {...next, to, cc, bcc} : next, {floating, subject: editSubject});
  }).catch(toastFailure(kind === 'forward' ? 'Failed to start the forward' : 'Failed to start the reply'));
}

/**
 * Opens the draft, showing its email first when the page shows another (Undo, a failure's Open).
 * One that was in a window opens in a window again, wherever the user is.
 */
function reopen(draft: DraftOut, {floating = false} = {}) {
  // The phone's sheet is over whatever page is up: it needs no page of its own.
  if (!floating && !isPhone()) showPaneFor(draft);
  show(draft, {floating});
}

/** The page whose pane a draft opens in: its own email's, the new message's own, or Drafts'. */
function showPaneFor(draft: Pick<DraftOut, 'id' | 'message_id'>) {
  const route = currentRoute();
  if (route.page === 'drafts') {
    if (route.open !== draft.id) navigate({page: 'drafts', open: draft.id});
  } else if (draft.message_id === null) {
    // A new message opens in the pane of the mail page it's on, else in Drafts.
    if (route.page === 'inbox' || route.page === 'sent') {
      if (route.open !== null) navigate({...route, open: null});
    } else navigate({page: 'drafts', open: draft.id});
  } else {
    const shown = (route.page === 'inbox' || route.page === 'sent') && route.open === draft.message_id;
    if (!shown) navigate(route.page === 'sent' ? {...route, open: draft.message_id} : route.page === 'inbox' ? {...route, open: draft.message_id} : {page: 'inbox', open: draft.message_id});
  }
}

// ---- Send, Undo, failures ----

// The drafts this tab sent, watched until the provider took each (it leaves Drafts) or refused it.
const sending = new Map<number, {subject: string}>();
// Discarded drafts on their way out, kept from opening again meanwhile.
const discarded = new Set<number>();

/**
 * ⌘Enter or Send (and Try again): the composer closes and the toast offers Undo while the server holds it.
 * With `at` (ms), Send later: the server holds it until then, and Scheduled opens on it. This tab
 * doesn't follow it meanwhile: a refusal hours later shows in its Drafts row, as one from another tab.
 */
export function send(draft: DraftOut, at?: number) {
  // Undo, or a refusal, brings it back where it was sent from.
  const floating = byDraft(draft.id)?.floating ?? false;
  if (byDraft(draft.id)) setComposers(without(draft.id));
  if (at === undefined) sending.set(draft.id, {subject: draft.subject});
  const held = settledUploads(draft.id, {strict: true}).then(() => flushSave(draft.id)).then(() => sendDraft(draft.id, at));
  let toastId = 0;
  const undo = () => {
    dismissToast(toastId);
    void held.then(() => undoSend(draft.id)).then(back => {
      sending.delete(draft.id);
      reopen(back, {floating});
    }, (error: unknown) => {
      if (error instanceof ApiFailure && error.code === 'draft_not_held') showToast('Too late to undo, it\'s already sending', null, 'failed');
      else if (!(error instanceof ApiFailure && error.code === 'draft_sending')) toastFailure('Failed to undo')(error);
    });
  };
  toastId = at === undefined ? showToast('Sending', {label: 'Undo', run: undo})
    : showToast(`Scheduled for ${scheduledWhen(at, serverNow(), timeZone())}`, {label: 'Undo', run: undo}, {glyph: 'send'});
  // Scheduled opens on it once the list has it, so the page doesn't take it for gone.
  if (at !== undefined) void held.then(() => refresh(DRAFTS_PATH)).then(() => navigate({page: 'scheduled', open: draft.id}), () => {});
  held.catch((error: unknown) => {
    // Refused before the hold began (a save that failed, no one to send to, offline): the composer
    // comes back with what the user had, the server still owed what didn't land.
    sending.delete(draft.id);
    dismissToast(toastId);
    toastFailure('Failed to send')(error);
    void loadDraft(draft.id).then(back => reopen(back, {floating}), () => {});
  });
}

/**
 * Drafts as the server lists them now: a draft this tab sent that the provider refused comes
 * back with its words, in the toast with Open. One that left the list went.
 */
export function watchSends(drafts: DraftRowOut[] | undefined) {
  if (!drafts) return;
  for (const [id, {subject}] of sending) {
    const row = drafts.find(one => one.id === id);
    if (!row) {
      sending.delete(id);
      continue;
    }
    if (row.send_state !== 'failed') continue;
    sending.delete(id);
    void loadDraft(id).then(draft => {
      const words = refusalWords(null, draft.send?.error ?? null, 'the provider refused it');
      showToast(failureText(subject ? `Failed to send "${subject}"` : 'Failed to send', words), {label: 'Open', run: () => reopen(draft)}, 'failed');
      if (draft.message_id !== null && docked() === null && !byDraft(draft.id)) {
        const route = currentRoute();
        if ((route.page === 'inbox' || route.page === 'sent') && route.open === draft.message_id) show(draft, {caret: false});
      }
    }, () => {});
  }
}

/** A draft on its way out: where its composer was, the server's answer, and how to start it again. */
interface TakenAway {
  id: number;
  // Open in a composer when it went: in a window, else in the pane.
  open: boolean;
  floating: boolean;
  gone: Promise<void>;
  // Starts it again with its recipients, subject, body, quote, help me write's versions and files.
  again: () => Promise<DraftOut>;
}

/** The draft goes at once: its composer closes, what's queued for it is dropped, and the server is asked. */
function takeAway(draft: DraftOut): TakenAway {
  const target = byDraft(draft.id);
  const floating = target?.floating ?? false;
  if (target) closedOn = floating ? shownEmail() : target.messageId;
  // Help me write's line and versions, as the composer last had them, come back with Undo too.
  const write = writeNow(draft);
  const files = filesNow(draft.id, draft);
  forgetSaves(draft.id);
  // Only this tab's memory: a discarded draft's id never opens again (Undo starts a new one).
  forgetFiles(draft.id);
  discarded.add(draft.id);
  setComposers(without(draft.id));
  const gone = discardDraft(draft.id, draft.message_id);
  void gone.catch(() => {}).finally(() => discarded.delete(draft.id));
  const again = async (): Promise<DraftOut> => {
    const restarted = await startDraft(draft.message_id === null ? {kind: 'new', account_id: draft.from.account_id} : {kind: draft.kind as Exclude<DraftKind, 'new'>, message_id: draft.message_id});
    const {from, to, cc, bcc, subject, body, quote, removed_attachments} = draft;
    await saveDraft(restarted.id, {from, to, cc, bcc, subject, body, quote, removed_attachments, write});
    const taken = await takeDraftFiles(restarted.id, files.map(file => file.id));
    return {...restarted, from, to, cc, bcc, subject, body, quote, removed_attachments, write, files: taken};
  };
  return {id: draft.id, open: target !== null, floating, gone, again};
}

/** The composer's Discard: the draft goes at once, and Undo starts it again with everything it had. */
export function discard(draft: DraftOut) {
  const taken = takeAway(draft);
  taken.gone.catch(toastFailure(discardFailedLine(1)));
  showToast(discardedLine(1), {label: 'Undo', run: () => {
    void taken.gone.then(taken.again).then(back => reopen(back, {floating: taken.floating})).catch(toastFailure(broughtBackLine(0, 1)));
  }}, 'gone');
}

/** A draft as it is now: the composer's, with what it still owes the server, else the server's. */
function draftNow(draftId: number): Promise<DraftOut> {
  const cached = getCached<DraftOut>(draftPath(draftId));
  return cached ? Promise.resolve({...cached, ...owedOf(draftId)} as DraftOut) : loadDraft(draftId);
}

/**
 * Drafts' Discard on rows (`ids` in the list's order): every one goes, under one toast. Its Undo
 * starts each again, oldest first so they come back in their places in the list, and opens again
 * those that were open, where they were. When not all come back, a toast says how many did.
 * Answers the drafts that didn't go.
 */
export function discardDrafts(ids: number[]): Promise<number[]> {
  const taking = Promise.allSettled(ids.map(draftNow)).then(async loads => {
    const away = loads.flatMap(load => (load.status === 'fulfilled' ? [takeAway(load.value)] : []));
    const answers = await Promise.allSettled(away.map(one => one.gone));
    const refused = [
      ...loads.flatMap((load, at) => (load.status === 'rejected' ? [{id: ids[at]!, error: load.reason as unknown}] : [])),
      ...answers.flatMap((answer, at) => (answer.status === 'rejected' ? [{id: away[at]!.id, error: answer.reason as unknown}] : [])),
    ];
    return {went: away.filter((_, at) => answers[at]!.status === 'fulfilled'), refused};
  });
  const undo = () => void taking.then(async ({went}) => {
    let back = 0;
    let failure: {error: unknown} | null = null;
    for (const one of [...went].reverse()) {
      try {
        const again = await one.again();
        back += 1;
        if (one.open) reopen(again, {floating: one.floating});
      } catch (error) {
        failure ??= {error};
      }
    }
    if (failure) toastFailure(broughtBackLine(back, went.length))(failure.error);
  });
  showToast(discardedLine(ids.length), {label: 'Undo', run: undo}, 'gone');
  return taking.then(({refused}) => {
    if (refused.length) toastFailure(discardFailedLine(refused.length))(refused[0]!.error);
    return refused.map(one => one.id);
  });
}

/**
 * Drafts' Pop out, and its selection's Open: each draft in a window of its own, in the order given.
 * One up in a window comes back, the pane's pops out, the rest load and open, the caret in the last.
 * The windows fold as they do when they don't all fit.
 */
export function popOutDrafts(ids: number[]) {
  void Promise.allSettled(ids.map(id => (byDraft(id) ? Promise.resolve(null) : loadDraft(id)))).then(loads => {
    let failed = 0;
    let failure: unknown = null;
    loads.forEach((load, at) => {
      const id = ids[at]!;
      if (load.status === 'rejected') {
        failed += 1;
        failure ??= load.reason;
        return;
      }
      const up = byDraft(id);
      if (up?.floating) change(id, {minimized: false, touched: ++touches});
      else if (up) popOut(id);
      else if (load.value && !discarded.has(id)) show(load.value, {floating: true, caret: at === ids.length - 1});
    });
    if (failed) toastFailure(counted(failed, 'Failed to open the draft', n => `Failed to open ${n} drafts`))(failure);
  });
}

// ---- Help me write ----
//
// The line's ask goes to the server with the body as the composer has it, and the answer goes to the
// composer showing that draft, which puts it in as the user's own change and keeps a version for undo.
// The ask's state is kept here by draft, so a composer closed and opened again while it works shows
// it working and still takes the answer. With no composer on the draft when the answer comes, a whole
// body is saved straight into the draft, its versions with it; a selection's answer has no selection
// left to go into, so it's dropped. A failure leaves the body as it was and says why on the line.

export interface Writing {
  working: boolean;
  error: string | null;
}

const IDLE: Writing = {working: false, error: null};
const writes = new Map<number, Writing>();
const takers = new Map<number, (blocks: Block[], selection: boolean) => void>();

/** Where a draft's ask stands: working, failed with its words, or neither. */
export const writingOf = (draftId: number) => writes.get(draftId) ?? IDLE;
export const useWriting = (draftId: number | null) => useSyncExternalStore(subscribe, () => (draftId === null ? IDLE : writingOf(draftId)));

/** The composer showing a draft takes what's written for it; the function it gets back lets go. */
export function takeWritten(draftId: number, take: (blocks: Block[], selection: boolean) => void) {
  takers.set(draftId, take);
  return () => {
    if (takers.get(draftId) === take) takers.delete(draftId);
  };
}

/** Says why on the line (null clears it). */
export function writeError(draftId: number, error: string | null) {
  if (error === null && !writes.get(draftId)?.error) return;
  if (error === null) writes.delete(draftId);
  else writes.set(draftId, {working: false, error});
  notify();
}

/** Asks for a draft: the whole body, or with `selection` only that part. One ask at a time per draft. */
export async function helpMeWrite(draftId: number, input: {prompt: string; body: Block[]; selection: string | null}) {
  if (writes.get(draftId)?.working) return;
  writes.set(draftId, {working: true, error: null});
  notify();
  let blocks: Block[];
  try {
    blocks = (await writeDraft(draftId, input)).blocks;
  } catch (error) {
    writes.set(draftId, {working: false, error: failureLine('Failed to write', error)});
    notify();
    return;
  }
  writes.delete(draftId);
  notify();
  const take = takers.get(draftId);
  if (take) take(blocks, input.selection !== null);
  else if (input.selection === null) saveWritten(draftId, blocks);
}

/** A whole body written for a draft no composer shows: saved into it, with a version to undo to. */
function saveWritten(draftId: number, blocks: Block[]) {
  const draft = getCached<DraftOut>(draftPath(draftId));
  // A draft sent or sending meanwhile goes as the user left it.
  if (!draft || draft.send || sending.has(draftId) || discarded.has(draftId)) return;
  const now = {...draft, ...owedOf(draftId)} as DraftOut;
  const write = now.write ?? {prompt: '', open: false, ...NO_VERSIONS};
  queueSave(draftId, {body: blocks, write: {...write, ...recordVersion(write, now.body, blocks), prompt: ''}});
}

// ---- Files ----

/** A file on its way to a draft: its chip shows while it uploads. */
export interface Upload {
  key: number;
  name: string;
  size: number;
}

let uploadKeys = 0;
const NO_UPLOADS: Upload[] = [];
const uploads = new Map<number, Upload[]>();
// Each draft's uploads under way, and whether each landed.
const inFlight = new Map<number, Set<Promise<boolean>>>();
const fileErrors = new Map<number, string>();

const uploadsOf = (draftId: number) => uploads.get(draftId) ?? NO_UPLOADS;
export const useUploads = (draftId: number | null) => useSyncExternalStore(subscribe, () => (draftId === null ? NO_UPLOADS : uploadsOf(draftId)));
export const useFileError = (draftId: number | null) => useSyncExternalStore(subscribe, () => (draftId === null ? null : fileErrors.get(draftId) ?? null));

/** A draft's files as the composer last had them: the cache's, else the draft's own. */
function filesNow(draftId: number, draft: Pick<DraftOut, 'files'>): DraftOut['files'] {
  return getCached<DraftOut>(draftPath(draftId))?.files ?? draft.files;
}

/**
 * Answers once the draft's uploads under way have settled. `strict` (Send) fails when one of them
 * failed, so a message never goes without a file the user attached.
 */
function settledUploads(draftId: number, {strict = false} = {}): Promise<void> {
  const pending = [...inFlight.get(draftId) ?? []];
  return Promise.all(pending).then(results => {
    if (strict && results.includes(false)) throw new ApiFailure(0, 'file_failed', 'a file didn\'t attach');
  });
}

function forgetFiles(draftId: number) {
  uploads.delete(draftId);
  inFlight.delete(draftId);
  fileErrors.delete(draftId);
}

function setFileError(draftId: number, error: string | null) {
  if (error === null ? !fileErrors.delete(draftId) : fileErrors.get(draftId) === error) return;
  if (error !== null) fileErrors.set(draftId, error);
  notify();
}

/** Clears the line saying why a file didn't attach. */
export const dismissFileError = (draftId: number) => setFileError(draftId, null);

/**
 * Attaches files to a draft (the attach button, a drop, a paste), each uploaded at once. One that
 * would take the attachments over 25 MB, counting `originals` less those `removed` (a forward's),
 * is refused here with the reason; the server checks again.
 */
export function attachFiles(draftId: number, files: File[], originals: {id: number; size_bytes: number}[] = [], removed: number[] = []) {
  if (!files.length) return;
  setFileError(draftId, null);
  for (const file of files) {
    const held = filesNow(draftId, {files: []});
    const total = attachmentsTotal([...held, ...uploadsOf(draftId).map(one => ({size_bytes: one.size}))], originals, removed) + file.size;
    if (total > ATTACHMENTS_MAX_BYTES) {
      setFileError(draftId, failureText(`Failed to attach ${file.name}`, `attachments can total 25 MB and these would be ${megabytes(total)}`));
      continue;
    }
    const upload: Upload = {key: ++uploadKeys, name: file.name, size: file.size};
    uploads.set(draftId, [...uploadsOf(draftId), upload]);
    notify();
    const done = uploadDraftFile(draftId, file).then(() => true, (error: unknown) => {
      setFileError(draftId, failureLine(`Failed to attach ${file.name}`, error));
      return false;
    }).finally(() => {
      uploads.set(draftId, uploadsOf(draftId).filter(one => one !== upload));
      inFlight.get(draftId)?.delete(done);
      notify();
    });
    inFlight.set(draftId, new Set([...inFlight.get(draftId) ?? [], done]));
  }
}

/** A chip's x: the file comes off the draft, and off the server. */
export function removeFile(draftId: number, fileId: number) {
  setFileError(draftId, null);
  void removeDraftFile(draftId, fileId).catch((error: unknown) => {
    setFileError(draftId, failureLine('Failed to remove the file', error));
    void loadDraft(draftId).then(draft => setCached(draftPath(draftId), draft), () => {});
  });
}
