// The composer's pure rules: whether an email has anyone for Reply all and whether a draft is still
// as it was filled (the server's own rules, shared/src/draftFill.ts), what a typed recipient is, a chip's words, the reply's quote as the
// composer shows it under its fold, and help me write's versions.
import {DRAFT_VERSIONS_MAX, forwardLines as quotedForwardLines, replyLine as quotedReplyLine} from '@setpoint/shared';
import type {DraftOut, DraftUpdateInput, FromOut, MessageOut, Recipient} from '@setpoint/shared';
import {draftEmpty, fillAnswer, NEW_MESSAGE_FILL} from '@setpoint/shared/draftFill';
import type {DraftFill} from '@setpoint/shared/draftFill';
import {isEmpty, readHtml, sameDescription} from '@setpoint/shared/richText';
import type {Block} from '@setpoint/shared/richText';
import {paragraphs} from './body.ts';

type Answered = Pick<MessageOut, 'account_id' | 'from_name' | 'from_address' | 'subject'> & Partial<Pick<MessageOut, 'to' | 'cc' | 'reply_to'>>;

/**
 * Whether Reply all would reach anyone Reply doesn't: the email's other To and Cc recipients, less
 * the user's own addresses. Recipients not known yet (mail from before they were kept) count as none.
 */
export function hasOthers(message: Answered, from: FromOut | undefined): boolean {
  const read = readAnswered(message, from);
  if (!read) return false;
  const count = (kind: 'reply' | 'reply_all') => {
    const filled = fillAnswer(kind, read.email, read.account, read.own);
    return filled.to.length + filled.cc.length;
  };
  return count('reply_all') > count('reply');
}

/**
 * The email as the shared fill rule reads it, with its account's addresses and every one of the
 * user's own; null while its recipients or the account's addresses aren't known.
 */
function readAnswered(message: Answered, from: FromOut | undefined) {
  if (!from || message.to === undefined) return null;
  const account = from.accounts.find(one => one.account_id === message.account_id)?.addresses.map(address => address.address) ?? [];
  if (!account.length) return null;
  const own = from.accounts.flatMap(one => one.addresses.map(address => address.address));
  const email = {fromName: message.from_name, fromAddress: message.from_address, subject: message.subject, to: message.to ?? null, cc: message.cc ?? null, replyTo: message.reply_to ?? null,
    // Mail the user sent (Sent's, or mail to themselves) answers its own recipients.
    sent: own.includes(message.from_address.toLowerCase())};
  return {email, account, own};
}

const ADDRESS = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/**
 * What the user typed as a recipient: an address, or "Name <address>" as one pasted from elsewhere.
 * Null for anything else.
 */
export function readRecipient(typed: string): Recipient | null {
  const text = typed.trim().replace(/[,;]+$/, '').trim();
  const named = /^"?([^"<]*?)"?\s*<([^<>]+)>$/.exec(text);
  if (named) {
    const address = named[2]!.trim().toLowerCase();
    return ADDRESS.test(address) ? {name: named[1]!.trim() || null, address} : null;
  }
  return ADDRESS.test(text) ? {name: null, address: text.toLowerCase()} : null;
}

