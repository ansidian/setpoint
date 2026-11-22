// The overdue banner's snoozes, kept in this browser's storage until each ends, and when it was last
// on screen, for its cooldown (logic/overdueBanner.ts has their rules). A browser that refuses
// storage, or a record that isn't one, reads as none, so the banner still shows and a snooze still
// takes its title off for this visit.
import type {Snooze} from '../logic/overdueBanner.ts';

const KEY = 'setpoint.overdueSnoozed';
const SEEN_KEY = 'setpoint.overdueSeen';

const isSnooze = (value: unknown): value is Snooze => {
  const snooze = value as Partial<Snooze> | null;
  return typeof snooze === 'object' && snooze !== null && typeof snooze.id === 'number' && typeof snooze.due === 'string' && typeof snooze.until === 'number';
};

/** The snoozes kept, ended ones included until they're pruned. */
export function readSnoozes(): Snooze[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isSnooze) : [];
  } catch {
    return [];
  }
}

/** Keeps `snoozes`, or removes the record when there are none. */
export function writeSnoozes(snoozes: readonly Snooze[]) {
  try {
    if (snoozes.length) localStorage.setItem(KEY, JSON.stringify(snoozes));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage refused: the snooze lasts for this visit only.
  }
}

/** When the banner was last on screen in this browser, by its own clock, or null. */
export function readSeen(): number | null {
  try {
    const seen = Number(localStorage.getItem(SEEN_KEY));
    return Number.isFinite(seen) && seen > 0 ? seen : null;
  } catch {
    return null;
  }
}

/** Keeps that the banner is on screen at `at`. */
export function writeSeen(at: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    // Storage refused: no cooldown, the banner showing on every arrival.
  }
}
