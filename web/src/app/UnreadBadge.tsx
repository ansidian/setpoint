// The red unread badge (SV-221, D471): Inbox's in the sidebar and the rail, and Unread's segment. Its
// count rolls (Count), and a rise registers from the corner of the eye (shell-11): it swells to 1.22
// and back over 260 ms. A fall, the user's own reading, stays quiet. From none it scales in from .6;
// at none it scales out before it goes.
import {useEffect, useRef, useState} from 'react';
import {motion} from '../tokens.ts';
import {Count} from './Count.tsx';

export function UnreadBadge({value, tip}: {value: number; tip?: string}) {
  // The value last seen, the number shown (the last one while it goes), whether it's arriving, and how many rises.
  const [seen, setSeen] = useState({value, shown: value, arriving: false, rises: 0});
  let current = seen;
  if (value !== seen.value) {
    current = {value, shown: value || seen.shown, arriving: seen.value === 0, rises: value > seen.value && seen.value > 0 ? seen.rises + 1 : seen.rises};
    setSeen(current);
  }
  const badge = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (current.rises) badge.current?.animate([{transform: 'none'}, {transform: 'scale(1.22)', offset: 0.4}, {transform: 'none'}], {duration: motion.slow, easing: motion.ease});
  }, [current.rises]);
  const going = value === 0 && current.shown > 0;
  useEffect(() => {
    if (!going) return;
    const timer = window.setTimeout(() => setSeen(last => (last.value === 0 ? {...last, shown: 0} : last)), motion.fast);
    return () => window.clearTimeout(timer);
  }, [going]);
  if (current.shown === 0) return null;
  const classes = ['ubadge num', current.arriving && !going && 'arriving', going && 'going'].filter(Boolean).join(' ');
  return <span ref={badge} className={classes} data-tip={tip}><Count value={current.shown} /></span>;
}
