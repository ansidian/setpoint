// The shared tooltip (DESIGN.md › Decided while building #299), in place of the browser's own: any
// element with `data-tip` names itself with it. The mouse resting on one, or the keyboard focusing one,
// shows the tip under it (logic/tip.ts): after 80 ms where it's marked `data-tip-quick` (what it
// reveals where you've stopped to read, as the reader's sender), 500 ms elsewhere (SV-171). Leaving it,
// a press, a scroll, Esc, or the window resizing or losing focus puts it away; so does the element
// going or losing its `data-tip`. A tip that only repeats the element's own words shows only while
// some of them are cut. One gaining a `data-tip` under the mouse (the editor's line over a mark) shows
// it once the mouse moves.
// One listener on the document serves every element, so a tooltip is only an attribute. While it
// shows, the element is described by it for a screen reader. A touch never shows one, and the phone
// mounts none: its few `data-tip`s (the attention badges) were `title`s no touch showed either. An
// element named only by its tooltip has an `aria-label` too, as the tip only describes.
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {placeTip, repeats, type TipPlace} from '../logic/tip.ts';
import {tip} from '../tokens.ts';

const ID = 'tip';

// The page's zoom (styles.css: 1.075 from 1440 px, 1.25 from 2200): rects are in the window's pixels, the tip's place in the page's.
const zoom = () => (document.documentElement as HTMLElement & {currentCSSZoom?: number}).currentCSSZoom || 1;

/** Whether some of `element`'s words are cut: a box in it that hides what overflows it, narrower than they are. */
const cut = (element: HTMLElement) => [element, ...element.querySelectorAll('*')]
  .some(each => each.scrollWidth > each.clientWidth && getComputedStyle(each).overflowX !== 'visible');

/** Adds the tip to `element`'s aria-describedby, or takes it out, leaving its others. */
function describe(element: HTMLElement, on: boolean) {
  const ids = (element.getAttribute('aria-describedby') ?? '').split(' ').filter(id => id && id !== ID);
  if (on) ids.push(ID);
  if (ids.length) element.setAttribute('aria-describedby', ids.join(' '));
  else element.removeAttribute('aria-describedby');
}

interface Shown {
  anchor: HTMLElement;
  text: string;
  n: number;
}

export function Tip() {
  const [shown, setShown] = useState<Shown | null>(null);
  const [place, setPlace] = useState<TipPlace | null>(null);
  const element = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let timer = 0;
    let n = 0;
    let pending: HTMLElement | null = null;
    let anchor: HTMLElement | null = null;
    // What the mouse was last over, so a move only counts when that changes; and what a press focused, as
    // a field focused by a click matches :focus-visible too.
    let under: HTMLElement | null = null;
    let pressed: HTMLElement | null = null;
    let watch: MutationObserver | null = null;
    const hide = () => {
      clearTimeout(timer);
      pending = null;
      if (!anchor) return;
      watch?.disconnect();
      describe(anchor, false);
      anchor = null;
      setShown(null);
    };
    const show = (target: HTMLElement) => {
      hide();
      const words = target.dataset.tip;
      if (!words || (repeats(target.textContent ?? '', words) && !cut(target))) return;
      anchor = target;
      describe(target, true);
      // Its words changing update it; it going, or losing them, puts it away.
      watch = new MutationObserver(() => {
        if (!target.isConnected || !target.dataset.tip) hide();
        else setShown(now => (now && now.text !== target.dataset.tip ? {...now, text: target.dataset.tip!} : now));
      });
      watch.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-tip']});
      setShown({anchor: target, text: words, n: ++n});
    };
    const owner = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>('[data-tip]') : null);

    const over = (event: PointerEvent) => {
      // None while a button is held, as across a drag's way over the calendar's chips.
      if (event.pointerType !== 'mouse' || event.buttons) return;
      const target = owner(event.target);
      under = target;
      if (target && (target === anchor || target === pending)) return;
      hide();
      if (!target) return;
      pending = target;
      timer = window.setTimeout(() => show(target), target.dataset.tipQuick ? tip.quickMs : tip.patientMs);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' && owner(event.target) !== under) over(event);
    };
    const press = (event: PointerEvent) => {
      hide();
      pressed = owner(event.target);
    };
    const out = (event: PointerEvent) => {
      const leaving = pending ?? anchor;
      if (leaving && !leaving.contains(event.relatedTarget as Node | null)) hide();
    };
    const focus = (event: FocusEvent) => {
      const target = owner(event.target);
      if (target && target === event.target && target !== pressed && target.matches(':focus-visible')) show(target);
    };
    const blur = (event: FocusEvent) => {
      if (event.target === anchor) hide();
    };
    const key = (event: KeyboardEvent) => {
      pressed = null;
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', press, true);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('focusout', blur);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Placed once measured, before it's drawn.
  useLayoutEffect(() => {
    const tipElement = element.current;
    if (!shown || !tipElement) {
      setPlace(null);
      return;
    }
    const z = zoom();
    const rect = shown.anchor.getBoundingClientRect();
    setPlace(placeTip(
      {left: rect.left / z, top: rect.top / z, width: rect.width / z, height: rect.height / z},
      {width: tipElement.offsetWidth, height: tipElement.offsetHeight},
      {width: window.innerWidth / z, height: window.innerHeight / z},
    ));
  }, [shown]);

  return shown && (
    <div key={shown.n} ref={element} id={ID} role="tooltip" className="tip num"
      style={place ? {left: place.left, top: place.top} : {visibility: 'hidden'}}>
      {shown.text}
    </div>
  );
}
