// Mail's resources and changes (shared/src/api/mail.ts has the routes). Every change shows at once
// on screen, counts included (DESIGN.md › Interaction rules), then the server's answer takes over:
// opening, Done, Pin, Mark read or unread and Mark all as read here; Trash in the Inbox page. Read
// state, Trash and Mark all as read are commands the provider confirms, by the live stream.
import type {AllOut, CommandOut, InboxOut, MailCountsOut, MarkAllReadOut, MessageOut, MessageRowOut, TrustedDomainOut} from '@setpoint/shared';
import {countsAfterDone, countsAfterOpen, inboxAfterDone, inboxAfterMarkAllRead, inboxAfterOpen, inboxAfterPin, inboxAfterUnread, markAllReads} from '../logic/inbox.ts';
import type {PatternPrompt} from '../logic/inbox.ts';
import {afterPending, ApiFailure, cachedPaths, getCached, holdLoads, loadingOf, refreshIfShown, sendJson, setCached, updateCached} from './client.ts';

export const inboxPath = (account: number | null) => (account ? `/mail/inbox?account_id=${account}` : '/mail/inbox');
export const COUNTS_PATH = '/mail/counts';
export const messagePath = (id: number) => `/mail/messages/${id}`;
export const ACCOUNTS_PATH = '/accounts';

/** A page of All: `before` is the previous page's `next_before`. */
export const ALL_PAGE = 100;
export const allPath = (account: number | null, before: string | null = null) =>
  `/mail/all?limit=${ALL_PAGE}${account ? `&account_id=${account}` : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`;

// B3's pattern prompts (logic/inbox.ts › PatternPrompt is the part of its shape the web reads).
// Where B3 isn't there the route answers 404, and the Inbox shows no prompt.
export const PROMPTS_PATH = '/mail/prompts';

/** Triage's health, for the Unsorted group's "Triage is down, as of 9:09 AM". */
export const TRIAGE_PATH = '/mail/triage';

/**
 * The email's HTML body as its own page, for the reader's sandboxed frame (its own policy; Show
 * asks for its remote images this time).
 */
export const emailBodyPath = (id: number, show: boolean) => `/api/mail/messages/${id}/body${show ? '?images=show' : ''}`;

const inboxPaths = () => cachedPaths('/mail/inbox');

/** An email's row in the Inbox as last loaded, wherever it shows, and whether it's in Attention. */
function cachedRow(id: number): {row: MessageRowOut; attention: boolean} | null {
  for (const path of inboxPaths()) {
    const inbox = getCached<InboxOut>(path);
    for (const group of inbox?.groups ?? []) {
      const row = group.rows.find(item => item.id === id);
      if (row) return {row, attention: inbox!.groups.some(other => other.group === 'attention' && other.rows.some(item => item.id === id))};
    }
  }
  return null;
}

/** An email's row in All as last loaded. */
function cachedAllRow(id: number): MessageRowOut | null {
  for (const path of cachedPaths('/mail/all')) {
    const row = getCached<AllOut>(path)?.days.flatMap(day => day.rows).find(item => item.id === id);
    if (row) return row;
  }
  return null;
}

/** Changes each loaded row of All, at once. */
function updateAllRows(change: (row: MessageRowOut) => MessageRowOut) {
  for (const path of cachedPaths('/mail/all')) {
    updateCached<AllOut>(path, page => ({...page, days: page.days.map(day => ({...day, rows: day.rows.map(change)}))}));
  }
}

/** The sidebar's counts as the full Inbox now has them (its counts are every account's, and its rows say which changed). */
function followInboxCounts() {
  const all = getCached<InboxOut>(inboxPath(null));
  if (all) setCached(COUNTS_PATH, all.counts);
}

// The latest change made here to each email. A change's answer is the email as the server had it
// then, so one that arrives after a later change's (P while the open is still on its way) would put
// back what that change did: it's left out, and the later one's answer, or its at-once effect, stays.
const edits = new Map<number, number>();
let edited = 0;

