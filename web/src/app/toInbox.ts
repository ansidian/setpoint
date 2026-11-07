// Going to the Inbox from elsewhere: one list since SV-70, so always the same place (D264).
import type {Route} from '../logic/route.ts';

export const toInbox = (): Route => ({page: 'inbox', open: null});
