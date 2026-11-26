// The Inbox is a view of state. Attention mail stays until Done, read or not. FYI and Noise stay
// until read, from any day. Unsorted mail stays while triage hasn't sorted it. Pinned mail stays
// until unpinned, whatever its lane or read state. Trashed mail is out of every view, Done mail is
// out of the Inbox, and a code's row leaves at its expiry. Mail archived at its provider (Gmail's
// Archive, moved out of iCloud's INBOX) also leaves the Inbox, because it was handled there and
// providers are the truth (All and search still show it). Snoozed mail is out of the Inbox, the
// Pinned shelf and the counts until it returns, when it sorts by its return time.
//
// That state is each email's. The Inbox lists conversations (an account's thread), each once, worked
// out from its emails: a conversation is in the Inbox while any of its emails is, in the highest
// group among them, and the counts count conversations.
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

/** An email with its conversation: its thread in its account. */
export interface ConversationCandidate extends InboxCandidate {
  threadId: string;
}

/** A conversation's key: a conversation never crosses accounts. */
export const conversationKey = (message: {accountId: number; threadId: string}) => `${message.accountId}\n${message.threadId}`;

/** A conversation in a list: its emails that came to the user, and the one that placed it (whose words the row shows). */
export interface Conversation<T> {
  key: string;
  lead: T;
  emails: T[];
  // Any of its emails is unread.
  unread: boolean;
  // Its newest email's arrival, or return from a snooze: what its group sorts it by.
  sortAt: string;
}

// A returned email sorts by its return, so it comes back at the top of its group.
const sortAtOf = (message: InboxCandidate) => message.returnedAt ?? message.receivedAt;
const newestFirst = (a: InboxCandidate, b: InboxCandidate) => sortAtOf(b).localeCompare(sortAtOf(a)) || b.id - a.id;

/**
 * Emails gathered into their conversations, each one's emails oldest first. Trashed mail is left
 * out, unless its trash failed in place.
 */
export function conversationsOf<T extends ConversationCandidate>(messages: T[]): Conversation<T>[] {
  const byKey = new Map<string, T[]>();
  for (const message of messages) {
    if (message.trashedAt && !message.held) continue;
    const key = conversationKey(message);
    byKey.set(key, [...(byKey.get(key) ?? []), message]);
  }
  return [...byKey].map(([key, emails]) => {
    const sorted = [...emails].sort((a, b) => -newestFirst(a, b));
    const newest = sorted.at(-1)!;
    return {key, lead: newest, emails: sorted, unread: sorted.some(email => email.unread), sortAt: sortAtOf(newest)};
  });
}

// Attention outranks Unsorted, which outranks every FYI kind, which outranks Noise.
const rankOf = (group: InboxGroup) => (group === 'attention' ? 0 : group === 'unsorted' ? 1 : group === 'noise' ? 3 : 2);

/**
 * Where a conversation sits in the Inbox: the highest group any of its emails is in (Attention, then
 * Unsorted, then the kind of its newest FYI email, then Noise), and the newest email in that group,
 * which placed it. Null when none of its emails is in the Inbox, as when all are Done.
 */
export function conversationPlace<T extends InboxCandidate>(emails: T[], now: string): {group: InboxGroup; lead: T} | null {
  let best: {group: InboxGroup; lead: T} | null = null;
  for (const email of [...emails].sort(newestFirst)) {
    const group = laneGroup(email, now);
    if (group && (!best || rankOf(group) < rankOf(best.group))) best = {group, lead: email};
  }
  return best;
}

export interface Group<T> {
  group: InboxGroup;
  rows: T[];
  unread: number;
}

/**
 * The groups in INBOX_GROUPS's order, empty ones left out, each a list of conversations newest
 * first. A conversation sits once, where conversationPlace puts it. A pinned one (any of its emails
 * pinned) is on the shelf and also in its group, so the shelf never hides it from where it belongs.
 * Every group starts expanded, and the list keeps what the user collapses.
 */
