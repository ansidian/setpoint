// Find in email: the header's field searching the open email, one for the whole app so it outlives
// the field that shows it. ⌘F with an email open on the Inbox, Sent or Snoozed opens it on that
// email (App.tsx, logic/find.ts › findScope). The field shows "Search <subject>", the count, and
// steps with Enter and ⇧Enter. Esc, `/`, or the email closing or changing ends it.
//
// What it matches: every part of the reader marked for it. A part on screen is `data-find` (the
// subject, each email's sender line, its paragraphs, its files' names), and its matches are drawn with
// the CSS highlight API, so React's text stays its own. An HTML email's frame is `data-find-frame`
// with the count its page gave (MailFrame.tsx). A folded part (a collapsed email, quoted history) is
// `data-find-hidden` with the count its text holds, and stepping onto one of its matches unfolds it
// through `registerFold`. Esc folds back only what find unfolded.
//
// The field's focus (`focused`) is what dims the page around its scope (styles.css › Find's dim).
import {useEffect, useSyncExternalStore} from 'react';
import type {RefObject} from 'react';
import {findWords, foldForFind, stepFind} from '../../logic/find.ts';
import type {FindScope} from '../../logic/find.ts';

export interface FindTarget {
  id: number;
  subject: string;
}

export interface FindState {
  // The email the reader has open, which ⌘F would search.
  target: FindTarget | null;
  // The email find searches, while the field is scoped to one.
  open: FindTarget | null;
  text: string;
  current: number;
  total: number;
  // A mail page's field has focus: the page dims around its scope.
  focused: boolean;
  // Asks the field showing find to take the keys.
  focus: number;
  // Moves on each new search or step, so the current match is brought into view once.
  seek: number;
}

let state: FindState = {target: null, open: null, text: '', current: 0, total: 0, focused: false, focus: 0, seek: 0};
const listeners = new Set<() => void>();
const set = (change: Partial<FindState>) => {
  state = {...state, ...change};
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const findState = () => state;
export const useFind = () => useSyncExternalStore(subscribe, findState);

/** What the focused field dims around, or null while no mail page's field has focus. */
export const dimScope = (find: FindState): FindScope | null => (find.focused ? (find.open ? 'email' : 'page') : null);

// The folds find can open, by key (`email:<id>`, `quoted:<id>`), and those it opened.
interface Fold {
  unfold: () => void;
  fold: () => void;
}
const folds = new Map<string, Fold>();
const unfolded = new Set<string>();

/** A folded part find may open to reach a match. Returns its unregistering. */
export function registerFold(key: string, fold: Fold) {
  folds.set(key, fold);
  return () => {
    if (folds.get(key) === fold) folds.delete(key);
  };
}

function foldBack() {
  for (const key of unfolded) folds.get(key)?.fold();
  unfolded.clear();
}

/** The reader's open email, or null when it closes. Another email, or none, ends find. */
export function setFindTarget(target: FindTarget | null) {
  if (state.open && state.open.id !== target?.id) closeFind();
  if (state.target?.id !== target?.id || state.target?.subject !== target?.subject) set({target});
}

/** Find on the open email, and the keys to its field. False when no email is open. */
export function openFind(): boolean {
  const {target} = state;
  if (!target) return false;
  if (state.open?.id === target.id) set({focus: state.focus + 1});
  else set({open: target, text: '', current: 0, total: 0, focus: state.focus + 1});
  return true;
}

/** Find ends: its words go, and what it unfolded folds back. */
export function closeFind() {
  if (!state.open) return;
  foldBack();
  set({open: null, text: '', current: 0, total: 0});
}

export function setFindText(text: string) {
  set({text, current: 0, seek: state.seek + 1});
}

/** Enter's next match, ⇧Enter's previous, wrapping. */
export function stepFindBy(delta: 1 | -1) {
  if (state.total > 0) set({current: stepFind(state.current, state.total, delta), seek: state.seek + 1});
}

export function setFindFocused(focused: boolean) {
  if (state.focused !== focused) set({focused});
}

/** Holds the reader's open email as find's target while it shows. */
export function useFindTarget(target: FindTarget | null) {
  const id = target?.id ?? null;
  const subject = target?.subject ?? '';
  useEffect(() => {
    setFindTarget(id === null ? null : {id, subject});
  }, [id, subject]);
  useEffect(() => () => setFindTarget(null), []);
}

// The frames in the reader, each told which of its matches is current (-1 for none) and whether
// to bring it into view.
type FrameStep = (current: number, reveal: boolean) => void;
const frames = new Map<Element, FrameStep>();

export function registerFrame(element: Element, step: FrameStep) {
  frames.set(element, step);
  return () => {
    if (frames.get(element) === step) frames.delete(element);
  };
}

/** The pane scrolled, at once, so a box from `top` to `bottom` (the window's pixels) is in view. */
export function revealInPane(scroller: Element | null, top: number, bottom: number) {
  if (!(scroller instanceof HTMLElement)) return;
  const box = scroller.getBoundingClientRect();
  const margin = 48;
  if (top >= box.top + margin && bottom <= box.bottom - margin) return;
  scroller.scrollTop += top - box.top - box.height / 3;
}

// Block boxes break a part's text into lines no match crosses.
const BLOCKS = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'TR', 'TD', 'TH', 'TABLE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'BR', 'HR', 'SECTION', 'ARTICLE']);

/** The ranges the words fall on inside a part, whose text nodes may be split by marks and spans. */
function partRanges(part: Element, words: string): Range[] {
  const nodes: Text[] = [];
  const starts: number[] = [];
  let text = '';
  const walker = document.createTreeWalker(part, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node instanceof Text) {
      nodes.push(node);
      starts.push(text.length);
      text += node.data;
    } else if (BLOCKS.has((node as Element).tagName)) {
      text += '\n';
    }
  }
  const folded = foldForFind(text);
  const at = (offset: number): [Text, number] => {
    let index = nodes.length - 1;
    while (index > 0 && starts[index]! > offset) index -= 1;
    return [nodes[index]!, offset - starts[index]!];
  };
  const ranges: Range[] = [];
  let from = 0;
  for (;;) {
    const start = folded.text.indexOf(words, from);
    if (start < 0) return ranges;
    const end = start + words.length - 1;
    const range = document.createRange();
    const [startNode, startOffset] = at(folded.at[start]!);
    const [endNode, endOffset] = at(folded.at[end]!);
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, Math.min(endNode.length, endOffset + 1));
    ranges.push(range);
    from = start + words.length;
  }
}

