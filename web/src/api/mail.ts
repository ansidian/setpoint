// Mail's resources and changes (shared/src/api/mail.ts has the routes). Every change shows at once
// on screen, counts included, then the server's answer takes over. A change acts on a whole
// conversation (opening, Done, Pin, Snooze and Unsnooze, Mark read or unread, Trash), and its Undo
// puts each email back. Read state, Trash and Mark all as read are commands the provider confirms,
// by the live stream.
import type {AllOut, ConversationChangeOut, ConversationUndo, InboxOut, MailConversationOut, MailCountsOut, MarkAllReadOut, MessageOut, MessageRowOut, SnoozedOut, TrustedDomainOut} from '@setpoint/shared';
import {holds, replyTarget} from '../logic/conversation.ts';
import {countsAfterDone, countsAfterOpen, inboxAfterDone, inboxAfterMarkAllRead, inboxAfterOpen, inboxAfterPin, inboxAfterSnooze, inboxAfterUnread, markAllReads} from '../logic/inbox.ts';
import type {PatternPrompt} from '../logic/inbox.ts';
import {afterPending, ApiFailure, cachedPaths, getCached, getJson, holdLoads, loadingOf, refreshIfShown, sendJson, setCached, updateCached} from './client.ts';

export const INBOX_PATH = '/mail/inbox';
export const COUNTS_PATH = '/mail/counts';
// How the mail day is going: the Inbox's empty pane.
export const DAY_PATH = '/mail/day';
export const messagePath = (id: number) => `/mail/messages/${id}`;
const CONVERSATIONS_PATH = '/mail/conversations';
/** Email `id`'s conversation, as the reader shows it (any of its emails' ids names it). */
export const conversationPath = (id: number) => `${CONVERSATIONS_PATH}/${id}`;
/** Which email, if any, a description's Gmail link names. */
export const gmailLinkPath = (account: string, id: string) => `/mail/gmail-link?account=${encodeURIComponent(account)}&id=${encodeURIComponent(id)}`;
export const ACCOUNTS_PATH = '/accounts';
/** The snoozed emails, soonest return first: the sidebar's Snoozed row and its page. */
export const SNOOZED_PATH = '/mail/snoozed';

/** A page of All: `before` is the previous page's `next_before`. */
export const ALL_PAGE = 100;
export const allPath = (before: string | null = null) =>
  `/mail/all?limit=${ALL_PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`;

/** A page of Sent, for one account or every one: `before` is the previous page's `next_before`. */
export const sentPath = (account: number | null, before: string | null = null) =>
  `/mail/sent?limit=${ALL_PAGE}${account ? `&account_id=${account}` : ''}${before ? `&before=${encodeURIComponent(before)}` : ''}`;

// Triage's pattern prompts (logic/inbox.ts › PatternPrompt is the part of its shape the web reads).
// Where triage isn't there the route answers 404, and the Inbox shows no prompt.
export const PROMPTS_PATH = '/mail/prompts';

/** Triage's health, for the Unsorted group's "Triage is down, as of 9:09 AM". */
export const TRIAGE_PATH = '/mail/triage';

/**
 * The email's HTML body as its own page, for the reader's sandboxed frame (its own policy). It has
 * its remote images or not, as the rule or Show has it. Either way is named, so the browser keeps it.
 * Folded (`fold`), its quoted history is left out, for ••• to show again.
 */
export const emailBodyPath = (id: number, images: boolean, fold = false) => `/api/mail/messages/${id}/body?images=${images ? 'show' : 'hide'}${fold ? '&quoted=fold' : ''}`;

/** Email `id` as last loaded: on its own (the phone's reader) or in a conversation the reader holds. */
export function cachedEmail(id: number): MessageOut | undefined {
  const own = getCached<MessageOut>(messagePath(id));
  if (own) return own;
  for (const path of cachedPaths(CONVERSATIONS_PATH)) {
    const email = getCached<MailConversationOut>(path)?.emails.find(one => one.id === id);
    if (email) return email;
  }
  return undefined;
}

