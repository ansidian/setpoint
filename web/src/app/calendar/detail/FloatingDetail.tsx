// The floating detail (DESIGN.md › The floating detail; boards 12a, 12b, 12c and 12d): a 280 px card
// beside the selected item, placed on the side covering the fewest other items, that glides to the
// next item clicked, can be dragged from anywhere but its buttons and text and left anywhere in the
// grid, and hands the item to the right pane's editor with Edit or E. It lives in the month section, as F4's overlays do.
// motion.ts runs the motion; this renders the card and tells it what's selected.
import {useEffect, useLayoutEffect, useState, useSyncExternalStore} from 'react';
import type {RefObject} from 'react';
import {DetailContent} from './DetailContent.tsx';
import type {DetailActions} from './DetailContent.tsx';
import {DetailMotion} from './motion.ts';
import type {DetailExit, DetailTarget} from './motion.ts';
import './detail.css';

export type {DetailExit, DetailTarget} from './motion.ts';
export type {DetailActions} from './DetailContent.tsx';

export interface FloatingDetailProps {
  // The selected item, or null to close (by `exit`).
  target: DetailTarget | null;
  exit: DetailExit;
  section: RefObject<HTMLElement | null>;
  scroller: RefObject<HTMLElement | null>;
  timeZone: string;
  // F6's Clone, Copy, Colour and Delete.
  actions?: DetailActions;
  onClose: () => void;
  onEdit: (target: DetailTarget) => void;
}

export function FloatingDetail({target, exit, section, scroller, timeZone, actions, onClose, onEdit}: FloatingDetailProps) {
  const [engine] = useState(() => new DetailMotion());
  const {phase, layers, side, lifted} = useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  useLayoutEffect(() => {
    engine.attach({section: section.current, scroller: scroller.current});
  });

  useLayoutEffect(() => {
    engine.setTarget(target, exit);
  }, [engine, target, exit]);

  // Every render: start what a new target asked for once its content is drawn, or keep by the item.
  useLayoutEffect(() => {
    engine.afterRender();
  });

  useEffect(() => {
    const element = scroller.current;
    const host = section.current;
    if (!element || !host) return;
    const onScroll = () => engine.onScroll();
    element.addEventListener('scroll', onScroll, {passive: true});
    const observer = new ResizeObserver(() => engine.onResize());
    observer.observe(host);
    return () => {
      element.removeEventListener('scroll', onScroll);
      observer.disconnect();
      engine.dispose();
    };
  }, [engine, scroller, section]);

  if (phase === 'closed' || !layers.length) return null;
  const showing = layers.find(layer => layer.role === 'in') ?? layers[layers.length - 1]!;
  return (
    <div className={`fd${lifted ? ' lifted' : ''}`} role="dialog" aria-label={showing.target.item.title} data-motion={phase} data-side={side ?? undefined}
      ref={element => {
        engine.attach({outer: element});
      }}>
      <div className="card float" ref={element => {
        engine.attach({card: element});
      }}
        onPointerDown={event => {
          const at = event.target as Element;
          if (!at.closest('.grip') && (at.closest('button, a, input, select, textarea, label, [role="radio"]') || overText(at, event.clientX, event.clientY))) return;
          engine.pointerDown(event.nativeEvent, event.currentTarget);
        }} onPointerMove={event => engine.pointerMove(event.nativeEvent)}
        onPointerUp={event => engine.pointerUp(event.nativeEvent)} onPointerCancel={event => engine.pointerUp(event.nativeEvent)}>
        <button className="grip" aria-label="Drag card" title="Drag to move" />
        <div className="fd-body" ref={element => {
          engine.attach({body: element});
        }}>
          {layers.map(layer => (
            <div key={layer.id} className={`fd-layer ${layer.role}`} data-role={layer.role} data-layer={layer.id} aria-hidden={layer.role === 'out' || undefined}>
              <DetailContent target={layer.target} timeZone={timeZone} actions={actions} onClose={onClose} onEdit={() => onEdit(layer.target)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Whether the pointer is on `element`'s own text, which stays selectable rather than dragging the card. */
function overText(element: Element, x: number, y: number): boolean {
  return [...element.childNodes].some(node => {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  });
}