export function inboxGroups<T extends ConversationCandidate>(messages: T[], now: string): Group<Conversation<T>>[] {
  const byGroup = new Map<InboxGroup, Conversation<T>[]>();
  const shelf: {conversation: Conversation<T>; pinnedAt: string}[] = [];
  for (const conversation of conversationsOf(messages)) {
    const place = conversationPlace(conversation.emails, now);
    if (place) byGroup.set(place.group, [...(byGroup.get(place.group) ?? []), {...conversation, lead: place.lead}]);
    const pinned = conversation.emails.filter(email => email.pinnedAt && !snoozed(email))
      .sort((a, b) => b.pinnedAt!.localeCompare(a.pinnedAt!) || b.id - a.id)[0];
    if (pinned) shelf.push({conversation: {...conversation, lead: pinned}, pinnedAt: pinned.pinnedAt!});
  }
  for (const rows of byGroup.values()) rows.sort((a, b) => b.sortAt.localeCompare(a.sortAt) || b.lead.id - a.lead.id);
  if (shelf.length) byGroup.set('pinned', shelf.sort((a, b) => b.pinnedAt.localeCompare(a.pinnedAt) || b.conversation.lead.id - a.conversation.lead.id).map(one => one.conversation));
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
 * The counts the Inbox shows, by conversation, so a count always matches the rows: Attention not
 * Done, read or not (the pill), every unread conversation in the Inbox (Noise included), and unread
 * per account. Opening drops the unread counts. Only Done drops the pill. Unread FYI stays a count
 * of emails, for Home Assistant (emailCounts).
 */
export function inboxCounts(messages: ConversationCandidate[], now: string): Counts {
  const counts: Counts = {attention: 0, unread: 0, unreadFyi: emailCounts(messages, now).unreadFyi, byAccount: new Map()};
  for (const conversation of conversationsOf(messages)) {
    const place = conversationPlace(conversation.emails, now);
    if (!place) continue;
    if (place.group === 'attention') counts.attention += 1;
    if (!conversation.unread) continue;
    counts.unread += 1;
    counts.byAccount.set(place.lead.accountId, (counts.byAccount.get(place.lead.accountId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Home Assistant's counts, by email as they always were: Attention emails not Done, read or not,
 * and unread FYI emails in the Inbox.
 */
export function emailCounts(messages: InboxCandidate[], now: string): {attention: number; unreadFyi: number} {
  const counts = {attention: 0, unreadFyi: 0};
  for (const message of messages) {
    const group = laneGroup(message, now);
    if (group === 'attention') counts.attention += 1;
    if (group && message.unread && message.lane === 'fyi') counts.unreadFyi += 1;
  }
  return counts;
}

/** Attention emails, newest first (by arrival or return), as Home Assistant lists them. */
export function attentionEmails<T extends InboxCandidate>(messages: T[], now: string): T[] {
  return messages.filter(message => laneGroup(message, now) === 'attention').sort(newestFirst);
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
export interface DayCandidate extends ConversationCandidate {
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
 * How the mail day is going since `dayStart` (the user's midnight). It counts emails Done today. It
 * counts the conversations that need the user (Attention not Done, the attention pill's number), and
 * how many of them have waited over 24 hours since the email that placed them arrived, or returned
 * from a snooze. It counts the emails triage sorted today out of Attention, to FYI
 * and to Noise. The pass over backfilled history isn't today's sorting, and trashed mail counts
 * nowhere.
 */
export function mailDay(messages: DayCandidate[], now: string, dayStart: string): MailDay {
  const day: MailDay = {done: 0, needYou: 0, overdue: 0, sortedFyi: 0, sortedNoise: 0};
  const overdueBefore = new Date(Date.parse(now) - OVERDUE_MS).toISOString();
  for (const message of messages) {
    if (message.trashedAt && !message.held) continue;
    if (message.doneAt && message.doneAt >= dayStart) day.done += 1;
    if (message.triagedAt && message.triagedAt >= dayStart && message.triageSource !== 'history') {
      if (message.lane === 'fyi') day.sortedFyi += 1;
      else if (message.lane === 'noise') day.sortedNoise += 1;
    }
  }
  for (const conversation of conversationsOf(messages)) {
    const place = conversationPlace(conversation.emails, now);
    if (place?.group !== 'attention') continue;
    day.needYou += 1;
    if (sortAtOf(place.lead) < overdueBefore) day.overdue += 1;
  }
  return day;
}
