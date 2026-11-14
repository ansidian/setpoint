// Todoist's order keys (SV-272): a task's place among its siblings is a string, and siblings sort by
// comparing them character by character ("a0" < "a0V" < "a1"). Moving one task writes one new key
// that sorts between its new neighbours', so no other task changes. The keys seen in Todoist's API
// reference ("a0", "a1V") are fractional indexes in base 62: a head letter saying how many digits
// the whole part has ("a" one, "b" two; "Z" one below "a0", and so on down), those digits, then
// any fraction. This is that scheme's usual algorithm (David Greenspan's, public domain).
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0]!;
const LAST = DIGITS[DIGITS.length - 1]!;

/** A fraction between two fractions; `b` null is no upper bound. Neither ends in a zero. */
function midpoint(a: string, b: string | null): string {
  if (b !== null) {
    let same = 0;
    while ((a[same] ?? ZERO) === b[same]) same++;
    if (same > 0) return b.slice(0, same) + midpoint(a.slice(same), b.slice(same));
  }
  const low = a ? DIGITS.indexOf(a[0]!) : 0;
  const high = b !== null ? DIGITS.indexOf(b[0]!) : DIGITS.length;
  if (high - low > 1) return DIGITS[Math.round((low + high) / 2)]!;
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return DIGITS[low]! + midpoint(a.slice(1), null);
}

function wholeLength(head: string): number {
  if (head >= 'a' && head <= 'z') return head.charCodeAt(0) - 'a'.charCodeAt(0) + 2;
  if (head >= 'A' && head <= 'Z') return 'Z'.charCodeAt(0) - head.charCodeAt(0) + 2;
  throw new Error('Not an order key.');
}

/** A key's whole part and its fraction; throws on a string that isn't a key. */
function parts(key: string): [string, string] {
  const length = wholeLength(key[0] ?? '');
  const whole = key.slice(0, length);
  const fraction = key.slice(length);
  if (whole.length !== length || [...key.slice(1)].some(digit => !DIGITS.includes(digit)) || fraction.endsWith(ZERO)) throw new Error('Not an order key.');
  return [whole, fraction];
}

/** The next whole part up, or null past the last. */
function increment(whole: string): string | null {
  const [head, ...digits] = [...whole] as [string, ...string[]];
  for (let at = digits.length - 1; at >= 0; at--) {
    const next = DIGITS.indexOf(digits[at]!) + 1;
    if (next < DIGITS.length) {
      digits[at] = DIGITS[next]!;
      return head + digits.join('');
    }
    digits[at] = ZERO;
  }
  if (head === 'Z') return `a${ZERO}`;
  if (head === 'z') return null;
  const up = String.fromCharCode(head.charCodeAt(0) + 1);
  if (up > 'a') digits.push(ZERO);
  else digits.pop();
  return up + digits.join('');
}

/** The next whole part down, or null past the first. */
function decrement(whole: string): string | null {
  const [head, ...digits] = [...whole] as [string, ...string[]];
  for (let at = digits.length - 1; at >= 0; at--) {
    const next = DIGITS.indexOf(digits[at]!) - 1;
    if (next >= 0) {
      digits[at] = DIGITS[next]!;
      return head + digits.join('');
    }
    digits[at] = LAST;
  }
  if (head === 'a') return `Z${LAST}`;
  if (head === 'A') return null;
  const down = String.fromCharCode(head.charCodeAt(0) - 1);
  if (down < 'Z') digits.push(LAST);
  else digits.pop();
  return down + digits.join('');
}

/**
 * A key that sorts after `before` and ahead of `after`; null for either is the list's end. Null
 * when the two aren't keys in order, or there's no room, so the caller falls back.
 */
export function orderKeyBetween(before: string | null, after: string | null): string | null {
  try {
    if (before !== null && after !== null && before >= after) return null;
    if (before === null) {
      if (after === null) return `a${ZERO}`;
      const [whole, fraction] = parts(after);
      if (whole === `A${ZERO.repeat(26)}`) return whole + midpoint('', fraction);
      return whole < after ? whole : decrement(whole);
    }
    const [whole, fraction] = parts(before);
    if (after === null) return increment(whole) ?? whole + midpoint(fraction, null);
    const [afterWhole, afterFraction] = parts(after);
    if (whole === afterWhole) return whole + midpoint(fraction, afterFraction);
    const up = increment(whole);
    if (up === null) return null;
    return up < after ? up : whole + midpoint(fraction, null);
  } catch {
    return null;
  }
}

/** Siblings in Todoist's order: by their keys where both have one, else by `child_order`. */
export function bySiblingOrder<T extends {id: number; orderKey: string | null; childOrder: number | null}>(a: T, b: T): number {
  if (a.orderKey !== null && b.orderKey !== null && a.orderKey !== b.orderKey) return a.orderKey < b.orderKey ? -1 : 1;
  return (a.childOrder ?? 0) - (b.childOrder ?? 0) || a.id - b.id;
}

/** The one id that moved between two orders of the same ids, or null when more than one did. */
export function singleMove(from: number[], to: number[]): number | null {
  return to.find(id => {
    const rest = from.filter(one => one !== id);
    return to.filter(one => one !== id).every((one, at) => one === rest[at]);
  }) ?? null;
}
