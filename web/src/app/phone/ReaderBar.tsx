// The phone reader's bottom bar: Done on Attention mail not yet Done, else Trash, then Reply and
// More. More opens a bottom sheet of the rest, one row each: Reply all (when the email has others to
// reply to), Forward, Snooze (received mail not snoozed), Add to calendar, Add as task, Trash (when
// Done leads), Mark read or Mark unread (not on sent mail), and Open in Gmail (Gmail's mail). A row
// is an entry in `moreRows`'s list, so another action is one more entry there. Snooze's row opens
// Snooze's own sheet (SnoozeSheet.tsx) as More's closes.
import {useState} from 'react';
import {Icon} from '../../ui/Icon.tsx';
import type {IconName} from '../../ui/glyphs.ts';
import {BottomSheet, SheetChoice} from './BottomSheet.tsx';
import {SnoozeSheet} from './SnoozeSheet.tsx';

/** What the email offers, as the reader knows it. */
export interface ReaderBarEmail {
  doneable: boolean;
  replyAll: boolean;
  gmail: boolean;
  // Marked unread here: More offers Mark read.
  markedUnread: boolean;
  // Sent mail: no read state to change.
  sent: boolean;
  // Received mail not snoozed already.
  snoozeable: boolean;
}

export interface ReaderBarActions {
  done: () => void;
  trash: () => void;
  reply: () => void;
  replyAll: () => void;
  forward: () => void;
  toggleRead: () => void;
  openInGmail: () => void;
  // Snooze until a moment (ms).
  snooze: (until: number) => void;
  // The editor's sheet, filled from the email.
  addEvent: () => void;
  addTask: () => void;
}

export interface MoreRow {
  icon: IconName;
  label: string;
  run: () => void;
}

/** More's rows, in their order, for this email. Snooze's row runs `openSnooze`, which puts its sheet up. */
export function moreRows(email: ReaderBarEmail, on: ReaderBarActions, openSnooze: () => void): MoreRow[] {
  const rows: (MoreRow | false)[] = [
    email.replyAll && {icon: 'reply_all', label: 'Reply all', run: on.replyAll},
    {icon: 'forward', label: 'Forward', run: on.forward},
    email.snoozeable && {icon: 'snooze', label: 'Snooze', run: openSnooze},
    {icon: 'event', label: 'Add to calendar', run: on.addEvent},
    {icon: 'task_alt', label: 'Add as task', run: on.addTask},
    email.doneable && {icon: 'delete', label: 'Trash', run: on.trash},
    !email.sent && (email.markedUnread ? {icon: 'mark_email_read', label: 'Mark read', run: on.toggleRead} : {icon: 'mark_email_unread', label: 'Mark unread', run: on.toggleRead}),
    email.gmail && {icon: 'open_in_new', label: 'Open in Gmail', run: on.openInGmail},
  ];
  return rows.filter(row => row !== false);
}

/** The bar's three actions, and More's sheet or Snooze's while one is open. */
export function ReaderBar({email, on}: {email: ReaderBarEmail; on: ReaderBarActions}) {
  const [more, setMore] = useState(false);
  const [snoozing, setSnoozing] = useState(false);
  return (
    <>
      {email.doneable
        ? <button className="ph-done" type="button" onClick={on.done}><Icon name="check" size={22} />Done</button>
        : <button className="trash" type="button" onClick={on.trash}><Icon name="delete" size={22} />Trash</button>}
      <button type="button" onClick={on.reply}><Icon name="reply" size={22} />Reply</button>
      <button type="button" aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}><Icon name="more_horiz" size={22} />More</button>
      {more && (
        <BottomSheet title="More" onClose={() => setMore(false)}>
          {moreRows(email, on, () => setSnoozing(true)).map(row => <SheetChoice key={row.label} icon={row.icon} label={row.label} onChoose={row.run} />)}
        </BottomSheet>
      )}
      {snoozing && <SnoozeSheet onPick={on.snooze} onClose={() => setSnoozing(false)} />}
    </>
  );
}
