// The phone reader's bottom bar: Done on Attention mail not yet Done, else Trash, then Reply and
// More, which act on the whole conversation; Reply, Reply all and Forward answer its newest email
// someone else sent, as the stack's foot does. More opens a bottom sheet of the rest, one row each: Reply all (when the email has others to
// reply to), Forward, Snooze (received mail not snoozed) or Snoozed with its return (a snoozed email,
// whose sheet changes the time or ends it), Find in email, Add to calendar, Add as task, Trash (when
// Done leads), and Mark read or Mark unread (not on sent mail). Open in Gmail stays on the desktop:
// on the phone it would leave Setpoint for Gmail's site. A row is an entry in `moreRows`'s list, so
// another action is one more entry there, its glyph in its action's colour as the swipe tray and the
// toasts have it (Snooze `violet`, Trash `alert`, read state `accent`), the rest `ink3`. Snooze's row
// opens Snooze's own sheet (SnoozeSheet.tsx) as More's closes.
import {useState} from 'react';
import {Icon} from '../../ui/Icon.tsx';
import type {IconName} from '../../ui/glyphs.ts';
import {BottomSheet, SheetChoice} from './BottomSheet.tsx';
import type {SheetTone} from './BottomSheet.tsx';
import {SnoozeSheet} from './SnoozeSheet.tsx';

/** What the email offers, as the reader knows it. */
export interface ReaderBarEmail {
  doneable: boolean;
  replyAll: boolean;
  // Marked unread here: More offers Mark read.
  markedUnread: boolean;
  // Sent mail: no read state to change.
  sent: boolean;
  // Received mail not snoozed already.
  snoozeable: boolean;
  // A snoozed email's return, where the page can change or end it, and how it reads ("Mon 9:00 AM").
  snoozed: {until: string; when: string} | null;
}

export interface ReaderBarActions {
  done: () => void;
  trash: () => void;
  reply: () => void;
  replyAll: () => void;
  forward: () => void;
  toggleRead: () => void;
  // Snooze until a moment (ms), or a snoozed email's new moment.
  snooze: (until: number) => void;
  // Ends a snoozed email's snooze.
  unsnooze: () => void;
  // The editor's sheet, filled from the email.
  addEvent: () => void;
  addTask: () => void;
  // Find in email, at the top of the reader (search/FindBar.tsx).
  find: () => void;
}

export interface MoreRow {
  icon: IconName;
  tone: SheetTone;
  label: string;
  detail?: string;
  run: () => void;
}

/** More's rows, in their order, for this email. Snooze's row runs `openSnooze`, which puts its sheet up. */
export function moreRows(email: ReaderBarEmail, on: ReaderBarActions, openSnooze: () => void): MoreRow[] {
  const rows: (MoreRow | false)[] = [
    email.replyAll && {icon: 'reply_all', tone: 'ink3', label: 'Reply all', run: on.replyAll},
    {icon: 'forward', tone: 'ink3', label: 'Forward', run: on.forward},
    email.snoozeable && {icon: 'snooze', tone: 'violet', label: 'Snooze', run: openSnooze},
    !!email.snoozed && {icon: 'snooze', tone: 'violet', label: 'Snoozed', detail: email.snoozed!.when, run: openSnooze},
    {icon: 'search', tone: 'ink3', label: 'Find in email', run: on.find},
    {icon: 'event', tone: 'ink3', label: 'Add to calendar', run: on.addEvent},
    {icon: 'task_alt', tone: 'ink3', label: 'Add as task', run: on.addTask},
    email.doneable && {icon: 'delete', tone: 'alert', label: 'Trash', run: on.trash},
    !email.sent && (email.markedUnread
      ? {icon: 'mark_email_read', tone: 'accent', label: 'Mark read', run: on.toggleRead}
      : {icon: 'mark_email_unread', tone: 'accent', label: 'Mark unread', run: on.toggleRead}),
  ];
  return rows.filter(row => row !== false);
}

/** What one email of the conversation offers in its own ••• sheet, as the reader knows it. */
export interface EmailSheetActions {
  reply: () => void;
  // Only when the email has others to reply to.
  replyAll: (() => void) | null;
  forward: () => void;
  addEvent: () => void;
  addTask: () => void;
}

/** An expanded email's own sheet, in its order: Reply, Reply all, Forward, Add to calendar, Add as task. */
export function emailRows(on: EmailSheetActions): MoreRow[] {
  const rows: (MoreRow | false)[] = [
    {icon: 'reply', tone: 'ink3', label: 'Reply', run: on.reply},
    !!on.replyAll && {icon: 'reply_all', tone: 'ink3', label: 'Reply all', run: on.replyAll},
    {icon: 'forward', tone: 'ink3', label: 'Forward', run: on.forward},
    {icon: 'event', tone: 'ink3', label: 'Add to calendar', run: on.addEvent},
    {icon: 'task_alt', tone: 'ink3', label: 'Add as task', run: on.addTask},
  ];
  return rows.filter(row => row !== false);
}

/** An expanded email's ••• on the phone, and its sheet while it's open, titled with who sent it. */
export function EmailSheetButton({from, on}: {from: string; on: EmailSheetActions}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="ibtn ph-icon" type="button" aria-label="More" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}><Icon name="more_horiz" size={20} /></button>
      {open && (
        <BottomSheet title={from} onClose={() => setOpen(false)}>
          {emailRows(on).map(row => <SheetChoice key={row.label} icon={row.icon} tone={row.tone} label={row.label} onChoose={row.run} />)}
        </BottomSheet>
      )}
    </>
  );
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
          {moreRows(email, on, () => setSnoozing(true)).map(row => <SheetChoice key={row.label} icon={row.icon} tone={row.tone} label={row.label} detail={row.detail} onChoose={row.run} />)}
        </BottomSheet>
      )}
      {snoozing && <SnoozeSheet onPick={on.snooze} snoozed={email.snoozed ? {until: email.snoozed.until, onUnsnooze: on.unsnooze} : undefined} onClose={() => setSnoozing(false)} />}
    </>
  );
}
