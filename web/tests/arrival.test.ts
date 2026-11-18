// The arrivals rule, as a table: each way of being away on its own and together, each sign of
// return, the idle spell at just under and at 5 minutes, input while hidden or unfocused being no
// return, a load in a hidden tab, and two arrivals in a row. Each row is a run of events from a
// page load and the arrivals it makes.
import {describe, expect, test} from 'vitest';
import {IDLE_MS, step} from '../src/logic/arrival.ts';
import type {Presence, PresenceEvent} from '../src/logic/arrival.ts';

type Short = 'hidden' | 'visible' | 'blur' | 'focus' | 'input' | 'tick';
// A row's events: a load ('load', 'load hidden', 'load blurred'), then each event at a time in ms.
type Row = [string, string, [Short, number][], number[]];

const MIN = 60_000;

/** The times of the arrivals in a run of events after a load at 0. */
function arrivals(load: string, events: [Short, number][]): number[] {
  const at: number[] = [];
  let presence: Presence | null = null;
  const run = (event: PresenceEvent) => {
    const next = step(presence, event);
    presence = next.presence;
    if (next.arrival) at.push(event.at);
  };
  run({type: 'load', hidden: load.includes('hidden'), focused: !load.includes('blurred'), at: 0});
  for (const [type, time] of events) run({type, at: time});
  return at;
}

describe('arrivals', () => {
  const rows: Row[] = [
    ['a load with the user there', 'load', [], [0]],
    ['a load in a hidden tab waits for it to show', 'load hidden', [['tick', MIN], ['visible', 2 * MIN]], [2 * MIN]],
    ['a load in an unfocused window waits for focus', 'load blurred', [['focus', MIN]], [MIN]],
    ['staying active: no arrival after the load', 'load', [['input', 4 * MIN], ['tick', 6 * MIN], ['input', 8 * MIN], ['tick', 12 * MIN]], [0]],

    ['hidden, then shown', 'load', [['hidden', MIN], ['visible', 2 * MIN]], [0, 2 * MIN]],
    ['unfocused, then focused', 'load', [['blur', MIN], ['focus', 2 * MIN]], [0, 2 * MIN]],
    ['idle seen by a tick, then a move', 'load', [['tick', IDLE_MS], ['input', IDLE_MS + 30_000]], [0, IDLE_MS + 30_000]],
    ['idle not yet seen by a tick: the move is the return all the same', 'load', [['input', IDLE_MS + 1000]], [0, IDLE_MS + 1000]],
    ['input at just under 5 minutes is no return', 'load', [['tick', IDLE_MS - 1], ['input', IDLE_MS - 1]], [0]],
    ['input at 5 minutes is a return', 'load', [['input', IDLE_MS]], [0, IDLE_MS]],

    ['hidden and unfocused: shown alone is no return', 'load', [['blur', MIN], ['hidden', MIN], ['visible', 2 * MIN], ['focus', 3 * MIN]], [0, 3 * MIN]],
    ['hidden long enough to be idle: shown is the return', 'load', [['hidden', MIN], ['tick', 20 * MIN], ['visible', 30 * MIN]], [0, 30 * MIN]],
    ['input while hidden is no return', 'load', [['hidden', MIN], ['input', 2 * MIN], ['visible', 3 * MIN]], [0, 3 * MIN]],
    ['a pointer moving over an unfocused window is no return', 'load', [['blur', MIN], ['input', 7 * MIN], ['focus', 8 * MIN]], [0, 8 * MIN]],
    ['focus after idle is the return, and the next move is not another', 'load', [['blur', MIN], ['tick', 10 * MIN], ['focus', 10 * MIN], ['input', 10 * MIN + 1]], [0, 10 * MIN]],
    ['hidden again before showing: one return', 'load', [['hidden', MIN], ['hidden', 2 * MIN], ['visible', 3 * MIN], ['visible', 4 * MIN]], [0, 3 * MIN]],

    ['two arrivals in a row', 'load', [['hidden', MIN], ['visible', 2 * MIN], ['blur', 3 * MIN], ['focus', 4 * MIN]], [0, 2 * MIN, 4 * MIN]],
    ['away by idle, then hidden: shown is the return', 'load', [['tick', 6 * MIN], ['hidden', 7 * MIN], ['visible', 8 * MIN]], [0, 8 * MIN]],
  ];
  test.each(rows)('%s', (_name, load, events, expected) => {
    expect(arrivals(load, events)).toEqual(expected);
  });
});
