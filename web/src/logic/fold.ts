// A list's rows as they show while it changes (DESIGN.md › Decided while building #13): a row that
// leaves stays, folding out, in the place it had, and a row that arrives folds in when its email was
// shown already (Pin moves it onto the shelf) or left just now (Undo brings it back). app/fold.ts
// draws the motion; the list decides which rows fold.

export type Fold = 'in' | 'out' | null;

export interface Entry<T> {
  key: string;
  // The email a row shows; null for a header or the prompt.
  id: number | null;
  item: T;
}

export interface Folded<T> extends Entry<T> {
  fold: Fold;
}

export interface FoldRules<T> {
  // Whether an entry gone from the list folds out (otherwise it just goes, as a collapsed group's rows do).
  folds: (gone: Folded<T>) => boolean;
  // Whether a new entry whose email was shown, or left lately, may fold in.
  arrives: (entry: Entry<T>, was: (key: string) => Folded<T> | undefined) => boolean;
  // Whether a new entry folds in although its email wasn't shown: a group's rows as it opens.
  opens?: (entry: Entry<T>, was: (key: string) => Folded<T> | undefined) => boolean;
}

/**
 * The list after a change: `next` in its order, each entry gone from `before` that folds kept after
 * the entry it followed (as 'out', until the list drops it), and each new row folding in when its
 * email was shown before or is in `returning` (emails that left lately), or its group opens, or it
 * was still folding out. A new header folds in with its first row.
 */
export function foldList<T>(before: Folded<T>[], next: Entry<T>[], rules: FoldRules<T>, returning: ReadonlySet<number>): Folded<T>[] {
  const nextKeys = new Set(next.map(entry => entry.key));
  const live = new Map(before.filter(entry => entry.fold !== 'out').map(entry => [entry.key, entry]));
  const shownIds = new Set([...live.values()].map(entry => entry.id).filter(id => id !== null));
  // The entries folding out, by the key of the entry they follow (null: at the top).
  const after = new Map<string | null, Folded<T>[]>();
  let anchor: string | null = null;
  for (const entry of before) {
    if (nextKeys.has(entry.key)) {
      anchor = entry.key;
    } else if (entry.fold === 'out' || rules.folds(entry)) {
      after.set(anchor, [...after.get(anchor) ?? [], {...entry, fold: 'out'}]);
    }
  }
  // An entry back before its fold out ended always folds in again: its element is still closed.
  const leaving = new Set(before.filter(entry => entry.fold === 'out').map(entry => entry.key));
  const was = (key: string) => live.get(key);
  const folds = next.map((entry): Fold => (!live.has(entry.key) && (leaving.has(entry.key) || (entry.id !== null
    && (((shownIds.has(entry.id) || returning.has(entry.id)) && rules.arrives(entry, was)) || (rules.opens?.(entry, was) ?? false)))) ? 'in' : null));
  const result: Folded<T>[] = [...after.get(null) ?? []];
  next.forEach((entry, index) => {
    const fold = folds[index] ?? (entry.id === null && !live.has(entry.key) && folds[index + 1] === 'in' ? 'in' : null);
    result.push({...entry, fold}, ...after.get(entry.key) ?? []);
  });
  return result;
}
