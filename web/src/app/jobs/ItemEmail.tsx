// A Needs you item's email (DESIGN.md › Needs you, D401): where the detail sits and as wide, so the
// item and its Assign to… stay beside it. The email alone: reading it here turns nothing read and
// changes nothing in mail (D313), and Open in Inbox is the way to everything else mail does with it.
import type {AccountOut} from '@setpoint/shared';
import type {CSSProperties} from 'react';
import {Icon} from '../../ui/Icon.tsx';
import {EmailOnly, PaneEdge} from '../Reader.tsx';
import type {Travel} from '../Reader.tsx';
import {useReadingPaneWidth} from '../readingPane.ts';

export function ItemEmail({id, travel, accounts, now, timeZone, leaving, canStep, onStep, onClose, onInbox}: {
  id: number;
  // How the user stepped to it, for its swap; null for a click.
  travel: Travel | null;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  leaving: boolean;
  canStep: {previous: boolean; next: boolean};
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  onInbox: () => void;
}) {
  const width = useReadingPaneWidth();
  return (
    <section className={leaving ? 'pane jb-pane leaving' : 'pane jb-pane'} aria-label="Email" inert={leaving} style={{'--readingPane': `${width}px`} as CSSProperties}>
      <PaneEdge width={width} />
      <div className="rd-tools">
        <button className="ibtn rd-back" type="button" aria-label="Back" title="Back · Esc" onClick={onClose}><Icon name="arrow_back" /></button>
        <button className="tool" type="button" onClick={onInbox}><Icon name="inbox" />Open in Inbox</button>
        <span className="grow" />
        <button className="ibtn" type="button" aria-label="Previous email" disabled={!canStep.previous} onClick={() => onStep(-1)}><Icon name="keyboard_arrow_up" /></button>
        <button className="ibtn" type="button" aria-label="Next email" disabled={!canStep.next} onClick={() => onStep(1)}><Icon name="keyboard_arrow_down" /></button>
      </div>
      <EmailOnly id={id} travel={travel} accounts={accounts} now={now} timeZone={timeZone} />
    </section>
  );
}
