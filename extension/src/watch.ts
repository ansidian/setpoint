// A broken reader says so (SV-174): on a board's jobs page whose pane or cards it couldn't read for a
// few seconds, the toolbar icon shows a badge and the tooltip "Setpoint couldn't read this LinkedIn
// page" (or Indeed page), so a change to the board's page doesn't just make chips quietly disappear.
// What a page expects is each board's `expects` (linkedin.ts, indeed.ts); this is how long it may wait.
import type {BoardName} from './boards.ts';
import type {Unread} from './posting.ts';

/** How long a page may stay unread before the badge says so: a board draws a job's pane (LinkedIn then sets its title) within a second or so. */
export const GRACE_MS = 5000;

/**
 * The badge after reading the page at `now`, given since when it has been unread (null while it reads):
 * shown once it has stayed unread for GRACE_MS, with when to read again if it may come to be. Only a
 * read page restarts the wait, so switching jobs while the reader is broken doesn't put it off.
 */
export function watch(since: number | null, unread: Unread | null, now: number): {since: number | null; badge: Unread | null; again: number | null} {
  if (!unread) return {since: null, badge: null, again: null};
  const from = since ?? now;
  const waited = now - from;
  return waited >= GRACE_MS ? {since: from, badge: unread, again: null} : {since: from, badge: null, again: GRACE_MS - waited};
}

/** The toolbar icon's own name, its tooltip while every page reads. */
export const NAME = 'Setpoint on job boards';

const PARTS: Record<Unread, string> = {pane: 'its job pane', cards: 'its job cards', both: 'its job pane and cards'};

/** The toolbar's badge and tooltip: "!" and "Setpoint couldn't read this Indeed page, its job pane", or none. */
export function badgeOf(unread: Unread | null, board: BoardName): {text: string; title: string} {
  return unread ? {text: '!', title: `Setpoint couldn't read this ${board} page, ${PARTS[unread]}`} : {text: '', title: NAME};
}
