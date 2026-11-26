// Mail: the Inbox, All, an email, and the changes the user makes.
//
//   GET  /api/mail/inbox?account_id=3          InboxOut (counts are always every account's)
//   GET  /api/mail/counts                      MailCountsOut (the sidebar and the tab title)
//   GET  /api/mail/day                         MailDayOut (the Inbox's empty pane)
//   GET  /api/mail/all?account_id=&before=&limit=   AllOut
//   GET  /api/mail/sent?account_id=&before=&limit=  SentOut
//   GET  /api/mail/messages/:id                MessageOut, without marking it read
//   POST /api/mail/messages/:id/open           MessageOut; marks it read (a command) if unread
//   POST /api/mail/messages/:id/read           {unread}            CommandOut (Mark read / unread)
//   POST /api/mail/messages/:id/done           {done}              MessageOut (local, no provider)
//   POST /api/mail/messages/:id/pin            {pinned}            MessageOut (local, no provider)
//   POST /api/mail/messages/:id/snooze         {until}             MessageOut (local, no provider)
//   POST /api/mail/messages/:id/unsnooze       MessageOut (local, no provider)
//   GET  /api/mail/snoozed                     SnoozedOut, soonest return first
//   POST /api/mail/messages/:id/trash          CommandOut; /untrash is Undo
//   POST /api/mail/mark-all-read               {account_id?}       {commands: CommandOut[]}
//   GET/POST /api/mail/trusted-domains, DELETE /api/mail/trusted-domains/:domain
//   GET  /api/mail/indexing                    IndexingOut (the first backfill's progress)
//   GET  /api/mail/gmail-link?account=&id=     GmailLinkOut (a description's Gmail link)
//
// Every list (the Inbox, All, Sent, Snoozed, search) lists conversations: an account's thread, once,
// as the email that placed it with `thread` saying who's in it. A conversation's own routes take any
// of its emails' ids:
//   GET  /api/mail/conversations/:id           MailConversationOut, opened at that email, without marking it read
//   POST /api/mail/conversations/:id/open      MailConversationOut; marks each unread email read (a command each)
//   POST /api/mail/conversations/:id/read      {unread}   ConversationChangeOut (Mark read / unread)
//   POST /api/mail/conversations/:id/done      {done}     ConversationChangeOut
//   POST /api/mail/conversations/:id/pin       {pinned}   ConversationChangeOut
//   POST /api/mail/conversations/:id/snooze    {until}    ConversationChangeOut
//   POST /api/mail/conversations/:id/unsnooze  ConversationChangeOut
//   POST /api/mail/conversations/:id/trash     ConversationChangeOut, the user's sent replies included
//   POST /api/mail/conversations/undo          ConversationUndo   ConversationChangeOut (puts each email back)
import {z} from 'zod';
import type {InboxGroup, Kind, Lane, MessageType} from '../enums.ts';
import type {Recipient, SecurityFacts} from '../message.ts';
import {id, instant} from './common.ts';
import type {CommandOut} from './common.ts';

/** Who's in a conversation, oldest first, each once. The user is `me` (name "me") for whatever they sent. */
export interface ConversationPersonOut {
  name: string;
  address: string;
  me: boolean;
}

/** A row's conversation: its emails (sent ones included, trashed ones left out) and who's in it. */
export interface ThreadRowOut {
  // "Dominic, me  4": the count shows from two.
  count: number;
  // Its emails' ids, oldest first.
  ids: number[];
  people: ConversationPersonOut[];
}

/**
 * One row in a list: the Inbox, All, the pinned shelf or search results. A row is a conversation,
 * shown as the email that placed it (its id, sender, words, lane and code), with what holds for the
 * whole conversation: `unread` if any email is, `pinned` if any is, `done` when all that came in are,
 * `attachment_count`, `draft` and `snoozed_until` (the soonest) over them all, and `received_at` its
 * newest email that came in. A lone email is a conversation of one.
 */
export interface MessageRowOut {
  id: number;
  account_id: number;
  from_name: string;
  from_address: string;
  // Who it's really from ("Northwind Talent"), and the platform ("via Greenhouse").
  organisation: string | null;
  via: string | null;
  subject: string;
  summary: string | null;
  received_at: string;
  unread: boolean;
  // Null while Unsorted.
  lane: Lane | null;
  kind: Kind | null;
  type: MessageType | null;
  protected: boolean;
  pinned: boolean;
  done: boolean;
  // A security row's decisive fact: "New sign-in · MacBook Pro · Los Angeles".
  fact: string | null;
  // A verification code, and when its row leaves the Inbox ("Expires in 11 min").
  code: {value: string; expires_at: string} | null;
  // When a written rule's delayed trash takes it ("Trash in 3 h"). Null when none
  // waits, a pinned email's included.
  trash_due_at: string | null;
  attachment_count: number;
  // The change waiting for its provider, or failed in place.
  command: CommandOut | null;
  // Mail the user sent to others, which never came in: only on such mail, which only the web asks
  // for (Sent, and search with `sent`). Mail to yourself is received mail and has no such key.
  sent_only?: true;
  // When the user replied (the row's reply mark): only while their reply is the conversation's newest
  // email. On an email in the reader, when the user replied to that email. Left out otherwise.
  replied_at?: string;
  // A draft answers it (a reply, reply all or forward the user started). Left out otherwise.
  draft?: true;
  // Snoozed until then: out of the Inbox, still in All and search. Left out while it isn't.
  snoozed_until?: string;
  // When it last returned from a snooze (the row's returned mark; `received_at` stays its arrival).
  // Left out while it never has.
  returned_at?: string;
  // Its conversation. Left out on an email in the reader.
  thread?: ThreadRowOut;
}

