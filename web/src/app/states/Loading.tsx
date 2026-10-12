// Loading (DESIGN.md › Motion, Decided while building #170): while a page's data is on its way it
// says so, never "nothing". A skeleton stands where the rows will be, in their shapes
// (Skeletons.tsx), appearing only after a short delay so a quick answer never flashes one, then
// breathing quietly until the rows replace it with a short fade. A load that fails says so in place,
// with Try again (#173). Setpoint starting shows its mark (#174).
import {useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {refresh} from '../../api/client.ts';
import {useOfflineSince} from '../../api/live.ts';
import {Icon, Mark} from '../../ui/Icon.tsx';
import {failureLine} from '../toast.ts';
import './loading.css';

/** A bar: `w` in px or a share ("46%"), `h` px tall (9 for a line of text, 11 for a title). */
export function Bar({w, h = 9, style}: {w: number | string; h?: number; style?: CSSProperties}) {
  return <span className="sk-bar" style={{width: typeof w === 'number' ? `${w}px` : w, height: h, ...style}} />;
}

/** A dot, as an account's or an unread one. */
export const Dot = ({size = 8}: {size?: number}) => <span className="sk-dot" style={{width: size, height: size}} />;

/**
 * A skeleton: its bars breathe together. `kind` names it for the checks; it's hidden from the
 * accessibility tree, which has nothing to read in it.
 */
export function Sk({kind, className, style, children}: {kind: string; className?: string; style?: CSSProperties; children: ReactNode}) {
  return <div className={className ? `sk ${className}` : 'sk'} data-skeleton={kind} aria-hidden="true" style={style}>{children}</div>;
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
 * "Couldn’t load the Inbox, Something went wrong. · Try again", in place of what didn't load (#173):
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
 * Setpoint starting, before it knows whether this browser is signed in (#174): the mark at 36 px
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
