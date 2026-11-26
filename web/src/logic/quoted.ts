// Where a plain-text email's quoted history starts, so the reader can fold it behind •••. The reader
// draws plain text itself (logic/body.ts), so this rule is the reader's. An HTML email's history is
// the server's (server/src/domain/quotedHistory.ts), since only its page can reach the email.
//
// The history starts at a reply's "On … wrote:" line (one line, or two where the sender's app
// wrapped it) with `>` lines under it, at `>` lines alone, or at Outlook's "-----Original
// Message-----" or its rule of underscores over a From: line. It folds only when nothing is lost by
// it: every line after the start must be quoted (an answer under the quote, or inline replies, show
// in full), a forward shows in full, and so does an email that would fold to nothing.

export interface Quoted {
  /** What shows above •••: the email's own words. */
  fresh: string;
  /** What ••• shows again, or null when the email has no history to fold and shows in full. */
  quoted: string | null;
}

const ATTRIBUTION = /^On\b.*\bwrote:$/;
const quotedLine = (line: string) => /^\s*>/.test(line);
const blank = (line: string) => line.trim() === '';
const FORWARD = /^(-+ ?Forwarded message ?-+|Begin forwarded message:)$/i;
const ORIGINAL = /^-{2,} ?Original Message ?-{2,}$/i;
const RULE = /^_{10,}$/;
const FORWARD_SUBJECT = /^Subject:\s*(FW|Fwd?):/i;

/** The first line at or after `from` that shows something, or -1. */
function nextShown(lines: string[], from: number): number {
  for (let at = from; at < lines.length; at += 1) if (!blank(lines[at]!)) return at;
  return -1;
}

/** The last line before `before` that shows something, or -1. */
function lastShown(lines: string[], before: number): number {
  for (let at = before - 1; at >= 0; at -= 1) if (!blank(lines[at]!)) return at;
  return -1;
}

const allQuoted = (lines: string[], from: number) => from >= 0 && lines.slice(from).every(line => blank(line) || quotedLine(line));

/** Where the history starting at line `at` begins, or null when none starts there. */
function startAt(lines: string[], at: number): number | null {
  const line = lines[at]!.trim();
  // "On … wrote:", or "On …" with "… wrote:" on the line under it.
  const wrapped = /^On\b/.test(line) && at + 1 < lines.length && /\bwrote:$/.test(lines[at + 1]!.trim());
  if (ATTRIBUTION.test(line) || wrapped) {
    const first = nextShown(lines, at + (wrapped ? 2 : 1));
    return first >= 0 && quotedLine(lines[first]!) && allQuoted(lines, first) ? at : null;
  }
  if (quotedLine(line)) {
    const above = lastShown(lines, at);
    if (above >= 0 && (quotedLine(lines[above]!) || FORWARD.test(lines[above]!.trim()))) return null;
    return allQuoted(lines, at) ? at : null;
  }
  const header = ORIGINAL.test(line) || (RULE.test(line) && /^From:/.test(lines[nextShown(lines, at + 1)]?.trim() ?? ''));
  if (header) {
    const next = lines.slice(at + 1, at + 8);
    return next.some(item => FORWARD_SUBJECT.test(item.trim())) ? null : at;
  }
  return null;
}

/** `text` split at where its quoted history starts, or whole when it has none to fold. */
export function splitQuoted(text: string): Quoted {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let at = 0; at < lines.length; at += 1) {
    const start = startAt(lines, at);
    if (start === null) continue;
    const fresh = lines.slice(0, start).join('\n').trimEnd();
    if (!fresh.trim()) break;
    return {fresh, quoted: lines.slice(start).join('\n')};
  }
  return {fresh: text, quoted: null};
}
