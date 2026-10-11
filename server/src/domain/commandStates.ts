// The command layer's states (after mantel's `control`; DESIGN.md › Interaction rules). A change is
// pending until its provider confirms it; otherwise it fails with the provider's own message and
// stays failed, in place, until the user tries again or moves it back. Nothing quietly reverts: a
// failure never undoes the change by itself, and only Move back does.
import type {CommandState} from '@setpoint/shared';

export const COMMAND_EVENTS = ['confirm', 'fail', 'retry', 'move_back'] as const;
export type CommandEvent = (typeof COMMAND_EVENTS)[number];

/** Pending and failed commands are active: one per target at a time. */
export const isActive = (state: CommandState) => state === 'pending' || state === 'failed';

/**
 * The next state, or null when the event doesn't apply in this state (a refused transition):
 *
 * | from      | confirm   | fail   | retry   | move_back |
 * | pending   | confirmed | failed | –       | –         |
 * | failed    | –         | –      | pending | reverted  |
 * | confirmed | –         | –      | –       | –         |
 * | reverted  | –         | –      | –       | –         |
 *
 * A confirmation that arrives after a failure (a slow provider answering a timed-out request) is
 * refused here; the next sync brings the provider's truth. Move back restores what the mirror held
 * before the change: the failed card's Move back on a calendar item (board 19b), and the way out of
 * any other failed change (a failed Trash goes back to the Inbox).
 */
export function nextCommandState(state: CommandState, event: CommandEvent): CommandState | null {
  switch (state) {
    case 'pending':
      return event === 'confirm' ? 'confirmed' : event === 'fail' ? 'failed' : null;
    case 'failed':
      return event === 'retry' ? 'pending' : event === 'move_back' ? 'reverted' : null;
    case 'confirmed':
    case 'reverted':
      return null;
  }
}
