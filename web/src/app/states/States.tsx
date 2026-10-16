// Health and states on the page (DESIGN.md › Health and states; board 19a): the needs-reconnect bar
// and the stale and failing lines at the top of the Inbox, and the offline pill over the page, with
// everything under it dimmed and changes disabled (App.tsx dims; client.ts refuses changes). The
// same pill says when Setpoint can't be reached at launch, under the mark (Root.tsx).
import type {AccountOut, TriageStatusOut} from '@setpoint/shared';
import {useCallback, useEffect, useRef, useState} from 'react';
import {checkSession, timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {retryNow, useOfflineSince, writesRefused} from '../../api/live.ts';
import {ACCOUNTS_PATH, TRIAGE_PATH} from '../../api/mail.ts';
import {authorizeGmail} from '../../api/settings.ts';
import {clockTime} from '../../logic/format.ts';
import {offlineRefuses} from '../../logic/live.ts';
import {inboxHealthLines, reconnectLine, reconnectTarget, triageNote} from '../../logic/health.ts';
import type {SourceLine} from '../../logic/health.ts';
import {CLEARED_MS, lineMovesOn, nextLines} from '../../logic/stateLines.ts';
import type {LinePhase, ShownLine} from '../../logic/stateLines.ts';
import {motion} from '../../tokens.ts';
import {Icon, Mark} from '../../ui/Icon.tsx';
import {isTyping} from '../../ui/keys.ts';
import {useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {foldRef, leaveCopy} from '../fold.ts';
import {openSettings} from '../settings/store.ts';
import {toastFailure} from '../toast.ts';
import {useCheckNow} from './checkNow.ts';
import './states.css';

/** The Inbox's bars: the needs-reconnect bar, or a stale or failing account's line. */
type Bar = {kind: 'reconnect'; text: string} | ({kind: 'line'} & SourceLine);

/**
 * "Business needs sign-in · Reconnect", then "Personal, as of 9:14 PM · Check now" for each stale or
 * failing account, folding in as they come and out as they go (states-13); null while there are none.
 */
export function useHealthBars() {
  const {list} = useAccounts();
  const now = useNow();
  const reconnect = reconnectLine(list);
  const bars: {key: string; line: Bar}[] = [
    ...(reconnect ? [{key: 'reconnect', line: {kind: 'reconnect' as const, text: reconnect}}] : []),
    ...inboxHealthLines(list, now, timeZone()).map(line => ({key: `line:${line.key}`, line: {kind: 'line' as const, ...line}})),
  ];
  // A line clears when its account is healthy again; the bar goes once signed in.
  const {shown, moveOn} = useShownLines(bars, bar => bar.kind === 'line');
  if (!shown.length) return null;
  return (
    <>
      {shown.map(({key, line, phase}) => (line.kind === 'reconnect'
        ? <ReconnectBar key={key} text={line.text} accounts={list} phase={phase} onMoveOn={from => moveOn(key, from)} />
        : <HealthBar key={key} line={line} phase={phase} onMoveOn={from => moveOn(key, from)} />))}
    </>
  );
}

/**
 * The lines as they show while they change (states-13; logic/stateLines.ts): one that arrives folds
 * in, one whose source is healthy again shows its check for 1.2 s, then folds out. The first paint
 * shows them as they are.
 */
export function useShownLines<T>(next: {key: string; line: T}[], clears: (line: T) => boolean) {
  const signature = JSON.stringify(next);
  const [state, setState] = useState(() => ({signature, shown: next.map((entry): ShownLine<T> => ({...entry, phase: 'here'}))}));
  let {shown} = state;
  if (state.signature !== signature) {
    shown = nextLines(state.shown, next, clears);
    setState({signature, shown});
  }
  const moveOn = useCallback((key: string, from: 'cleared' | 'out') => setState(last => ({...last, shown: lineMovesOn(last.shown, key, from)})), []);
  return {shown, moveOn};
}

/**
 * A line's motion by its phase: the ref that folds it in or out (app/fold.ts, as rows fold), and its
 * time: cleared, it folds out after 1.2 s; folded out, it goes.
 */
export function useLinePhase(phase: LinePhase, onMoveOn: (from: 'cleared' | 'out') => void) {
  const moveOn = useRef(onMoveOn);
  useEffect(() => {
    moveOn.current = onMoveOn;
  });
  useEffect(() => {
    if (phase !== 'cleared' && phase !== 'out') return;
    const timer = window.setTimeout(() => moveOn.current(phase), phase === 'cleared' ? CLEARED_MS : motion.medium);
    return () => window.clearTimeout(timer);
  }, [phase]);
  return foldRef(phase === 'in' ? 'in' : phase === 'out' ? 'out' : null);
}

function ReconnectBar({text, accounts, phase, onMoveOn}: {text: string; accounts: AccountOut[]; phase: LinePhase; onMoveOn: (from: 'cleared' | 'out') => void}) {
  const ref = useLinePhase(phase, onMoveOn);
  return (
    <div ref={ref} className="hbar caution" role="alert">
      <Icon name="sync_problem" size={16} />
      <span>{text}</span>
      <span>·</span>
      <button className="act" type="button" onClick={() => reconnectFrom(accounts)}>Reconnect</button>
    </div>
  );
}

/** The bar's Reconnect: Google's sign-in for the one Gmail account needing it, else Settings › Accounts (states-08). */
export function reconnectFrom(accounts: AccountOut[]) {
  const target = reconnectTarget(accounts);
  if (target === 'settings') {
    openSettings('accounts');
    return;
  }
  const label = accounts.find(account => account.id === target.gmail)?.label ?? 'the account';
  authorizeGmail(target.gmail).then(({url}) => window.location.assign(url), toastFailure(`Couldn't reconnect ${label}`));
}

/**
 * A stale or failing account's line, with its fix on it: Check now, "Checking…" until the check lands
 * (states-08). Once its account is healthy again its glyph turns to `check` in `good` and its words
 * go quiet, then it folds out (states-13).
 */
function HealthBar({line, phase, onMoveOn}: {line: SourceLine; phase: LinePhase; onMoveOn: (from: 'cleared' | 'out') => void}) {
  const ref = useLinePhase(phase, onMoveOn);
  const check = useCheckNow(line.source === null ? undefined : {id: line.source, health: line.health}, ACCOUNTS_PATH);
  const cleared = phase === 'cleared' || phase === 'out';
  return (
    <div ref={ref} className={`hbar ${cleared ? 'muted cleared' : line.state === 'failing' ? 'failing' : 'muted'}`}>
      {cleared ? <Icon name="check" size={16} className="ok" /> : <Icon name={line.state === 'failing' ? 'warning' : 'history'} size={16} />}
      <span className="num ell" title={line.text}>{line.text}</span>
      {line.source !== null && !cleared && <CheckNow check={check} />}
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
function Pill({text, onRetry, leaves = false}: {text: string; onRetry: () => void; leaves?: boolean}) {
  return (
    <div ref={leaves ? fadeWhenGone : undefined} className="offline-pill" role="status">
      <Icon name="cloud_off" size={16} />
      <span className="num">{text}</span>
      <button className="retry" type="button" onClick={onRetry}><Icon name="refresh" size={16} />Retry now</button>
    </div>
  );
}

/**
 * "Offline, as of 9:41 PM, retrying" and Retry now, once Setpoint's live stream has been down 2 s
 * (live.ts).
 */
export function OfflinePill() {
  const since = useOfflineSince();
  // Changes are refused, not queued, from the moment the stream drops (asked as each key comes, so one
  // pressed with the drop is caught too): the keys that change something reach nothing, while reading
  // goes on (J, K, Enter, the arrows; states-05). A field's typing, Settings and ⌘K keep their keys
  // (their changes are refused, client.ts).
  useEffect(() => {
    const block = (event: KeyboardEvent) => {
      if (!writesRefused() || !offlineRefuses(event) || isTyping(event) || (event.target instanceof Element && event.target.closest('.offline-pill, .settings, .palette'))) return;
      event.stopPropagation();
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, []);
  if (since === null) return null;
  return <Pill text={`Offline, as of ${clockTime(since, timeZone())}, retrying`} onRetry={retryNow} leaves />;
}

/**
 * Back online, the pill fades out over 120 ms where it was rather than vanishing (states-13); it came
 * in from 8 px above over 180 ms (states.css).
 */
const fadeWhenGone = (pill: HTMLDivElement | null) => {
  if (!pill) return;
  return () => leaveCopy(pill, () => [{opacity: 1}, {opacity: 0}], {duration: motion.fast, easing: motion.ease});
};

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
