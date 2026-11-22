// The page's events fed to the arrivals rule (logic/arrival.ts): the tab shown or hidden, and the
// window focused or not. Its presence lives in a ref; React hears of an arrival, and of the user
// going or coming back, alone.
import {useEffect, useRef, useState} from 'react';
import {serverNow} from '../api/auth.ts';
import {isAway, step} from '../logic/arrival.ts';
import type {Presence, PresenceEvent} from '../logic/arrival.ts';

/** The latest arrival: how many there have been, and when it was, on the server's clock and this browser's own. */
export interface Arrival {
  count: number;
  at: number;
  clock: number;
}

const hidden = () => document.visibilityState === 'hidden';
// An email's body is a frame of its own: focus going into it leaves this window focused still.
const focused = () => document.hasFocus() || document.activeElement instanceof HTMLIFrameElement;

/**
 * The user's arrivals (null until the first, which is the page load if they're there for it), and
 * whether they're here now, which changes only as they go away or come back.
 */
export function useArrival(): {arrival: Arrival | null; present: boolean} {
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [present, setPresent] = useState(false);
  const presence = useRef<Presence | null>(null);
  const here = useRef(false);
  const feed = useRef((event: PresenceEvent) => {
    const next = step(presence.current, event);
    presence.current = next.presence;
    if (here.current === isAway(next.presence)) setPresent(here.current = !here.current);
    if (next.arrival) setArrival(last => ({count: (last?.count ?? 0) + 1, at: event.at, clock: Date.now()}));
  });

  useEffect(() => {
    const send = feed.current;
    send({type: 'load', hidden: hidden(), focused: focused(), at: serverNow()});
    const visibility = () => send({type: hidden() ? 'hidden' : 'visible', at: serverNow()});
    const blur = () => {
      if (!focused()) send({type: 'blur', at: serverNow()});
    };
    const focus = () => send({type: 'focus', at: serverNow()});
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
    };
  }, []);

  return {arrival, present};
}
