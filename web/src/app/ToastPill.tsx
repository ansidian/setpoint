// The app's one toast (toast.ts holds it), drawn once by App.tsx over every page and above Settings.
import {useEffect, useRef, useState} from 'react';
import type {CSSProperties, PointerEvent as ReactPointerEvent} from 'react';
import {Icon} from '../ui/Icon.tsx';
import {usePhone} from './Phone.tsx';
import {dismissToast, useToast} from './toast.ts';
import type {Toast} from './toast.ts';

// The phone's toast: these tones' glyphs alone, bare.
const PHONE_TONES = {done: 'done', read: 'done', gone: 'gone', failed: 'failed', pinned: 'pinned'} as const;
const PHONE_GLYPHS = {done: 'check', gone: 'delete', failed: 'error', pinned: 'keep'} as const;
// The time ring's radius in its 22 px disc, its 1.5 px stroke inside the disc's edge.
const RING_R = 10.25;

// A swipe: past this far, let go, and the toast goes. Short of it, it snaps back.
const SWIPE_PX = 72;
// A press moves this far before it's a drag, so a click on its button stays a click.
const DRAG_PX = 4;
// It fades as it's dragged, to this at SWIPE_PX and no further.
const FADED = 0.35;
// A trackpad swipe has no let-go: this long after its last move, a swipe short of SWIPE_PX snaps back.
const WHEEL_REST_MS = 160;

/**
 * The one toast, over every page and above Settings. Its action runs once, then it goes. Keyed by
 * its id, so one replacing another drops in afresh.
 */
export function ToastPill() {
  const toast = useToast();
  if (!toast) return null;
  return <Pill key={toast.id} toast={toast} />;
}

/**
 * It leads with its tone's glyph in a tinted disc, its time a ring draining around it (none while it
 * waits). A failure is one line, wrapping when long.
 * Swiped left or right, by a drag or two fingers on a trackpad, it follows and fades, and goes once
 * past SWIPE_PX. There's no ×, and no hint that it swipes.
 */
function Pill({toast}: {toast: Toast}) {
  const {action, tone} = toast;
  const phone = usePhone();
  const ref = useRef<HTMLDivElement>(null);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  // The way it was swiped off: -1 left, 1 right, 0 not swiped.
  const [out, setOut] = useState(0);

  const swipeOff = (by: number) => {
    setOut(Math.sign(by));
    dismissToast(toast.id);
  };

  // Two fingers across a trackpad: the browser's wheel, horizontal. Not React's onWheel, which can't
  // stop the swipe going back a page.
  useEffect(() => {
    const pill = ref.current!;
    const id = toast.id;
    let sum = 0;
    let rest = 0;
    // Swiped off: the fingers' last moves land on a pill already going. (Gone by its time, it takes
    // no pointer, so no wheel either.)
    let off = false;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      if (off) return;
      window.clearTimeout(rest);
      // The pill follows the fingers, as content does with natural scrolling.
      sum -= event.deltaX;
      if (Math.abs(sum) >= SWIPE_PX) {
        off = true;
        setDragging(false);
        setDx(sum);
        setOut(Math.sign(sum));
        dismissToast(id);
        return;
      }
      setDragging(true);
      setDx(sum);
      rest = window.setTimeout(() => {
        sum = 0;
        setDragging(false);
        setDx(0);
      }, WHEEL_REST_MS);
    };
    pill.addEventListener('wheel', onWheel, {passive: false});
    return () => {
      pill.removeEventListener('wheel', onWheel);
      window.clearTimeout(rest);
    };
  }, [toast.id]);

  /**
   * A press on the pill, followed on the window, so a flick that leaves the pill in one move still
   * drags it. It's a drag once it has moved DRAG_PX, so a click on the button stays a click. Let go
   * past SWIPE_PX, it goes. Short of it (or cancelled), it snaps back.
   */
  const press = (down: ReactPointerEvent) => {
    // The phone's toast doesn't swipe.
    if (down.button !== 0 || toast.leaving || phone) return;
    const pointer = down.pointerId;
    const from = down.clientX;
    let moved = false;
    const move = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      const by = event.clientX - from;
      if (!moved) {
        if (Math.abs(by) < DRAG_PX) return;
        moved = true;
        setDragging(true);
      }
      setDx(by);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (!moved) return;
      setDragging(false);
      // The click a drag ends in, where it's let go, isn't one.
      const swallow = (click: MouseEvent) => {
        click.stopPropagation();
        click.preventDefault();
      };
      window.addEventListener('click', swallow, {capture: true, once: true});
      window.setTimeout(() => window.removeEventListener('click', swallow, {capture: true}));
      // How far by the release itself, as the last move may not have drawn yet.
      const by = event.clientX - from;
      if (event.type === 'pointerup' && Math.abs(by) >= SWIPE_PX) {
        setDx(by);
        swipeOff(by);
      } else {
        setDx(0);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  const style = {
    '--toast-ms': `${toast.ms ?? 0}ms`, '--dx': `${dx}px`, '--out': out,
    // Kept as it's swiped off: its fade-out starts from here.
    opacity: 1 - (1 - FADED) * Math.min(1, Math.abs(dx) / SWIPE_PX),
  } as CSSProperties;
  const motionClasses = [dragging && 'dragging', toast.leaving && 'leaving', out && 'swiped'];
  const run = () => {
    action!.run();
    dismissToast(toast.id);
  };

  if (phone) {
    const phoneTone = tone in PHONE_TONES ? PHONE_TONES[tone as keyof typeof PHONE_TONES] : null;
    const className = ['toast', 'ph', phoneTone, action && 'timed', ...motionClasses].filter(Boolean).join(' ');
    return (
      <div ref={ref} className={className} role="status" style={style} onPointerDown={press}>
        {phoneTone && <span className="tone"><Icon name={PHONE_GLYPHS[phoneTone]} size={16} /></span>}
        <span className="txt">{toast.text}</span>
        {action && <button className="btn ghost sm" type="button" onClick={run}>{action.label}</button>}
      </div>
    );
  }

  const className = ['toast', `t-${tone}`, tone === 'failed' && 'wraps', ...motionClasses].filter(Boolean).join(' ');
  return (
    <div ref={ref} className={className} role="status" style={style} onPointerDown={press}>
      <span className="disc">
        <Icon name={toast.glyph} size={14} />
        {toast.ms !== null && (
          <svg className="time" viewBox="0 0 22 22" aria-hidden="true">
            <circle className="trk" cx="11" cy="11" r={RING_R} />
            <circle className="arc" cx="11" cy="11" r={RING_R} pathLength={100} />
          </svg>
        )}
      </span>
      <span className="txt">{toast.text}</span>
      {action && (
        <button className="tb" type="button" onClick={run}>
          {action.label}
          {action.key && <span className="kbd">{action.key}</span>}
        </button>
      )}
    </div>
  );
}
