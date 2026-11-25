// The phone's mail title menu, the same on the Inbox, Sent, Drafts and Snoozed (logic/mailMenu.ts
// has its rows), with the sidebar's counts. A view goes to the Inbox in it, or switches the Inbox's
// own; Settings opens Settings' index.
import type {DraftsOut, MailCountsOut, SnoozedOut} from '@setpoint/shared';
import {useResource} from '../../api/client.ts';
import {DRAFTS_PATH} from '../../api/drafts.ts';
import {COUNTS_PATH, SNOOZED_PATH} from '../../api/mail.ts';
import {mailMenu} from '../../logic/mailMenu.ts';
import type {MailHere} from '../../logic/mailMenu.ts';
import type {InboxView} from '../../logic/route.ts';
import {scheduledAt} from '../../logic/selection.ts';
import {useNow} from '../clock.ts';
import {navigate} from '../router.ts';
import type {TitleMenuRow} from './TitleMenu.tsx';

/** Where the menu is open, and on the Inbox its own counts and switch. */
export type MailPlace = MailHere & ({page: 'inbox'; unread: number; attention: number; onView: (view: InboxView) => void} | {page: 'sent' | 'drafts' | 'snoozed'});

/** The menu's rows for the place. */
export function useMailMenu(place: MailPlace): TitleMenuRow[] {
  const now = useNow();
  const {data: counts} = useResource<MailCountsOut>(COUNTS_PATH);
  const {data: drafts} = useResource<DraftsOut>(DRAFTS_PATH);
  const {data: snoozed} = useResource<SnoozedOut>(SNOOZED_PATH);
  // Drafts counts what's being written: a draft scheduled to send is Scheduled's, on the desktop.
  const writing = drafts?.drafts.filter(row => !scheduledAt(row, now)).length ?? 0;
  const groups = mailMenu(place, {
    unread: place.page === 'inbox' ? place.unread : counts?.unread ?? 0,
    attention: place.page === 'inbox' ? place.attention : counts?.attention ?? 0,
    drafts: writing,
    snoozed: snoozed?.rows.length ?? 0,
  });
  return groups.flatMap((group, index): TitleMenuRow[] => [...(index ? ['divider' as const] : []), ...group.map(({label, go, count, checked}): TitleMenuRow => ({
    label, ...(count !== undefined ? {count} : {}),
    ...(go.page === 'settings' ? {command: true} : {checked}),
    onChoose: () => {
      if (go.page === 'settings') navigate({page: 'settings', section: null});
      else if (go.page === 'inbox') {
        if (place.page === 'inbox') place.onView(go.view);
        else navigate({page: 'inbox', open: null, ...(go.view === 'all' ? {} : {view: go.view})});
      } else navigate({page: go.page, open: null});
    },
  }))]);
}