/** Refreshes each conversation on screen that holds email `id`: its draft line or its emails changed. */
export function refreshConversationsOf(id: number) {
  for (const path of cachedPaths(CONVERSATIONS_PATH)) {
    if (getCached<MailConversationOut>(path)?.emails.some(one => one.id === id)) refreshIfShown(path);
  }
}

/**
 * What R (and the stacked reader's foot) answers on email `id`'s conversation: its newest email
 * someone else sent, from the reader's copy or asked for now. Email `id` itself when it can't be read.
 */
export async function replyTargetOf(id: number): Promise<number> {
  const conversation = getCached<MailConversationOut>(conversationPath(id)) ?? await getJson<MailConversationOut>(conversationPath(id)).catch(() => null);
  return (conversation && replyTarget(conversation.emails)) ?? id;
}

const inboxPaths = () => cachedPaths('/mail/inbox');

/** Email `id`'s conversation's row in the Inbox as last loaded, wherever it shows, and whether it's in Attention. */
function cachedRow(id: number): {row: MessageRowOut; attention: boolean} | null {
  for (const path of inboxPaths()) {
    const inbox = getCached<InboxOut>(path);
    for (const group of inbox?.groups ?? []) {
      const row = group.rows.find(item => holds(item, id));
      if (row) return {row, attention: inbox!.groups.some(other => other.group === 'attention' && other.rows.some(item => holds(item, id)))};
    }
  }
  return null;
}

