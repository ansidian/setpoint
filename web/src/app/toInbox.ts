// Going to the Inbox from elsewhere: one list since SV-70, so always the same place (D264).
import type {Route} from '../logic/route.ts';

export const toInbox = (account: number | null = null): Route => ({page: 'inbox', account, open: null});
