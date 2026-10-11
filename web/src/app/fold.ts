// The mail list's motion (DESIGN.md › Decided while building #13): a row leaving fades and its height
// closes over 180 ms while the rows below slide up; a row arriving opens the same way. logic/fold.ts
// decides which rows fold; this keeps the leaving ones on screen for the motion and draws it.
import {useEffect, useState} from 'react';
import {motion} from '../tokens.ts';
import {foldList} from '../logic/fold.ts';
import type {Entry, Folded, FoldRules} from '../logic/fold.ts';

// Emails that left lately, so Undo's return folds back in.
const RETURNING = 50;

/** `next` as it shows while it changes; the first paint shows as it is. */
export function useFold<T>(next: Entry<T>[], rules: FoldRules<T>): Folded<T>[] {
  const [state, setState] = useState(() => ({next, shown: next.map((entry): Folded<T> => ({...entry, fold: null})), left: [] as number[]}));
  let current = state;
  if (state.next !== next) {
    const shown = foldList(state.shown, next, rules, new Set(state.left));
    const gone = shown.flatMap(entry => (entry.fold === 'out' && entry.id !== null ? [entry.id] : []));
    current = {next, shown, left: [...state.left.filter(id => !gone.includes(id)), ...gone].slice(-RETURNING)};
    setState(current);
  }
  const shown = current.shown;
  useEffect(() => {
    if (!shown.some(entry => entry.fold === 'out')) return;
    const timer = window.setTimeout(() => setState(last => ({...last, shown: last.shown.filter(entry => entry.fold !== 'out')})), motion.medium);
    return () => window.clearTimeout(timer);
  }, [shown]);
  return shown;
}

const timing = {duration: motion.medium, easing: motion.ease};
const closed: Keyframe = {height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px', opacity: 0};

/** A leaving row's ref: it fades and closes, and stays closed until the list drops it. */
export function foldOut(element: HTMLElement | null) {
  element?.animate([{height: `${element.offsetHeight}px`}, closed], {...timing, fill: 'forwards'});
}

/** An arriving row's ref: it opens from nothing to its height (and back from a fold out not finished). */
export function foldIn(element: HTMLElement | null) {
  if (!element) return;
  element.getAnimations().forEach(animation => animation.cancel());
  element.style.overflow = 'hidden';
  const animation = element.animate([closed, {height: `${element.offsetHeight}px`}], timing);
  const done = () => element.style.removeProperty('overflow');
  animation.onfinish = done;
  animation.oncancel = done;
}