/** Email `id`'s conversation's row in All as last loaded. */
function cachedAllRow(id: number): MessageRowOut | null {
  for (const path of cachedPaths('/mail/all')) {
    const row = getCached<AllOut>(path)?.days.flatMap(day => day.rows).find(item => holds(item, id));
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
  const all = getCached<InboxOut>(INBOX_PATH);
  if (all) setCached(COUNTS_PATH, all.counts);
}

// The latest change made here to each conversation, by the id it was asked by. A change's answer
// says what it sent, not the email as it is now, so the email and its conversation load again once
// it's in. A load asked after a later change (P while the open is still on its way) would show what
// that one did, so only the latest change's answer loads them again; the at-once effect stays meanwhile.
const edits = new Map<number, number>();
let edited = 0;

/** Marks a change to the conversation. Its answer loads it again only if it's still the latest (`settled`). */
function edit(id: number): number {
  edited += 1;
  edits.set(id, edited);
  return edited;
}

/** The conversations the reader holds that email `id` is in: their paths. */
const conversationsOf = (id: number) => cachedPaths(CONVERSATIONS_PATH).filter(path => getCached<MailConversationOut>(path)?.emails.some(email => email.id === id));

function settled(id: number, mark: number) {
  if (edits.get(id) !== mark) return;
  refreshIfShown(messagePath(id));
  for (const path of conversationsOf(id)) refreshIfShown(path);
}

/**
 * Changes the conversation as the reader has it, at once if it's loaded: its row (the tools) and
 * the phone's email. An email still loading takes the change as its load lands, since that answer
 * may be from before it (P before the email is in). A change, as `edit` marks it.
 */
function updateMessage(id: number, change: Partial<MessageRowOut>): number {
  const path = messagePath(id);
  const apply = () => updateCached<MessageOut>(path, message => ({...message, ...change}));
  if (getCached<MessageOut>(path)) apply();
  else void loadingOf(path)?.then(apply);
  // The conversation's row and each of its emails, as the change applies to every one.
  const changed = (one: string) => () => updateCached<MailConversationOut>(one, conversation => ({
    ...conversation, row: {...conversation.row, ...change}, emails: conversation.emails.map(email => ({...email, ...change})),
  }));
  for (const one of conversationsOf(id)) changed(one)();
  const own = conversationPath(id);
  if (!getCached<MailConversationOut>(own)) void loadingOf(own)?.then(changed(own));
  return edit(id);
}

// Where a change to an email shows at once. A load asked while the change is on its way can be
// answered from before the server has the change, so these hold their answers until it's in.
const MAIL_LOADS = ['/mail/inbox', '/mail/all', '/mail/sent', SNOOZED_PATH, COUNTS_PATH, DAY_PATH];

/** Sends a change with the lists and counts held; the release loads them again. */
async function change<T>(send: () => Promise<T>): Promise<T> {
  const release = holdLoads(MAIL_LOADS);
  try {
    return await send();
  } finally {
    release();
  }
}

/** A change to email `id`'s whole conversation, by its route (`/done`, `/pin`…); loads it again once in. */
function changeConversation(id: number, mark: number, route: string, input?: unknown): Promise<ConversationChangeOut> {
  return change(async () => {
    try {
      return await afterPending(() => sendJson<ConversationChangeOut>('POST', `${conversationPath(id)}/${route}`, input));
    } finally {
      settled(id, mark);
    }
  });
}

/**
 * One change to several conversations (a selection's). Each gets its own change, as for one, and
 * all are sent together. The lists' and counts' answers are held until the last is in, so one
 * landing between them doesn't bring back for a moment what the others did at once. A change to one
 * goes as it always has. Each one's outcome.
 */
export async function changeEach<T>(ids: number[], change: (id: number) => Promise<T>): Promise<PromiseSettledResult<T>[]> {
  const release = ids.length > 1 ? holdLoads(MAIL_LOADS) : () => undefined;
  try {
    return await Promise.allSettled(ids.map(id => change(id)));
  } finally {
    release();
  }
}

/** The conversations whose change the server refused, with why, from `changeEach`'s outcomes. */
export function refusals(ids: number[], outcomes: PromiseSettledResult<unknown>[]): {id: number; error: unknown}[] {
  return outcomes.flatMap((outcome, at) => (outcome.status === 'rejected' ? [{id: ids[at]!, error: outcome.reason as unknown}] : []));
}

// Each conversation's answer to its last opening, by the email it was opened at. Only it says which
// emails open expanded (any unread before the opening read them). A load's answer judges by read
// state as it is, so one served after the opening leaves the emails it read collapsed.
const opened = new Map<number, MailConversationOut>();

/** The answer to the latest opening at email `id`, once it's in (the stacked reader seeds from it). */
export const openingOf = (id: number): MailConversationOut | undefined => opened.get(id);

/**
 * Opens email `id`'s conversation (a click or Enter): every unread email of it turns read, and the
 * unread counts drop at once. The answer is the conversation as it opened, which emails expanded
 * included (judged on the read state from before), so the reader takes it from here. `listed` when
 * it's opened from its row in a list: the email the row names then expands only as any other does.
 */
export function openMessage(id: number, {listed = false}: {listed?: boolean} = {}): Promise<MailConversationOut> {
  // This opening's answer is the one that judges which emails open expanded.
  opened.delete(id);
  const found = cachedRow(id);
  if (found?.row.unread) {
    for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterOpen(inbox, id));
    updateCached<MailCountsOut>(COUNTS_PATH, counts => countsAfterOpen(counts, found.row));
    updateAllRows(row => (holds(row, id) ? {...row, unread: false} : row));
  }
  const mark = edit(id);
  return change(async () => {
    const conversation = await sendJson<MailConversationOut>('POST', `${conversationPath(id)}/open`, listed ? {listed} : undefined);
    opened.set(id, conversation);
    if (edits.get(id) === mark) {
      setCached(conversationPath(id), conversation);
      refreshIfShown(messagePath(id));
    }
    return conversation;
  });
}

/** Done (`H`) on the whole conversation: out of Attention at once, and the pill drops. */
export function setDone(id: number, done = true): Promise<ConversationChangeOut> {
  const found = cachedRow(id);
  if (done && found) {
    for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterDone(inbox, id));
    updateCached<MailCountsOut>(COUNTS_PATH, counts => countsAfterDone(counts, found.row, found.attention));
  }
  // All keeps Done mail, so its row and the reader show the change at once.
  updateAllRows(row => (holds(row, id) ? {...row, done} : row));
  return changeConversation(id, updateMessage(id, {done}), 'done', {done});
}

