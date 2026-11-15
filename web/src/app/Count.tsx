// A count that rolls when it changes: the unread badge, the sidebar's unread counts, a group
// header's and All's lane counts. For 180 ms it shows both numbers in one cell. Going down (a Done,
// a read), the old one leaves downward and the new one comes in from above, as an odometer rolls.
// Going up, they move the other way. The cell's ::after draws the old number from `data-was`, so
// the count's text is only ever the number itself.
import {useEffect, useState} from 'react';
import {motion} from '../tokens.ts';

export function Count({value}: {value: number}) {
  const [shown, setShown] = useState<{value: number; was: number | null}>({value, was: null});
  let current = shown;
  if (shown.value !== value) {
    current = {value, was: shown.value};
    setShown(current);
  }
  useEffect(() => {
    if (current.was === null) return;
    const timer = window.setTimeout(() => setShown(last => (last === current ? {value: last.value, was: null} : last)), motion.medium);
    return () => window.clearTimeout(timer);
  }, [current]);
  const rolling = current.was === null ? {} : {'data-was': current.was, 'data-dir': current.value < current.was ? 'down' : 'up'};
  // Keyed by its number, so each change rolls in afresh.
  return <span className="count" {...rolling}><span key={current.value} className="now">{current.value}</span></span>;
}
