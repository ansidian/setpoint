// Health and states on the page (DESIGN.md › Health and states; board 19a): the needs-reconnect bar
// and the stale and failing lines at the top of the Inbox, and the offline pill over the page, with
// everything under it dimmed and changes disabled (App.tsx dims; client.ts refuses changes). The
// same pill says when Setpoint can't be reached at launch, under the mark (Root.tsx).
import type {AccountOut, TriageStatusOut} from '@setpoint/shared';
import {useEffect} from 'react';
import {checkSession, timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {retryNow, useOfflineSince} from '../../api/live.ts';
import {ACCOUNTS_PATH, TRIAGE_PATH} from '../../api/mail.ts';
import {authorizeGmail} from '../../api/settings.ts';
import {clockTime} from '../../logic/format.ts';
import {inboxHealthLines, reconnectLine, reconnectTarget, triageNote} from '../../logic/health.ts';
import type {SourceLine} from '../../logic/health.ts';
import {Icon, Mark} from '../../ui/Icon.tsx';
import {useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {openSettings} from '../settings/store.ts';
import {toastFailure} from '../toast.ts';
import {useCheckNow} from './checkNow.ts';
import './states.css';

/**
 * "Business needs sign-in · Reconnect", then "Personal, as of 9:14 PM · Check now" for each stale or
 * failing account; null while every account is healthy.
 */
export function useHealthBars() {
  const {list} = useAccounts();
  const now = useNow();
  const reconnect = reconnectLine(list);
  const lines = inboxHealthLines(list, now, timeZone());
  if (!reconnect && !lines.length) return null;
  return (
    <>
      {reconnect && (
        <div className="hbar caution" role="alert">
          <Icon name="sync_problem" size={16} />
          <span>{reconnect}</span>
          <span>·</span>
          <button className="act" type="button" onClick={() => reconnectFrom(list)}>Reconnect</button>
        </div>
      )}
      {lines.map(line => <HealthBar key={line.key} line={line} />)}
    </>
  );
}

/** The bar's Reconnect: Google's sign-in for the one Gmail account needing it, else Settings › Accounts (states-08). */
function reconnectFrom(accounts: AccountOut[]) {
  const target = reconnectTarget(accounts);
  if (target === 'settings') {
    openSettings('accounts');
    return;
  }
  const label = accounts.find(account => account.id === target.gmail)?.label ?? 'the account';
  authorizeGmail(target.gmail).then(({url}) => window.location.assign(url), toastFailure(`Couldn't reconnect ${label}`));
}

/** A stale or failing account's line, with its fix on it: Check now, "Checking…" until the check lands (states-08). */
function HealthBar({line}: {line: SourceLine}) {
  const check = useCheckNow(line.source === null ? undefined : {id: line.source, health: line.health}, ACCOUNTS_PATH);
  return (
    <div className={`hbar ${line.state === 'failing' ? 'failing' : 'muted'}`}>
      <Icon name={line.state === 'failing' ? 'warning' : 'history'} size={16} />
      <span className="num ell" title={line.text}>{line.text}</span>
      {line.source !== null && <CheckNow check={check} />}
    </div>
  );
}

/** " · Check now" after a line's words: the button, "Checking…" while it runs, or why it couldn't start. */
export function CheckNow({check}: {check: ReturnType<typeof useCheckNow>}) {
  return (
    <>
      <span className="sep">·</span>
      {check.text === null
        ? <button className="check-now" type="button" onClick={check.run}>Check now</button>
        : <span className={check.failed ? 'check-now failed' : 'check-now checking'} role="status">{check.text}</span>}
    </>
  );
}

/** The Unsorted group's "Triage is down, as of 9:09 AM", while it is. */
export function TriageNote() {
  const {data} = useResource<TriageStatusOut>(TRIAGE_PATH);
  const note = triageNote(data, useNow(), timeZone());
  return note && <span className="gh-note num"><Icon name="warning" size={16} />{note}</span>;
}

/** The offline pill: `cloud_off`, what's wrong and that it's retrying, and Retry now. */
function Pill({text, onRetry}: {text: string; onRetry: () => void}) {
  return (
    <div className="offline-pill" role="status">
      <Icon name="cloud_off" size={16} />
      <span className="num">{text}</span>
      <button className="retry" type="button" onClick={onRetry}><Icon name="refresh" size={16} />Retry now</button>
    </div>
  );
}

/** "Offline, as of 9:41 PM, retrying" and Retry now, while Setpoint's live stream is down. */
export function OfflinePill() {
  const since = useOfflineSince();
  const offline = since !== null;
  // Changes are disabled, not queued: no key reaches the page under the pill. Esc still closes the
  // topmost thing, and Settings or ⌘K keep their keys (their changes are refused, client.ts).
  useEffect(() => {
    if (!offline) return;
    const block = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || (event.target instanceof Element && event.target.closest('.offline-pill, .settings, .palette'))) return;
      event.stopPropagation();
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, [offline]);
  if (since === null) return null;
  return <Pill text={`Offline, as of ${clockTime(since, timeZone())}, retrying`} onRetry={retryNow} />;
}

/**
 * Setpoint unreachable at launch (a deploy, a restart): the mark, dimmed, where the sign-in card's
 * top sits, and the offline pill under it, not the sign-in card. Root asks again every few seconds;
 * Retry now asks at once.
 */
export function Unreachable() {
  return (
    <div className="boot unreachable">
      <div className="boot-at">
        <Mark size={36} />
        <Pill text="Can’t reach Setpoint, retrying" onRetry={() => void checkSession()} />
      </div>
    </div>
  );
}
