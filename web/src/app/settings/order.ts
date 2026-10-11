// Reordering by drag, live (DESIGN.md › Decided while building #14): while a row is dragged the
// others make room as it passes, easing over 180 ms, as darma's lists do; letting go saves the order
// shown, and letting go elsewhere eases everything back. ↑ ↓ on a handle slide the rows the same way.
import {useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, DragEvent, RefObject} from 'react';
import {dropIndex, placed, shifts} from '../../logic/settings.ts';
import {motion} from '../../tokens.ts';

const ROWS = ':scope > [data-order]';

/**
 * Rows that changed place in the list slide from where they were to where they are now (from where
 * they show mid-slide, if still moving). A drop needs none: the rows already show where they land.
 */
function useFlip(container: RefObject<HTMLElement | null>, order: string, droppedRef: RefObject<boolean>) {
  const tops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const now = new Map<string, number>();
    for (const row of container.current?.querySelectorAll<HTMLElement>(ROWS) ?? []) {
      const sliding = new DOMMatrix(getComputedStyle(row).transform).m42;
      row.getAnimations().forEach(animation => animation instanceof CSSTransition || animation.cancel());
      const top = row.offsetTop;
      const was = tops.current.get(row.dataset.order!);
      now.set(row.dataset.order!, top);
      if (!droppedRef.current && was !== undefined && was + sliding !== top) {
        row.animate([{transform: `translateY(${was + sliding - top}px)`}, {transform: 'none'}], {duration: motion.medium, easing: motion.ease});
      }
    }
    tops.current = now;
    droppedRef.current = false;
  }, [container, order, droppedRef]);
}

/** A row's part in the drag: its props, and whether it's the one dragged (drawn at .5). */
export interface DragProps {
  'data-order': number;
  style: CSSProperties | undefined;
  dragging: boolean;
  onDragStart: (event: DragEvent) => void;
  onDragEnd: () => void;
}

interface Drag {
  id: number;
  from: number;
  to: number;
  // The rows' heights when the drag began, in the list's order.
  heights: number[];
}

/**
 * A list reordered by drag: the group's props and each row's. The rows stay in the list's order in
 * the page while they're dragged (moving the dragged row's element would end the drag) and show the
 * new order by sliding; `type` names the drag's data.
 */
export function useLiveOrder<T extends {id: number}>(list: T[], type: string, save: (ids: number[]) => void) {
  const [drag, setDrag] = useState<Drag | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const dropped = useRef(false);
  useFlip(group, list.map(item => item.id).join(), dropped);
  const slides = drag ? shifts(drag.heights, drag.from, drag.to) : null;

  const groupProps = {
    ref: group,
    className: drag ? 'set-group reordering' : 'set-group',
    // Taking the drag on entering a row too, so a row sliding under a still pointer still takes the drop.
    onDragEnter: (event: DragEvent) => {
      if (drag && event.dataTransfer.types.includes(type)) event.preventDefault();
    },
    onDragOver: (event: DragEvent) => {
      if (!drag || !event.dataTransfer.types.includes(type)) return;
      event.preventDefault();
      // The others' middles where they sit in the page (layout pixels, scaled to the pointer's by the
      // wide screen's zoom).
      const box = group.current!;
      const rect = box.getBoundingClientRect();
      const scale = rect.height / box.offsetHeight;
      const middles = [...box.querySelectorAll<HTMLElement>(ROWS)].filter(row => row.dataset.order !== String(drag.id))
        .map(row => rect.top + (row.offsetTop - box.offsetTop + row.offsetHeight / 2) * scale);
      const to = dropIndex(middles, event.clientY);
      if (to !== drag.to) setDrag({...drag, to});
    },
    onDrop: (event: DragEvent) => {
      if (!drag) return;
      event.preventDefault();
      if (drag.to !== drag.from) {
        dropped.current = true;
        save(placed(list, drag.id, drag.to).map(item => item.id));
      }
      setDrag(null);
    },
  };

  const rowProps = (item: T, index: number): DragProps => ({
    'data-order': item.id,
    style: slides?.[index] ? {transform: `translateY(${slides[index]}px)`} : undefined,
    dragging: drag?.id === item.id,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(type, String(item.id));
      event.dataTransfer.effectAllowed = 'move';
      const heights = [...group.current?.querySelectorAll<HTMLElement>(ROWS) ?? []].map(row => row.offsetHeight);
      setDrag({id: item.id, from: index, to: index, heights});
    },
    // Let go outside the list: the rows ease back, then the drag ends.
    onDragEnd: () => {
      if (!drag) return;
      setDrag({...drag, to: drag.from});
      window.setTimeout(() => setDrag(null), motion.medium);
    },
  });

  return {groupProps, rowProps};
}
