// The segmented control's thumb (DESIGN.md › Decided while building #179, #317): a `sub3` pill under
// the `on` segment, always drawn and always moving on its transition, so when another segment turns
// on it travels there, position and width together, settling with a slight spring. What isn't a
// segment turning on (the first placement, a resize, the fonts arriving, a count's width changing)
// places it at once. Segmented.tsx is its one user.

/** Keeps `--thumb-x` and `--thumb-w` on the `.seg` at its `on` segment, `data-thumb` while one is on. */
export function segThumb(seg: HTMLElement | null) {
  if (!seg) return;
  let on: HTMLElement | null = null;
  let x = '';
  let w = '';
  const place = () => {
    const now = seg.querySelector<HTMLElement>(':scope > .on');
    if (!now) {
      seg.removeAttribute('data-thumb');
      on = null;
      return;
    }
    const nextX = `${now.offsetLeft}px`;
    const nextW = `${now.offsetWidth}px`;
    const turned = on !== null && now !== on;
    on = now;
    if (nextX === x && nextW === w && seg.hasAttribute('data-thumb')) return;
    x = nextX;
    w = nextW;
    // Anything but a segment turning on goes at once: just this change loses its transition.
    if (!turned) seg.dataset.still = '';
    seg.dataset.thumb = '';
    seg.style.setProperty('--thumb-x', x);
    seg.style.setProperty('--thumb-w', w);
    if (!turned) {
      void getComputedStyle(seg, '::before').transform;
      delete seg.dataset.still;
    }
  };
  place();
  // A segment turned on, or one's words or the fonts changing its width.
  const turned = new MutationObserver(place);
  turned.observe(seg, {subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class']});
  const resized = new ResizeObserver(place);
  resized.observe(seg);
  return () => {
    turned.disconnect();
    resized.disconnect();
  };
}
