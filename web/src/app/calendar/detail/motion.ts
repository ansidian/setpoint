// The floating detail's motion (DESIGN.md › The floating detail and The glide; board 12c): one card
// that opens from its item, glides to the next one (FLIP translate on its own curve, the overshoot
// clamped at the grid's edges, retargeting mid-glide from its position and velocity), swaps its
// content and height as it goes, lifts and follows a drag, and closes or hands over to the editor.
// The rules are pure (logic/placement.ts, logic/glide.ts); this drives them frame by frame on the
// card's elements, and React renders what it publishes (the phase, the content layers, the side).
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import type {Rect} from '../../../logic/calendar.ts';
import {contentSlideFrom, glidePosition, glideSegment, glideVelocity} from '../../../logic/glide.ts';
import type {GlideSegment} from '../../../logic/glide.ts';
import {clampInto, placeBeside} from '../../../logic/placement.ts';
import type {Point, Side, Size} from '../../../logic/placement.ts';
import {glide, layout, motion} from '../../../tokens.ts';
import {CAL_ITEMS, findItem, heightOf, pointIn, rectIn} from '../geometry.ts';

/** What the card shows: an item, the day it was picked on, and its calendar. */
export interface DetailTarget {
  item: ItemOut;
  date: string;
  calendar: CalendarOut | undefined;
}

/** How the card leaves when nothing is selected: Esc or the grid (close), or Edit (to the pane). */
export type DetailExit = 'close' | 'edit';

export type Phase = 'closed' | 'opening' | 'rest' | 'glide' | 'drag' | 'closing';

/** One item's content in the card; during a glide the old one fades out over the new one. */
export interface Layer {
  id: number;
  target: DetailTarget;
  role: 'in' | 'out';
}

export interface Snapshot {
  phase: Phase;
  layers: Layer[];
  side: Side | null;
  lifted: boolean;
}

const keyOf = (target: DetailTarget) => `${target.item.key}|${target.date}`;
const visible = (phase: Phase) => phase === 'opening' || phase === 'rest' || phase === 'glide' || phase === 'drag';

const overlaps = (a: Rect, b: Rect) => a.top < b.top + b.height && a.top + a.height > b.top && a.left < b.left + b.width && a.left + a.width > b.left;

export class DetailMotion {
  private snapshot: Snapshot = {phase: 'closed', layers: [], side: null, lifted: false};
  private listeners = new Set<() => void>();

  // The elements, attached by the component.
  private section: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private outer: HTMLDivElement | null = null;
  private card: HTMLDivElement | null = null;
  private body: HTMLDivElement | null = null;

  attach(parts: {section?: HTMLElement | null; scroller?: HTMLElement | null; outer?: HTMLDivElement | null; card?: HTMLDivElement | null; body?: HTMLDivElement | null}) {
    if ('section' in parts) this.section = parts.section ?? null;
    if ('scroller' in parts) this.scroller = parts.scroller ?? null;
    if ('outer' in parts) {
      this.outer = parts.outer ?? null;
      // A card drawn afresh (opening again) takes its place at once.
      if (this.outer) this.apply();
    }
    if ('card' in parts) this.card = parts.card ?? null;
    if ('body' in parts) this.body = parts.body ?? null;
  }

  private target: DetailTarget | null = null;
  private shown: string | null = null;
  private waiting: DetailTarget | null = null;
  private pending: 'open' | 'glide' | null = null;
  // The layer the pending open or glide waits to see drawn before measuring it.
  private pendingLayer = 0;
  private pos: Point = {left: 0, top: 0};
  private size: Size = {width: layout.floatingDetail, height: 0};
  private bounds: Rect = {left: 0, top: 0, width: 0, height: 0};
  // Beside its item, or left where it was dropped.
  private anchored = true;
  private segment: GlideSegment | null = null;
  private started = 0;
  private frame = 0;
  private flipped = false;
  private scrollTop = 0;
  private seq = 0;
  private exitAnimation: Animation | null = null;
  private drag: {pointer: number; dx: number; dy: number; x: number; y: number; moved: boolean} | null = null;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  private publish(next: Partial<Snapshot>) {
    this.snapshot = {...this.snapshot, ...next};
    this.listeners.forEach(listener => listener());
  }

  // ---------- Geometry, read from the grid ----------

  private anchorOf(target: DetailTarget): HTMLElement | null {
    // The chip on the day it was picked; an item folded into "+N" anchors on its "+N".
    return this.section ? findItem(this.section, target.date, target.item.key, true) : null;
  }

