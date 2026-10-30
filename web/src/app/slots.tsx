// Mail's slots (decision 52, D306): two places mail draws that another module fills, without mail
// knowing which. The reader's head has one under the sender's line and above the actions, and each
// of the Inbox's rows one after its subject. A module fills them once from its wiring point, before
// Setpoint first draws; unfilled, they draw nothing and leave no gap. This file names no module, so it
// stays when one is removed.
import type {MessageRowOut} from '@setpoint/shared';
import type {ComponentType, ReactNode} from 'react';

export interface MailSlots {
  /**
   * A hook the Inbox's list calls once per draw with every row it shows, so a filler can ask about
   * them all in one request rather than one per row. It answers what a row draws after its subject.
   */
  useRows: (rows: readonly MessageRowOut[]) => (row: MessageRowOut) => ReactNode;
  /** What the reader's head draws for the email open. */
  Reader: ComponentType<{row: MessageRowOut}>;
}

const nothing = () => null;
const EMPTY: MailSlots = {useRows: () => nothing, Reader: nothing};
let filled: MailSlots = EMPTY;

/** Fills mail's slots: once, from a wiring point, before Setpoint first draws (so the hook never changes). */
export function fillMailSlots(slots: MailSlots) {
  filled = slots;
}

/** What each of these rows draws after its subject (nothing, unfilled). */
export function useRowSlot(rows: readonly MessageRowOut[]): (row: MessageRowOut) => ReactNode {
  return filled.useRows(rows);
}

/** The reader head's slot, for the email open. */
export function ReaderSlot({row}: {row: MessageRowOut}) {
  const Fill = filled.Reader;
  return <Fill row={row} />;
}
