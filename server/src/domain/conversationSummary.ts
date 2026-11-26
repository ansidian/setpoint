// When a conversation's own summary is due, for the reader's head. It is written from the emails
// triage summed up: received, sorted, not trashed, with a summary. A conversation of fewer than two
// such emails has none (its row's summary says it). While one of its received emails is still
// Unsorted, it waits for that email's summary. Otherwise the stored summary is fresh when it covers
// the newest of them, and due when it covers an older one or there is none. One rule for the writer
// and the reader, so the head never shows a summary the writer would write again.

export interface SummaryEmail {
  id: number;
  receivedAt: string;
  received: boolean;
  // Sorted by triage (it has a lane).
  sorted: boolean;
  trashed: boolean;
  // The USPS digest, which triage never sorts.
  uspsDigest: boolean;
  summary: string | null;
}

export type SummaryState = 'none' | 'wait' | 'due' | 'fresh';

const before = (a: SummaryEmail, b: SummaryEmail) => a.receivedAt < b.receivedAt || (a.receivedAt === b.receivedAt && a.id < b.id);

/** The emails a conversation's summary is written from, oldest first. */
export function summaryEmails<T extends SummaryEmail>(emails: T[]): T[] {
  return emails.filter(email => email.received && email.sorted && !email.trashed && !email.uspsDigest && email.summary !== null)
    .sort((a, b) => (before(a, b) ? -1 : 1));
}

/** Whether a conversation's summary is due, given the newest email the stored one covers (null for none). */
export function summaryState(emails: SummaryEmail[], coveredId: number | null): SummaryState {
  const lines = summaryEmails(emails);
  if (lines.length < 2) return 'none';
  if (emails.some(email => email.received && !email.sorted && !email.trashed && !email.uspsDigest)) return 'wait';
  return lines.at(-1)!.id === coveredId ? 'fresh' : 'due';
}
