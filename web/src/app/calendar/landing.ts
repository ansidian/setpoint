// A change visibly arrives (polish audit calflows-02, calflows-11): when an item's change goes from
// waiting for its provider to done, or an item comes back (Undo, ⌘Z, a create the server now lists),
// its chip's tint brightens once and settles (`.landed`, 420 ms). Drawn on the element itself, so a
// re-render meanwhile doesn't restart it.
import {useLayoutEffect, useRef} from 'react';
import type {ItemOut} from '@setpoint/shared';

// Items expected to land when next drawn settled, by id, until a moment after they were asked for.
const awaited = new Map<number, number>();
const AWAIT_MS = 10_000;

/** The items a create made, or Undo put back: they land as they're next drawn with nothing pending. */
export function expectLanding(ids: Iterable<number>) {
  const until = Date.now() + AWAIT_MS;
  for (const id of ids) awaited.set(id, until);
}

function awaitedNow(id: number): boolean {
  const until = awaited.get(id);
  if (until === undefined) return false;
  awaited.delete(id);
  return until > Date.now();
}

/** Plays the landing on `element`, from its start. */
export function land(element: HTMLElement) {
  element.classList.remove('landed');
  // Taken off and put back in one frame, it plays again.
  void element.offsetWidth;
  element.classList.add('landed');
  const done = (event: AnimationEvent) => {
    if (event.animationName !== 'landed') return;
    element.classList.remove('landed');
    element.removeEventListener('animationend', done);
  };
  element.addEventListener('animationend', done);
}

/** A ref for an item's chip or block that lands it when its change arrives or it comes back. */
export function useLanding<T extends HTMLElement>(item: ItemOut) {
  const element = useRef<T>(null);
  const state = item.command?.state ?? null;
  const last = useRef<string | null | undefined>(undefined);
  useLayoutEffect(() => {
    const before = last.current;
    last.current = state;
    if (state !== null || item.id < 0 || !element.current) return;
    if (before === 'pending' || awaitedNow(item.id)) land(element.current);
  }, [state, item.id]);
  return element;
}
