// Overlays that leave with a fade (DESIGN.md › Motion: ⌘K, Settings and the "+N" popover close over
// 120 ms, as the floating detail does): what closed stays drawn, marked closing, for the fade, then
// goes. Opening again meanwhile shows the new one at once. While closing it takes no input (the
// caller makes it inert), so closing still feels immediate.
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {motion} from '../tokens.ts';

interface Was {
  element: HTMLElement | null;
  back: boolean;
}

function giveBack(was: Was) {
  if (was.back) return;
  was.back = true;
  // What can't take focus (the page's body) leaves it with nothing, not inside the closing overlay.
  (document.activeElement as HTMLElement | null)?.blur?.();
  was.element?.focus?.();
}

/**
 * An overlay's focus: what had it when the overlay opened gets it back as the overlay starts closing,
 * once, so the page has the keys during the fade (and a command run from it acts on the page). Called
 * before the overlay's own effect that takes focus.
 */
export function useFocusReturn(closing: boolean) {
  const was = useRef<Was>({element: null, back: false});
  useEffect(() => {
    const state = was.current;
    state.element = document.activeElement as HTMLElement | null;
    return () => giveBack(state);
  }, []);
  useLayoutEffect(() => {
    if (closing) giveBack(was.current);
  }, [closing]);
}

/** `value` as it shows: once it turns null, the last one is kept for `ms` with `closing` set. */
export function useExit<T>(value: T | null, ms: number = motion.fast): {shown: T | null; closing: boolean} {
  const [kept, setKept] = useState<T | null>(value);
  if (value !== null && value !== kept) setKept(value);
  useEffect(() => {
    if (value !== null || kept === null) return;
    const timer = window.setTimeout(() => setKept(null), ms);
    return () => window.clearTimeout(timer);
  }, [value, kept, ms]);
  return {shown: value ?? kept, closing: value === null && kept !== null};
}
