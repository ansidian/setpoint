// Mail: the Inbox, All, an email, and the changes the user makes (BRIEF.md › Mail; DESIGN.md › Mail and
// Interaction rules).
//
//   GET  /api/mail/inbox?account_id=3          InboxOut (counts are always every account's)
//   GET  /api/mail/counts                      MailCountsOut (the sidebar and the tab title)
//   GET  /api/mail/day                         MailDayOut (the Inbox's empty pane, SV-218)
//   GET  /api/mail/all?account_id=&before=&limit=   AllOut
//   GET  /api/mail/messages/:id                MessageOut, without marking it read
//   POST /api/mail/messages/:id/open           MessageOut; marks it read (a command) if unread
//   POST /api/mail/messages/:id/read           {unread}            CommandOut (Mark read / unread)
//   POST /api/mail/messages/:id/done           {done}              MessageOut (local, no provider)
//   POST /api/mail/messages/:id/pin            {pinned}            MessageOut (local, no provider)
//   POST /api/mail/messages/:id/trash          CommandOut; /untrash is Undo
//   POST /api/mail/mark-all-read               {account_id?}       {commands: CommandOut[]}
//   GET/POST /api/mail/trusted-domains, DELETE /api/mail/trusted-domains/:domain
//   GET  /api/mail/indexing                    IndexingOut (the first backfill's progress)
//   GET  /api/mail/gmail-link?account=&id=     GmailLinkOut (a description's Gmail link, D555)
import {z} from 'zod';
import type {InboxGroup, Kind, Lane, MessageType} from '../enums.ts';
import type {SecurityFacts} from '../message.ts';
import type {CommandOut} from './common.ts';

/** One email in a list: the Inbox, All, the pinned shelf or search results. */
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
  // When a written rule's delayed trash takes it ("Trash in 3 h", DESIGN.md #347); null when none
  // waits, a pinned email's included.
  trash_due_at: string | null;
  attachment_count: number;
  // The change waiting for its provider, or failed in place.
  command: CommandOut | null;
}

/** One Inbox group, in DESIGN.md's order (INBOX_GROUPS); empty groups are left out. */
export interface InboxGroupOut {
  group: InboxGroup;
  count: number;
  unread: number;
  rows: MessageRowOut[];
}

/**
 * The counts, which follow the rules at once (DESIGN.md › Interaction rules): opening an unread
 * email drops `unread` and its account's; only Done drops `attention`. They count what the Inbox
 * shows, so an expired code's row leaves them too.
 */
export interface MailCountsOut {
  // Attention not Done, read or not: the sidebar's pill and mantel's attention half.
  attention: number;
  // Every unread email in the Inbox, Noise included.
  unread: number;
  // Unread FYI: mantel's FYI half.
  unread_fyi: number;
  accounts: {account_id: number; unread: number}[];
}

/**
 * How the mail day is going, for the Inbox's pane with nothing open (SV-218, D465). Today is since
 * the user's midnight. Not in the iPhone app's contract.
 */
export interface MailDayOut {
  // Emails marked Done today.
  done: number;
  // Attention not Done, read or not (MailCountsOut.attention), and those of them waiting over 24 h.
  need_you: number;
  overdue: number;
  // What triage sorted today, out of Attention: to FYI and to Noise.
  sorted_fyi: number;
  sorted_noise: number;
  // Every email kept (trashed mail aside), their size in bytes (text, HTML and attachments), and the
  // oldest one's arrival; null with none.
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

/** All: every email, Noise included, newest first, by local day (DESIGN.md › All). */
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

export interface AttachmentOut {
  id: number;
  filename: string;
  mime_type: string;
  size_bytes: number;
  // PDF, image and CSV open a preview.
  previewable: boolean;
}

/**
 * Why remote content loads or not (decision 25):
 * - `trusted`: the sender's domain is in Settings › Mail's trusted domains;
 * - `authenticated`: the sender passed DMARC (or aligned DKIM) and the email isn't Noise;
 * - `noise`: authenticated, but Noise never loads by itself;
 * - `not_authenticated`: the provider's verdict was a fail or no policy;
 * - `unknown`: there was no verdict to read (an unrecognised header layout, an older email).
 */
export const REMOTE_CONTENT_REASONS = ['trusted', 'authenticated', 'noise', 'not_authenticated', 'unknown'] as const;
export type RemoteContentReason = (typeof REMOTE_CONTENT_REASONS)[number];

/**
 * Remote content loads when the sender passed DMARC and the email isn't Noise, or its domain is
 * trusted; otherwise "Images hidden", Show and Always show from contosocoffee.example.
 */
export interface RemoteContentOut {
  // The sender's domain (accounts.google.com), as the reader's head shows it.
  domain: string;
  // What "Always show from …" trusts: the sender's whole domain (google.com), D28.
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
  // Pre-fills proposals; never shown on its own (decision 16).
  key_date: string | null;
  security: SecurityFacts | null;
  attachments: AttachmentOut[];
  remote_content: RemoteContentOut;
  // Open in Gmail (`O`); null for iCloud.
  open_url: string | null;
}

export const readInput = z.strictObject({unread: z.boolean()});
export const doneInput = z.strictObject({done: z.boolean()});
export const pinInput = z.strictObject({pinned: z.boolean()});
export const markAllReadInput = z.strictObject({account_id: z.int().positive().optional()});
export interface MarkAllReadOut {
  commands: CommandOut[];
}

/**
 * SV-270 (D555): the email an Open in Gmail address names, by its account's address and Gmail's
 * message id, so a description's link opens it in the reader; null when Setpoint doesn't have it.
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
 * what's indexed so far". `progress` is 0–1 across the accounts still backfilling; `indexing` is
 * null once every account has finished (or none has started).
 */
export interface IndexingOut {
  indexing: {progress: number} | null;
  accounts: {account_id: number; progress: number; done: boolean}[];
}

/** SV-274: GET /api/mail/mailpieces?day=YYYY-MM-DD, the agenda rail's USPS mail for a day. */
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
    // What USPS said is coming; 0 is "No mail today". It can be more than `scans`, the pictures.
    pieces: number;
    scans: MailScanOut[];
  } | null;
}
