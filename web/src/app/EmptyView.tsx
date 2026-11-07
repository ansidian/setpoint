// An empty Inbox view (SV-226): a line-drawn spot illustration of its own, drawn in once on arrival,
// over a headline, one quiet line and Show All. No mark and no glow: they're the empty pane's (#331, #335).
import {timeZone} from '../api/auth.ts';
import {EMPTY_HEADLINES, quietLine} from '../logic/emptyView.ts';
import type {EmptyInboxView} from '../logic/emptyView.ts';
import {useNow} from './clock.ts';

// One line of a drawing: `ink3` unless it's the view's one touch of colour; `solid` ones hide what's behind.
interface Stroke {d: string; accent?: boolean; solid?: boolean}

// The emptied tray FYI and Noise share: its rim's notch, as the app's inbox glyph has it.
const TRAY: Stroke[] = [
  {d: 'M30 74 L44 52 H116 L130 74 V98 a4 4 0 0 1 -4 4 H34 a4 4 0 0 1 -4 -4 Z'},
  {d: 'M30 74 H60 L65 84 H95 L100 74 H130'},
];

// Drawn on a 160 by 120 board, in the order they draw in.
const DRAWINGS: Record<EmptyInboxView, Stroke[]> = {
  // An open envelope, its letter out of the pocket with a check in `good`.
  unread: [
    {d: 'M30 62 L80 28 L130 62'},
    {d: 'M50 34 H110 a3 3 0 0 1 3 3 V92 H47 V37 a3 3 0 0 1 3 -3 Z', solid: true},
    {d: 'M69 52 L77 60 L93 44', accent: true},
    {d: 'M30 62 L80 90 L130 62 V100 a4 4 0 0 1 -4 4 H34 a4 4 0 0 1 -4 -4 Z', solid: true},
  ],
  // A flag at half-mast, its pennant in `caution`.
  attention: [
    {d: 'M40 106 H120'},
    {d: 'M60 106 V20'},
    {d: 'M60 13 a3.5 3.5 0 1 1 0 7 a3.5 3.5 0 1 1 0 -7 Z'},
    {d: 'M60 52 H104 L94 64 L104 76 H60', accent: true},
  ],
  // The emptied tray, a small sparkle over it in `cool`.
  fyi: [
    ...TRAY,
    {d: 'M114 18 Q115.5 30.5 128 32 Q115.5 33.5 114 46 Q112.5 33.5 100 32 Q112.5 30.5 114 18 Z', accent: true},
    {d: 'M131 12 V20 M127 16 H135', accent: true},
  ],
  // The tray with a calm wave over it.
  noise: [
    ...TRAY,
    {d: 'M46 34 q8.5 -7 17 0 t17 0 t17 0 t17 0'},
  ],
};

/** `newest`: when the last email the quiet line tells of came (quietLine). */
export function EmptyView({view, newest, onAll}: {view: EmptyInboxView; newest: string | null; onAll: () => void}) {
  const now = useNow();
  const quiet = quietLine(view, newest, now, timeZone());
  const strokes = DRAWINGS[view];
  return (
    <div className="view-empty">
      <div className={`ve-block ${view}`}>
        <svg className="ve-art" viewBox="0 0 160 120" aria-hidden="true">
          {strokes.map((stroke, at) => (
            <path key={at} d={stroke.d} pathLength={1} className={[stroke.accent && 'accent', stroke.solid && 'solid'].filter(Boolean).join(' ') || undefined}
              style={{animationDelay: `${Math.round((at / strokes.length) * 120)}ms`}} />
          ))}
        </svg>
        <p className="ve-head">{EMPTY_HEADLINES[view]}</p>
        {quiet && <p className="ve-quiet num">{quiet}</p>}
        <button className="btn ghost sm" type="button" onClick={onAll}>Show All</button>
      </div>
    </div>
  );
}