  private geometry(target: DetailTarget): {anchor: Rect; others: Rect[]; bounds: Rect} | null {
    const section = this.section;
    const scroller = this.scroller;
    const element = this.anchorOf(target);
    if (!section || !scroller || !element) return null;
    this.scrollTop = scroller.scrollTop;
    this.bounds = rectIn(scroller, section);
    const others = [...section.querySelectorAll(CAL_ITEMS)].filter(other => other !== element).map(other => rectIn(other, section));
    return {anchor: rectIn(element, section), others, bounds: this.bounds};
  }

  /** The card's height with `layer`'s content: the grip plus the content as it lays out. */
  private heightWith(layer: HTMLElement | null): number {
    if (!this.card || !this.body || !layer) return this.size.height;
    return this.card.offsetHeight - this.body.offsetHeight + layer.offsetHeight;
  }

  private layerElement(role: 'in' | 'out'): HTMLElement | null {
    return this.body?.querySelector<HTMLElement>(`[data-role="${role}"]`) ?? null;
  }

  private apply() {
    if (this.outer) this.outer.style.transform = `translate(${this.pos.left}px, ${this.pos.top}px)`;
  }

  private originToward(anchor: Rect | null): string {
    if (!anchor) return 'center';
    return `${anchor.left + anchor.width / 2 - this.pos.left}px ${anchor.top + anchor.height / 2 - this.pos.top}px`;
  }

  // ---------- What React tells it ----------

  /** The selected item changed (or went away, leaving by `exit`). Called in a layout effect. */
  setTarget(target: DetailTarget | null, exit: DetailExit) {
    const previous = this.target;
    this.target = target;
    const phase = this.snapshot.phase;
    if (!target) {
      this.waiting = null;
      if (visible(phase)) this.leave(exit, previous);
      return;
    }
    const key = keyOf(target);
    if (key === this.shown && visible(phase)) {
      // The same item, refreshed: its content changes in place.
      this.publish({layers: this.snapshot.layers.map(layer => (layer.role === 'in' ? {...layer, target} : layer))});
      return;
    }
    if (!this.anchorOf(target)) {
      // Its chip isn't drawn yet (a link to a far month, data still coming): open once it is.
      this.waiting = target;
      if (visible(phase)) this.leave('close', previous);
      return;
    }
    this.waiting = null;
    this.begin(target);
  }

  private begin(target: DetailTarget) {
    const phase = this.snapshot.phase;
    this.shown = keyOf(target);
    if (visible(phase) && this.snapshot.layers.length) {
      if (this.drag) this.endDrag();
      // Hold the height while the new content comes in, and keep the content showing as the old.
      this.lockHeight();
      const showing = this.snapshot.layers.find(layer => layer.role === 'in');
      this.publish({layers: [...(showing ? [{...showing, role: 'out' as const}] : []), {id: ++this.seq, target, role: 'in'}]});
      this.pending = 'glide';
      this.pendingLayer = this.seq;
    } else {
      this.exitAnimation?.cancel();
      this.exitAnimation = null;
      this.stopGlide();
      this.anchored = true;
      this.publish({phase: 'opening', layers: [{id: ++this.seq, target, role: 'in'}], lifted: false});
      this.pending = 'open';
      this.pendingLayer = this.seq;
    }
  }

  /** After every render: start what a new target asked for, or keep the card by its item. */
  afterRender() {
    if (this.waiting) {
      if (this.anchorOf(this.waiting)) {
        const target = this.waiting;
        this.waiting = null;
        this.begin(target);
      }
      return;
    }
    const pending = this.pending;
    const target = this.target;
    if (!pending || !target) {
      this.follow();
      return;
    }
    // React draws the new content in the render after the one that asked for it.
    const incoming = this.layerElement('in');
    if (!incoming || incoming.dataset.layer !== String(this.pendingLayer)) return;
    const where = this.geometry(target);
    if (!where || !this.card) return;
    this.pending = null;
    this.size = {width: this.card.offsetWidth, height: this.heightWith(incoming)};
    const place = placeBeside(where.anchor, this.size, where.bounds, where.others);
    this.publish({side: place.side});
    if (pending === 'open') this.open(place, where.anchor);
    else this.glideTo(place, incoming);
  }

  // ---------- Open, close and the hand-off to Edit ----------

  private open(place: Point, anchor: Rect) {
    const card = this.card!;
    this.pos = {left: place.left, top: place.top};
    this.apply();
    this.outer!.dataset.glideFrom = '';
    card.style.transformOrigin = this.originToward(anchor);
    const animation = card.animate([{opacity: 0, transform: `scale(${glide.openScale})`}, {opacity: 1, transform: 'none'}], {duration: glide.openMs, easing: motion.ease});
    animation.onfinish = () => {
      if (this.snapshot.phase === 'opening') this.publish({phase: 'rest'});
    };
  }