/** Several recipients pasted at once, split at commas, semicolons and new lines. */
export function readRecipients(pasted: string): {recipients: Recipient[]; rest: string} {
  const parts = pasted.split(/[,;\n]+(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(part => part.trim()).filter(Boolean);
  const recipients: Recipient[] = [];
  const rest: string[] = [];
  for (const part of parts) {
    const recipient = readRecipient(part);
    if (recipient) recipients.push(recipient);
    else rest.push(part);
  }
  return {recipients, rest: rest.join(', ')};
}

/** A chip's words: the name when there is one, else the address. */
export const chipLabel = (recipient: Recipient) => recipient.name?.trim() || recipient.address;

/** Adds recipients to a field's, each address once. */
export function withRecipients(field: Recipient[], added: Recipient[]): Recipient[] {
  const seen = new Set(field.map(one => one.address));
  return [...field, ...added.filter(one => !seen.has(one.address) && seen.add(one.address))];
}

/** The line above a reply's quote, as the server writes it: "On Oct 3, 2026, Theo Walsh wrote:". */
export const replyLine = (message: Pick<MessageOut, 'from_name' | 'from_address' | 'received_at'>, timeZone: string): string =>
  quotedReplyLine({fromName: message.from_name, fromAddress: message.from_address, receivedAt: message.received_at}, timeZone);

/** The original as the quote's blocks, for trimming: its HTML read as rich text, or its lines. */
export function quoteOf(message: Pick<MessageOut, 'body_html' | 'body_text'>): Block[] {
  if (message.body_html) return readHtml(message.body_html).blocks;
  return paragraphs(message.body_text).map(lines => ({type: 'paragraph' as const, runs: [{text: lines.join('\n'), marks: [], href: null}]}));
}

type Drafted = Pick<DraftOut, 'kind' | 'to' | 'cc' | 'bcc' | 'subject' | 'body' | 'quote' | 'removed_attachments' | 'send'> & Partial<Pick<DraftOut, 'files'>>;

/**
 * Whether a draft is still exactly as the server filled it, so closing it leaves nothing behind
 * (draftEmpty). A reply's or forward's start is the server's fill of `message`, read with From as
 * they've loaded; while either isn't in, the draft counts as written, and the server, which leaves
 * empty drafts out of Drafts, sweeps it later.
 */
export function emptyDraft(draft: Drafted, message: Answered | undefined, from: FromOut | undefined): boolean {
  let fill: DraftFill | null = NEW_MESSAGE_FILL;
  if (draft.kind !== 'new') {
    const read = message ? readAnswered(message, from) : null;
    fill = read ? fillAnswer(draft.kind, read.email, read.account, read.own) : null;
  }
  return draftEmpty({
    to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, body: draft.body, quote: draft.quote,
    removedAttachments: draft.removed_attachments, files: draft.files?.length ?? 0, sending: !!draft.send,
  }, fill);
}

/**
 * What was typed in a composer before the server answered with its draft, put into that draft: a
 * recipient joins the server's, and words typed on a draft that was left with words go after them,
 * so nothing either side wrote is lost. The answer is what to save.
 */
export function fillAround(draft: Pick<DraftOut, 'to' | 'cc' | 'bcc' | 'body'>, typed: DraftUpdateInput): DraftUpdateInput {
  const saved: DraftUpdateInput = {...typed};
  for (const field of ['to', 'cc', 'bcc'] as const) {
    const added = typed[field];
    if (added) saved[field] = withRecipients(draft[field], added);
  }
  // Words typed and taken back leave the body as the server has it.
  if (typed.body && isEmpty(typed.body)) delete saved.body;
  else if (typed.body && !isEmpty(draft.body)) saved.body = [...draft.body, ...typed.body];
  return saved;
}

/**
 * Whether a reply or forward of `message` starts with Cc (Reply all's other recipients), from the
 * same rule the server fills it by, so its rows are there while the server answers. False when the
 * email or From isn't in yet.
 */
export function startsWithCopies(kind: DraftOut['kind'], message: Answered | undefined, from: FromOut | undefined): boolean {
  const read = kind === 'reply_all' && message ? readAnswered(message, from) : null;
  return read !== null && fillAnswer('reply_all', read.email, read.account, read.own).cc.length > 0;
}

/** A forward's header lines as the server writes them above the email. */
export const forwardLines = (message: Pick<MessageOut, 'from_name' | 'from_address' | 'subject' | 'received_at'> & Partial<Pick<MessageOut, 'to' | 'cc'>>, timeZone: string): string[] =>
  quotedForwardLines({fromName: message.from_name, fromAddress: message.from_address, subject: message.subject, receivedAt: message.received_at, to: message.to ?? null, cc: message.cc ?? null}, timeZone);

/** The composer's windows: a window, a window folded to its title bar, the gap between, the "+N" chip. */
export const WINDOW_WIDTH = 560;
export const WINDOW_BAR_WIDTH = 320;
export const WINDOW_GAP = 12;
export const WINDOW_MORE_WIDTH = 64;

export interface WindowSlot {
  key: number;
  minimized: boolean;
  // When it was last opened or brought back: the lowest was touched longest ago.
  touched: number;
}

/**
 * Fits the windows into `room` px: the ones touched longest ago fold to their title bars first,
 * and once even the bars don't fit the oldest go into the "+N" chip. The window touched last
 * always stays as it is. Answers which to fold and which to hide, oldest first.
 */
export function arrangeWindows(windows: WindowSlot[], room: number): {fold: number[]; hidden: number[]} {
  const byAge = [...windows].sort((a, b) => a.touched - b.touched);
  const newest = byAge.at(-1)?.key;
  const folded = new Set(windows.filter(one => one.minimized).map(one => one.key));
  const hidden = new Set<number>();
  const width = () => {
    const shown = windows.filter(one => !hidden.has(one.key));
    const windowsWidth = shown.reduce((sum, one) => sum + (folded.has(one.key) ? WINDOW_BAR_WIDTH : Math.min(WINDOW_WIDTH, room)), 0);
    return windowsWidth + Math.max(0, shown.length - 1) * WINDOW_GAP + (hidden.size ? WINDOW_GAP + WINDOW_MORE_WIDTH : 0);
  };
  const fold: number[] = [];
  for (const one of byAge) {
    if (width() <= room) break;
    if (one.key === newest || folded.has(one.key)) continue;
    folded.add(one.key);
    fold.push(one.key);
  }
  for (const one of byAge) {
    if (width() <= room) break;
    if (one.key !== newest) hidden.add(one.key);
  }
  return {fold, hidden: [...hidden]};
}

/**
 * Where each window sits, right to left in the order they popped out: its distance from the row's
 * right end and its width. Hidden ones take no room. `end` is where the "+N" chip goes.
 */
export function placeWindows(windows: Omit<WindowSlot, 'touched'>[], hidden: number[], room: number): {at: Map<number, {right: number; width: number}>; end: number} {
  const at = new Map<number, {right: number; width: number}>();
  const end = windows.reduce((right, one) => {
    const width = one.minimized ? WINDOW_BAR_WIDTH : Math.min(WINDOW_WIDTH, room || WINDOW_WIDTH);
    at.set(one.key, {right, width});
    return hidden.includes(one.key) ? right : right + width + WINDOW_GAP;
  }, 0);
  return {at, end};
}

// ---- Help me write's versions ----
//
// Each draft help me write puts in keeps the body as it was before and as it was written, so undo and
// redo beside the line step between them. Typing after a step makes a version of its own on the next
// undo (so redo brings the typing back) and drops what redo had. The oldest go past DRAFT_VERSIONS_MAX.

export interface Versions {
  versions: Block[][];
  // The version the body shows, unless it was typed in since.
  at: number;
}

export const NO_VERSIONS: Versions = {versions: [], at: 0};

const sameBody = (a: Block[], b: Block[]) => sameDescription(a, b);

const kept = (versions: Block[][], max: number): Versions => {
  const trimmed = versions.slice(-max);
  return {versions: trimmed, at: trimmed.length - 1};
};

/** A draft written: the body before it (unless that's already the version shown) and after it. */
export function recordVersion(state: Versions, before: Block[], after: Block[], max = DRAFT_VERSIONS_MAX): Versions {
  const base = state.versions.slice(0, state.at + 1);
  if (!base.length || !sameBody(base.at(-1)!, before)) base.push(before);
  base.push(after);
  return kept(base, max);
}

/** Whether undo has a version to go back to from the body as it is now. */
export const canUndo = (state: Versions, current: Block[]) => state.versions.length > 0 && (state.at > 0 || !sameBody(current, state.versions[0]!));

/** Whether redo has a version: only while the body is still the version shown. */
export const canRedo = (state: Versions, current: Block[]) => state.at < state.versions.length - 1 && sameBody(current, state.versions[state.at]!);

/** Undo from the body as it is now: the version to show, or null. Typing since is kept as a version first. */
export function undoVersion(state: Versions, current: Block[], max = DRAFT_VERSIONS_MAX): {state: Versions; body: Block[]} | null {
  if (!canUndo(state, current)) return null;
  let next = state;
  if (!sameBody(current, state.versions[state.at]!)) next = kept([...state.versions.slice(0, state.at + 1), current], max);
  const at = next.at - 1;
  return {state: {versions: next.versions, at}, body: next.versions[at]!};
}

/** Redo: the next version to show, or null. */
export function redoVersion(state: Versions, current: Block[]): {state: Versions; body: Block[]} | null {
  if (!canRedo(state, current)) return null;
  const at = state.at + 1;
  return {state: {versions: state.versions, at}, body: state.versions[at]!};
}

/**
 * The line's words: over an empty body, what to write; over text, what to change; over text help me
 * write wrote (a version past the first shows, typed in since or not), a follow-up.
 */
export const writePlaceholder = (body: Block[], state: Versions) => (isEmpty(body) ? 'Describe your message' : state.at > 0 ? 'Describe your follow-up changes' : 'Describe your change');
