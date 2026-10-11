// The top: nothing until GET /api/me answers, then the app with live updates while the user is signed
// in, or the sign-in card. A 401 later swaps the app for the card and keeps the address.
import {useEffect} from 'react';
import {checkSession, useAuth} from '../api/auth.ts';
import {startLive, stopLive} from '../api/live.ts';
import {App} from './App.tsx';
import {SignIn} from './SignIn.tsx';

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

  if (auth === 'checking') return null;
  return auth === 'in' ? <App /> : <SignIn />;
}