/** One Inbox group, in INBOX_GROUPS' order. Empty groups are left out. */
export interface InboxGroupOut {
  group: InboxGroup;
  count: number;
  unread: number;
  rows: MessageRowOut[];
}

/**
 * The counts, which change at once. They count conversations, as the Inbox's rows are, so a count
 * matches the rows. Opening an unread conversation drops `unread` and its account's. Only Done drops
 * `attention`. They count what the Inbox shows, so an expired code's row leaves them too.
 */
export interface MailCountsOut {
  // Conversations in Attention, not Done, read or not: the sidebar's pill.
  attention: number;
  // Every unread conversation in the Inbox, Noise included.
  unread: number;
  // Unread FYI emails, counted by email: Home Assistant's FYI half.
  unread_fyi: number;
  accounts: {account_id: number; unread: number}[];
}

/**
 * How the mail day is going, for the Inbox's pane with nothing open. Today is since
 * the user's midnight.
 */
export interface MailDayOut {
  // Emails marked Done today.
  done: number;
  // Conversations in Attention not Done, read or not (MailCountsOut.attention), and those of them waiting over 24 h.
  need_you: number;
  overdue: number;
  // What triage sorted today, out of Attention: to FYI and to Noise.
  sorted_fyi: number;
  sorted_noise: number;
  // Every email kept (trashed mail aside), their size in bytes (text, HTML and attachments), and the
  // oldest one's arrival, null with none.
  total: number;
  bytes: number;
  oldest_at: string | null;
}

export interface InboxOut {
  account_id: number | null;
  groups: InboxGroupOut[];
  counts: MailCountsOut;
  // The next moment the Inbox changes by itself (a code's row expiring), to refetch then.
  next_change_at: string | null;
}

export const inboxInput = z.strictObject({account_id: z.coerce.number().int().positive().optional()});

