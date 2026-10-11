// Reading Gmail's history records (harvested from v1's gmailHistoryProjection, see SV-3): which
// messages arrived in the inbox, and which changed in a way the mirror shows (read, trash, inbox,
// spam, deleted). The mirror then reads each changed message's current labels rather than
// replaying events in order, so a burst of changes settles on Gmail's state, not on the last event.
import type {ProviderState} from '../../sync/mailMirror.ts';
import type {GmailHistoryEvent, GmailHistoryRecord} from './api.ts';

// Labels whose change the mirror shows.
const WATCHED = ['UNREAD', 'TRASH', 'INBOX', 'SPAM'];

/** An event's labels: its own list, or else the message's (v1: Gmail sends either). */
const eventLabels = (event: GmailHistoryEvent) => event.labelIds ?? event.message?.labelIds ?? [];

export interface HistoryChanges {
  // Arrived in the inbox (new mail, or moved back to it): fetched whole if the record lacks it.
  arrived: Set<string>;
  // Changed read, trash, inbox or spam state, or was deleted: re-read for its labels.
  changed: Set<string>;
}

export function historyChanges(records: GmailHistoryRecord[]): HistoryChanges {
  const arrived = new Set<string>();
  const changed = new Set<string>();
  for (const record of records) {
    for (const event of record.messagesAdded ?? []) {
      if (event.message?.id && event.message.labelIds?.includes('INBOX')) arrived.add(event.message.id);
    }
    for (const event of record.labelsAdded ?? []) {
      const id = event.message?.id;
      if (!id) continue;
      if (eventLabels(event).includes('INBOX')) arrived.add(id);
      if (eventLabels(event).some(label => WATCHED.includes(label))) changed.add(id);
    }
    for (const event of record.labelsRemoved ?? []) {
      const id = event.message?.id;
      if (id && eventLabels(event).some(label => WATCHED.includes(label))) changed.add(id);
    }
    for (const event of record.messagesDeleted ?? []) if (event.message?.id) changed.add(event.message.id);
  }
  return {arrived, changed};
}

/** A message's state from its labels: unread, in the trash, or out of the inbox (archived or spam). */
export function stateFromLabels(labels: string[] = []): ProviderState {
  const trashed = labels.includes('TRASH');
  return {unread: labels.includes('UNREAD'), trashed, archived: !trashed && (!labels.includes('INBOX') || labels.includes('SPAM'))};
}
