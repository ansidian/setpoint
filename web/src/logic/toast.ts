// The toast's tone: what happened, said by a colour and a glyph in a disc before a word is read.
// Done things are `good` with `check`, an email marked read `good` with `mark_email_read`, things taken
// away `alert` with `delete`, Sending `accent` with `send`, a pin `sunGlyph` with `keep`, a failure
// `alert` with `error`. Any other line is plain, `ink2`, with a glyph that fits it (`content_copy` for
// Copied, `info` otherwise). The tone follows the line's own first words, so every page's lines take
// it without passing it along. The caller marks a failure in a provider's own words.

import type {IconName} from '../ui/glyphs.ts';

export type ToastTone = 'done' | 'read' | 'gone' | 'send' | 'pinned' | 'failed' | 'plain';

/** How long a toast, and its Undo, stays: six seconds, a failure eight, so the provider's words can be read. */
export const TOAST_MS = {line: 6000, failed: 8000} as const;

/** A line's tone by what it says it did: "Marked 3 as read", "Completed Pay rent", "Moved to Trash", "Couldn't pin it". */
export function toastTone(text: string): ToastTone {
  if (/^Couldn['’]t /.test(text)) return 'failed';
  if (/^Marked (\d+ )?as read$/.test(text)) return 'read';
  if (/^(Marked|Completed) /.test(text)) return 'done';
  if (/^(Moved (\d+ )?to Trash|Deleted |Discarded |Draft discarded$)/.test(text)) return 'gone';
  if (text === 'Sending') return 'send';
  // A pin made where the shelf can't be seen.
  if (/^Pinned( \d+)?$/.test(text)) return 'pinned';
  return 'plain';
}

const TONE_GLYPHS: Record<ToastTone, IconName> = {
  done: 'check', read: 'mark_email_read', gone: 'delete', send: 'send', pinned: 'keep', failed: 'error', plain: 'info',
};

/** The glyph in its disc: its tone's, or for a plain line one that fits its words. */
export function toastGlyph(tone: ToastTone, text: string): IconName {
  if (tone === 'plain' && /^Copied /.test(text)) return 'content_copy';
  return TONE_GLYPHS[tone];
}

/**
 * How long it stays, or null when it waits: a confirm, and a failure with an action (Open, Try
 * again), wait to be answered, swiped away or replaced. The phone's toast doesn't swipe and has no
 * Cancel, so there every toast still runs its time.
 */
export function toastMs({tone, action, confirm = false, phone = false}: {tone: ToastTone; action: boolean; confirm?: boolean; phone?: boolean}): number | null {
  if (!phone && (confirm || (tone === 'failed' && action))) return null;
  return tone === 'failed' ? TOAST_MS.failed : TOAST_MS.line;
}
