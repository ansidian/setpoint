// The state lines as they show while they change (the polish audit's states-13): a line that
// arrives folds in, as a row does (#13), and one that goes folds out at once, whether its source is
// healthy again or it went otherwise. The one that says something as it goes, Jobs's history pass
// with "Read 330 emails", keeps its place for 1.2 s first. app/states/States.tsx keeps the time and
// draws the motion.

/** How a line shows: folding in, here, done (its last words showing), folding out. */
export type LinePhase = 'in' | 'here' | 'done' | 'out';

export interface ShownLine<T> {
  // Stable while its words change: the account's or the source's name.
  key: string;
  line: T;
  phase: LinePhase;
}

/** How long a line shows its last words before it folds out. */
export const DONE_MS = 1200;

/**
 * The lines after a change: `next` in its order, each line gone from `shown` kept after the line it
 * followed, done if `holds` says it has last words to show (else folding out), and each new line
 * folding in. A line back while it showed its last words stays as it is; one back while folding out
 * folds in again, its element still closed.
 */
export function nextLines<T>(shown: ShownLine<T>[], next: {key: string; line: T}[], holds: (line: T) => boolean): ShownLine<T>[] {
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
    const phase: LinePhase = entry.phase === 'done' || entry.phase === 'out' ? entry.phase : holds(entry.line) ? 'done' : 'out';
    after.set(anchor, [...after.get(anchor) ?? [], {...entry, phase}]);
  }
  const result = [...after.get(null) ?? []];
  for (const entry of next) {
    const was = before.get(entry.key);
    result.push({key: entry.key, line: entry.line, phase: !was || was.phase === 'out' ? 'in' : 'here'}, ...after.get(entry.key) ?? []);
  }
  return result;
}

/** A moment on for one line: done, it folds out; folded out, it goes. */
export function lineMovesOn<T>(shown: ShownLine<T>[], key: string, from: 'done' | 'out'): ShownLine<T>[] {
  return shown.flatMap(entry => (entry.key !== key || entry.phase !== from ? [entry] : from === 'done' ? [{...entry, phase: 'out' as const}] : []));
}
