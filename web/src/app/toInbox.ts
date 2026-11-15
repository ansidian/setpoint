// Going to the Inbox from elsewhere: one list, so always the same place.
import type {Route} from '../logic/route.ts';

export const toInbox = (): Route => ({page: 'inbox', open: null});
