// Mail search's Gmail-style operators, typed in the field and kept there as text: `from:pat`,
// `to:sam@example.org`, `subject:"lease renewal"`, `has:attachment`, `is:unread`,
// `after:2026/03/01`, `before:3/1/2026`. A date is year first or year last, by "/" or "-". A `-` or `!` before the name or before the value leaves
// out what it matches (`-from:indeed`, `from:-indeed`), once even with both. A `-` anywhere else in
// the value is literal (`from:usps-informed`).
//
// Pure, with no clock: the server's filters (src/search/search.ts) and the field's marks read this
// one rule, so a marked operator is exactly one the search filters by. An operator still without a
// value (`from:` while typing) is dropped. One with a value it can't read (`has:pdf`,
// `before:2026/13/40`) is no operator, and searches as the words it is. An unknown name (`foo:bar`,
// `https://…`) is a plain word.

/** What an operator filters by. */
export type OperatorFilter = ({kind: 'from' | 'to' | 'subject'; value: string} | {kind: 'attachment'} | {kind: 'unread'; value: boolean} | {kind: 'after' | 'before'; date: string}) & {not: boolean};

export type Operator = OperatorFilter & {
  // The whole token in the text it came from, its `-` and quotes included.
  start: number;
  end: number;
};

export type OperatorName = 'from' | 'to' | 'subject' | 'has' | 'is' | 'before' | 'after';

/** What a token is: a name, an optional `-` or `!` either side of its colon, and a value, "quoted" or not. */
export const OPERATOR_TOKEN = /^([-!]?)(from|to|subject|has|is|before|after):([-!]?)("[^"]*"?|[^\s"]*)$/i;

// A search's tokens: an operator whole (its quoted value one with it), a "quote" (an unclosed one
// runs to the end), or a run of anything but spaces and quotes.
const TOKENS = /[-!]?(?:from|to|subject|has|is|before|after):[-!]?(?:"[^"]*"?|[^\s"]*)|"[^"]*"?|[^\s"]+/gi;

export interface SearchToken {
  raw: string;
  start: number;
  end: number;
  quoted: boolean;
  // An operator the search reads, or one still without a value. Never one it can't read.
  operator: boolean;
}

/** Whether a real day: no Feb 30. */
export const validDay = (year: number, month: number, day: number) => {
  const at = new Date(Date.UTC(year, month - 1, day));
  return at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
};

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * A before: or after: day as YYYY-MM-DD: year/month/day (`2026/3/1`) or month/day/year
 * (`3/1/2026`), by "/" or "-" used alike, one or two digits for the month and day. A four-digit year
 * says which end it's at. Null for anything else, or a day that isn't one.
 */
export function operatorDate(value: string): string | null {
  const yearFirst = /^(\d{4})([/-])(\d{1,2})\2(\d{1,2})$/.exec(value);
  const yearLast = /^(\d{1,2})([/-])(\d{1,2})\2(\d{4})$/.exec(value);
  const [year, month, day] = yearFirst ? [yearFirst[1], yearFirst[3], yearFirst[4]] : yearLast ? [yearLast[4], yearLast[1], yearLast[3]] : [];
  if (!year || !validDay(+year, +month!, +day!)) return null;
  return `${year}-${pad(+month!)}-${pad(+day!)}`;
}

/** An operator token's filter, 'empty' while it has no value yet, or null when it's no operator. */
export function readOperator(raw: string): OperatorFilter | 'empty' | null {
  const match = OPERATOR_TOKEN.exec(raw);
  if (!match) return null;
  const [, before, name, after, typed] = match as unknown as [string, string, string, string, string];
  const not = before !== '' || after !== '';
  const value = (typed.startsWith('"') ? typed.slice(1).replace(/"$/, '') : typed).trim();
  if (!value) return 'empty';
  const lower = value.toLowerCase();
  switch (name.toLowerCase() as OperatorName) {
    case 'from':
    case 'to':
    case 'subject':
      return {kind: name.toLowerCase() as 'from' | 'to' | 'subject', value, not};
    case 'has':
      return lower === 'attachment' || lower === 'file' ? {kind: 'attachment', not} : null;
    case 'is':
      return lower === 'unread' || lower === 'read' ? {kind: 'unread', value: lower === 'unread', not} : null;
    case 'before':
    case 'after': {
      const date = operatorDate(value);
      return date ? {kind: name.toLowerCase() as 'before' | 'after', date, not} : null;
    }
  }
}

/** The search's tokens in order, where each sits in `text`. */
export function searchTokens(text: string): SearchToken[] {
  return [...text.matchAll(TOKENS)].map(match => ({
    raw: match[0], start: match.index, end: match.index + match[0].length, quoted: match[0].startsWith('"'), operator: readOperator(match[0]) !== null,
  }));
}

/** The operators typed, each where it sits, and the words left (spaced as one). */
export function parseOperators(text: string): {operators: Operator[]; text: string} {
  const operators: Operator[] = [];
  const words: string[] = [];
  for (const token of searchTokens(text)) {
    const read = token.operator ? readOperator(token.raw) : null;
    if (read && read !== 'empty') operators.push({...read, start: token.start, end: token.end});
    else if (!token.operator) words.push(token.raw);
  }
  return {operators, text: words.join(' ')};
}
