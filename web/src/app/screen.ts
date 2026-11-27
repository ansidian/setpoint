// The screen the window is on, for what this browser keeps per screen (the reading pane's width,
// the sidebar's fold): an external display and the laptop's own each have theirs.
import {screenKey} from '../logic/reader.ts';

/** The screen in front's name among kept values. */
export const here = () => screenKey(window.screen);

const listeners = new Set<() => void>();
const moved = () => listeners.forEach(listener => listener());

// The query names the screen it was made on, so each change watches the next one. A resize covers
// a browser that doesn't re-read the query on the move.
function watchScreen() {
  const query = window.matchMedia(`(device-width: ${window.screen.width}px) and (device-height: ${window.screen.height}px)`);
  query.addEventListener('change', () => {
    moved();
    watchScreen();
  }, {once: true});
}
watchScreen();
window.addEventListener('resize', moved);

/** Calls back when the window may have moved to another screen. */
export function onScreenChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