/** Marks a change to the email; its answer shows only if it's still the latest (`answered`). */
function edit(id: number): number {
  edited += 1;
  edits.set(id, edited);
  return edited;
}

function answered(id: number, mark: number, message: MessageOut) {
  if (edits.get(id) === mark) setCached(messagePath(id), message);
}

/**
 * Changes the email as the reader has it, at once if it's loaded, else as its first load lands, since
 * that load's answer may be from before the change (P before the email is in); a change, as `edit`
 * marks it.
 */
function updateMessage(id: number, change: Partial<MessageOut>): number {
  const path = messagePath(id);
  const apply = () => updateCached<MessageOut>(path, message => ({...message, ...change}));
  if (getCached<MessageOut>(path)) apply();
  else void loadingOf(path)?.then(apply);
  return edit(id);
}

/** Loads the lists and counts again, after a change. */
export function refreshMail() {
  for (const path of [...inboxPaths(), COUNTS_PATH, ...cachedPaths('/mail/all')]) refreshIfShown(path);
}

async function change<T>(send: () => Promise<T>): Promise<T> {
  try {
    return await send();
  } finally {
    refreshMail();
  }
}

/** Opens an email (a click or Enter): an unread one turns read, and the unread counts drop at once. */
export function openMessage(id: number): Promise<MessageOut> {
  const found = cachedRow(id);
  if (found?.row.unread) {
    for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterOpen(inbox, id));
    updateCached<MailCountsOut>(COUNTS_PATH, counts => countsAfterOpen(counts, found.row));
  }
  const mark = edit(id);
  return change(async () => {
    const message = await sendJson<MessageOut>('POST', `/mail/messages/${id}/open`);
    answered(id, mark, message);
    return message;
  });
}

/** Done (`H`): out of Attention at once; the pill drops. */
export function setDone(id: number, done = true): Promise<MessageOut> {
  const found = cachedRow(id);
  if (done && found) {
    for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterDone(inbox, id));
    updateCached<MailCountsOut>(COUNTS_PATH, counts => countsAfterDone(counts, found.row, found.attention));
  }
  // All keeps Done mail, so its row and the reader show the change at once (SV-69).
  updateAllRows(row => (row.id === id ? {...row, done} : row));
  const mark = updateMessage(id, {done});
  return change(async () => {
    const message = await sendJson<MessageOut>('POST', `/mail/messages/${id}/done`, {done});
    answered(id, mark, message);
    return message;
  });
}

// SV-80: each email's pin changes go one at a time. Two sent together (P, then P again before the
// first is answered) can reach the server in either order and leave it pinned while the screen
// says unpinned, so a change made while one is on its way only updates what's wanted, and that is
// sent once the one in flight is answered, if it differs. The last asked is what the server keeps,
// and the lists and the email hold their answers meanwhile, so one landing between the two can't
// show the pin back.
const pinning = new Map<number, {wanted: boolean; mark: number; done: Promise<MessageOut>}>();

/**
 * Pin (`P`) puts it on the Pinned shelf, or takes it off, at once on screen. Every way to pin
 * comes here (the reader's P, the Pinned toast's Undo, the shelf's Unpin); it resolves with the
 * email as the server has it once the last change asked is in.
 */
export function setPinned(id: number, pinned: boolean): Promise<MessageOut> {
  const fromAll = cachedAllRow(id);
  for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterPin(inbox, id, pinned, fromAll));
  updateAllRows(row => (row.id === id ? {...row, pinned} : row));
  const mark = updateMessage(id, {pinned});
  const queued = pinning.get(id);
  if (queued) {
    queued.wanted = pinned;
    queued.mark = mark;
    return queued.done;
  }
  const state = {wanted: pinned, mark} as {wanted: boolean; mark: number; done: Promise<MessageOut>};
  const release = holdLoads(['/mail/inbox', '/mail/all', messagePath(id)]);
  state.done = change(async () => {
    try {
      let sent: boolean;
      let message: MessageOut;
      do {
        sent = state.wanted;
        message = await sendJson<MessageOut>('POST', `/mail/messages/${id}/pin`, {pinned: sent});
      } while (state.wanted !== sent);
      answered(id, state.mark, message);
      return message;
    } finally {
      pinning.delete(id);
      release();
    }
  });
  pinning.set(id, state);
  return state.done;
}

