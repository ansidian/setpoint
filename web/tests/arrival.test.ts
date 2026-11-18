// The arrivals rule, as a table: each way of being away on its own and together, each sign of
// return, a load in a hidden tab or an unfocused window, and two arrivals in a row. Each row is a
// run of events from a page load and the arrivals it makes. Time alone makes no arrival: an hour
// in a shown, focused tab is none.
import {describe, expect, test} from 'vitest';
import {step} from '../src/logic/arrival.ts';
import type {Presence, PresenceEvent} from '../src/logic/arrival.ts';

type Short = 'hidden' | 'visible' | 'blur' | 'focus';
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
    ['a load in a hidden tab waits for it to show', 'load hidden', [['visible', 2 * MIN]], [2 * MIN]],
    ['a load in an unfocused window waits for focus', 'load blurred', [['focus', MIN]], [MIN]],

    ['hidden, then shown', 'load', [['hidden', MIN], ['visible', 2 * MIN]], [0, 2 * MIN]],
    ['unfocused, then focused', 'load', [['blur', MIN], ['focus', 2 * MIN]], [0, 2 * MIN]],

    ['hidden and unfocused: shown alone is no return', 'load', [['blur', MIN], ['hidden', MIN], ['visible', 2 * MIN], ['focus', 3 * MIN]], [0, 3 * MIN]],
    ['hidden for an hour: shown is the return', 'load', [['hidden', MIN], ['visible', 60 * MIN]], [0, 60 * MIN]],
    ['focused again twice: one return', 'load', [['blur', MIN], ['focus', 2 * MIN], ['focus', 3 * MIN]], [0, 2 * MIN]],
    ['hidden again before showing: one return', 'load', [['hidden', MIN], ['hidden', 2 * MIN], ['visible', 3 * MIN], ['visible', 4 * MIN]], [0, 3 * MIN]],

    ['two arrivals in a row', 'load', [['hidden', MIN], ['visible', 2 * MIN], ['blur', 3 * MIN], ['focus', 4 * MIN]], [0, 2 * MIN, 4 * MIN]],
  ];
  test.each(rows)('%s', (_name, load, events, expected) => {
    expect(arrivals(load, events)).toEqual(expected);
  });
});
