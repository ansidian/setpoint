// The composer's state, one for the whole app: one composer is open at a time, in the reading pane
// under its email. Opening another email leaves the draft where it is (its row carries the draft
// mark), and its composer opens again when the email is shown again. Esc closes it, keeping the
// draft, and it stays closed while that email stays shown.
//
// Saving: each field's change is queued and sent DRAFT_SAVE_MS after the last one, one save after
// another so the last write wins. Send, Esc, opening another draft and leaving the page save at once.
// Nothing shows while it works. A save that fails says so in the composer until one lands.
//
// Send: the composer closes and the toast reads "Sending" with Undo. The toast shows at the press,
// before the server's hold has begun, so its 6 seconds end before the server's: Undo is never
// offered once the server would refuse it. An Undo the server refuses all the same (a slow answer)
// says it was too late. Undo opens the composer again, everything in place. The hold over, the
// draft is gone once the provider took it. If the provider refused it, the draft comes back with
// its words and Try again: on its email, in the toast (Open), and in Drafts.
//
// Discard has no key: the draft goes at once, and the toast's Undo starts it again as it was. A
// draft nothing was written in goes quietly when its composer closes.
//
// A new message (C) has no email to stay with: it opens in the pane by itself, and showing an email
// closes it into Drafts. On Drafts, the open draft is the page's own (its address names it).
import type {DraftCreateInput, DraftKind, DraftOut, DraftRowOut, DraftUpdateInput, FromOut, MessageOut} from '@setpoint/shared';
import {useSyncExternalStore} from 'react';
import {ApiFailure, getCached, getJson} from '../../api/client.ts';
import {discardDraft, draftPath, FROM_PATH, loadDraft, saveDraft, sendDraft, startDraft, undoSend} from '../../api/drafts.ts';
import {messagePath} from '../../api/mail.ts';
import {hasOthers, unwritten} from '../../logic/composer.ts';
import {currentRoute, navigate} from '../router.ts';
import {dismissToast, failureLine, showToast, toastFailure} from '../toast.ts';

/** How long after the last change a draft is saved. */
export const DRAFT_SAVE_MS = 600;

export interface OpenComposer {
  draftId: number;
  messageId: number | null;
  kind: DraftKind;
  // Where the caret lands: the body when it already has someone to go to, else To. None when it
  // opened again by itself on its email, so J and K go on stepping through the list.
  focus: 'body' | 'to' | null;
  // A new one for each opening, so a composer opened again draws the draft afresh.
  key: number;
}

let open: OpenComposer | null = null;
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

export const useOpenComposer = () => useSyncExternalStore(subscribe, () => open);
export const useSaveError = (draftId: number) => useSyncExternalStore(subscribe, () => saveErrors.get(draftId) ?? null);
export const openComposer = () => open;

// ---- Saving ----

const queued = new Map<number, DraftUpdateInput>();
const timers = new Map<number, number>();
// Each draft's saves, one after another.
const chains = new Map<number, Promise<void>>();

/** Queues a change to the draft, saved a moment after the last one. */
export function queueSave(draftId: number, changes: DraftUpdateInput) {
  queued.set(draftId, {...queued.get(draftId), ...changes});
  window.clearTimeout(timers.get(draftId));
  timers.set(draftId, window.setTimeout(() => void flushSave(draftId), DRAFT_SAVE_MS));
}

/** Saves what's queued now, and answers once every save of the draft so far has landed. */
export function flushSave(draftId: number, {keepalive = false} = {}): Promise<void> {
  window.clearTimeout(timers.get(draftId));
  timers.delete(draftId);
  const changes = queued.get(draftId);
  queued.delete(draftId);
  const before = chains.get(draftId) ?? Promise.resolve();
  if (!changes) return before;
  const next = before.then(() => saveDraft(draftId, changes, {keepalive})).then(() => {
    if (saveErrors.delete(draftId)) notify();
  }, (error: unknown) => {
    // A save refused because the draft is sending or gone has nothing left to keep.
    if (error instanceof ApiFailure && (error.status === 404 || error.code === 'draft_held' || error.code === 'draft_sending')) return;
    saveErrors.set(draftId, failureLine('Couldn\'t save the draft', error));
    notify();
    throw error;
  });
  chains.set(draftId, next.catch(() => {}));
  return next;
}

