// The one segmented control. Month | Week, Event | Task, News's views, Jobs's status filter and
// Code expiry draw it. It owns the markup and the sliding thumb (seg.ts). Where a page turns it on,
// Tab and Shift-Tab step its segments from anywhere on the page and wrap at the ends. Its tooltip
// is "Tab · ⇧Tab".
import {useEffect, useLayoutEffect, useRef} from 'react';
import type {CSSProperties, ReactNode, RefObject} from 'react';
import {motion} from '../tokens.ts';
import {isTyping} from './keys.ts';
import {segThumb} from './seg.ts';

// `quiet`: drawn quieter, and passed over by Tab and Shift-Tab, though a click still turns it on
// (Sent's accounts with no sent mail).
export type Segment<T> = {value: T; label: ReactNode; tip?: string; quiet?: boolean};

/** How its buttons say which one is on: pressed toggles (the default), radios, or tabs. */
export type SegmentRole = 'pressed' | 'radio' | 'tab';

const GROUP_ROLE = {pressed: 'group', radio: 'radiogroup', tab: 'tablist'} as const;

/**
 * Whether a key steps a page's segmented control, and which way. Only Tab or Shift-Tab steps it. It
 * doesn't in a text field, or with a popover, menu, dialog or the editor open. It doesn't inside a
 * form or dialog either, where Tab is the browser's.
 */
export function tabStep(event: KeyboardEvent): 1 | -1 | null {
  if (event.key !== 'Tab' || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return null;
  if (isTyping(event) || event.defaultPrevented) return null;
  if (document.querySelector('.pop, [aria-modal="true"], .palette, .rpane.editor')) return null;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest('.editor, [role="dialog"]')) return null;
  return event.shiftKey ? -1 : 1;
}

/**
 * The segment `delta` from `value`, wrapping from the last to the first and back. `skipped` ones are
 * passed over, from wherever `value` sits, a skipped one included.
 */
export function stepSegment<T>(values: readonly T[], value: T, delta: 1 | -1, skipped: ReadonlySet<T> = new Set()): T {
  const at = values.indexOf(value);
  if (at === -1) return values.find(one => !skipped.has(one)) ?? values[0]!;
  for (let step = 1; step <= values.length; step += 1) {
    const next = values[(((at + step * delta) % values.length) + values.length) % values.length]!;
    if (!skipped.has(next)) return next;
  }
  return value;
}

export function Segmented<T extends string | number>({segments, value, onChange, onTab, label, role = 'pressed', className, style}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (next: T) => void;
  /** Turns on Tab and Shift-Tab for the page, given the segment they step to (onChange when it's just a change). */
  onTab?: (next: T) => void;
  label?: string;
  role?: SegmentRole;
  className?: string;
  style?: CSSProperties;
}) {
  // The latest render's, so the key always acts on what's on screen.
  const latest = useRef({segments, value, onTab});
  useLayoutEffect(() => {
    latest.current = {segments, value, onTab};
  });
  const tabs = onTab !== undefined;
  useEffect(() => {
    if (!tabs) return;
    const onKey = (event: KeyboardEvent) => {
      const delta = tabStep(event);
      const {segments: now, value: at, onTab: step} = latest.current;
      if (delta === null || !step) return;
      event.preventDefault();
      step(stepSegment(now.map(segment => segment.value), at, delta, new Set(now.filter(segment => segment.quiet).map(segment => segment.value))));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [tabs]);

  return (
    <span className={className ? `seg ${className}` : 'seg'} ref={segThumb} role={label ? GROUP_ROLE[role] : undefined} aria-label={label}
      data-tip={tabs ? 'Tab · ⇧Tab' : undefined} style={style}>
      {segments.map(segment => {
        const on = segment.value === value;
        const state = role === 'radio' ? {role: 'radio', 'aria-checked': on} : role === 'tab' ? {role: 'tab', 'aria-selected': on} : {'aria-pressed': on};
        return (
          <button key={segment.value} type="button" className={[on && 'on', segment.quiet && 'quiet'].filter(Boolean).join(' ') || undefined} data-tip={segment.tip} {...state} onClick={() => onChange(segment.value)}>
            {segment.label}
          </button>
        );
      })}
    </span>
  );
}

/** A quick fade on a list when what it shows changes (Jobs's filter, News's view), never on its first draw. */
export function useListFade(list: RefObject<HTMLElement | null>, shows: unknown) {
  const was = useRef(shows);
  useLayoutEffect(() => {
    if (was.current === shows) return;
    was.current = shows;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    list.current?.animate([{opacity: 0.4}, {opacity: 1}], {duration: motion.fast, easing: motion.ease});
  }, [list, shows]);
}
