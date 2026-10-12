// The sign-in card, darma's (DESIGN.md › Not designed yet: sign-in follows darma's card): alone on
// the page, the mark and Setpoint over its fields. The first time it claims Setpoint with the setup
// token from `npm run cli -- setup-token` and a new password, then shows the recovery codes once;
// afterwards it asks for the password. A refusal keeps the text, turns the field's border `alert`
// and says why in place of the hint. With a passkey registered (Settings › Security) it offers one;
// where Setpoint asks for both, the passkey follows the password. A lost password is replaced with
// a recovery code: the code and a new password, then new codes, shown once as the claim's are.
//
// The card answers (the polish audit's states-14): a refusal shakes it once and selects what was
// typed, so typing replaces it; with passkeys registered and nothing typed, Use a passkey is the
// solid button; and signed in, it scales away as the app fades in (Root.tsx keeps it, `leaving`).
import {MIN_PASSWORD_LENGTH} from '@setpoint/shared';
import type {AuthStatusOut} from '@setpoint/shared';
import {useEffect, useRef, useState} from 'react';
import type {FormEvent} from 'react';
import {authStatus, claim, continueIn, failureLine, recover, signIn, signInWithPasskey} from '../api/auth.ts';
import {tabTitle} from '../logic/title.ts';
import {motion} from '../tokens.ts';
import {Icon, Mark} from '../ui/Icon.tsx';

/** A refusal's shake: across and back, smaller each time, once, over the modal's 260 ms. */
const SHAKE = [0, -6, 5, -3, 0].map(x => ({translate: `${x}px 0`}));

export function SignIn({leaving = false}: {leaving?: boolean}) {
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
  const card = useRef<HTMLFormElement>(null);
  const passwordField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    document.title = tabTitle({page: 'sign-in'});
    authStatus().then(setStatus, error => setFailure(failureLine(error)));
  }, []);

  const claiming = status ? !status.claimed : false;
  const ready = !sending && password.length > 0 && (!claiming || token.trim().length > 0) && (!recovering || code.trim().length > 0);
  const newPassword = claiming || recovering;
  // With passkeys registered, Use a passkey leads until a character of the password is typed.
  const offerPasskey = Boolean(status?.passkeys) && !claiming && !recovering;
  const passkeyFirst = offerPasskey && password === '';

  /** A refusal: its line, the field's text selected so typing replaces it, and one shake of the card. */
  function refused(error: unknown) {
    setFailure(failureLine(error));
    const field = card.current?.querySelector<HTMLInputElement>('input:focus') ?? passwordField.current;
    field?.select();
    card.current?.animate(SHAKE, {duration: motion.slow, easing: motion.ease});
  }

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
      refused(error);
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
      <div className={leaving ? 'sign-in-page leaving' : 'sign-in-page'} inert={leaving}>
        <div className="sign-in" role="dialog" aria-label="Recovery codes">
          <div className="brand"><Mark size={24} />Setpoint</div>
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
    <div className={leaving ? 'sign-in-page leaving' : 'sign-in-page'} inert={leaving}>
      <form className="sign-in" ref={card} aria-label="Sign in to Setpoint" onSubmit={event => void submit(event)}>
        <div className="brand"><Mark size={24} />Setpoint</div>
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
          <input ref={passwordField} className={failure ? 'input failed' : 'input'} type="password" value={password} aria-label={newPassword ? 'New password' : 'Password'}
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
          {passkeyNext ? <button className="btn" type="button" disabled={sending} onClick={() => void withPasskey()}><Icon name="passkey" size={16} />Use passkey</button> : (
            // Right to left, the main action first (styles.css), so where three don't fit the recovery
            // code's link goes under the others rather than past the card's edge.
            <>
              <button className={passkeyFirst ? 'btn ghost' : 'btn'} type="submit" disabled={!ready}>{claiming ? 'Claim Setpoint' : 'Sign in'}</button>
              {offerPasskey && <button className={passkeyFirst ? 'btn' : 'btn ghost'} type="button" disabled={sending} onClick={() => void withPasskey()}><Icon name="passkey" size={16} />Use a passkey</button>}
              {status?.claimed && (
                <button className="btn quiet" type="button" disabled={sending} onClick={() => recoverInstead(!recovering)}>
                  {recovering ? 'Use the password' : 'Use a recovery code'}
                </button>
              )}
            </>
          )}
        </div>
      </form>
    </div>
  );
}
