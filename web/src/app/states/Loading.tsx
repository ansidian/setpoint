// Loading (DESIGN.md › Motion, Decided while building #225): while a page's data is on its way it
// says so, never "nothing". A skeleton stands where the rows will be, in their shapes
// (Skeletons.tsx), appearing only after a short delay so a quick answer never flashes one, then
// breathing quietly until the rows replace it with a short fade. A load that fails says so in place,
// with Try again (#228). Setpoint starting shows its mark (#233).
import {useEffect, useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {refresh} from '../../api/client.ts';
import {useOfflineSince} from '../../api/live.ts';
import {skeleton} from '../../tokens.ts';
import {Icon, Mark} from '../../ui/Icon.tsx';
import {failureLine} from '../toast.ts';
import './loading.css';

/** A bar: `w` in px or a share ("46%"), `h` px tall (9 for a line of text, 11 for a title). */
export function Bar({w, h = 9, style}: {w: number | string; h?: number; style?: CSSProperties}) {
  return <span className="sk-bar" style={{width: typeof w === 'number' ? `${w}px` : w, height: h, ...style}} />;
}

/** A dot, as an account's or an unread one. */
export const Dot = ({size = 8}: {size?: number}) => <span className="sk-dot" style={{width: size, height: size}} />;

// A skeleton shows at once, without its delay and fade, while the shell's is showing (as Setpoint
// starts, ShellFrame.tsx) and for a moment after it gives way, so the app's carry on from it.
let carrying = false;
let carryUntil = 0;

/** The shell's effect: once its skeleton shows, the app's next skeletons carry on from it. */
export function carrySkeletons() {
  const timer = window.setTimeout(() => {
    carrying = true;
  }, skeleton.delayMs);
  return () => {
    window.clearTimeout(timer);
    if (carrying) carryUntil = Date.now() + 1000;
    carrying = false;
  };
}

/**
 * A skeleton: its bars breathe together. `kind` names it for the checks; it's hidden from the
 * accessibility tree, which has nothing to read in it.
 */
export function Sk({kind, className, style, immediate = false, children}: {kind: string; className?: string; style?: CSSProperties; immediate?: boolean; children: ReactNode}) {
  const [carried] = useState(() => immediate || carrying || Date.now() < carryUntil);
  const classes = ['sk', carried && 'carried', className].filter(Boolean).join(' ');
  return <div className={classes} data-skeleton={kind} aria-hidden="true" style={style}>{children}</div>;
}

/**
 * Whether what's loaded here arrived after a wait (this key showed without it first), so it fades in
 * as it replaces its skeleton; what was there at once (the cache) doesn't.
 */
export function useArrival(loaded: boolean, key: unknown = null): boolean {
  const [seen, setSeen] = useState<{key: unknown; waited: boolean}>({key, waited: !loaded});
  let current = seen;
  if (current.key !== key) current = {key, waited: !loaded};
  else if (!loaded && !current.waited) current = {...current, waited: true};
  if (current !== seen) setSeen(current);
  return loaded && current.waited;
}

/**
 * Whether `on` has held for `ms` (a search's first answer still on its way after a moment); each
 * time it turns on, it waits again.
 */
export function useAfter(on: boolean, ms: number): boolean {
  const [episode, setEpisode] = useState({on, count: 0});
  let current = episode;
  if (current.on !== on) current = {on, count: on ? current.count + 1 : current.count};
  if (current !== episode) setEpisode(current);
  const [waited, setWaited] = useState(-1);
  const count = current.count;
  useEffect(() => {
    if (!on) return;
    const timer = window.setTimeout(() => setWaited(count), ms);
    return () => window.clearTimeout(timer);
  }, [on, count, ms]);
  return on && waited === count;
}

/** One of a page's loads: its path, and what useResource answered for it. */
export interface Load {
  path: string | null;
  data: unknown;
  error: Error | undefined;
}

/** A load that failed with nothing to show: data already shown stays, and the next live event tries again. */
const failedLoad = (load: Load) => load.path !== null && load.error !== undefined && load.data === undefined;

/**
 * Whether any of these loads failed with nothing to show, while Setpoint is reachable (offline, the
 * pill says so and the skeleton waits for it to come back).
 */
export function useLoadFailed(loads: Load[]): boolean {
  const offline = useOfflineSince() !== null;
  return !offline && loads.some(failedLoad);
}

/**
 * "Couldn’t load the Inbox, Something went wrong. · Try again", in place of what didn't load (#228):
 * the failing health line's look, its glyph `warning` in `caution`; Try again loads each failed one
 * again. Nothing while they're loading or loaded, or while Setpoint is offline.
 */
export function LoadFailed({what, loads, className}: {what: string; loads: Load[]; className?: string}) {
  const failed = useLoadFailed(loads);
  const [trying, setTrying] = useState(false);
  if (!failed) return null;
  const first = loads.find(failedLoad)!;
  const again = () => {
    setTrying(true);
    void Promise.all(loads.filter(failedLoad).map(load => refresh(load.path!))).finally(() => setTrying(false));
  };
  return (
    <div className={className ? `load-failed ${className}` : 'load-failed'} role="alert">
      <Icon name="warning" size={16} />
      <span className="ell" title={failureLine(`Couldn’t load ${what}`, first.error)}>{failureLine(`Couldn’t load ${what}`, first.error)}</span>
      <span>·</span>
      <button className="act" type="button" disabled={trying} onClick={again}><Icon name="refresh" size={16} />Try again</button>
    </div>
  );
}

/**
 * Setpoint starting, before it knows whether this browser is signed in (#233): the mark at 36 px
 * where the sign-in card's top sits, its chips settling in turn once the start has taken a moment,
 * then breathing as a skeleton does. Unreachable (States.tsx) is the same screen with the pill.
 */
export function Boot() {
  return (
    <div className="boot starting" aria-label="Starting Setpoint">
      <div className="boot-at"><Mark size={36} /></div>
    </div>
  );
}
