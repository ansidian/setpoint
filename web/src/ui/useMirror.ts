// The marks a line draws under its input (the editor's line, mail search's operators).
import {useEffect} from 'react';
import type {RefObject} from 'react';

const MIRROR_EVENTS = ['scroll', 'input', 'select', 'keyup', 'focus', 'blur'] as const;

/**
 * Keeps a line's marks under its letters: a line longer than the field scrolls inside the
 * input, so the mirror moves with it, and says which sides are cut short, which fade.
 */
export function useMirror(input: RefObject<HTMLInputElement | null>, mirror: RefObject<HTMLSpanElement | null>, text: string) {
  useEffect(() => {
    const field = input.current;
    const marks = mirror.current;
    const inner = marks?.firstElementChild;
    if (!field || !marks || !(inner instanceof HTMLElement)) return;
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      // Chromium moves the input's scroll after its caret, so it's read a frame later.
      frame = requestAnimationFrame(() => {
        const left = field.scrollLeft;
        inner.style.transform = left ? `translateX(${-left}px)` : '';
        marks.toggleAttribute('data-clip-left', left > 0);
        marks.toggleAttribute('data-clip-right', field.scrollWidth - field.clientWidth - left > 1);
      });
    };
    for (const name of MIRROR_EVENTS) field.addEventListener(name, follow);
    follow();
    return () => {
      cancelAnimationFrame(frame);
      for (const name of MIRROR_EVENTS) field.removeEventListener(name, follow);
    };
  }, [input, mirror, text]);
}
