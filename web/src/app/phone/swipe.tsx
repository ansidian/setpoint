// A list's rows swiping on the phone (logic/swipe.ts rules where it rests and what a full swipe
// runs). The list hands its pointer events here; the row a drag holds follows the finger by its
// `--sw` offset, set directly rather than through React, so a drag doesn't draw the whole list again
// at each move. The tray of actions behind it draws only for that row, and only while it's dragged
// or resting open. One row rests open at a time: a press anywhere else in the list, or a scroll,
// closes it, and that press opens nothing. A drag, or a press that closes a row, never ends in the
// row's click. Its rows carry `data-swipe-key`, else `data-key`; the list says what each one offers
// and runs what's picked. A row that is itself a link wraps it, the tray beside the link, not in it.
import {useEffect, useRef, useState} from 'react';
import type {PointerEvent as ReactPointerEvent, ReactNode} from 'react';
import {swipeArmed, swipeAxis, swipeOffset, swipeRelease, swipeStarts} from '../../logic/swipe.ts';
import type {SwipeSide} from '../../logic/swipe.ts';
import {Icon} from '../../ui/Icon.tsx';
import type {IconName} from '../../ui/glyphs.ts';
import './swipe.css';

/** One action behind a row: its words, its glyph and its fill. */
export interface SwipeAct {
  id: string;
  label: string;
  icon: IconName;
  tone: 'accent' | 'alert' | 'good' | 'sun';
  // It takes the row out of the list (Trash, Done): the row slides off the way it went before it folds.
  leaves?: boolean;
}

export interface SwipeActs {
  lead: SwipeAct[];
  trail: SwipeAct[];
}

interface Drag {
  pointer: number;
  row: HTMLElement;
  key: string;
  acts: SwipeActs;
  x: number;
  y: number;
  base: number;
  width: number;
  axis: 'x' | 'y' | null;
  offset: number;
}

/** The row a swipe holds: its key, which side shows, whether a full swipe is armed and whether it rests open. */
export interface SwipeState {
  key: string;
  side: SwipeSide;
  armed: boolean;
  open: boolean;
}

// How long a row takes to settle, before its tray goes even if no transition ends (reduced motion).
const SETTLE_MS = 260;
// How long a row that slid off keeps its offset: past its fold, and back to rest if it stayed (a refusal).
const GONE_MS = 1200;