// Each conversation's pin changes go one at a time. Two sent together (P, then P again before the
// first is answered) can reach the server in either order and leave it pinned while the screen says
// unpinned. So a change made while one is on its way only updates what's wanted. That is sent once
// the one in flight is answered, if it differs. The server keeps the last asked. The lists and the
// email hold their answers meanwhile, so one landing between the two can't show the pin back.
const pinning = new Map<number, {wanted: boolean; mark: number; done: Promise<Pinned>}>();

/** Where a pin change left a conversation: pinned or not on the server, and what puts it back as it was before the first. */
export interface Pinned {
  pinned: boolean;
  undo: ConversationUndo;
}

/** The conversation pinned or not, at once on screen: the shelf, its rows and the reader. A change, as `edit` marks it. */
function showPinned(id: number, pinned: boolean): number {
  const fromAll = cachedAllRow(id);
  for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterPin(inbox, id, pinned, fromAll));
  updateAllRows(row => (holds(row, id) ? {...row, pinned} : row));
  return updateMessage(id, {pinned});
}

/**
 * Pin (`P`) puts the conversation on the Pinned shelf, or takes it off, at once on screen. Every way
 * to pin comes here (the reader's P, the shelf's Unpin). It resolves once the last change asked is
 * in, with whether it's pinned on the server and the first change's Undo.
 */
export function setPinned(id: number, pinned: boolean): Promise<Pinned> {
  const mark = showPinned(id, pinned);
  const queued = pinning.get(id);
  if (queued) {
    queued.wanted = pinned;
    queued.mark = mark;
    return queued.done;
  }
  const state = {wanted: pinned, mark} as {wanted: boolean; mark: number; done: Promise<Pinned>};
  const release = holdLoads(['/mail/inbox', '/mail/all', messagePath(id), ...conversationsOf(id)]);
  state.done = change(async () => {
    try {
      let sent: boolean;
      let first: ConversationUndo | null = null;
      do {
        sent = state.wanted;
        const answer = await afterPending(() => sendJson<ConversationChangeOut>('POST', `${conversationPath(id)}/pin`, {pinned: sent}));
        first ??= answer.undo;
      } while (state.wanted !== sent);
      return {pinned: sent, undo: first};
    } finally {
      pinning.delete(id);
      release();
      settled(id, state.mark);
    }
  });
  pinning.set(id, state);
  return state.done;
}

/** A row without its snooze, or its returned mark. */
const unsnoozed = ({snoozed_until: _until, ...row}: MessageRowOut): MessageRowOut => row;
const unreturned = ({returned_at: _returned, ...row}: MessageRowOut): MessageRowOut => row;

/**
 * Snooze the conversation until `until` (ms): out of the Inbox, its counts and the shelf at once,
 * marked snoozed in All and search, and first in Snoozed by its time. Its returned mark, if any, goes.
 */
export function snooze(id: number, until: number): Promise<ConversationChangeOut> {
  const at = new Date(until).toISOString();
  const row = cachedRow(id)?.row ?? cachedAllRow(id) ?? getCached<SnoozedOut>(SNOOZED_PATH)?.rows.find(one => holds(one, id)) ?? null;
  for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterSnooze(inbox, id));
  followInboxCounts();
  updateAllRows(one => (holds(one, id) ? {...unreturned(one), snoozed_until: at} : one));
  if (row) {
    updateCached<SnoozedOut>(SNOOZED_PATH, list => ({rows: [...list.rows.filter(one => !holds(one, id)), {...unreturned(row), snoozed_until: at}]
      .sort((a, b) => a.snoozed_until!.localeCompare(b.snoozed_until!) || a.id - b.id)}));
  }
  return changeConversation(id, updateMessage(id, {snoozed_until: at, returned_at: undefined}), 'snooze', {until: at});
}

