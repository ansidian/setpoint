// What this browser remembers between opens to paint Setpoint at once (DESIGN.md › Decided while
// building #233, #234): whether it was signed in, so a start draws the shell rather than the mark,
// and the sidebar's last-known shape (logic/shape.ts), so the accounts, the counts and Today's place
// show before their answers. Per browser, as the theme is (theme.ts); a browser that refuses
// storage just starts as if new. Signing out, or a session ending, forgets both.
import {localDate} from '../logic/format.ts';
import {parseShape} from '../logic/shape.ts';
import type {SidebarShape} from '../logic/shape.ts';

const SHAPE = 'setpoint.sidebar';
const SIGNED_IN = 'setpoint.signedIn';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse; the next open starts as if new.
  }
}

/** Whether this browser was signed in when it last asked. */
export const signedInBefore = () => read(SIGNED_IN) === '1';

export const rememberSignedIn = () => write(SIGNED_IN, '1');

/** Signed out, or the session ended: nothing of it stays to be drawn. */
export function forgetSession() {
  write(SIGNED_IN, null);
  write(SHAPE, null);
}

/** Today by this browser's clock and zone, which it knows before Setpoint answers: the day Today's lines are kept for. */
export const browserDay = () => localDate(Date.now(), Intl.DateTimeFormat().resolvedOptions().timeZone);

/** The sidebar as it last stood, or null. */
export const lastShape = (): SidebarShape | null => parseShape(read(SHAPE));

/** Keeps the sidebar's shape, merging with what's kept (Today's lines come apart from the accounts). */
export function rememberShape(change: Partial<SidebarShape>) {
  const kept = lastShape() ?? {accounts: [], counts: null, today: null};
  const next = {...kept, ...change};
  const text = JSON.stringify(next);
  if (text !== read(SHAPE)) write(SHAPE, text);
}
