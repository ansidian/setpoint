// The Inbox is a view of state (decision 6; BRIEF.md › The Inbox; DESIGN.md › The list):
// Attention until Done, read or not; FYI and Noise until read, from any day; Unsorted while triage
// hasn't sorted it; Pinned until unpinned, whatever its lane or read state. Trashed mail is out of
// every view, Done mail out of the Inbox, and a code's row leaves at its expiry. Mail archived at
// its provider (Gmail's Archive, moved out of iCloud's INBOX) leaves the Inbox too: it was handled
// there, and providers are the truth (B2; All and search still show it).
import {INBOX_GROUPS} from '@setpoint/shared';
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
  // A change to it failed: it stays where it was, failed in place, until Try again or Move back
  // (a failed Trash or Mark read must not look like it worked).
  held?: boolean;
}

const FYI_GROUPS: Record<Kind, InboxGroup> = {
  security: 'security', deliveries: 'deliveries', money: 'money', career: 'career', people: 'people', updates: 'updates', other: 'other',
};

/** The lane group an email belongs to, if it's in the Inbox at all (the Pinned shelf aside). */
export function laneGroup(message: InboxCandidate, now: string): InboxGroup | null {
  if (message.doneAt || ((message.trashedAt || message.archivedAt) && !message.held)) return null;
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
 * The groups in DESIGN.md's order, empty ones left out. A pinned email is on the shelf and also in
 * its group, so the shelf never hides it from where it belongs. Every group starts expanded
 * (2026-10-10); the list keeps what the user collapses.
 */
export function inboxGroups<T extends InboxCandidate>(messages: T[], now: string): Group<T>[] {
  const byGroup = new Map<InboxGroup, T[]>();
  const add = (group: InboxGroup, message: T) => byGroup.set(group, [...(byGroup.get(group) ?? []), message]);
  const newest = (a: T, b: T) => b.receivedAt.localeCompare(a.receivedAt) || b.id - a.id;
  for (const message of [...messages].sort(newest)) {
    const group = laneGroup(message, now);
    if (group) add(group, message);
  }
  const pinned = messages.filter(message => message.pinnedAt && (!message.trashedAt || message.held))
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
 * The counts the Inbox shows (decision 48): attention not Done, read or not (the pill); every unread
 * email in the Inbox, Noise included; unread FYI; and unread per account. Opening drops the unread
 * counts; only Done drops the pill.
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
 * Mark all as read's emails: every unread email outside Attention and Security, Noise included
 * (BRIEF.md › The Inbox). Attention mail not yet Done keeps its read state, and so does Security, so
 * a live code or a sign-in alert isn't swept away with the newsletters (UX #4); trashed and archived
 * mail, which the Inbox doesn't show, isn't touched.
 */
export function markAllReadTargets<T extends InboxCandidate>(messages: T[]): T[] {
  return messages.filter(message => message.unread && !message.trashedAt && !message.archivedAt
    && !(message.lane === 'attention' && !message.doneAt) && !(message.lane === 'fyi' && message.kind === 'security'));
}
