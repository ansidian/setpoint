// An email's actions, one list for ⌘K's This email (board 20), the reader's More (its proposals on
// Security and Noise mail) and the right-click menu on its row (DESIGN.md #248), so they can't
// drift. ⌘K's order: Done H (Attention mail not yet Done, #93), Trash E, Pin or Unpin P, Open in
// Gmail O (Gmail's mail), Add to calendar, Add as task, Ask about this email, Mark unread ⇧U. The
// menu leads with Open ↵, offers Mark read on an unread row in Mark unread's place, and ends with
// its Copy items: the sender's address and a code row's code.
import type {ItemKind, MessageRowOut} from '@setpoint/shared';
import {readerActions} from '../logic/reader.ts';
import {selectionOffers} from '../logic/selection.ts';
import {copyText} from './ContextMenu.tsx';
import type {MenuAction} from './ContextMenu.tsx';

export interface EmailHandlers {
  done: () => void;
  trash: () => void;
  pin: () => void;
  openInGmail: () => void;
  propose: (kind: ItemKind) => void;
  ask: () => void;
  markUnread: () => void;
  // The menu's own: Open, and Mark read on an unread row.
  open?: () => void;
  markRead?: () => void;
}

/** `gmail`: whether its account is Gmail's (false hides Open in Gmail, as null does until it's known). */
export function emailActions(row: MessageRowOut, gmail: boolean | null, on: EmailHandlers, where: 'menu' | 'palette'): MenuAction[] {
  const menu = where === 'menu';
  const unread = menu && row.unread && on.markRead;
  return [
    ...(menu && on.open ? [{id: 'open', group: 'open', label: 'Open', icon: 'mail', hint: '↵', run: on.open} satisfies MenuAction] : []),
    ...(readerActions(row).done ? [{id: 'done', group: 'act', label: 'Done', icon: 'check', hint: 'H', run: on.done} satisfies MenuAction] : []),
    {id: 'trash', group: 'act', label: 'Trash', icon: 'delete', hint: 'E', danger: menu, run: on.trash},
    {id: 'pin', group: 'act', label: row.pinned ? 'Unpin' : 'Pin', icon: row.pinned ? 'keep_off' : 'keep', hint: 'P', run: on.pin},
    ...(gmail ? [{id: 'gmail', group: 'act', label: 'Open in Gmail', icon: 'open_in_new', hint: 'O', run: on.openInGmail} satisfies MenuAction] : []),
    {id: 'event', group: 'make', label: 'Add to calendar', icon: 'event', run: () => on.propose('event')},
    {id: 'task', group: 'make', label: 'Add as task', icon: 'task_alt', run: () => on.propose('task')},
    {id: 'ask', group: 'make', label: 'Ask about this email', icon: 'auto_awesome', keywords: 'alfred', run: on.ask},
    unread
      ? {id: 'read', group: menu ? 'read' : 'make', label: 'Mark read', icon: 'mark_email_read', run: on.markRead!}
      : {id: 'unread', group: menu ? 'read' : 'make', label: 'Mark unread', icon: 'mark_email_unread', hint: '⇧U', run: on.markUnread},
    ...(menu ? [
      {id: 'copy-address', group: 'copy', label: 'Copy sender address', icon: 'alternate_email', run: () => copyText(row.from_address)} satisfies MenuAction,
      ...(row.code ? [{id: 'copy-code', group: 'copy', label: 'Copy code', icon: 'content_copy', run: () => copyText(row.code!.value)} satisfies MenuAction] : []),
    ] : []),
  ];
}

export interface SelectionHandlers {
  done: () => void;
  trash: () => void;
  pin: () => void;
  markRead: () => void;
  markUnread: () => void;
  clear: () => void;
}

/**
 * A selection's actions (DESIGN.md #249), for its right-click menu and ⌘K, as its pane's tools: Done H
 * for the emails that can be ("Done 2" when not all of them), Trash E, Pin or Unpin P, Mark read or
 * Mark unread ⇧U, Clear selection. Nothing that's one email's only.
 */
export function selectionActions(rows: MessageRowOut[], on: SelectionHandlers, where: 'menu' | 'palette'): MenuAction[] {
  const offer = selectionOffers(rows);
  return [
    ...(offer.done ? [{id: 'done', group: 'act', label: offer.done === rows.length ? 'Done' : `Done ${offer.done}`, icon: 'check', hint: 'H', run: on.done} satisfies MenuAction] : []),
    {id: 'trash', group: 'act', label: 'Trash', icon: 'delete', hint: 'E', danger: where === 'menu', run: on.trash},
    {id: 'pin', group: 'act', label: offer.pin ? 'Pin' : 'Unpin', icon: offer.pin ? 'keep' : 'keep_off', hint: 'P', run: on.pin},
    offer.read
      ? {id: 'read', group: 'read', label: 'Mark read', icon: 'mark_email_read', run: on.markRead}
      : {id: 'unread', group: 'read', label: 'Mark unread', icon: 'mark_email_unread', hint: '⇧U', run: on.markUnread},
    {id: 'clear', group: 'clear', label: 'Clear selection', icon: 'close', hint: 'Esc', run: on.clear},
  ];
}