/** Mark unread (⌘K on an open email): a command the provider confirms. */
export function markUnread(id: number): Promise<CommandOut> {
  for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterUnread(inbox, id));
  followInboxCounts();
  updateAllRows(row => (row.id === id ? {...row, unread: true} : row));
  updateMessage(id, {unread: true});
  return change(() => afterPending(() => sendJson<CommandOut>('POST', `/mail/messages/${id}/read`, {unread: true})));
}

/** Mark read (the phone's reader, after Mark unread). */
export function markRead(id: number): Promise<CommandOut> {
  const found = cachedRow(id);
  if (found?.row.unread) {
    for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterOpen(inbox, id));
    updateCached<MailCountsOut>(COUNTS_PATH, counts => countsAfterOpen(counts, found.row));
  }
  updateAllRows(row => (row.id === id ? {...row, unread: false} : row));
  updateMessage(id, {unread: false});
  return change(() => afterPending(() => sendJson<CommandOut>('POST', `/mail/messages/${id}/read`, {unread: false})));
}

/** Trash (`E`), to the provider's trash, with Undo for 6 seconds. */
export const trashMessage = (id: number) => change(() => afterPending(() => sendJson<CommandOut>('POST', `/mail/messages/${id}/trash`)));

/** Trash's Undo: back out of the provider's trash. */
export const untrashMessage = (id: number) => change(() => afterPending(() => sendJson<CommandOut>('POST', `/mail/messages/${id}/untrash`)));

/** "Always show from contosocoffee.example": remote content from this domain loads from now on. */
export async function trustDomain(domain: string, messageId: number): Promise<TrustedDomainOut[]> {
  try {
    return await sendJson<TrustedDomainOut[]>('POST', '/mail/trusted-domains', {domain});
  } finally {
    refreshIfShown(messagePath(messageId));
  }
}

/** A pattern prompt's Yes (a learned rule) or No; B3 answers with the prompts that remain. */
export async function answerPrompt(id: number, yes: boolean): Promise<void> {
  try {
    const remaining = await sendJson<PatternPrompt[] | undefined>('POST', `${PROMPTS_PATH}/${id}`, {answer: yes ? 'yes' : 'no'});
    if (Array.isArray(remaining)) setCached(PROMPTS_PATH, remaining);
    else refreshIfShown(PROMPTS_PATH);
  } catch (error) {
    // Answered already (409), or gone (404): the list as the server has it now.
    refreshIfShown(PROMPTS_PATH);
    throw error;
  }
}

/** An attachment's address, for its Download link: served inline, so the link's `download` saves it. */
export const attachmentUrl = (messageId: number, attachmentId: number) => `/api/mail/messages/${messageId}/attachments/${attachmentId}`;

/**
 * An attachment's bytes, for its preview (GET /api/mail/messages/:id/attachments/:a, through the
 * account's adapter); a failure carries the server's words for the preview to show.
 */
export async function attachmentBlob(messageId: number, attachmentId: number): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(attachmentUrl(messageId, attachmentId));
  } catch {
    throw new ApiFailure(0, 'unreachable', 'Can’t reach Setpoint');
  }
  if (!response.ok) {
    const error = await response.json().catch(() => undefined) as {error?: {code?: string; message?: string}} | undefined;
    throw new ApiFailure(response.status, error?.error?.code ?? 'http_error', error?.error?.message ?? response.statusText);
  }
  return response.blob();
}

/** Mark all as read (⇧I): every unread email outside Attention and Security, Noise included, for one account or all. */
export function markAllRead(account: number | null): Promise<MarkAllReadOut> {
  for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterMarkAllRead(inbox, account));
  followInboxCounts();
  updateAllRows(row => (markAllReads(row, account) ? {...row, unread: false} : row));
  return change(() => sendJson<MarkAllReadOut>('POST', '/mail/mark-all-read', account ? {account_id: account} : {}));
}
