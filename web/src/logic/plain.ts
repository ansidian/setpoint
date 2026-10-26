// SV-110 (D290): a lit phrase clicked (or ⌥⌫ with the caret in it) is title words again, as the
// iPhone's tap is (setpoint-ios QuickAddDraft's `makePlain`, the same rules). The editor keeps the
// line's plain spans and hides their words from the parser, so `parseTitle` needs nothing new.
import type {Mark} from './compose.ts';

/** Part of the line, `end` exclusive (UTF-16 offsets, as a Mark's). */
export interface Span {
  start: number;
  end: number;
}

/**
 * The plain spans once `before` is typed into `after`: a span the change didn't touch stays, moved
 * with the text after the change; one typed into is read again.
 */
export function retyped(plain: Span[], before: string, after: string): Span[] {
  if (!plain.length || before === after) return plain;
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix += 1;
  const [from, to] = [prefix, before.length - suffix];
  const delta = after.length - before.length;
  return plain.flatMap(span => (span.end <= from ? [span] : span.start >= to ? [{start: span.start + delta, end: span.end + delta}] : []));
}

/** Each word of `text` as its own plain span: words that are only a title (a proposal's). */
export const wordSpans = (text: string): Span[] => [...text.matchAll(/\S+/g)].map(word => ({start: word.index, end: word.index + word[0].length}));

const MASK = 0xe000;
const MASKS = 0x1900;

/**
 * The line with each plain span's words hidden from the parser: each word becomes one Private Use
 * character repeated to its length, so every offset stays where it was, and `words` holds them for
 * `unmasked`.
 */
export function masked(text: string, plain: Span[]): {text: string; words: string[]} {
  if (!plain.length) return {text, words: []};
  // UTF-16 code units, as the offsets are.
  const units = text.split('');
  const words: string[] = [];
  const hidden = (unit: string) => unit.charCodeAt(0) >= MASK && unit.charCodeAt(0) < MASK + MASKS;
  for (const span of [...plain].sort((a, b) => a.start - b.start)) {
    if (span.start < 0 || span.end > units.length) continue;
    let at = span.start;
    while (at < span.end && words.length < MASKS) {
      if (/\s/.test(units[at]!) || hidden(units[at]!)) {
        at += 1;
        continue;
      }
      let end = at;
      while (end < span.end && !/\s/.test(units[end]!)) end += 1;
      const mask = String.fromCharCode(MASK + words.length);
      words.push(units.slice(at, end).join(''));
      for (let index = at; index < end; index += 1) units[index] = mask;
      at = end;
    }
  }
  return {text: units.join(''), words};
}

/** What the parser gave back (a title, a place) with the hidden words put back. */
export function unmasked(text: string, words: string[]): string {
  if (!words.length) return text;
  let out = '';
  let last = -1;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index) - MASK;
    if (code >= 0 && code < words.length) {
      if (code !== last) out += words[code];
      last = code;
    } else {
      out += text[index];
      last = -1;
    }
  }
  return out;
}

/** The lit phrase the caret is inside (not at either edge, where ⌥⌫ deletes a word as ever). */
export const markInside = (marks: Mark[], caret: number): Mark | null => marks.find(mark => mark.start < caret && caret < mark.end) ?? null;

/**
 * What E selects in the line (D290): its first run of title words, the words outside its marks, so
 * typing replaces them and the phrases stay; with no title words, the caret at the line's start.
 */
export function titleRun(text: string, marks: Mark[]): Span {
  let at = 0;
  for (const mark of [...marks, {start: text.length, end: text.length}]) {
    const words = /\S(?:.*\S)?/.exec(text.slice(at, mark.start));
    if (words) return {start: at + words.index, end: at + words.index + words[0].length};
    at = Math.max(at, mark.end);
  }
  return {start: 0, end: 0};
}