/** Drops what's queued for a draft that's going away. */
function forgetSaves(draftId: number) {
  window.clearTimeout(timers.get(draftId));
  timers.delete(draftId);
  queued.delete(draftId);
  saveErrors.delete(draftId);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    for (const draftId of [...queued.keys()]) void flushSave(draftId, {keepalive: true}).catch(() => {});
  });
}

// ---- Opening and closing ----

/**
 * The composer gives up its draft (closed, or another opening): saved now, or, when nothing was
 * written in it, discarded quietly, so an R or C let go of leaves nothing in Drafts.
 */
function letGo(draftId: number) {
  const draft = getCached<DraftOut>(draftPath(draftId));
  const now = draft ? {...draft, ...queued.get(draftId)} as DraftOut : null;
  if (now && !now.send && unwritten(now)) {
    forgetSaves(draftId);
    discarded.add(draftId);
    void discardDraft(draftId, now.message_id).catch(() => {}).finally(() => discarded.delete(draftId));
    return;
  }
  void flushSave(draftId).catch(() => {});
}

function show(draft: Pick<DraftOut, 'id' | 'message_id' | 'kind' | 'to' | 'cc' | 'bcc'>, {caret = true} = {}) {
  if (open && open.draftId !== draft.id) letGo(open.draftId);
  const someone = draft.to.length + draft.cc.length + draft.bcc.length > 0;
  open = {draftId: draft.id, messageId: draft.message_id, kind: draft.kind, focus: caret ? (someone ? 'body' : 'to') : null, key: ++opened};
  closedOn = null;
  notify();
}

/** Starts (or takes up again) a draft of `kind` on an email, or a new message, and opens it. */
export function startComposer(input: DraftCreateInput) {
  if (open && input.kind !== 'new' && open.messageId === input.message_id && open.kind === input.kind) {
    // Already open: R again puts the caret back in it.
    document.querySelector<HTMLElement>('.composer .desc-edit')?.focus();
    return;
  }
  void startDraft(input).then(show, toastFailure(input.kind === 'forward' ? 'Couldn\'t start the forward' : input.kind === 'new' ? 'Couldn\'t start a message' : 'Couldn\'t start the reply'));
}

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

/** Esc, or the composer's close: it closes, the draft kept. */
export function closeComposer() {
  if (!open) return;
  letGo(open.draftId);
  closedOn = open.messageId;
  open = null;
  notify();
}

/** Whether a draft can open by itself: not while its send is held or under way, or it's going. */
const openable = (row: DraftRowOut) => row.send_state !== 'held' && row.send_state !== 'sending' && !sending.has(row.id) && !discarded.has(row.id);

/**
 * The reader shows `messageId`: its draft's composer opens again, the latest one when it has more
 * than one, unless the user closed it here. Showing another email lets the closed one open again.
 */
export function showEmail(messageId: number, drafts: DraftRowOut[] | undefined) {
  if (closedOn !== null && closedOn !== messageId) closedOn = null;
  // A new message gives the pane to the email, kept in Drafts.
  if (open && open.messageId === null) closeComposer();
  if (!drafts || closedOn === messageId || open?.messageId === messageId) return;
  const draft = drafts.filter(row => row.message_id === messageId && openable(row)).sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (!draft) return;
  void loadDraft(draft.id).then(full => {
    // Something else opened meanwhile, or it was sent or discarded.
    if (closedOn === messageId || open?.messageId === messageId || sending.has(full.id) || discarded.has(full.id)) return;
    show(full, {caret: false});
  }, () => {});
}

