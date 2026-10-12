// The mail list's motion (DESIGN.md › Decided while building #13): a row leaving fades and its height
// closes over 180 ms while the rows below slide up; a row arriving opens the same way. Its text goes
// first (by 72 ms) and the height closes after, so a folding row never shows a squashed slice of its
// lines; arriving, its height opens first and its text comes in after. A row Done or Trash takes
// first plays a 120 ms beat (its tint and glyph, styles.css); rows of one group folding together, as
// it opens or closes, start 12 ms apart, at most 60. logic/fold.ts decides which rows fold; this
// keeps the leaving ones on screen for the motion and draws it.
import {useEffect, useState} from 'react';
import {motion} from '../tokens.ts';
import {foldList} from '../logic/fold.ts';
import type {Entry, Fold, Folded, FoldRules} from '../logic/fold.ts';

// Emails that left lately, so Undo's return folds back in.
const RETURNING = 50;

/** A row's beat before it folds: Done ticks it off in `good`, Trash throws it away in `alert`. */
export type Beat = 'done' | 'trash';

/**
 * Why each email's row is leaving, set by the page as Done or Trash takes it (and cleared by Undo),
 * so the row plays its beat before it folds.
 */
export const beats = new Map<number, Beat>();

/** The beat's length: the fold waits for it. */
export const BEAT_MS = motion.fast;

/** Rows of one group folding together start this far apart, up to STAGGER_CAP_MS. */
export const STAGGER_MS = 12;
export const STAGGER_CAP_MS = 60;

/** How long a list keeps a leaving row drawn: its beat (or its place in a stagger), then its fold. */
export const FOLD_HOLD_MS = motion.medium + BEAT_MS;

/** A row's delay with `index` rows before it in its run: 12 ms each, at most 60. */
export const staggered = (index: number) => Math.min(index * STAGGER_MS, STAGGER_CAP_MS);

/** `next` as it shows while it changes; the first paint shows as it is. Leaving entries stay `hold` ms. */
export function useFold<T>(next: Entry<T>[], rules: FoldRules<T>, hold: number = motion.medium): Folded<T>[] {
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
    const timer = window.setTimeout(() => setState(last => ({...last, shown: last.shown.filter(entry => entry.fold !== 'out')})), hold);
    return () => window.clearTimeout(timer);
  }, [shown, hold]);
  return shown;
}

