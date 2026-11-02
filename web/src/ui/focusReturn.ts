import {useEffect} from 'react';

/**
 * An overlay's focus: what had it when the overlay opened gets it back as the overlay closes, so the
 * page has the keys at once (and a command run from it acts on the page). Called before the overlay's
 * own effect that takes focus.
 */
export function useFocusReturn() {
  useEffect(() => {
    const had = document.activeElement as HTMLElement | null;
    return () => {
      // What can't take focus (the page's body) leaves it with nothing, not inside the closing overlay.
      (document.activeElement as HTMLElement | null)?.blur?.();
      had?.focus?.();
    };
  }, []);
}
