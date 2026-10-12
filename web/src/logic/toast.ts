// The toast's tone (DESIGN.md › Decided while building, the one toast): a glyph before the line says
// what kind of thing happened before a word is read. Done things lead with `check` in `good`, things
// taken away with `delete` in `ink3`, failures with `error` in `alert` and an `alert` ring, and a pin
// made out of the shelf's sight with `keep` in `ink3`. Any other line has no glyph. The tone follows
// the line's own first words, so every page's lines take it without passing it along; a failure in a
// provider's own words is marked by the caller.

export type ToastTone = 'done' | 'gone' | 'failed' | 'pinned';

/** How long a toast, and its Undo, stays: six seconds, a failure eight, so the provider's words can be read. */
export const TOAST_MS = {line: 6000, failed: 8000} as const;

/** A line's tone by what it says it did: "Marked Done", "Completed Pay rent", "Moved to Trash", "Couldn't pin it, …". */
export function toastTone(text: string): ToastTone | null {
  if (/^Couldn['’]t /.test(text)) return 'failed';
  if (/^(Marked|Completed) /.test(text)) return 'done';
  if (/^(Moved to Trash|Deleted )/.test(text)) return 'gone';
  // A pin made where the shelf can't be seen (polish audit inbox-09).
  if (text === 'Pinned') return 'pinned';
  return null;
}

export const toastMs = (tone: ToastTone | null) => (tone === 'failed' ? TOAST_MS.failed : TOAST_MS.line);
