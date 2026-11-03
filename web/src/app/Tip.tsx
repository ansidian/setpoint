// The shared tooltip (DESIGN.md › Decided while building #299), in place of the browser's own: any
// element with `data-tip` names itself with it. The mouse resting on one 80 ms, or the keyboard
// focusing one, shows the tip under it (logic/tip.ts), and leaving it, a press, a scroll, Esc, or the
// window resizing or losing focus puts it away; so does the element going or losing its `data-tip`.
// One listener on the document serves every element, so a tooltip is only an attribute. While it
// shows, the element is described by it for a screen reader. A touch never shows one, and the phone
// has none, as it had no `title` tooltips either.
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {placeTip, type TipPlace} from '../logic/tip.ts';
import {tip} from '../tokens.ts';

const ID = 'tip';

// The page's zoom from 2200 px (styles.css): rects are in the window's pixels, the tip's place in the page's.
const zoom = () => (document.documentElement as HTMLElement & {currentCSSZoom?: number}).currentCSSZoom || 1;

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
      if (!target.dataset.tip) return;
      anchor = target;
      describe(target, true);
      // Its words changing update it; it going, or losing them, puts it away.
      watch = new MutationObserver(() => {
        if (!target.isConnected || !target.dataset.tip) hide();
        else setShown(now => (now && now.text !== target.dataset.tip ? {...now, text: target.dataset.tip!} : now));
      });
      watch.observe(document.body, {childList: true, subtree: true, attributes: true, attributeFilter: ['data-tip']});
      setShown({anchor: target, text: target.dataset.tip, n: ++n});
    };
    const owner = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>('[data-tip]') : null);

    const over = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return;
      const target = owner(event.target);
      if (target && (target === anchor || target === pending)) return;
      hide();
      if (!target) return;
      pending = target;
      timer = window.setTimeout(() => show(target), tip.delayMs);
    };
    const out = (event: PointerEvent) => {
      const leaving = pending ?? anchor;
      if (leaving && !leaving.contains(event.relatedTarget as Node | null)) hide();
    };
    const focus = (event: FocusEvent) => {
      const target = owner(event.target);
      if (target && target === event.target && target.matches(':focus-visible')) show(target);
    };
    const blur = (event: FocusEvent) => {
      if (event.target === anchor) hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', blur);
    document.addEventListener('keydown', key, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
    return () => {
      hide();
      document.removeEventListener('pointerover', over);
      document.removeEventListener('pointerout', out);
      document.removeEventListener('pointerdown', hide, true);
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
