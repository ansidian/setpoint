// The overdue tasks this browser has shown in its banner (OverdueBanner.tsx), kept in localStorage
// as the sidebar's rail is, by task and due (logic/overdueBanner.ts). Not shared with another browser
// or the phone. If storage can't be read or written, the banner still works and may show again.
import {addShown, readShown} from '../logic/overdueBanner.ts';

const KEY = 'setpoint.overdueShown';

/** The tasks shown before, by their keys. */
export function shownTasks(): Set<string> {
  try {
    return new Set(readShown(localStorage.getItem(KEY)));
  } catch {
    return new Set();
  }
}

/** Records tasks as shown, dropping the ones too old to show again. */
export function markShown(keys: readonly string[], now: number, timeZone: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify(addShown([...shownTasks()], keys, now, timeZone)));
  } catch {
    // Private windows may refuse; the banner may show these again.
  }
}
