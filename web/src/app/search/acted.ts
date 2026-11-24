// Alfred's proposals created or saved here, by "turn:index", and telling the server so: a later
// proposal in the thread leaves them be, and his next question says they were made. The chip,
// its full card and the phone's editor sheet all record it once their Create or Save goes through.
import {useSyncExternalStore} from 'react';
import {alfredActed} from '../../api/search.ts';

let acted: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const actedKey = (turnId: number, index: number) => `${turnId}:${index}`;

/**
 * Records a proposal as acted on. The item is made either way: a failure to record it only means a
 * later proposal in the thread may replace its (already folded) card, so it says nothing.
 */
export function markActed(turnId: number, index: number) {
  const key = actedKey(turnId, index);
  if (acted.has(key)) return;
  acted = new Set([...acted, key]);
  listeners.forEach(listener => listener());
  void alfredActed(turnId, index).catch(() => {});
}

export const useActed = () => useSyncExternalStore(subscribe, () => acted);
