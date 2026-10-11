// Health and states on the page (DESIGN.md › Health and states; board 19a): the needs-reconnect bar
// and the stale and failing lines at the top of the Inbox, and the offline pill over the page, with
// everything under it dimmed and changes disabled (App.tsx dims; client.ts refuses changes).
import type {TriageStatusOut} from '@setpoint/shared';
import {useEffect} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {retryNow, useOfflineSince} from '../../api/live.ts';
import {TRIAGE_PATH} from '../../api/mail.ts';
import {clockTime} from '../../logic/format.ts';
import {inboxHealthLines, reconnectLine, triageNote} from '../../logic/health.ts';
import {Icon} from '../../ui/Icon.tsx';
import {useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {openSettings} from '../settings/store.ts';
import './states.css';

/**
 * "Business needs sign-in · Reconnect", then "Personal, as of 9:14 PM" for each stale or failing
 * account; null while every account is healthy.
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
          <Icon name="warning-fill" size={16} />
          <span>{reconnect}</span>
          <span>·</span>
          <button className="act" type="button" onClick={() => openSettings('accounts')}>Reconnect</button>
        </div>
      )}
      {lines.map(line => (
        <div key={line.text} className={`hbar ${line.state === 'failing' ? 'failing' : 'muted'}`}>
          <Icon name={line.state === 'failing' ? 'error' : 'schedule'} size={16} />
          <span className="num ell" title={line.text}>{line.text}</span>
        </div>
      ))}
    </>
  );
}

/** The Unsorted group's "Triage is down, as of 9:09 AM", while it is. */
export function TriageNote() {
  const {data} = useResource<TriageStatusOut>(TRIAGE_PATH);
  const note = triageNote(data, useNow(), timeZone());
  return note && <span className="gh-note num"><Icon name="error" size={16} />{note}</span>;
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
  return (
    <div className="offline-pill" role="status">
      <Icon name="cloud_off" size={16} />
      <span className="num">Offline, as of {clockTime(since, timeZone())}, retrying</span>
      <button className="retry" type="button" onClick={retryNow}>Retry now</button>
    </div>
  );
}
