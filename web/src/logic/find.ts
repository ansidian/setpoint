// Find in email: the rules under the header's field when it searches the open email instead of the
// mail. Which scope a key opens, how a text is folded for matching (case and accents fall away,
// whitespace runs become one space, a line break stays a wall no match crosses), where the words
// fall in it, how the count reads and how stepping wraps. The frame's script holds the same folding
// for an HTML email's page (server/src/domain/emailHtml.ts › MEASURE_SCRIPT).
import type {Route} from './route.ts';
import type {Run} from './search.ts';

/** What the header's field searches: the page's mail (its search, as before) or the open email. */
export type FindScope = 'page' | 'email';

/** The pages whose open email ⌘F searches. */
const FIND_PAGES: ReadonlySet<Route['page']> = new Set(['inbox', 'sent', 'snoozed']);

/**
 * The scope a key opens: ⌘F (`find`) with an email open on the Inbox, Sent or Snoozed searches that
 * email. `/` always searches the page, and so does ⌘F anywhere else.
 */
export function findScope(page: Route['page'], emailOpen: boolean, key: 'find' | 'slash'): FindScope {
  return key === 'find' && emailOpen && FIND_PAGES.has(page) ? 'email' : 'page';
}

/** A text folded for matching, and for each of its characters the index it came from. */
export interface Folded {
  text: string;
  at: number[];
}

const MARKS = /\p{M}/gu;

/**
 * The text as find compares it: lower case, accents off, each run of spaces one space, and a run
 * holding a line break one line break.
 */
export function foldForFind(text: string): Folded {
  let out = '';
  const at: number[] = [];
  let index = 0;
  let space: {from: number; line: boolean} | null = null;
  for (const char of text) {
    if (/\s/.test(char)) {
      space = space ? {from: space.from, line: space.line || char === '\n'} : {from: index, line: char === '\n'};
    } else {
      if (space) {
        out += space.line ? '\n' : ' ';
        at.push(space.from);
        space = null;
      }
      // Each code unit maps back, a wide character's two as well.
      const piece = char.normalize('NFD').replace(MARKS, '').toLowerCase();
      out += piece;
      for (let unit = 0; unit < piece.length; unit += 1) at.push(index);
    }
    index += char.length;
  }
  if (space) {
    out += space.line ? '\n' : ' ';
    at.push(space.from);
  }
  return {text: out, at};
}

/** The words as find looks for them: folded, trimmed, on one line. Empty when there's nothing to find. */
export function findWords(query: string): string {
  return foldForFind(query.replace(/\s+/g, ' ')).text.trim();
}

/**
 * Where the words fall in a text, as runs of the text itself, one after another, never overlapping.
 * Several words match as one phrase, as a browser's find does, and never across a line break.
 */
export function findRuns(text: string, query: string): Run[] {
  const words = findWords(query);
  if (!words) return [];
  const folded = foldForFind(text);
  const runs: Run[] = [];
  let from = 0;
  for (;;) {
    const start = folded.text.indexOf(words, from);
    if (start < 0) return runs;
    const last = start + words.length - 1;
    // The last character's own length, a surrogate pair's two.
    const end = folded.at[last]! + (text.codePointAt(folded.at[last]!)! > 0xffff ? 2 : 1);
    runs.push({start: folded.at[start]!, end});
    from = start + words.length;
  }
}

/** How many times the words fall in a text. */
export const countFinds = (text: string, query: string) => findRuns(text, query).length;

/** The match after (`1`) or before (`-1`) the current one, wrapping at either end. */
export function stepFind(current: number, total: number, delta: 1 | -1): number {
  if (total <= 0) return 0;
  return (((current + delta) % total) + total) % total;
}

/** The field's count: "3 of 12", "No matches", or nothing while there are no words. */
export function findCount(current: number, total: number, query: string): string | null {
  if (!findWords(query)) return null;
  if (total <= 0) return 'No matches';
  return `${Math.min(current, total - 1) + 1} of ${total}`;
}

/** The field's placeholder while it searches an email. */
export const findLabel = (subject: string) => `Search ${subject.trim() || 'this email'}`;