  private leave(exit: DetailExit, from: DetailTarget | null) {
    const card = this.card;
    this.stopGlide();
    if (this.drag) this.endDrag();
    this.pending = null;
    this.shown = null;
    if (!card) {
      this.publish({phase: 'closed', layers: [], side: null, lifted: false});
      return;
    }
    const anchorElement = from ? this.anchorOf(from) : null;
    const anchor = anchorElement && this.section ? rectIn(anchorElement, this.section) : null;
    const edit = exit === 'edit';
    // Edit: shrinks and fades toward the right pane, over 220 ms; close: toward its item, 120 ms.
    card.style.transformOrigin = edit ? 'right center' : this.originToward(anchor);
    const to = edit ? `translateX(${glide.editorSlidePx}px) scale(${glide.editScale})` : `scale(${glide.closeScale})`;
    const animation = card.animate([{opacity: 1, transform: 'none'}, {opacity: 0, transform: to}], {duration: edit ? glide.editMs : glide.closeMs, easing: motion.ease, fill: 'forwards'});
    this.exitAnimation = animation;
    this.publish({phase: 'closing', lifted: false});
    animation.onfinish = () => {
      if (this.exitAnimation !== animation) return;
      this.exitAnimation = null;
      this.anchored = true;
      this.publish({phase: 'closed', layers: [], side: null});
    };
  }

  // ---------- The glide ----------

  private lockHeight() {
    const body = this.body;
    if (!body) return;
    const height = heightOf(body);
    body.getAnimations().forEach(animation => animation.cancel());
    body.style.height = `${height}px`;
  }

  private glideTo(place: Point, incoming: HTMLElement | null) {
    const now = performance.now();
    let from = {...this.pos};
    let velocity = {x: 0, y: 0};
    if (this.segment) {
      // Mid-glide: from where it is, as fast as it's going. No restart, no close.
      from = glidePosition(this.segment, now - this.started);
      velocity = glideVelocity(this.segment, now - this.started);
    }
    this.anchored = true;
    this.flipped = false;
    this.outer!.dataset.glideFrom = `${Math.round(from.left)},${Math.round(from.top)}`;
    this.startSegment(glideSegment(from, place, this.size, this.bounds, velocity), now);
    this.swapContent(from, place, incoming);
  }

