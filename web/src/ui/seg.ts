// The segmented control's thumb (DESIGN.md › Decided while building #222; polish audit grids-09):
// when another segment turns on, a `sub3` pill slides from the last one to it over 180 ms rather
// than the fill jumping. At rest the `on` segment draws its own fill, so it sits on its exact box. A
// ref for any `.seg` (Month | Week, Unread | All, Event | Task…).
import {motion} from '../tokens.ts';

/** Keeps `--thumb-x` and `--thumb-w` on the `.seg` at its `on` segment, `data-sliding` while the thumb moves between two. */
export function segThumb(seg: HTMLElement | null) {
  if (!seg) return;
  let on: HTMLElement | null = null;
  let timer = 0;
  const rest = () => {
    window.clearTimeout(timer);
    seg.removeAttribute('data-sliding');
  };
  const place = () => {
    const now = seg.querySelector<HTMLElement>(':scope > .on');
    if (now) {
      seg.style.setProperty('--thumb-x', `${now.offsetLeft}px`);
      seg.style.setProperty('--thumb-w', `${now.offsetWidth}px`);
    }
    // Another segment on: the thumb, still where the last one was, slides over.
    if (now && on && now !== on) {
      seg.dataset.sliding = '';
      window.clearTimeout(timer);
      // Its transitionend, else a moment past it.
      timer = window.setTimeout(rest, motion.medium + 100);
    }
    on = now;
  };
  const arrived = (event: TransitionEvent) => {
    if (event.target === seg && event.pseudoElement === '::before' && event.propertyName === 'transform') rest();
  };
  place();
  // A segment turned on, or one's words or the fonts changing its width.
  const turned = new MutationObserver(place);
  turned.observe(seg, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class']});
  const resized = new ResizeObserver(place);
  resized.observe(seg);
  seg.addEventListener('transitionend', arrived);
  return () => {
    rest();
    turned.disconnect();
    resized.disconnect();
    seg.removeEventListener('transitionend', arrived);
  };
}
