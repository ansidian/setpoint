// The sign-in card, darma's (DESIGN.md › Not designed yet: sign-in follows darma's card): alone on
// the page, the mark and Setpoint over its fields. The first time it claims Setpoint with the setup
// token from `npm run cli -- setup-token` and a new password, then shows the recovery codes once;
// afterwards it asks for the password. A refusal keeps the text, turns the field's border `alert`
// and says why in place of the hint. With a passkey registered (Settings › Security) it offers one;
// where Setpoint asks for both, the passkey follows the password. A lost password is replaced with
// a recovery code: the code and a new password, then new codes, shown once as the claim's are.
import {MIN_PASSWORD_LENGTH} from '@setpoint/shared';
import type {AuthStatusOut} from '@setpoint/shared';
import {useEffect, useState} from 'react';
import type {FormEvent} from 'react';
import {authStatus, claim, continueIn, failureLine, recover, signIn, signInWithPasskey} from '../api/auth.ts';
import {tabTitle} from '../logic/title.ts';
import {Mark} from '../ui/Icon.tsx';

export function SignIn() {
  const [status, setStatus] = useState<AuthStatusOut | null>(null);
  const [token, setToken] = useState('');
  const [password, setPassword] = useState('');
  const [failure, setFailure] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  // The password was right and the passkey comes next.
  const [passkeyNext, setPasskeyNext] = useState(false);
  // Signing in with a recovery code and a new password instead.
  const [recovering, setRecovering] = useState(false);
  const [code, setCode] = useState('');

  useEffect(() => {
    document.title = tabTitle({page: 'sign-in'});
    authStatus().then(setStatus, error => setFailure(failureLine(error)));
  }, []);

  const claiming = status ? !status.claimed : false;
  const ready = !sending && password.length > 0 && (!claiming || token.trim().length > 0) && (!recovering || code.trim().length > 0);
  const newPassword = claiming || recovering;

  function recoverInstead(next: boolean) {
    setRecovering(next);
    setPassword('');
    setCode('');
    setFailure(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSending(true);
    try {
      if (newPassword && password.length < MIN_PASSWORD_LENGTH) throw new Error(`At least ${MIN_PASSWORD_LENGTH} characters`);
      if (claiming) {
        setCodes(await claim(token.trim(), password));
      } else if (recovering) {
        setCodes(await recover(code.trim(), password));
      } else if (!await signIn(password)) {
        setPasskeyNext(true);
        await withPasskey();
      }
    } catch (error) {
      setFailure(failureLine(error));
    }
    setSending(false);
  }

  async function withPasskey() {
    setSending(true);
    setFailure(null);
    try {
      await signInWithPasskey();
    } catch (error) {
      setFailure(error instanceof DOMException ? 'The passkey wasn’t used. Try again.' : failureLine(error));
    }
    setSending(false);
  }

  if (codes) {
    return (
      <div className="sign-in-page">
        <div className="sign-in" role="dialog" aria-label="Recovery codes">
          <div className="brand"><Mark />Setpoint</div>
          <div className="sign-in-fields">
            <p className="sign-in-line">Your recovery codes, shown once. Keep them somewhere safe.</p>
            <pre className="recovery">{codes.join('\n')}</pre>
          </div>
          <div className="sign-in-foot">
            <button className="btn" type="button" autoFocus onClick={() => void continueIn()}>Continue</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sign-in-page">
      <form className="sign-in" aria-label="Sign in to Setpoint" onSubmit={event => void submit(event)}>
        <div className="brand"><Mark />Setpoint</div>
        <div className="sign-in-fields">
          {claiming && (
            <input className={failure ? 'input token failed' : 'input token'} value={token} placeholder="Setup token" aria-label="Setup token"
              autoFocus autoComplete="off" spellCheck={false} autoCapitalize="off" data-1p-ignore
              onChange={event => {
                setToken(event.target.value);
                setFailure(null);
              }} />
          )}
          {recovering && (
            <input className={failure ? 'input code failed' : 'input code'} value={code} placeholder="Recovery code" aria-label="Recovery code"
              autoFocus autoComplete="off" spellCheck={false} autoCapitalize="off" data-1p-ignore
              onChange={event => {
                setCode(event.target.value);
                setFailure(null);
              }} />
          )}
          <input className={failure ? 'input failed' : 'input'} type="password" value={password} aria-label={newPassword ? 'New password' : 'Password'}
            placeholder={newPassword ? 'New password' : 'Password'} autoFocus={!claiming && !recovering} autoComplete={newPassword ? 'new-password' : 'current-password'}
            onChange={event => {
              setPassword(event.target.value);
              setFailure(null);
            }} />
          {failure ? <p className="sign-in-line failed">{failure}</p>
            : passkeyNext ? <p className="sign-in-line">This Setpoint asks for your passkey too.</p>
            : claiming ? <p className="sign-in-line">From <span className="mono">npm run cli -- setup-token</span></p>
            : recovering ? <p className="sign-in-line">This replaces the password, removes passkeys and makes new codes.</p> : null}
        </div>
        <div className="sign-in-foot">
          {passkeyNext ? <button className="btn" type="button" disabled={sending} onClick={() => void withPasskey()}>Use passkey</button> : (
            <>
              {status?.claimed && (
                <button className="btn quiet" type="button" disabled={sending} onClick={() => recoverInstead(!recovering)}>
                  {recovering ? 'Use the password' : 'Use a recovery code'}
                </button>
              )}
              {status?.passkeys && !claiming && !recovering && <button className="btn ghost" type="button" disabled={sending} onClick={() => void withPasskey()}>Use a passkey</button>}
              <button className="btn" type="submit" disabled={!ready}>{claiming ? 'Claim Setpoint' : 'Sign in'}</button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
