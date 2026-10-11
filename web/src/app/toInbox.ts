// Going to the Inbox from elsewhere (D106): Unread while anything waits there, else All, by the
// counts as last loaded (the sidebar keeps them live). Within the Inbox, Unread and All are the user's.
import type {MailCountsOut} from '@setpoint/shared';
import {getCached} from '../api/client.ts';
import {COUNTS_PATH} from '../api/mail.ts';
import {arrivalView} from '../logic/inbox.ts';
import type {Route} from '../logic/route.ts';

export const toInbox = (account: number | null = null): Route => ({page: 'inbox', view: arrivalView(getCached<MailCountsOut>(COUNTS_PATH), account), account, open: null});