export function useSwipes({enabled, acts, run}: {
  enabled: boolean;
  // What the row `key` offers, or null for a row that doesn't swipe.
  acts: (key: string) => SwipeActs | null;
  run: (key: string, act: SwipeAct) => void;
}) {
  const [state, setState] = useState<SwipeState | null>(null);
  const drag = useRef<Drag | null>(null);
  // The row resting open, and where.
  const rest = useRef<{row: HTMLElement; key: string; offset: number; acts: SwipeActs} | null>(null);
  // The press ended a drag, or closed a row: its click isn't the row's. Caught on the window before
  // anything else hears it (a link's own navigation included), and let go at the next press, so a
  // press that sends no click doesn't take the next one's.
  const swallowing = useRef<((event: MouseEvent) => void) | null>(null);
  const release = () => {
    if (swallowing.current) window.removeEventListener('click', swallowing.current, true);
    swallowing.current = null;
  };
  const swallow = () => {
    release();
    const catcher = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      release();
    };
    swallowing.current = catcher;
    window.addEventListener('click', catcher, true);
  };
  useEffect(() => release, []);
  const latest = useRef({acts, run});
  useEffect(() => {
    latest.current = {acts, run};
  });

  const place = (row: HTMLElement, offset: number, settling: boolean) => {
    row.dataset.swipe = settling ? 'settle' : 'drag';
    row.style.setProperty('--sw', `${offset}px`);
  };
  // Back to closed: it settles, and its tray goes once it has.
  const settleClosed = (row: HTMLElement) => {
    place(row, 0, true);
    rest.current = null;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      row.removeEventListener('transitionend', finish);
      if (rest.current?.row === row || drag.current?.row === row) return;
      delete row.dataset.swipe;
      row.style.removeProperty('--sw');
      setState(current => (current && (row.dataset.swipeKey ?? row.dataset.key) === current.key ? null : current));
    };
    row.addEventListener('transitionend', finish);
    window.setTimeout(finish, SETTLE_MS);
  };
  // Off the side it went, its first action filling the tray, while the list folds it away.
  const slideOff = (row: HTMLElement, key: string, side: SwipeSide) => {
    rest.current = null;
    place(row, (side === 'lead' ? 1 : -1) * row.getBoundingClientRect().width, true);
    setState({key, side, armed: true, open: false});
    window.setTimeout(() => {
      if (rest.current?.row === row || drag.current?.row === row) return;
      delete row.dataset.swipe;
      row.style.removeProperty('--sw');
      setState(current => (current?.key === key ? null : current));
    }, GONE_MS);
  };
  // Picking `act` on the row: it leaves or settles closed, then the list runs it.
  const pick = (row: HTMLElement, key: string, side: SwipeSide, act: SwipeAct) => {
    if (act.leaves) slideOff(row, key, side);
    else settleClosed(row);
    latest.current.run(key, act);
  };
  const close = () => {
    const open = rest.current;
    if (open) settleClosed(open.row);
  };
  useEffect(() => {
    if (!enabled) close();
  });

  const down = (event: ReactPointerEvent) => {
    release();
    if (!enabled || !event.isPrimary || event.button !== 0) return;
    const target = event.target as Element;
    const open = rest.current;
    // A press on an open row's tray is its button's.
    if (open && target.closest('.sw')) return;
    const row = target.closest<HTMLElement>('[data-swipe-key]') ?? target.closest<HTMLElement>('[data-key]');
    // A press anywhere but the open row closes it, and does nothing else.
    if (open && row !== open.row) {
      close();
      swallow();
      return;
    }
    if (!row || !swipeStarts(event.clientX)) return;
    const key = row.dataset.swipeKey ?? row.dataset.key!;
    const offered = open?.row === row ? open.acts : latest.current.acts(key);
    if (!offered || (!offered.lead.length && !offered.trail.length)) return;
    drag.current = {pointer: event.pointerId, row, key, acts: offered, x: event.clientX, y: event.clientY, base: open?.row === row ? open.offset : 0,
      width: row.getBoundingClientRect().width, axis: null, offset: open?.row === row ? open.offset : 0};
  };

  const move = (event: ReactPointerEvent) => {
    const at = drag.current;
    if (!at || at.pointer !== event.pointerId) return;
    const dx = event.clientX - at.x;
    if (at.axis === null) {
      at.axis = swipeAxis(dx, event.clientY - at.y);
      if (at.axis === 'y') {
        drag.current = null;
        if (rest.current) close();
        return;
      }
      if (at.axis === null) return;
      // A pointer that's already gone can't be captured; the drag goes on while it stays on the row.
      try {
        at.row.setPointerCapture(event.pointerId);
      } catch {
        // Nothing to hold on to.
      }
    }
    const counts = {lead: at.acts.lead.length, trail: at.acts.trail.length};
    at.offset = swipeOffset(at.base, dx, counts, at.width);
    place(at.row, at.offset, false);
    const side: SwipeSide = at.offset > 0 ? 'lead' : 'trail';
    const armed = swipeArmed(at.offset, counts, at.width);
    setState(current => (current && current.key === at.key && current.side === side && current.armed === armed && !current.open ? current : {key: at.key, side, armed, open: false}));
  };

  const up = (event: ReactPointerEvent) => {
    const at = drag.current;
    if (!at || at.pointer !== event.pointerId) return;
    drag.current = null;
    // A tap on the open row closes it.
    if (at.axis === null) {
      if (rest.current?.row === at.row) {
        close();
        swallow();
      }
      return;
    }
    swallow();
    const counts = {lead: at.acts.lead.length, trail: at.acts.trail.length};
    const outcome = swipeRelease(at.offset, counts, at.width);
    if ('run' in outcome) {
      pick(at.row, at.key, outcome.run, at.acts[outcome.run][0]!);
      return;
    }
    if (outcome.rest === 0) {
      settleClosed(at.row);
      return;
    }
    place(at.row, outcome.rest, true);
    rest.current = {row: at.row, key: at.key, offset: outcome.rest, acts: at.acts};
    setState({key: at.key, side: outcome.rest > 0 ? 'lead' : 'trail', armed: false, open: true});
  };

  const cancel = (event: ReactPointerEvent) => {
    const at = drag.current;
    if (!at || at.pointer !== event.pointerId) return;
    drag.current = null;
    if (at.axis === 'x') settleClosed(at.row);
  };

  /** The tray behind the row `key`, while it's swiped. */
  const tray = (key: string): ReactNode => {
    if (!state || state.key !== key) return null;
    const open = rest.current?.key === key ? rest.current : null;
    const acts = (open?.acts ?? drag.current?.acts ?? latest.current.acts(key))?.[state.side] ?? [];
    return (
      <span className={['sw', state.side, state.armed && 'armed'].filter(Boolean).join(' ')} aria-hidden={state.open ? undefined : true}>
        {acts.map(act => (
          <button key={act.id} className={`sw-b ${act.tone}`} type="button" tabIndex={state.open ? undefined : -1} onClick={event => {
            event.preventDefault();
            event.stopPropagation();
            const row = rest.current?.row;
            if (row) pick(row, key, state.side, act);
            else latest.current.run(key, act);
          }}>
            <Icon name={act.icon} size={20} /><span>{act.label}</span>
          </button>
        ))}
      </span>
    );
  };

  return {state, tray, close, handlers: {onPointerDown: down, onPointerMove: move, onPointerUp: up, onPointerCancel: cancel}};
}