/** Unsnooze (Snoozed's and the reader's): back in the Inbox as it was, once the server has it. */
export function unsnooze(id: number): Promise<ConversationChangeOut> {
  updateAllRows(one => (holds(one, id) ? unsnoozed(one) : one));
  updateCached<SnoozedOut>(SNOOZED_PATH, list => ({rows: list.rows.filter(one => !holds(one, id))}));
  return changeConversation(id, updateMessage(id, {snoozed_until: undefined}), 'unsnooze');
}

/** The conversation unread, at once on screen: its dot and the counts. A change, as `edit` marks it. */
function showUnread(id: number): number {
  for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterUnread(inbox, id));
  followInboxCounts();
  updateAllRows(row => (holds(row, id) ? {...row, unread: true} : row));
  return updateMessage(id, {unread: true});
}

/** Mark unread (⇧U, ⌘K): commands the provider confirms. */
export function markUnread(id: number): Promise<ConversationChangeOut> {
  return changeConversation(id, showUnread(id), 'read', {unread: true});
}

/** Mark read (a copied code, the menu's Mark read, the phone's reader after Mark unread). */
export function markRead(id: number): Promise<ConversationChangeOut> {
  const found = cachedRow(id);
  if (found?.row.unread) {
    for (const path of inboxPaths()) updateCached<InboxOut>(path, inbox => inboxAfterOpen(inbox, id));
    updateCached<MailCountsOut>(COUNTS_PATH, counts => countsAfterOpen(counts, found.row));
  }
  updateAllRows(row => (holds(row, id) ? {...row, unread: false} : row));
  return changeConversation(id, updateMessage(id, {unread: false}), 'read', {unread: false});
}

/** Trash (`E`): every email of the conversation, the user's sent replies too, with Undo for 6 seconds. */
export const trashMessage = (id: number) => changeConversation(id, edit(id), 'trash');

/**
 * A change's Undo: each email of the conversation back as it was before it (Done, pin, snooze,
 * read state, out of the trash). `id` is the conversation's, to load it again.
 */
export function undoChange(id: number, undo: ConversationUndo, mark = edit(id)): Promise<ConversationChangeOut> {
  return change(() => afterPending(() => sendJson<ConversationChangeOut>('POST', `${CONVERSATIONS_PATH}/undo`, undo)).finally(() => settled(id, mark)));
}

/** The Pinned toast's Undo: the pin taken back on screen at once, and each email as it was before it. */
export const undoPin = (id: number, pinned: Pinned) => undoChange(id, pinned.undo, showPinned(id, !pinned.pinned));

/** Mark read's Undo: unread again on screen at once, and only the emails that were unread back so. */
export const undoRead = (id: number, undo: ConversationUndo) => undoChange(id, undo, showUnread(id));

/** "Always show from contosocoffee.example": remote content from this domain loads from now on. */
export async function trustDomain(domain: string, messageId: number): Promise<TrustedDomainOut[]> {
  try {
    return await sendJson<TrustedDomainOut[]>('POST', '/mail/trusted-domains', {domain});
  } finally {
    refreshIfShown(messagePath(messageId));
    for (const path of conversationsOf(messageId)) refreshIfShown(path);
  }
}

/** A pattern prompt's Yes (a learned rule) or No. Triage answers with the prompts that remain. */
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
 * account's adapter). A failure carries the server's words for the preview to show.
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

/** Mark all as read (⇧I): every unread email outside Attention and Security, Noise included. */
export function markAllRead(): Promise<MarkAllReadOut> {
  for (const path of inboxPaths()) updateCached<InboxOut>(path, inboxAfterMarkAllRead);
  followInboxCounts();
  updateAllRows(row => (markAllReads(row) ? {...row, unread: false} : row));
  return change(() => sendJson<MarkAllReadOut>('POST', '/mail/mark-all-read', {}));
}

/** A day's USPS mail for the agenda rail (src/logic/mailpieces.ts). */
export const mailpiecesPath = (day: string) => `/mail/mailpieces?day=${day}`;