/** C: a new message, from the account asked for (Sent's selected one), else the one last sent from. */
export function newMessage(accountId?: number) {
  const route = currentRoute();
  // The pane is the message's: an email open there gives way.
  if ((route.page === 'inbox' || route.page === 'sent') && route.open !== null) navigate({...route, open: null});
  if (route.page === 'drafts' && route.open !== null) navigate({page: 'drafts', open: null});
  startComposer({kind: 'new', ...(accountId ? {account_id: accountId} : {})});
}

/** Drafts' row: its draft opens in Drafts' pane, the caret in it. */
export function openDraft(draftId: number) {
  if (open?.draftId === draftId) return;
  void loadDraft(draftId).then(draft => show(draft), toastFailure('Couldn\'t open the draft'));
}

/** Opens the draft, showing its email first when the page shows another (Undo, a failure's Open). */
function reopen(draft: DraftOut) {
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
  show(draft);
}

// ---- Send, Undo, failures ----

// The drafts this tab sent, watched until the provider took each (it leaves Drafts) or refused it.
const sending = new Map<number, {subject: string}>();
// Discarded drafts on their way out, kept from opening again meanwhile.
const discarded = new Set<number>();

/** ⌘Enter or Send (and Try again): the composer closes and the toast offers Undo while the server holds it. */
export function send(draft: DraftOut) {
  if (open?.draftId === draft.id) {
    open = null;
    notify();
  }
  sending.set(draft.id, {subject: draft.subject});
  const held = flushSave(draft.id).then(() => sendDraft(draft.id));
  let toastId = 0;
  const undo = () => {
    dismissToast(toastId);
    void held.then(() => undoSend(draft.id)).then(back => {
      sending.delete(draft.id);
      reopen(back);
    }, (error: unknown) => {
      if (error instanceof ApiFailure && error.code === 'draft_not_held') showToast('Too late to undo, it\'s already sending', null, 'failed');
      else if (!(error instanceof ApiFailure && error.code === 'draft_sending')) toastFailure('Couldn\'t undo it')(error);
    });
  };
  toastId = showToast('Sending', {label: 'Undo', run: undo});
  held.catch((error: unknown) => {
    // Refused before the hold began (no one to send to, offline): the composer comes back.
    sending.delete(draft.id);
    dismissToast(toastId);
    toastFailure('Couldn\'t send it')(error);
    void loadDraft(draft.id).then(reopen, () => {});
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
      const words = draft.send?.error ?? 'the provider refused it';
      showToast(`Couldn't send ${subject ? `"${subject}"` : 'it'}, ${words}`, {label: 'Open', run: () => reopen(draft)}, 'failed');
      if (draft.message_id !== null && open === null) {
        const route = currentRoute();
        if ((route.page === 'inbox' || route.page === 'sent') && route.open === draft.message_id) show(draft, {caret: false});
      }
    }, () => {});
  }
}

/** Discard: the draft goes at once, and Undo starts it again with everything it had. */
export function discard(draft: DraftOut) {
  if (open?.draftId === draft.id) {
    closedOn = open.messageId;
    open = null;
  }
  forgetSaves(draft.id);
  discarded.add(draft.id);
  notify();
  const gone = discardDraft(draft.id, draft.message_id);
  gone.catch(toastFailure('Couldn\'t discard the draft')).finally(() => discarded.delete(draft.id));
  showToast('Draft discarded', {label: 'Undo', run: () => {
    void gone.then(async () => {
      const again = await startDraft(draft.message_id === null ? {kind: 'new', account_id: draft.from.account_id} : {kind: draft.kind as Exclude<DraftKind, 'new'>, message_id: draft.message_id});
      const {from, to, cc, bcc, subject, body, quote, removed_attachments} = draft;
      await saveDraft(again.id, {from, to, cc, bcc, subject, body, quote, removed_attachments});
      reopen({...again, from, to, cc, bcc, subject, body, quote, removed_attachments});
    }).catch(toastFailure('Couldn\'t bring the draft back'));
  }}, 'gone');
}
