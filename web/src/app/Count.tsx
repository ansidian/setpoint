// A count that rolls when it changes (polish audit motion-07): the attention pill, the sidebar's
// unread counts, a group header's and All's lane counts. For 180 ms it shows both numbers in one
// cell: going down (a Done, a read), the old one leaves downward and the new one comes in from above,
// as an odometer rolls; going up, the other way. The old number is drawn by the cell's ::after from
// `data-was`, so the count's text is only ever the number itself.
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
