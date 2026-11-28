// Sign out at Settings' foot (the nav's on the desktop, the page's on the phone) asks there, in place
// of itself: "Sign out of Setpoint?" over Cancel and Sign out, as one stray click or Enter shouldn't
// end the session. ⌘K's Sign out opens Settings asking. On the desktop Esc cancels it (before Settings
// sees the key) and Enter signs out, outside a field and not on a held key's repeats; opening another
// page or closing Settings cancels it too. Cancel sits where Sign out was, so a double click can't
// answer. Settings › Security's own Sign out, beside what it signs out of, doesn't ask.
import {useEffect, useRef} from 'react';
import {signOut} from '../../api/auth.ts';
import {Icon} from '../../ui/Icon.tsx';
import {toastFailure} from '../toast.ts';
import {askSignOutHere, cancelSignOut, closeSettings, useSigningOut} from './store.ts';

const QUESTION = 'Sign out of Setpoint?';

const answer = () => {
  closeSettings();
  void signOut().catch(toastFailure('Failed to sign out'));
};

export function SignOut({phone = false}: {phone?: boolean}) {
  const asking = useSigningOut();
  const ask = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  useEffect(() => {
    if (asking) ask.current?.focus({preventScroll: true});
    else if (wasAsking.current && document.activeElement === document.body) trigger.current?.focus({preventScroll: true});
    wasAsking.current = asking;
  }, [asking]);

  // The phone leaves the question behind with its page.
  useEffect(() => (phone ? cancelSignOut : undefined), [phone]);

  useEffect(() => {
    if (!asking || phone) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (event.key !== 'Enter' && event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.key === 'Enter') answer();
      else cancelSignOut();
    };
    window.addEventListener('keydown', onKey, {capture: true});
    return () => window.removeEventListener('keydown', onKey, {capture: true});
  }, [asking, phone]);

  if (!asking) {
    return phone
      ? <button ref={trigger} className="btn ghost" type="button" onClick={askSignOutHere}><Icon name="door_open" size={17} />Sign out</button>
      : (
        <button ref={trigger} type="button" className="nav foot" onClick={askSignOutHere}>
          <Icon name="door_open" />
          <span className="grow">Sign out</span>
        </button>
      );
  }
  return (
    <div ref={ask} className={phone ? 'sign-out-ask' : 'sign-out-ask foot'} role="group" aria-label={QUESTION} tabIndex={-1}>
      <p className="ask-q">{QUESTION}</p>
      <div className="acts">
        <button className="btn sm quiet" type="button" onClick={cancelSignOut}>Cancel{!phone && <span className="kbd">Esc</span>}</button>
        <button className="btn sm" type="button" onClick={answer}>Sign out{!phone && <span className="kbd">↵</span>}</button>
      </div>
    </div>
  );
}
