// The completion moment's burst: six dots in the ring's colour flying out from a done check and
// fading (styles.css). Drawn only while the moment plays, and hidden from assistive tech.
import type {CSSProperties} from 'react';

const ANGLES = [0, 60, 120, 180, 240, 300];

/** The dots, in `--ring` from `style` (the task's project colour), else the place's own ring colour. */
export function Burst({style}: {style?: CSSProperties}) {
  return (
    <span className="burst" aria-hidden="true" style={style}>
      {ANGLES.map(angle => <i key={angle} style={{'--a': `${angle}deg`} as CSSProperties} />)}
    </span>
  );
}
