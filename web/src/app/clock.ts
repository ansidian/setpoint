// "Now" on screen: the server's clock (api/auth.ts), ticking so ages and countdowns move on.
import {useEffect, useState} from 'react';
import {serverNow} from '../api/auth.ts';

const TICK_MS = 15_000;

export function useNow(): number {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(serverNow()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
