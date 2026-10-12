// The top: nothing until GET /api/me answers, then the app with live updates while the user is signed
// in, or the sign-in card. A 401 later swaps the app for the card and keeps the address. Setpoint
// unreachable at launch shows the mark and the offline pill, and asks again every few seconds, and
// as soon as the network is back, until it answers (DESIGN.md › Health and states).
import {useEffect} from 'react';
import {checkSession, useAuth} from '../api/auth.ts';
import {RECONNECT_MS, startLive, stopLive} from '../api/live.ts';
import {AlfredInk} from '../ui/Icon.tsx';
import {App} from './App.tsx';
import {SignIn} from './SignIn.tsx';
import {Unreachable} from './states/States.tsx';

export function Root() {
  const auth = useAuth();

  useEffect(() => {
    void checkSession();
  }, []);

  useEffect(() => {
    if (auth !== 'in') return;
    startLive(() => void checkSession());
    return stopLive;
  }, [auth]);

  useEffect(() => {
    if (auth !== 'unreachable') return;
    const retry = () => void checkSession();
    const timer = window.setInterval(retry, RECONNECT_MS);
    window.addEventListener('online', retry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', retry);
    };
  }, [auth]);

  if (auth === 'checking') return null;
  if (auth === 'unreachable') return <Unreachable />;
  return auth === 'in' ? <><AlfredInk /><App /></> : <SignIn />;
}
