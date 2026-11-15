// The reader's conversation list: the other emails of the open email's thread, under its body.
// What it holds and how it folds is logic/reader.ts › conversationLines.
import type {ConversationEmailOut, MessageOut} from '@setpoint/shared';
import {useState} from 'react';
import {age, fullTimestamp} from '../logic/format.ts';
import {conversationLines} from '../logic/reader.ts';
import {Icon} from '../ui/Icon.tsx';

/**
 * The other emails of its thread, under the body: one line each, oldest first, with who sent it
 * ("You" for the user), its first words and its age. A click opens that email. The heading says where
 * they sit: all earlier, all later, or both, with this email's place marked between. A long run of
 * earlier emails folds behind one line, keeping the nearest in view.
 */
export function Conversation({message, now, timeZone, onOpen}: {message: MessageOut; now: number; timeZone: string; onOpen: (id: number) => void}) {
  const [unfolded, setUnfolded] = useState(false);
  const view = conversationLines(message, unfolded);
  if (!view) return null;
  const line = (email: ConversationEmailOut) => (
    <button key={email.id} type="button" className={email.sent ? 'rd-conv-line you' : 'rd-conv-line'} onClick={() => onOpen(email.id)}>
      <span className="who" data-tip={email.sent ? undefined : email.from_address} data-tip-quick>{email.sent ? 'You' : email.from_name}</span>
      <span className="words">{email.excerpt || email.subject}</span>
      <span className="age num" data-tip={fullTimestamp(email.received_at, timeZone)} data-tip-quick>{age(email.received_at, now, timeZone)}</span>
    </button>
  );
  return (
    <section className="rd-conv" aria-label={view.heading}>
      <h2 className="rd-conv-h">{view.heading}</h2>
      {view.folded > 0 && (
        <button type="button" className="rd-conv-line more" onClick={() => setUnfolded(true)}>
          <span className="who"><Icon name="expand_more" size={16} />{view.folded} more</span>
        </button>
      )}
      {view.earlier.map(line)}
      {view.marked && <div className="rd-conv-line here" aria-current="true"><span className="who">This email</span></div>}
      {view.later.map(line)}
    </section>
  );
}
