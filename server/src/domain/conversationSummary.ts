// When a conversation's own summary is due, for the reader's head. It is written from the emails
// triage summed up: received, sorted, not trashed, with a summary. A conversation of fewer than two
// such emails has none (its row's summary says it). While one of its received emails is still
// Unsorted, it waits for that email's summary. Otherwise the stored summary is fresh when it covers
// the newest of them, and due when it covers an older one or there is none. One rule for the writer
// and the reader, so the head never shows a summary the writer would write again.
//
// What the head shows (`headSummary`): the summary while fresh. While it's due, a skeleton (pending)
// only while a rewrite is coming: an email is still Unsorted, or the newest was triaged in the last
// few minutes and its call hasn't failed. Otherwise the newest summed-up email's own summary stands
// in (fallback), with why when its call failed or triage can't call (down, or the budget spent). A
// conversation summed up before summaries were written, or whose newest email went to the Trash,
// gets no rewrite and no why.
import type {ConversationSummaryOut, SummaryFailureCause} from '@setpoint/shared';

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
  // When triage sorted it (null for mail sorted before that was kept).
  triagedAt?: string | null;
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

/** How long after triage sorts the newest email its conversation's rewrite counts as coming (a call's own timeout is 2 min). */
export const PENDING_MS = 5 * 60_000;

export interface SummaryFailure {
  cause: SummaryFailureCause;
  status: number | null;
}

/** A failed call's cause from its HTTP status (null: no answer). */
export function failureOf(status: number | null): SummaryFailure {
  if (status === null) return {cause: 'unreachable', status: null};
  return {cause: status === 429 ? 'limited' : status >= 500 ? 'down' : 'refused', status};
}

export interface StoredSummary {
  // The summary and the newest email it covers, null while none was written.
  summary: string | null;
  coveredId: number | null;
  // The last call that failed, and the newest email it was for.
  failure: (SummaryFailure & {messageId: number}) | null;
}

/** What the reader's head shows for a conversation, null when it has no summary of its own to show. */
export function headSummary(emails: SummaryEmail[], stored: StoredSummary | null, {triageDown, budgetSpent, now}: {triageDown: boolean; budgetSpent: boolean; now: string}): ConversationSummaryOut | null {
  const state = summaryState(emails, stored?.coveredId ?? null);
  if (state === 'none') return null;
  if (state === 'fresh') return {state: 'fresh', text: stored!.summary!};
  const newest = summaryEmails(emails).at(-1)!;
  const fallback = (failure: SummaryFailure | null): ConversationSummaryOut => ({state: 'fallback', text: newest.summary!, email_id: newest.id, failure});
  if (triageDown) return fallback({cause: 'triage_down', status: null});
  if (budgetSpent) return fallback({cause: 'budget', status: null});
  if (state === 'wait') return {state: 'pending'};
  if (stored?.failure?.messageId === newest.id) return fallback({cause: stored.failure.cause, status: stored.failure.status});
  const since = Date.parse(now) - Date.parse(newest.triagedAt ?? '');
  return since >= 0 && since < PENDING_MS ? {state: 'pending'} : fallback(null);
}
