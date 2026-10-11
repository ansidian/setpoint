// "Now" on screen: the server's clock (api/auth.ts), ticking so ages and countdowns move on.
import {useEffect, useState} from 'react';
import {serverNow} from '../api/auth.ts';

const TICK_MS = 15_000;

/**
 * Now, moving on every 15 s, and at `at` too: the next moment something on screen changes by
 * itself (a code's countdown, its leaving at expiry), so it changes then rather than on a later tick.
 */
export function useNow(at: number | null = null): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (at === null) return;
    const timer = window.setTimeout(() => setNow(Math.max(serverNow(), at)), at - serverNow());
    return () => window.clearTimeout(timer);
  }, [at]);
  return now;
}