/** All: every email, Noise included, newest first, by local day. */
export const allInput = z.strictObject({
  account_id: z.coerce.number().int().positive().optional(),
  // The previous page's `next_before`.
  before: z.string().regex(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export interface AllDayOut {
  date: string;
  rows: MessageRowOut[];
}
export interface AllOut {
  days: AllDayOut[];
  next_before: string | null;
}

/** Sent: the mail the user sent, mail to yourself included, newest first, by local day, paged as All is. */
export const sentInput = allInput;
/** A sent email's row: as any list's, with who it went to (null while Setpoint hasn't read its headers). */
export interface SentRowOut extends MessageRowOut {
  to: Recipient[] | null;
  cc: Recipient[] | null;
}
export interface SentDayOut {
  date: string;
  rows: SentRowOut[];
}
export interface SentOut {
  days: SentDayOut[];
  next_before: string | null;
  // The accounts with any sent mail, in the sidebar's order, whichever account the list is for.
  accounts: number[];
}

export interface AttachmentOut {
  id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
  // PDF, image and CSV open a preview.
  previewable: boolean;
}

/**
 * Why remote content loads or not:
 * - `trusted`: the sender's domain is in Settings › Mail's trusted domains.
 * - `authenticated`: the sender passed DMARC (or aligned DKIM) and the email isn't Noise.
 * - `noise`: authenticated, but Noise never loads by itself.
 * - `not_authenticated`: the provider's verdict was a fail or no policy.
 * - `unknown`: there was no verdict to read (an unrecognised header layout, an older email).
 */
export const REMOTE_CONTENT_REASONS = ['trusted', 'authenticated', 'noise', 'not_authenticated', 'unknown'] as const;
export type RemoteContentReason = (typeof REMOTE_CONTENT_REASONS)[number];

/**
 * Remote content loads when the sender passed DMARC and the email isn't Noise, or its domain is
 * trusted. Otherwise "Images hidden", Show and Always show from contosocoffee.example.
 */
export interface RemoteContentOut {
  // The sender's domain (accounts.google.com), as the reader's head shows it.
  domain: string;
  // What "Always show from …" trusts: the sender's whole domain (google.com).
  trust_domain: string;
  sender_authenticated: boolean | null;
  trusted: boolean;
  load: boolean;
  reason: RemoteContentReason;
}

/** An email in the reading pane. */
export interface MessageOut extends MessageRowOut {
  thread_id: string;
  body_text: string;
  body_html: string | null;
  // Pre-fills proposals, and is never shown on its own.
  key_date: string | null;
  security: SecurityFacts | null;
  attachments: AttachmentOut[];
  remote_content: RemoteContentOut;
  // Open in Gmail (`O`), or null for iCloud.
  open_url: string | null;
  // Who it was sent to and what it answers, from its headers. All five are left out while Setpoint
  // hasn't read them (mail from before they were kept, until the header pass reaches it). Empty
  // lists and a null In-Reply-To mean the email had none.
  to?: Recipient[];
  cc?: Recipient[];
  reply_to?: Recipient[];
  // The References header's Message-IDs in order, oldest first, and In-Reply-To's.
  references?: string[];
  in_reply_to?: string | null;
  // The sender's unsubscribe page (an https address from List-Unsubscribe), left out when it had
  // none.
  unsubscribe_url?: string;
}

export const readInput = z.strictObject({unread: z.boolean()});
export const doneInput = z.strictObject({done: z.boolean()});
export const pinInput = z.strictObject({pinned: z.boolean()});
/** Snooze until an instant in the future. */
export const snoozeInput = z.strictObject({until: z.iso.datetime({offset: true})});
/** A conversation's email in the reader: as any email's, with what its one collapsed line shows. */
export interface ConversationMessageOut extends MessageOut {
  // Opens expanded: the first, the newest, any unread (before this opening read it) and the one it was opened at.
  expanded: boolean;
  // Its first words, for its line while collapsed.
  excerpt: string;
  // Its HTML body ends in quoted history, which the body page leaves out with ?quoted=fold and the
  // reader shows again behind •••. False for plain text, whose history the web finds itself.
  quoted_history: boolean;
}

/** A conversation in the reader: its emails oldest first, trashed ones left out (but the one it was opened at). */
export interface MailConversationOut {
  account_id: number;
  thread_id: string;
  // Its first email's subject.
  subject: string;
  // The email it was opened at: expanded, and the one to bring into view.
  opened_id: number;
  // Its row, for the conversation's tools (pinned, done, snoozed, unread).
  row: MessageRowOut;
  emails: ConversationMessageOut[];
  // The draft that answers one of its emails (the newest), as a "Draft" line at its foot. Null with none.
  draft: {id: number; message_id: number} | null;
}

/**
 * What puts each email of a conversation back as it was before a change: its own fields (Done, pin,
 * snooze) as they were, the read state of those whose read state changed, and the emails it trashed.
 */
export const conversationUndoSchema = z.strictObject({
  emails: z.array(z.strictObject({
    id, done_at: instant.nullable(), opened_before_done: z.boolean().nullable(), pinned_at: instant.nullable(),
    snoozed_until: instant.nullable(), returned_at: instant.nullable(), trash_due_at: instant.nullable(),
  })),
  read: z.array(z.strictObject({id, unread: z.boolean()})),
  trashed: z.array(id),
});
export type ConversationUndo = z.infer<typeof conversationUndoSchema>;

/** A change to a whole conversation: the commands it sent its provider, and its Undo. */
export interface ConversationChangeOut {
  commands: CommandOut[];
  undo: ConversationUndo;
}

/** Snoozed mail, soonest return first, with nothing trashed. */
export interface SnoozedOut {
  rows: MessageRowOut[];
}
export const markAllReadInput = z.strictObject({account_id: z.int().positive().optional()});
export interface MarkAllReadOut {
  commands: CommandOut[];
}

/**
 * The email an Open in Gmail address names, by its account's address and Gmail's
 * message id, so a description's link opens it in the reader. Null when Setpoint doesn't have it.
 */
export const gmailLinkInput = z.strictObject({account: z.string().min(1), id: z.string().min(1)});
export interface GmailLinkOut {
  message_id: number | null;
}

/** Settings › Mail's trusted remote-content domains. */
export const trustedDomainInput = z.strictObject({
  domain: z.string().trim().toLowerCase().regex(/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'A domain such as contosocoffee.example'),
});
export interface TrustedDomainOut {
  domain: string;
  created_at: string;
}

/**
 * The first backfill (365 days per account), for search's status line: "Indexing · 62% · showing
 * what's indexed so far". `progress` is 0–1 across the accounts still backfilling. `indexing` is
 * null once every account has finished (or none has started).
 */
export interface IndexingOut {
  indexing: {progress: number} | null;
  accounts: {account_id: number; progress: number; done: boolean}[];
}

/** GET /api/mail/mailpieces?day=YYYY-MM-DD, the agenda rail's USPS mail for a day. */
export const mailpiecesInput = z.strictObject({day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)});
export interface MailScanOut {
  id: number;
  // GET it for the picture (a JPEG or PNG), kept as long as its day.
  url: string;
}
export interface MailpiecesOut {
  day: string;
  // Null on a day with no digest (a Sunday, a holiday, a day before the 30 kept): no section.
  digest: {
    // What USPS said is coming, where 0 is "No mail today". It can be more than `scans`, the pictures.
    pieces: number;
    scans: MailScanOut[];
  } | null;
}
