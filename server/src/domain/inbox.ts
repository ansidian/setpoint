// The Inbox is a view of state. Attention mail stays until Done, read or not. FYI and Noise stay
// until read, from any day. Unsorted mail stays while triage hasn't sorted it. Pinned mail stays
// until unpinned, whatever its lane or read state. Trashed mail is out of every view, Done mail is
// out of the Inbox, and a code's row leaves at its expiry. Mail archived at its provider (Gmail's
// Archive, moved out of iCloud's INBOX) also leaves the Inbox, because it was handled there and
// providers are the truth (All and search still show it). Snoozed mail is out of the Inbox, the
// Pinned shelf and the counts until it returns, when it sorts by its return time.
import {INBOX_GROUPS, markAllReadReads} from '@setpoint/shared';
import type {InboxGroup, Kind, Lane} from '@setpoint/shared';

export interface InboxCandidate {
  id: number;
  accountId: number;
  lane: Lane | null;
  kind: Kind | null;
  unread: boolean;
  receivedAt: string;
  organisation: string | null;
  fromName: string;
  pinnedAt: string | null;
  doneAt: string | null;
  trashedAt: string | null;
  codeExpiresAt: string | null;
  // Left the provider's inbox without Setpoint.
  archivedAt?: string | null;
  // A change to it failed. It stays where it was, failed in place, until Try again or Move back
  // (a failed Trash or Mark read must not look like it worked).
  held?: boolean;
  // Snoozed until then: out of the Inbox until it returns, whatever the time says.
  snoozedUntil?: string | null;
  // When it last returned from a snooze. Its group sorts it by then rather than by its arrival.
  returnedAt?: string | null;
}

const snoozed = (message: Pick<InboxCandidate, 'snoozedUntil' | 'held'>) => !!message.snoozedUntil && !message.held;

const FYI_GROUPS: Record<Kind, InboxGroup> = {
  security: 'security', deliveries: 'deliveries', money: 'money', career: 'career', people: 'people', updates: 'updates', other: 'other',
};

/** The lane group an email belongs to, if it's in the Inbox at all (the Pinned shelf aside). */
export function laneGroup(message: InboxCandidate, now: string): InboxGroup | null {
  if (message.doneAt || ((message.trashedAt || message.archivedAt) && !message.held) || snoozed(message)) return null;
  if (message.codeExpiresAt !== null && message.codeExpiresAt <= now) return null;
  if (message.lane === null) return 'unsorted';
  if (message.lane === 'attention') return 'attention';
  if (!message.unread && !message.held) return null;
  if (message.lane === 'noise') return 'noise';
  return FYI_GROUPS[message.kind ?? 'other'];
}

export interface Group<T> {
  group: InboxGroup;
  rows: T[];
  unread: number;
}

/**
 * The groups in INBOX_GROUPS's order, empty ones left out. A pinned email is on the shelf and also in
 * its group, so the shelf never hides it from where it belongs. Every group starts expanded, and
 * the list keeps what the user collapses.
 */
export function inboxGroups<T extends InboxCandidate>(messages: T[], now: string): Group<T>[] {
  const byGroup = new Map<InboxGroup, T[]>();
  const add = (group: InboxGroup, message: T) => byGroup.set(group, [...(byGroup.get(group) ?? []), message]);
  // A returned email sorts by its return, so it comes back at the top of its group.
  const sortAt = (message: T) => message.returnedAt ?? message.receivedAt;
  const newest = (a: T, b: T) => sortAt(b).localeCompare(sortAt(a)) || b.id - a.id;
  for (const message of [...messages].sort(newest)) {
    const group = laneGroup(message, now);
    if (group) add(group, message);
  }
  const pinned = messages.filter(message => message.pinnedAt && (!message.trashedAt || message.held) && !snoozed(message))
    .sort((a, b) => b.pinnedAt!.localeCompare(a.pinnedAt!) || b.id - a.id);
  if (pinned.length) byGroup.set('pinned', pinned);
  return INBOX_GROUPS.flatMap(group => {
    const rows = byGroup.get(group);
    if (!rows?.length) return [];
    return [{group, rows, unread: rows.filter(row => row.unread).length}];
  });
}

