import {useEffect, useState} from 'react';

/**
 * `value` as it shows, for what leaves in place on Jobs (the email's pane, the Needs you band and its
 * From history line): once it turns null, the last one is kept for `ms` with `closing` set, while its
 * fold or fade plays.
 */
export function useHold<T>(value: T | null, ms: number): {shown: T | null; closing: boolean} {
  const [kept, setKept] = useState<T | null>(value);
  if (value !== null && value !== kept) setKept(value);
  useEffect(() => {
    if (value !== null || kept === null) return;
    const timer = window.setTimeout(() => setKept(null), ms);
    return () => window.clearTimeout(timer);
  }, [value, kept, ms]);
  return {shown: value ?? kept, closing: value === null && kept !== null};
}
