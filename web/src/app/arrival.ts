// The page's events fed to the arrivals rule (logic/arrival.ts): the tab shown or hidden, the window
// focused or not, pointer, wheel, scroll and key input, and the app's clock for the idle spell. Its
// presence lives in a ref, so input moves only a timestamp; React hears of an arrival alone.
import {useEffect, useRef, useState} from 'react';
import {serverNow} from '../api/auth.ts';
import {isAway, step} from '../logic/arrival.ts';
import type {Presence, PresenceEvent} from '../logic/arrival.ts';
import {useNow} from './clock.ts';

/** The latest arrival: how many there have been, and when it was. */
export interface Arrival {
  count: number;
  at: number;
}

const hidden = () => document.visibilityState === 'hidden';
// An email's body is a frame of its own: focus going into it leaves this window focused still.
const focused = () => document.hasFocus() || document.activeElement instanceof HTMLIFrameElement;

const INPUT = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'scroll'] as const;

/**
 * The user's arrivals (null until the first, which is the page load if they're there for it), and
 * whether they're here now, which changes only as they go away or come back. An idle spell is seen
 * by the clock's tick.
 */
export function useArrival(): {arrival: Arrival | null; present: boolean} {
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [present, setPresent] = useState(false);
  const presence = useRef<Presence | null>(null);
  const here = useRef(false);
  const feed = useRef((event: PresenceEvent) => {
    const next = step(presence.current, event);
    presence.current = next.presence;
    if (here.current === isAway(next.presence, event.at)) setPresent(here.current = !here.current);
    if (next.arrival) setArrival(last => ({count: (last?.count ?? 0) + 1, at: event.at}));
  });

  const now = useNow();
  useEffect(() => {
    if (presence.current) feed.current({type: 'tick', at: now});
  }, [now]);

  useEffect(() => {
    const send = feed.current;
    send({type: 'load', hidden: hidden(), focused: focused(), at: serverNow()});
    const visibility = () => send({type: hidden() ? 'hidden' : 'visible', at: serverNow()});
    const blur = () => {
      if (!focused()) send({type: 'blur', at: serverNow()});
    };
    const focus = () => send({type: 'focus', at: serverNow()});
    const input = () => send({type: 'input', at: serverNow()});
    const options = {capture: true, passive: true};
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    for (const type of INPUT) window.addEventListener(type, input, options);
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', blur);
      window.removeEventListener('focus', focus);
      for (const type of INPUT) window.removeEventListener(type, input, options);
    };
  }, []);

  return {arrival, present};
}
