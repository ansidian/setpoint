// The screen the window is on, for what this browser keeps per screen (the reading pane's width,
// the sidebar's fold): an external display and the laptop's own each have theirs.
import {screenKey} from '../logic/reader.ts';

/** The screen in front's name among kept values. */
export const here = () => screenKey(window.screen);

const listeners = new Set<() => void>();
const moved = () => listeners.forEach(listener => listener());

// A move to another screen often keeps the window's size, so no resize says so, and the size query
// below isn't re-read on a move by every browser. The screen's own change event is, where it exists;
// the pixel ratio's query catches a move between a Retina display and another; and focus catches up
// when nothing fired. Each query names what it was made on, so each change watches the next one.
function watch(query: () => string) {
  window.matchMedia(query()).addEventListener('change', () => {
    moved();
    watch(query);
  }, {once: true});
}
watch(() => `(device-width: ${window.screen.width}px) and (device-height: ${window.screen.height}px)`);
watch(() => `(resolution: ${window.devicePixelRatio}dppx)`);
// Chromium's Screen is an EventTarget, which TypeScript's DOM types don't say; Safari's isn't.
(window.screen as Screen & Partial<EventTarget>).addEventListener?.('change', moved);
window.addEventListener('resize', moved);
window.addEventListener('focus', moved);

/** Calls back when the window may have moved to another screen. */
export function onScreenChange(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
