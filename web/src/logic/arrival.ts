// When the user arrives: on a page load, or coming back after being away. Away is the tab hidden,
// the window without focus, or no pointer or key input for 5 minutes. The signs of return end it:
// the tab shown, the window focused, or the first input after an idle spell. The overdue banner
// enters only on an arrival (app/arrival.ts feeds this the page's events), so it never shows
// mid-use, and never to an empty chair. Pure: no DOM, no timers.

/** How long without input before the user counts as away. */
export const IDLE_MS = 5 * 60_000;

export interface Presence {
  hidden: boolean;
  blurred: boolean;
  /** The last pointer or key input, or the last sign of return. */
  lastInput: number;
  /** Seen idle by a tick, so the next input is a return even if it comes within the tick's gap. */
  idle: boolean;
}

export type PresenceEvent =
  | {type: 'load'; hidden: boolean; focused: boolean; at: number}
  | {type: 'hidden'; at: number}
  | {type: 'visible'; at: number}
  | {type: 'blur'; at: number}
  | {type: 'focus'; at: number}
  | {type: 'input'; at: number}
  | {type: 'tick'; at: number};

const idleAt = (presence: Presence, at: number) => presence.idle || at - presence.lastInput >= IDLE_MS;

/** Whether the user is away at `at`. */
export const isAway = (presence: Presence, at: number): boolean => presence.hidden || presence.blurred || idleAt(presence, at);

/**
 * The presence after `event`, and whether it is an arrival: the page loading with the user there,
 * or the user going from away to present. Input while the tab is hidden or the window unfocused
 * counts as input, but is no return.
 */
export function step(presence: Presence | null, event: PresenceEvent): {presence: Presence; arrival: boolean} {
  if (event.type === 'load' || presence === null) {
    const hidden = event.type === 'load' ? event.hidden : false;
    const blurred = event.type === 'load' ? !event.focused : false;
    const next = {hidden, blurred, lastInput: event.at, idle: false};
    return {presence: next, arrival: !isAway(next, event.at)};
  }
  const away = isAway(presence, event.at);
  let next: Presence;
  switch (event.type) {
    case 'hidden': next = {...presence, hidden: true}; break;
    case 'blur': next = {...presence, blurred: true}; break;
    // Coming back to the tab or the window is input too: an idle spell ends with it.
    case 'visible': next = {...presence, hidden: false, lastInput: event.at, idle: false}; break;
    case 'focus': next = {...presence, blurred: false, lastInput: event.at, idle: false}; break;
    case 'input': next = {...presence, lastInput: event.at, idle: false}; break;
    case 'tick': next = idleAt(presence, event.at) === presence.idle ? presence : {...presence, idle: true}; break;
  }
  return {presence: next, arrival: away && !isAway(next, event.at)};
}