const timing = {duration: motion.medium, easing: motion.ease};
const closed: Keyframe = {height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px', borderTopWidth: '0px', borderBottomWidth: '0px', opacity: 0};
/** Leaving: the text is gone by 40% (72 ms), then the height closes cleanly. */
const leaving = (height: number): Keyframe[] => [{height: `${height}px`, opacity: 1}, {opacity: 0, offset: 0.4}, closed];
/** Arriving, the mirror: the height opens, and the text comes in over the last 40%. */
const arriving = (height: number): Keyframe[] => [closed, {opacity: 0, offset: 0.6}, {height: `${height}px`, opacity: 1}];

/** A leaving row's ref: after `delay` it fades and closes, and stays closed until the list drops it. */
export function foldOut(element: HTMLElement | null, delay = 0) {
  // Once: the same row given its ref again doesn't start over.
  if (!element || element.dataset.fold === 'out') return;
  element.dataset.fold = 'out';
  element.animate(leaving(element.offsetHeight), {...timing, delay, fill: 'both'});
}

/** An arriving row's ref: after `delay` it opens from nothing to its height (and back from a fold out not finished). */
export function foldIn(element: HTMLElement | null, delay = 0) {
  if (!element) return;
  delete element.dataset.fold;
  element.getAnimations().forEach(animation => animation.cancel());
  element.style.overflow = 'hidden';
  const animation = element.animate(arriving(element.offsetHeight), {...timing, delay, fill: 'backwards'});
  const done = () => element.style.removeProperty('overflow');
  animation.onfinish = done;
  animation.oncancel = done;
}

/**
 * An email folding onto the Pinned shelf: it folds in, then holds `sub3` and lets it go over 260 ms,
 * so it's clear where it landed (polish audit inbox-09), whatever the list does meanwhile.
 */
export function foldInLanding(element: HTMLElement | null, delay = 0) {
  foldIn(element, delay);
  const held = element ? getComputedStyle(element).getPropertyValue('--sub3').trim() : '';
  element?.animate([{backgroundColor: held}, {}], {duration: motion.slow, delay: delay + motion.medium, easing: motion.ease, fill: 'backwards'});
}

type FoldCallback = (element: HTMLElement | null) => void;
// One ref per delay, so a row's ref stays the same function from render to render.
const outRefs = new Map<number, FoldCallback>();
const inRefs = new Map<number, FoldCallback>();
const landingRefs = new Map<number, FoldCallback>();
function cached(refs: Map<number, FoldCallback>, delay: number, fold: (element: HTMLElement | null, delay: number) => void): FoldCallback {
  let ref = refs.get(delay);
  if (!ref) {
    ref = element => fold(element, delay);
    refs.set(delay, ref);
  }
  return ref;
}

/** The ref that folds an entry its way after `delay` ms (landing on the shelf, with its hold); none for an entry staying put. */
export function foldRef(fold: Fold, delay = 0, landing = false): FoldCallback | undefined {
  if (fold === 'out') return cached(outRefs, delay, foldOut);
  if (fold === 'in') return cached(landing ? landingRefs : inRefs, delay, landing ? foldInLanding : foldIn);
  return undefined;
}

/**
 * Each folding row's delay in `entries`, by its key: a beat's length for a row Done or Trash took,
 * else its place in a run of its group's rows folding the same way (a group opening or closing,
 * Mark all as read). `groupOf` names a row's group (null for a header or another entry).
 */
export function foldDelays<T>(entries: Folded<T>[], groupOf: (entry: Folded<T>) => string | null): Map<string, number> {
  const delays = new Map<string, number>();
  // The run the last row was in: its group, which way it folds, and how many rows it has had.
  let group: string | null = null;
  let way: Fold = null;
  let count = 0;
  for (const entry of entries) {
    const own = entry.fold === null || entry.id === null ? null : groupOf(entry);
    if (own === null) {
      group = null;
      continue;
    }
    count = own === group && entry.fold === way ? count + 1 : 0;
    group = own;
    way = entry.fold;
    delays.set(entry.key, entry.fold === 'out' && beats.has(entry.id!) ? BEAT_MS : staggered(count));
  }
  return delays;
}

/**
 * A card closed on purpose (Alfred's Answer card, a proposal: ×, Esc, Cancel, Create) folds away as a
 * leaving row does, so what's under it slides back up rather than jumping. The page drops the card at
 * once; a copy of it, taking nothing, stays in its place for the fold, then goes.
 */
export function foldAway(element: Element | null) {
  leaveCopy(element, card => leaving(card.offsetHeight), timing);
}

/**
 * Something the page drops on purpose leaves in motion: a copy of it, taking nothing and hidden from
 * assistive tech, stays in its place for `keyframes` (built from the element as it was), then goes.
 */
export function leaveCopy(element: Element | null, keyframes: (element: HTMLElement) => Keyframe[], options: KeyframeAnimationOptions) {
  if (!(element instanceof HTMLElement) || !element.isConnected || element.dataset.left !== undefined) return;
  element.dataset.left = '';
  const ghost = element.cloneNode(true) as HTMLElement;
  ghost.inert = true;
  ghost.setAttribute('aria-hidden', 'true');
  ghost.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
  ghost.style.overflow = 'hidden';
  ghost.style.pointerEvents = 'none';
  element.after(ghost);
  // The copy arrives as a new element: its own entrance doesn't play again.
  ghost.getAnimations({subtree: true}).forEach(animation => animation.cancel());
  ghost.animate(keyframes(element), {...options, fill: 'forwards'}).onfinish = () => ghost.remove();
}
