// The phone's mail title menu (app/phone/mailMenu.ts draws it): the Inbox's five views, Unread and
// Attention with their counts, then Sent, Drafts and Snoozed as the desktop's sidebar lists them
// (Drafts while a draft waits and Snoozed while an email is snoozed, each with its count, and either
// while it's the page showing), then Settings. The place showing is checked.
import {INBOX_VIEWS} from './route.ts';
import type {InboxView} from './route.ts';

export type MailList = 'sent' | 'drafts' | 'snoozed';
/** Where the menu is open: an Inbox view, or one of the lists. */
export type MailHere = {page: 'inbox'; view: InboxView} | {page: MailList};
/** Where a row goes. */
export type MailGo = {page: 'inbox'; view: InboxView} | {page: MailList} | {page: 'settings'};

export interface MailMenuRow {
  label: string;
  go: MailGo;
  count?: number;
  checked?: boolean;
}

export const VIEW_LABELS: Record<InboxView, string> = {all: 'All', unread: 'Unread', attention: 'Attention', fyi: 'FYI', noise: 'Noise'};
const LIST_LABELS: Record<MailList, string> = {sent: 'Sent', drafts: 'Drafts', snoozed: 'Snoozed'};

/** The header's title: the view's name, "Inbox" for All, or the list's. */
export const mailTitle = (here: MailHere) => (here.page === 'inbox' ? (here.view === 'all' ? 'Inbox' : VIEW_LABELS[here.view]) : LIST_LABELS[here.page]);

/** The menu's rows in their groups, the groups apart by dividers. */
export function mailMenu(here: MailHere, counts: {unread: number; attention: number; drafts: number; snoozed: number}): MailMenuRow[][] {
  const counted = (count: number) => (count > 0 ? {count} : {});
  const views = INBOX_VIEWS.map((view): MailMenuRow => ({
    label: VIEW_LABELS[view], go: {page: 'inbox', view}, checked: here.page === 'inbox' && here.view === view,
    ...(view === 'unread' ? counted(counts.unread) : view === 'attention' ? counted(counts.attention) : {}),
  }));
  const list = (page: MailList, count = 0): MailMenuRow => ({label: LIST_LABELS[page], go: {page}, checked: here.page === page, ...counted(count)});
  const lists = [
    list('sent'),
    ...(counts.drafts > 0 || here.page === 'drafts' ? [list('drafts', counts.drafts)] : []),
    ...(counts.snoozed > 0 || here.page === 'snoozed' ? [list('snoozed', counts.snoozed)] : []),
  ];
  return [views, lists, [{label: 'Settings', go: {page: 'settings'}}]];
}
