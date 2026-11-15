// Who a sent email went to, in the sender's place on its row: "To Sam Ortiz +2", the count kept
// whole while a long name is cut (logic/sent.ts). Sent's list and search's results draw it.
import type {Recipient} from '@setpoint/shared';
import {recipientLine, recipientText} from '../logic/sent.ts';

export function SentFrom({to, cc}: {to: Recipient[] | null | undefined; cc: Recipient[] | null | undefined}) {
  const line = recipientLine(to, cc);
  return (
    <span className={line.known ? 'from to' : 'from to unknown'} aria-label={recipientText(line)} data-tip={line.tip ?? undefined}>
      {line.lead && <span className="lead">{line.lead}</span>}
      <span className="who">{line.name}</span>
      {line.more > 0 && <span className="more num">+{line.more}</span>}
    </span>
  );
}
