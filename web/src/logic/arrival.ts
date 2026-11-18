// When the user arrives: on a page load, or coming back to the tab or the window. Away is the tab
// hidden or the window without focus; the tab shown or the window focused again ends it. Time alone
// makes no arrival, and nor does a page change inside the app. The overdue banner enters on each
// arrival (app/arrival.ts feeds this the page's events), so it never shows mid-use, and never to
// an empty chair. Pure: no DOM, no timers.

export interface Presence {
  hidden: boolean;
  blurred: boolean;
}

export type PresenceEvent =
  | {type: 'load'; hidden: boolean; focused: boolean; at: number}
  | {type: 'hidden'; at: number}
  | {type: 'visible'; at: number}
  | {type: 'blur'; at: number}
  | {type: 'focus'; at: number};

/** Whether the user is away. */
export const isAway = (presence: Presence): boolean => presence.hidden || presence.blurred;

/**
 * The presence after `event`, and whether it is an arrival: the page loading with the user there,
 * or the user going from away to present.
 */
export function step(presence: Presence | null, event: PresenceEvent): {presence: Presence; arrival: boolean} {
  if (event.type === 'load' || presence === null) {
    const next = event.type === 'load' ? {hidden: event.hidden, blurred: !event.focused} : {hidden: false, blurred: false};
    return {presence: next, arrival: !isAway(next)};
  }
  const away = isAway(presence);
  let next: Presence;
  switch (event.type) {
    case 'hidden': next = {...presence, hidden: true}; break;
    case 'visible': next = {...presence, hidden: false}; break;
    case 'blur': next = {...presence, blurred: true}; break;
    case 'focus': next = {...presence, blurred: false}; break;
  }
  return {presence: next, arrival: away && !isAway(next)};
}