type Entry = {range: Range} | {block: Element; index: number};

interface Highlights {
  set: (name: string, highlight: unknown) => void;
  delete: (name: string) => void;
}
const highlights = () => (globalThis as {CSS?: {highlights?: Highlights}}).CSS?.highlights;
const Highlight = () => (globalThis as {Highlight?: new (...ranges: Range[]) => unknown}).Highlight;

function paint(all: Range[], current: Range | null) {
  const registry = highlights();
  const make = Highlight();
  if (!registry || !make) return;
  if (all.length) registry.set('setpoint-find', new make(...all));
  else registry.delete('setpoint-find');
  if (current) registry.set('setpoint-find-current', new make(current));
  else registry.delete('setpoint-find-current');
}

/**
 * Find run over the reader's scroller: it counts the matches of every part in order, marks them,
 * tells each frame its current match, unfolds a folded part when the current match is in it, and
 * brings the current match into view after each new search or step.
 */
export function useFindIn(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const pane = root.current;
    const scroller = pane?.querySelector('.rd-scroll');
    if (!pane || !scroller) return;
    let queued = 0;
    let revealed = -1;
    const run = () => {
      queued = 0;
      const {open, text, current, seek} = state;
      const words = open ? findWords(text) : '';
      if (!words) {
        paint([], null);
        frames.forEach(step => step(-1, false));
        if (state.total !== 0) set({total: 0});
        return;
      }
      const entries: Entry[] = [];
      for (const part of scroller.querySelectorAll('[data-find], [data-find-frame], [data-find-hidden]')) {
        if (part.hasAttribute('data-find')) {
          for (const range of partRanges(part, words)) entries.push({range});
        } else {
          const count = Number(part.getAttribute('data-find-count') ?? 0);
          for (let index = 0; index < count; index += 1) entries.push({block: part, index});
        }
      }
      if (state.total !== entries.length) set({total: entries.length});
      const at = entries.length ? Math.min(current, entries.length - 1) : -1;
      const chosen = at >= 0 ? entries[at]! : null;
      const reveal = seek !== revealed;
      paint(entries.flatMap(entry => ('range' in entry ? [entry.range] : [])), chosen && 'range' in chosen ? chosen.range : null);
      frames.forEach((step, frame) => step(chosen && 'block' in chosen && chosen.block === frame ? chosen.index : -1, reveal));
      if (!chosen) return;
      if ('block' in chosen) {
        const key = chosen.block.getAttribute('data-find-hidden');
        const fold = key ? folds.get(key) : undefined;
        if (key && fold) {
          unfolded.add(key);
          fold.unfold();
        }
        if (key || !reveal) return;
        // A frame brings its own match into view once its page answers (MailFrame.tsx).
        revealed = seek;
        return;
      }
      if (!reveal) return;
      revealed = seek;
      const box = chosen.range.getBoundingClientRect();
      revealInPane(scroller, box.top, box.bottom);
    };
    const later = () => {
      if (!queued) queued = requestAnimationFrame(run);
    };
    later();
    const observer = new MutationObserver(later);
    observer.observe(pane, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-find-count']});
    const unsubscribe = subscribe(later);
    return () => {
      if (queued) cancelAnimationFrame(queued);
      observer.disconnect();
      unsubscribe();
      paint([], null);
    };
  }, [root]);
}
