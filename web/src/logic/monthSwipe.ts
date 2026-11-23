// The phone's month picker swiped sideways: left for the next month, right for the
// one before, as a calendar's pages turn. A press within EDGE of the screen's left edge is Safari's
// Back, never the picker's; a drag that goes up or down is the sheet's; a short one is a tap's.
import {swipeAxis, swipeStarts} from './swipe.ts';

/** How far sideways a drag goes before letting go turns the month. */
export const MONTH_SWIPE = 40;

/** The months a drag from x `startX` by (dx, dy) turns: +1 next, -1 previous, 0 none. */
export function monthSwipe(startX: number, dx: number, dy: number): -1 | 0 | 1 {
  if (!swipeStarts(startX) || swipeAxis(dx, dy) !== 'x' || Math.abs(dx) < MONTH_SWIPE) return 0;
  return dx < 0 ? 1 : -1;
}
