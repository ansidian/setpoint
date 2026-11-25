// A mail list's scrollbar, drawn over its rows' right end as macOS's overlay scrollbars are, so the
// lifted row and the day bands run to the card's edge rather than stopping at a native scrollbar's
// gutter. It is the list's first child: a sticky strip of no height at the scrollport's top, holding
// the thumb, which takes the list's share in view as its height and follows the scroll. A drag on it
// scrolls the list. Where the pointer is coarse (the phone) the native overlay scrollbar stays and
// this draws nothing (styles.css).
import {useLayoutEffect, useRef} from 'react';
import type {PointerEvent} from 'react';

const INSET = 3;
const MIN = 32;

/** The thumb's height and offset from the scrollport's top, or null when nothing scrolls. */
export function thumbPlace(scrollTop: number, scrollHeight: number, clientHeight: number): {size: number; top: number} | null {
  const range = scrollHeight - clientHeight;
  if (range < 1) return null;
  const track = clientHeight - INSET * 2;
  const size = Math.min(track, Math.max(MIN, (track * clientHeight) / scrollHeight));
  return {size, top: INSET + ((track - size) * Math.min(Math.max(scrollTop, 0), range)) / range};
}

export function ScrollThumb() {
  const strip = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLDivElement>(null);
  const drag = useRef<{y: number; scrollTop: number; perPx: number} | null>(null);
  useLayoutEffect(() => {
    const list = strip.current?.parentElement;
    const bar = thumb.current;
    if (!list || !bar) return;
    const place = () => {
      const at = thumbPlace(list.scrollTop, list.scrollHeight, list.clientHeight);
      bar.hidden = !at;
      if (!at) return;
      bar.style.height = `${at.size}px`;
      bar.style.transform = `translateY(${at.top}px)`;
    };
    // The rows' heights change as they load, fold and open, so each one is watched.
    const sizes = new ResizeObserver(place);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(list);
      for (const child of list.children) sizes.observe(child);
      place();
    };
    const children = new MutationObserver(watch);
    children.observe(list, {childList: true});
    list.addEventListener('scroll', place, {passive: true});
    watch();
    return () => {
      sizes.disconnect();
      children.disconnect();
      list.removeEventListener('scroll', place);
    };
  }, []);
  const start = (event: PointerEvent<HTMLDivElement>) => {
    const list = strip.current?.parentElement;
    const at = list && thumbPlace(list.scrollTop, list.scrollHeight, list.clientHeight);
    if (!list || !at) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    // Pointer moves are in screen px, the list's in CSS px under the UI's zoom.
    const zoom = list.getBoundingClientRect().height / list.offsetHeight || 1;
    const track = list.clientHeight - INSET * 2 - at.size;
    drag.current = {y: event.clientY, scrollTop: list.scrollTop, perPx: track > 0 ? (list.scrollHeight - list.clientHeight) / track / zoom : 0};
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const list = strip.current?.parentElement;
    if (!list || !drag.current) return;
    list.scrollTo({top: drag.current.scrollTop + (event.clientY - drag.current.y) * drag.current.perPx});
  };
  const end = () => {
    drag.current = null;
  };
  return (
    <div ref={strip} className="scroll-strip" aria-hidden="true">
      <div ref={thumb} className="scroll-thumb" hidden onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
    </div>
  );
}
