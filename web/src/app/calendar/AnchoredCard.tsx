// An overlay anchored to a calendar item (DESIGN.md › Placement, override 7): the recurring-drop
// prompt (board 15b) and the failed card (board 19b). It sits 8 px off its item on the side covering
// the fewest other items, inside the grid (F5's placeBeside), measured in the month section's own
// CSS pixels so the wide-screen zoom doesn't throw it off (geometry.ts, D23), and follows its item as
// the grid scrolls. With its item out of view it hides.
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {placeBeside} from '../../logic/placement.ts';
import type {Placement} from '../../logic/placement.ts';
import {CAL, CAL_ITEMS, findItem, rectIn} from './geometry.ts';

interface AnchoredCardProps {
  // The item it's anchored to: its day on the grid and its key.
  anchor: {date: string; key: string};
  className: string;
  label: string;
  children: ReactNode;
}

export function AnchoredCard({anchor, className, label, children}: AnchoredCardProps) {
  const card = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  const measure = () => {
    const host = card.current?.closest<HTMLElement>(CAL.section);
    const element = host ? findItem(host, anchor.date, anchor.key) : null;
    const grid = host?.querySelector(CAL.scroll);
    if (!host || !element || !grid || !card.current) {
      setPlace(current => (current ? null : current));
      return;
    }
    const others = [...host.querySelectorAll(CAL_ITEMS)].filter(other => other !== element).map(other => rectIn(other, host));
    const next = placeBeside(rectIn(element, host), {width: card.current.offsetWidth, height: card.current.offsetHeight}, rectIn(grid, host), others);
    setPlace(current => (current && current.left === next.left && current.top === next.top && current.side === next.side ? current : next));
  };
  const latest = useRef(measure);
  useLayoutEffect(() => {
    latest.current = measure;
    measure();
  });

  useEffect(() => {
    const host = card.current?.closest<HTMLElement>(CAL.section);
    const grid = host?.querySelector(CAL.scroll);
    if (!host || !grid) return;
    const onChange = () => latest.current();
    grid.addEventListener('scroll', onChange, {passive: true});
    const observer = new ResizeObserver(onChange);
    observer.observe(host);
    return () => {
      grid.removeEventListener('scroll', onChange);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={card} className={className} role="dialog" aria-label={label} data-side={place?.side}
      style={place ? {left: place.left, top: place.top} : {left: 0, top: 0, visibility: 'hidden'}}>
      {children}
    </div>
  );
}
