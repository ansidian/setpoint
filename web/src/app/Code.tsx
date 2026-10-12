// A verification code's parts, shared by the list's code row (DESIGN.md › The list) and the reader's
// code card (polish audit reader-04): Copy, which confirms in `good` for a second and a half and says
// so when the clipboard refuses (#109), and the countdown, which moves on as its words change, each
// second through its last minute ("Expires in 42 sec", in `caution`, inbox-11).
import {useEffect, useState} from 'react';
import type {MouseEvent} from 'react';
import {serverNow} from '../api/auth.ts';
import {codeGroups, countdownChange, expiresIn, expiresSoon} from '../logic/format.ts';
import {Icon} from '../ui/Icon.tsx';
import {showToast} from './toast.ts';

const COPIED_MS = 1500;

/** Copy: the code without its space onto the clipboard; "Copied" in `good` for 1.5 s. */
export function CodeCopy({value}: {value: string}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  // A clipboard that refuses says so (#41).
  const copy = (event: MouseEvent) => {
    event.stopPropagation();
    const writing = navigator.clipboard ? navigator.clipboard.writeText(value) : Promise.reject(new Error('No clipboard'));
    writing.then(() => setCopied(true), () => showToast('Couldn\'t copy it'));
  };
  return (
    <button className={copied ? 'btn ghost sm copy copied' : 'btn ghost sm copy'} type="button" onClick={copy}>
      <Icon name={copied ? 'check' : 'content_copy'} size={14} />{copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/** The next moment a countdown's words change: each second in its last minute, else a minute's end. */
function nextChange(at: string, now: number): number | null {
  const expires = Date.parse(at);
  const left = expires - now;
  if (left <= 0) return null;
  return expiresSoon(at, now) ? expires - (Math.ceil(left / 1000) - 1) * 1000 : countdownChange(at, now);
}

/** A code's countdown on the server's clock: its words, whether it's in its last minute, and whether it's gone. */
export function useCountdown(at: string): {text: string; soon: boolean; expired: boolean} {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const next = nextChange(at, now);
    if (next === null) return;
    const timer = window.setTimeout(() => setNow(Math.max(serverNow(), next)), next - serverNow());
    return () => window.clearTimeout(timer);
  }, [at, now]);
  return {text: expiresIn(at, now), soon: expiresSoon(at, now), expired: Date.parse(at) <= now};
}

/**
 * The reader's code card (reader-04), after the sender: the code in Geist Mono at 22 px in two groups,
 * Copy, and at the right its countdown on the clock, not the email's own words; once expired it says
 * so and the code steps back to `ink3`.
 */
export function CodeCard({code}: {code: {value: string; expires_at: string}}) {
  const countdown = useCountdown(code.expires_at);
  return (
    <div className={countdown.expired ? 'code-card expired' : 'code-card'}>
      <span className="code">{codeGroups(code.value)}</span>
      <CodeCopy value={code.value} />
      <span className="grow" />
      <span className={countdown.soon ? 'expiry num soon' : 'expiry num'}>{countdown.text}</span>
    </div>
  );
}
