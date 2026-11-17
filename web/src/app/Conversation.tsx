// The reader's conversation list: the open email's thread as a timeline, under its body.
// What it holds and how it folds is logic/reader.ts › conversationLines.
import type {MessageOut} from '@setpoint/shared';
import {useState} from 'react';
import {fullTimestamp} from '../logic/format.ts';
import {conversationLines} from '../logic/reader.ts';
import type {ConversationRow} from '../logic/reader.ts';
import {Icon} from '../ui/Icon.tsx';

/**
 * Every email of the open email's thread, under its body: one row each, oldest first, with its date
 * and clock time in columns of their own, who sent it ("You" for the user) and its first words. The open email is a row too, in its
 * place, marked with the accent bar and reading "This email"; a click on any other row opens that
 * email. The heading counts them all. A long run of earlier emails folds behind one line, keeping
 * the nearest in view.
 */
export function Conversation({message, timeZone, onOpen}: {message: MessageOut; timeZone: string; onOpen: (id: number, sent: boolean) => void}) {
  const [unfolded, setUnfolded] = useState(false);
  const view = conversationLines(message, unfolded, timeZone);
  if (!view) return null;
  const parts = (row: ConversationRow) => (
    <>
      <span className="day num">{row.day}</span>
      <span className="time num" data-tip={fullTimestamp(row.received_at, timeZone)} data-tip-quick>{row.time}</span>
      <span className="who" data-tip={row.address ?? undefined} data-tip-quick>{row.who}</span>
      <span className="words">{row.words}</span>
    </>
  );
  return (
    <section className="rd-conv" aria-label={view.heading}>
      <h2 className="rd-conv-h">{view.heading}<span className="num">{view.count}</span></h2>
      {view.folded > 0 && (
        <button type="button" className="rd-conv-line more" onClick={() => setUnfolded(true)}>
          <Icon name="expand_more" size={16} />{view.folded} more
        </button>
      )}
      {view.rows.map(row => (row.current
        ? <div key={row.id} className="rd-conv-line here" aria-current="true">{parts(row)}</div>
        : <button key={row.id} type="button" className={row.sent ? 'rd-conv-line you' : 'rd-conv-line'} onClick={() => onOpen(row.id, row.sent)}>{parts(row)}</button>))}
    </section>
  );
}
