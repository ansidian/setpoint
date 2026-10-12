// The health lines as they show while they change (the polish audit's states-13): a line that
// arrives folds in, as a row does (#13); one that clears, its source healthy again, keeps its place
// with its glyph turned to a `good` check for 1.2 s, then folds out; one that goes otherwise (the
// reconnect bar, an account removed) folds out at once. app/states/States.tsx keeps the time and
// draws the motion.

/** How a line shows: folding in, here, cleared (its check showing), folding out. */
export type LinePhase = 'in' | 'here' | 'cleared' | 'out';

export interface ShownLine<T> {
  // Stable while its words change: the account's or the source's name.
  key: string;
  line: T;
  phase: LinePhase;
}

/** How long a cleared line shows its check before it folds out. */
export const CLEARED_MS = 1200;

/**
 * The lines after a change: `next` in its order, each line gone from `shown` kept after the line it
 * followed, cleared if `clears` says its going is a recovery (else folding out), and each new line
 * folding in. A line back while it showed its check stays as it is; one back while folding out folds
 * in again, its element still closed.
 */
export function nextLines<T>(shown: ShownLine<T>[], next: {key: string; line: T}[], clears: (line: T) => boolean): ShownLine<T>[] {
  const before = new Map(shown.map(entry => [entry.key, entry]));
  const nextKeys = new Set(next.map(entry => entry.key));
  // The lines going, by the key of the line they follow (null: at the top).
  const after = new Map<string | null, ShownLine<T>[]>();
  let anchor: string | null = null;
  for (const entry of shown) {
    if (nextKeys.has(entry.key)) {
      anchor = entry.key;
      continue;
    }
    const phase: LinePhase = entry.phase === 'cleared' || entry.phase === 'out' ? entry.phase : clears(entry.line) ? 'cleared' : 'out';
    after.set(anchor, [...after.get(anchor) ?? [], {...entry, phase}]);
  }
  const result = [...after.get(null) ?? []];
  for (const entry of next) {
    const was = before.get(entry.key);
    result.push({key: entry.key, line: entry.line, phase: !was || was.phase === 'out' ? 'in' : 'here'}, ...after.get(entry.key) ?? []);
  }
  return result;
}

/** A moment on for one line: cleared, it folds out; folded out, it goes. */
export function lineMovesOn<T>(shown: ShownLine<T>[], key: string, from: 'cleared' | 'out'): ShownLine<T>[] {
  return shown.flatMap(entry => (entry.key !== key || entry.phase !== from ? [entry] : from === 'cleared' ? [{...entry, phase: 'out' as const}] : []));
}