  private startSegment(segment: GlideSegment, now: number) {
    this.segment = segment;
    this.started = now;
    this.publish({phase: 'glide'});
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    const segment = this.segment;
    if (!segment) return;
    const elapsed = now - this.started;
    // The overshoot is already shrunk to the room at the edges; this only guards the momentum.
    this.pos = clampInto(glidePosition(segment, elapsed), this.size, this.bounds, 0);
    this.apply();
    if (elapsed >= segment.duration) {
      this.segment = null;
      this.pos = {...segment.to};
      this.apply();
      this.land();
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  /** On landing the side may flip (board 12c), once, if the card's final height asks for it. */
  private land() {
    const target = this.target;
    const where = target && this.anchored ? this.geometry(target) : null;
    if (where && this.card && !this.flipped) {
      this.size = {width: this.card.offsetWidth, height: this.heightWith(this.layerElement('in'))};
      const place = placeBeside(where.anchor, this.size, where.bounds, where.others);
      if (Math.abs(place.left - this.pos.left) > 0.5 || Math.abs(place.top - this.pos.top) > 0.5) {
        this.flipped = true;
        this.publish({side: place.side});
        this.startSegment(glideSegment(this.pos, place, this.size, this.bounds), performance.now());
        return;
      }
    }
    this.publish({phase: 'rest'});
  }

  private stopGlide() {
    cancelAnimationFrame(this.frame);
    this.segment = null;
  }

  /**
   * Old content out over 0–120 ms; new content in over 70–220 ms with its 6 px slide, the two
   * crossfading (the old layer lies over the new), so the card is never blank mid-flight; height over 220.
   */
  private swapContent(from: Point, to: Point, incoming: HTMLElement | null) {
    const outgoing = this.layerElement('out');
    const body = this.body;
    if (outgoing) {
      const opacity = Number(getComputedStyle(outgoing).opacity);
      outgoing.getAnimations().forEach(animation => animation.cancel());
      outgoing.animate([{opacity}, {opacity: 0}], {duration: glide.oldContentOutMs, easing: motion.ease, fill: 'forwards'});
    }
    if (incoming) {
      const slide = contentSlideFrom(from, to);
      incoming.animate(
        [{opacity: 0, transform: `translate(${slide.x}px, ${slide.y}px)`}, {opacity: 1, transform: 'none'}],
        {delay: glide.newContentInFromMs, duration: glide.newContentInToMs - glide.newContentInFromMs, easing: motion.ease, fill: 'backwards'},
      );
    }
    if (body && incoming) {
      const height = heightOf(body);
      const next = incoming.offsetHeight;
      body.style.height = '';
      const animation = body.animate([{height: `${height}px`}, {height: `${next}px`}], {duration: glide.heightMs, easing: motion.ease});
      animation.onfinish = () => {
        // The old content has gone; only what's showing stays.
        if (this.snapshot.layers.some(layer => layer.role === 'out')) this.publish({layers: this.snapshot.layers.filter(layer => layer.role === 'in')});
      };
    }
  }

  // ---------- Keeping by its item ----------

  /** At rest beside its item: if the item moved (data changed, a resize), the card glides after it. */
  private follow() {
    const target = this.target;
    if (!target || this.snapshot.phase !== 'rest' || !this.anchored) return;
    const element = this.anchorOf(target);
    if (!element) {
      // Its chip has gone (the day scrolled out of the drawn rows, a calendar toggled off).
      this.waiting = target;
      this.leave('close', null);
      return;
    }
    this.updateVisibility();
  }

  /** The grid scrolled: the card stays with its item, and hides while the item is out of view. */
  onScroll() {
    const scroller = this.scroller;
    if (!scroller) return;
    const delta = scroller.scrollTop - this.scrollTop;
    this.scrollTop = scroller.scrollTop;
    if (!visible(this.snapshot.phase) || !this.anchored || this.drag || !delta) return;
    this.pos = {left: this.pos.left, top: this.pos.top - delta};
    if (this.segment) {
      const {from, to} = this.segment;
      this.segment = {...this.segment, from: {left: from.left, top: from.top - delta}, to: {left: to.left, top: to.top - delta}};
    }
    this.apply();
    this.updateVisibility();
  }

  private updateVisibility() {
    const target = this.target;
    const outer = this.outer;
    if (!target || !outer || !this.section || !this.scroller) return;
    const element = this.anchorOf(target);
    const inView = !!element && overlaps(rectIn(element, this.section), rectIn(this.scroller, this.section));
    outer.style.visibility = inView || !this.anchored ? '' : 'hidden';
  }

  /** The grid changed size: beside its item it's placed again; dropped, it's kept inside. */
  onResize() {
    const target = this.target;
    if (!target || this.snapshot.phase !== 'rest') return;
    const where = this.geometry(target);
    if (!where || !this.card) return;
    this.size = {width: this.card.offsetWidth, height: this.card.offsetHeight};
    this.pos = this.anchored ? placeBeside(where.anchor, this.size, where.bounds, where.others) : clampInto(this.pos, this.size, where.bounds, 0);
    this.apply();
  }

  // ---------- Drag, from the grip ----------

  pointerDown(event: PointerEvent, grip: Element) {
    if (event.button !== 0 || !visible(this.snapshot.phase) || !this.section) return;
    event.preventDefault();
    grip.setPointerCapture?.(event.pointerId);
    if (this.segment) {
      this.pos = clampInto(glidePosition(this.segment, performance.now() - this.started), this.size, this.bounds, 0);
      this.stopGlide();
      this.apply();
    }
    const at = pointIn(event.clientX, event.clientY, this.section);
    this.drag = {pointer: event.pointerId, dx: at.left - this.pos.left, dy: at.top - this.pos.top, x: event.clientX, y: event.clientY, moved: false};
    if (this.card) this.size = {width: this.card.offsetWidth, height: this.card.offsetHeight};
    this.publish({phase: 'drag', lifted: true});
  }

  pointerMove(event: PointerEvent) {
    const drag = this.drag;
    const section = this.section;
    if (!drag || drag.pointer !== event.pointerId || !section || !this.scroller) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 2) return;
    drag.moved = true;
    // 1:1 with the pointer, inside the grid as it is now.
    const at = pointIn(event.clientX, event.clientY, section);
    this.bounds = rectIn(this.scroller, section);
    this.pos = clampInto({left: at.left - drag.dx, top: at.top - drag.dy}, this.size, this.bounds, 0);
    this.apply();
  }

  pointerUp(event: PointerEvent) {
    const drag = this.drag;
    if (!drag || drag.pointer !== event.pointerId) return;
    this.endDrag();
  }

  private endDrag() {
    const drag = this.drag;
    this.drag = null;
    if (drag?.moved) {
      // Dropped: it stays here, detached, until the next item glides it away (board 12d).
      this.anchored = false;
      this.pos = {left: Math.round(this.pos.left), top: Math.round(this.pos.top)};
      this.apply();
      if (this.outer) this.outer.style.visibility = '';
    }
    this.publish({phase: 'rest', lifted: false});
  }

  dispose() {
    this.stopGlide();
    this.exitAnimation?.cancel();
  }
}
