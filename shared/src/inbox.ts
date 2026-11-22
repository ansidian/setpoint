// Which emails Mark all as read reads. The server picks them by it, and the web marks them read at
// once by it while the server answers.
import type {Kind, Lane} from './enums.ts';

/**
 * Whether Mark all as read reads an email the Inbox shows: unread, outside Attention unless Done
 * (a live code or a reply waiting keeps its dot), and outside Security (a sign-in alert keeps its).
 */
export const markAllReadReads = ({unread, lane, kind, done}: {unread: boolean; lane: Lane | null; kind: Kind | null; done: boolean}): boolean =>
  unread && !(lane === 'attention' && !done) && !(lane === 'fyi' && kind === 'security');