export interface Counts {
  attention: number;
  unread: number;
  unreadFyi: number;
  byAccount: Map<number, number>;
}

/**
 * The counts the Inbox shows: attention not Done, read or not (the pill), every unread email in the
 * Inbox (Noise included), unread FYI, and unread per account. Opening drops the unread counts. Only
 * Done drops the pill.
 */
export function inboxCounts(messages: InboxCandidate[], now: string): Counts {
  const counts: Counts = {attention: 0, unread: 0, unreadFyi: 0, byAccount: new Map()};
  for (const message of messages) {
    const group = laneGroup(message, now);
    if (!group) continue;
    if (group === 'attention') counts.attention += 1;
    if (!message.unread) continue;
    counts.unread += 1;
    if (message.lane === 'fyi') counts.unreadFyi += 1;
    counts.byAccount.set(message.accountId, (counts.byAccount.get(message.accountId) ?? 0) + 1);
  }
  return counts;
}

/** The next moment the Inbox changes by itself: a code's row expiring. */
export function nextInboxChange(messages: InboxCandidate[], now: string): string | null {
  const next = messages
    .filter(message => laneGroup(message, now) && message.codeExpiresAt !== null && message.codeExpiresAt > now)
    .map(message => message.codeExpiresAt!).sort()[0];
  return next ?? null;
}

/**
 * Mark all as read's emails: every unread email outside Attention and Security, Noise included.
 * Attention mail not yet Done keeps its read state, and so does Security, so a live code or a
 * sign-in alert isn't swept away with the newsletters. Trashed, archived and snoozed mail, which the
 * Inbox doesn't show, isn't touched.
 */
export function markAllReadTargets<T extends Pick<InboxCandidate, 'unread' | 'trashedAt' | 'archivedAt' | 'lane' | 'doneAt' | 'kind' | 'snoozedUntil'>>(messages: T[]): T[] {
  return messages.filter(message => !message.trashedAt && !message.archivedAt && !message.snoozedUntil
    && markAllReadReads({unread: message.unread, lane: message.lane, kind: message.kind, done: message.doneAt !== null}));
}

/** What the Inbox's empty pane counts from one email. */
export interface DayCandidate extends InboxCandidate {
  triagedAt: string | null;
  triageSource: string | null;
}

export interface MailDay {
  done: number;
  needYou: number;
  overdue: number;
  sortedFyi: number;
  sortedNoise: number;
}

const OVERDUE_MS = 24 * 60 * 60 * 1000;

/**
 * How the mail day is going since `dayStart` (the user's midnight). It counts Done today. It counts
 * what needs the user (Attention not Done, the attention pill's number), and how much of that has
 * waited over 24 hours since arriving, or since returning from a snooze. It counts what triage sorted today out of Attention, to FYI
 * and to Noise. The pass over backfilled history isn't today's sorting, and trashed mail counts
 * nowhere.
 */
export function mailDay(messages: DayCandidate[], now: string, dayStart: string): MailDay {
  const day: MailDay = {done: 0, needYou: 0, overdue: 0, sortedFyi: 0, sortedNoise: 0};
  const overdueBefore = new Date(Date.parse(now) - OVERDUE_MS).toISOString();
  for (const message of messages) {
    if (message.trashedAt && !message.held) continue;
    if (message.doneAt && message.doneAt >= dayStart) day.done += 1;
    if (laneGroup(message, now) === 'attention') {
      day.needYou += 1;
      if ((message.returnedAt ?? message.receivedAt) < overdueBefore) day.overdue += 1;
    }
    if (message.triagedAt && message.triagedAt >= dayStart && message.triageSource !== 'history') {
      if (message.lane === 'fyi') day.sortedFyi += 1;
      else if (message.lane === 'noise') day.sortedNoise += 1;
    }
  }
  return day;
}
