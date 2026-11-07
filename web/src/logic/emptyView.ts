// An empty Inbox view's words (SV-226): its headline, and one quiet line with something earned.
import {readerTime} from './format.ts';
import type {InboxView} from './route.ts';

export type EmptyInboxView = Exclude<InboxView, 'all'>;

export const EMPTY_HEADLINES: Record<EmptyInboxView, string> = {
  unread: 'All read',
  attention: 'Nothing needs you',
  fyi: 'No FYI mail',
  noise: 'No Noise today',
};

/**
 * The quiet line under the headline, from the list itself so it never repeats the pane beside it: when
 * the last email needing the user came (Attention's newest, Done or not), or the last new email.
 */
export function quietLine(view: EmptyInboxView, newest: string | null, now: number, timeZone: string): string | null {
  if (!newest) return null;
  const at = readerTime(newest, now, timeZone);
  const lead = view === 'attention' ? 'The last one came' : 'Last new email';
  return at.includes(',') ? `${lead} ${at}` : `${lead} at ${at}`;
}
