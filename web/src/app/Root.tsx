// The top: nothing until GET /api/me answers, then the app with live updates while the user is signed
// in, or the sign-in card. A 401 later swaps the app for the card and keeps the address. Setpoint
// unreachable at launch shows the mark and the offline pill, and asks again every few seconds, and
// as soon as the network is back, until it answers (DESIGN.md › Health and states). Signing in, the
// card stays over the app for the 180 ms it takes to scale away while the app fades in (states-14).
import {useEffect, useState} from 'react';
import {checkSession, useAuth} from '../api/auth.ts';
import {RECONNECT_MS, startLive, stopLive} from '../api/live.ts';
import {motion} from '../tokens.ts';
import {AlfredInk} from '../ui/Icon.tsx';
import {App} from './App.tsx';
import {SignIn} from './SignIn.tsx';
import {Unreachable} from './states/States.tsx';

export function Root() {
  const auth = useAuth();
  // From the card into the app: the card leaves over the app rather than vanishing.
  const [was, setWas] = useState(auth);
  const [leaving, setLeaving] = useState(false);
  if (was !== auth) {
    setWas(auth);
    setLeaving(was === 'out' && auth === 'in');
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), motion.medium);
    return () => window.clearTimeout(timer);
  }, [leaving]);

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
  // The card keeps its place among the children while it leaves, so it's the same card, as typed.
  return (
    <>
      {auth === 'in' && <><AlfredInk /><App /></>}
      {(auth !== 'in' || leaving) && <SignIn leaving={auth === 'in'} />}
    </>
  );
}
