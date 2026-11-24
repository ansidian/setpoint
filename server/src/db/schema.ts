// Setpoint's tables. First come the mail and calendar records and the platform: the owner and
// sign-in, settings and secrets, sources with their credentials and health, durable jobs and sync
// cursors, commands, the notification log and the AI usage ledger. Then comes the search index.
// Then the providers' item fields, watch channels, Todoist's projects and OAuth state, Time to
// Leave's routes and the reminders' mark (in its own block at the end). Then triage's rules,
// prompts, evidence and health, the search log and Alfred's threads, and what the cutover import
// left. News's sources, articles, stories and image copies come last.
//
// Timestamps are ISO 8601 UTC strings ("2026-10-07T16:12:00.000Z"). Dates are local
// `YYYY-MM-DD` in the owner's zone. JSON columns hold values checked by `@setpoint/shared`.
import {sql} from 'drizzle-orm';
import {blob, check, index, integer, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn} from 'drizzle-orm/sqlite-core';
import {
  ACCOUNT_PROVIDERS, AI_PROVIDERS, AI_PURPOSES, AUTH_MODES, CALENDAR_PROVIDERS, COLOURS, COMMAND_KINDS, COMMAND_STATES,
  COMMAND_TARGETS, ITEM_KINDS, KINDS, LANES, MESSAGE_TYPES, NOTIFICATION_KINDS, NOTIFY_TOPICS, SECRET_NAMES,
  NEWS_ADAPTERS, NEWS_SECTIONS, RULE_TRASH, NEWS_SOURCE_KINDS, SESSION_METHODS, SOURCE_PROVIDERS, SYNC_MODES, TRANSPARENCIES, TRIAGE_SOURCES, WEATHER_CONDITIONS,
  DRAFT_KINDS, SEND_STATES, type AnswerApplicationOut, type AnswerItemOut, type DraftWriteState, type EmphasisOut, type ItemWhen, type NewsAdapterKey, type ProposalOut, type Recipient, type RuleMatch, type SearchChip, type SearchReadingFallback, type SecurityFacts,
} from '@setpoint/shared';
import type {Block} from '@setpoint/shared/richText';
import type {ArticleNotes, NoiseReason} from '../domain/newsSorting.ts';
import type {SenderAuthentication} from '../domain/senderAuthentication.ts';

const quoted = (values: readonly string[]) => sql.raw(values.map(value => `'${value}'`).join(', '));

/** A mail account: four Gmail and one iCloud today, each with a label, colour, icon and order. */
export const accounts = sqliteTable('accounts', {
  id: integer('id').primaryKey({autoIncrement: true}),
  provider: text('provider', {enum: ACCOUNT_PROVIDERS}).notNull(),
  label: text('label').notNull().unique(),
  address: text('address').notNull().unique(),
  colour: text('colour', {enum: COLOURS}).notNull(),
  // A Material Symbols name from the bundled set.
  icon: text('icon').notNull(),
  position: integer('position').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  check('accounts_provider', sql`${table.provider} in (${quoted(ACCOUNT_PROVIDERS)})`),
  check('accounts_colour', sql`${table.colour} in (${quoted(COLOURS)})`),
]);

/**
 * One row per email: the provider's fields plus what triage derives. Every
 * view is a query over this table, and nothing is copied per view.
 *
 * Search reads `messages_fts`, an FTS5 index over the sender, organisation, subject, summary, search
 * terms, search body and a sent email's recipients, kept in step by triggers on this table. Drizzle
 * has no virtual tables or triggers, so migrations 0022 and 0045 create them by hand (see the notes
 * there).
 */
export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey({autoIncrement: true}),
  accountId: integer('account_id').notNull().references(() => accounts.id),
  // Gmail's message id, or the iCloud message's IMAP identity. Unique within its account.
  providerId: text('provider_id').notNull(),
  threadId: text('thread_id').notNull(),
  fromName: text('from_name').notNull(),
  fromAddress: text('from_address').notNull(),
  // Who it's really from ("Northwind Talent"), and the platform it came through ("Greenhouse").
  organisation: text('organisation'),
  via: text('via'),
  subject: text('subject').notNull(),
  // Triage's one line under the subject.
  summary: text('summary'),
  snippet: text('snippet').notNull(),
  // The bodies are in `message_bodies`, read only where they're needed.
  receivedAt: text('received_at').notNull(),
  // The provider's read state, kept both ways.
  unread: integer('unread', {mode: 'boolean'}).notNull(),
  // Null until triage has sorted it: Unsorted.
  lane: text('lane', {enum: LANES}),
  kind: text('kind', {enum: KINDS}),
  type: text('type', {enum: MESSAGE_TYPES}),
  // Pre-fills proposals and serves search. Never shown on its own.
  keyDate: text('key_date'),
  securityFacts: text('security_facts', {mode: 'json'}).$type<SecurityFacts>(),
  // Protected security mail always stays in Attention. No rule moves it.
  protected: integer('protected', {mode: 'boolean'}).notNull().default(false),
  pinnedAt: text('pinned_at'),
  // Done takes it out of Attention. Whether it was opened first teaches triage.
  doneAt: text('done_at'),
  openedBeforeDone: integer('opened_before_done', {mode: 'boolean'}),
  // A verification code and when its row leaves the Inbox (15 minutes after arrival by default).
  code: text('code'),
  codeExpiresAt: text('code_expires_at'),
  // When the user first opened it in Setpoint, so Done can record whether it was opened.
  openedAt: text('opened_at'),
  // In the provider's trash. It is out of every view until Undo (untrash) or the provider purges it.
  trashedAt: text('trashed_at'),
  // When a delayed trash is due: the earlier of a written rule's (arrival plus its delay) and
  // the code's (its expiry). The minute pass (src/triage/ruleTrash.ts) trashes it then.
  // Pinning clears it, and so does the pass once it sends the trash. Unpinning brings back only
  // the code's, while it hasn't expired. The rule's is `triage_rule_id`, the rule that sorted it.
  trashDueAt: text('trash_due_at'),
  // Its code row is trashed at the code's expiry. Triage sets it once, when it sorts new mail with
  // a code, so codes from before it, history and codes read again later are never trashed.
  codeTrash: integer('code_trash', {mode: 'boolean'}).notNull().default(false),
  // Whether the sender passed DMARC (mail sync records it). Null while unknown. Remote content loads
  // for authenticated, non-Noise senders.
  senderAuthenticated: integer('sender_authenticated', {mode: 'boolean'}),

  // ---- Mail sync: provider facts the adapters record ----
  // The verdict behind `sender_authenticated` with its SPF / DKIM / DMARC evidence
  // (src/domain/senderAuthentication.ts). Null while unknown.
  senderAuth: text('sender_auth', {mode: 'json'}).$type<SenderAuthentication>(),
  // The Message-ID header. An IMAP message keeps it when it moves (Trash and back, a new
  // UIDVALIDITY), so the mirror matches it to its row instead of adding a copy.
  rfc822Id: text('rfc822_id'),
  // Who it was sent to and what it answers, read from its headers: To, Cc and Reply-To as
  // addresses (lowercased) with their display names, References in order and In-Reply-To. Null
  // until read (mail from before they were kept, filled by the header pass in src/sync/headers.ts);
  // an empty list once read means the header had none.
  toRecipients: text('to_recipients', {mode: 'json'}).$type<Recipient[]>(),
  ccRecipients: text('cc_recipients', {mode: 'json'}).$type<Recipient[]>(),
  replyTo: text('reply_to', {mode: 'json'}).$type<Recipient[]>(),
  referenceIds: text('reference_ids', {mode: 'json'}).$type<string[]>(),
  inReplyTo: text('in_reply_to'),
  // The sender's unsubscribe page, an https address from List-Unsubscribe. Null when it had none,
  // or it came before Setpoint kept it.
  listUnsubscribe: text('list_unsubscribe'),
  // It left the provider's inbox without Setpoint (archived in Gmail, moved out of iCloud's INBOX).
  // Until it's back, it is out of the Inbox but still in All and search.
  archivedAt: text('archived_at'),
  // Arrived through the 365-day backfill rather than as new mail, for triage to treat as history.
  backfill: integer('backfill', {mode: 'boolean'}).notNull().default(false),
  // The user sent it: it is in Gmail's SENT label or iCloud's sent mailbox. Mail to yourself is
  // both sent and received, one row.
  sent: integer('sent', {mode: 'boolean'}).notNull().default(false),
  // It came to the user: it reached the inbox. False only for mail the user sent to others (sent
  // only), which never goes through triage, Jobs, counts, notifications, the Inbox or All, and
  // which search returns only when asked. Set when the row is made; a sent-only row whose inbox
  // copy arrives later becomes received then, and is triaged as new mail.
  received: integer('received', {mode: 'boolean'}).notNull().default(true),
  // iCloud: where Trash keeps it ("uidvalidity:uid" in the Trash mailbox), for Undo.
  trashRef: text('trash_ref'),

  // ---- Search: what the index holds in place of the body ----
  // `message_bodies.body_text` without its links and footers (src/domain/searchBody.ts), written with it.
  searchBody: text('search_body').notNull().default(''),
  // Words for what the email is about, written after it arrives (src/search/terms.ts). Null
  // until then, and for an email the model had none for.
  searchTerms: text('search_terms'),
  // The prompt version that last read it, whatever came back, so it's charged for once per version.
  // Null for new mail, which is read on its own. 0 for mail from before terms. That mail, and mail
  // read by an older prompt, is read only once the user says so.
  searchTermsVersion: integer('search_terms_version'),
  // Who mail the user sent to others went to, To then Cc, as names and addresses ("Sam Ortiz
  // sam.ortiz@example.org"), so search finds it by them as it finds received mail by its sender.
  // Empty for other mail. Triggers write it from the recipients (migration 0045), never the app.
  searchRecipients: text('search_recipients').notNull().default(''),

  // ---- Triage: how the lane was decided, once per email ----
  // What decided it (a rule, a learned rule, a model, the unsure default, the history pass), the
  // rule if one did (Settings › Mail's "9 this month"), and when. Null while Unsorted. The domain
  // checks the values, not a CHECK, because adding one here would rebuild the table and its FTS
  // triggers.
  triageSource: text('triage_source', {enum: TRIAGE_SOURCES}),
  triageRuleId: integer('triage_rule_id').references((): AnySQLiteColumn => triageRules.id, {onDelete: 'set null'}),
  triagedAt: text('triaged_at'),
  // When the one-time extraction pass over backfilled history read it. Set once, so no email is
  // charged for twice.
  extractedAt: text('extracted_at'),

  // ---- USPS mail: the Informed Delivery digest ----
  // The daily digest from USPS Informed Delivery (src/domain/mailpieces.ts). Its scans go to the
  // agenda rail (`mail_digests`), so the email itself is out of the Inbox and its counts. It is
  // never triaged and never notified. All and search still find it.
  uspsDigest: integer('usps_digest', {mode: 'boolean'}).notNull().default(false),

  // ---- Snooze: Setpoint's own, as no provider has one ----
  // Snoozed until then: out of the Inbox, in the Snoozed list, still in All and search. It returns
  // at that time (the minute pass, src/triage/snooze.ts) or when a new email arrives in its thread.
  snoozedUntil: text('snoozed_until'),
  // When it last returned from a snooze: unread, at the top of its group, with the returned mark.
  // Snoozing it again clears it.
  returnedAt: text('returned_at'),
}, table => [
  uniqueIndex('messages_account_provider').on(table.accountId, table.providerId),
  index('messages_rfc822').on(table.accountId, table.rfc822Id),
  index('messages_received').on(table.receivedAt),
  index('messages_thread').on(table.accountId, table.threadId),
  // The Sent list, newest first.
  index('messages_sent').on(table.sent, table.receivedAt),
  check('messages_lane', sql`${table.lane} is null or ${table.lane} in (${quoted(LANES)})`),
  check('messages_kind', sql`${table.kind} is null or ${table.kind} in (${quoted(KINDS)})`),
  check('messages_type', sql`${table.type} is null or ${table.type} in (${quoted(MESSAGE_TYPES)})`),
  check('messages_done', sql`(${table.doneAt} is null) = (${table.openedBeforeDone} is null)`),
  check('messages_code', sql`(${table.code} is null) = (${table.codeExpiresAt} is null)`),
  // The rule that sorted it.
  index('messages_triage_rule').on(table.triageRuleId),
  // The minute pass reads the due ones.
  index('messages_trash_due').on(table.trashDueAt),
  // The Snoozed list, soonest first, and the minute pass's due ones.
  index('messages_snoozed').on(table.snoozedUntil),
  // What reads many emails' few columns reads these instead of the table, which hold every column it
  // needs. The Inbox, All, the counts and the day: src/queries/mail.ts `listColumns`.
  index('messages_list').on(
    table.received, table.uspsDigest, table.accountId, table.lane, table.kind, table.unread, table.receivedAt, table.organisation, table.fromName,
    table.pinnedAt, table.doneAt, table.trashedAt, table.codeExpiresAt, table.archivedAt, table.triagedAt, table.triageSource,
    table.snoozedUntil, table.returnedAt,
  ),
  // The pattern prompts' verdicts: Done Attention mail (src/triage/learning.ts).
  index('messages_verdicts').on(table.lane, table.backfill, table.doneAt, table.organisation, table.type, table.kind, table.protected, table.openedBeforeDone),
]);

/**
 * An email's bodies, one row per email, going with it. They are apart from `messages` because SQLite
 * walks a row's earlier values to read a later one, so bodies in the row made every read of many
 * emails read their bodies too. Only the reader, quoting, triage, codes, Jobs and Alfred read them.
 */
export const messageBodies = sqliteTable('message_bodies', {
  messageId: integer('message_id').primaryKey().references(() => messages.id, {onDelete: 'cascade'}),
  bodyText: text('body_text').notNull(),
  bodyHtml: text('body_html'),
});

/** An email's attachment, previewed in the reader (PDF, image, CSV). */
export const attachments = sqliteTable('attachments', {
  id: integer('id').primaryKey({autoIncrement: true}),
  messageId: integer('message_id').notNull().references(() => messages.id, {onDelete: 'cascade'}),
  providerId: text('provider_id').notNull(),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
}, table => [index('attachments_message').on(table.messageId)]);

/**
 * An address an account can send as, for the composer's From: the account's own and, for Gmail, the
 * verified aliases of its "Send mail as" list, read from Gmail now and then (src/sending/aliases.ts).
 * An iCloud account has its own address only.
 */
export const sendAs = sqliteTable('send_as', {
  id: integer('id').primaryKey({autoIncrement: true}),
  accountId: integer('account_id').notNull().references(() => accounts.id, {onDelete: 'cascade'}),
  address: text('address').notNull(),
  // The name the provider sends with. Null where it has none.
  name: text('name'),
  primary: integer('primary', {mode: 'boolean'}).notNull().default(false),
  position: integer('position').notNull(),
}, table => [uniqueIndex('send_as_account_address').on(table.accountId, table.address)]);

/**
 * A draft: mail the user is writing, kept in Setpoint only until it is sent (DESIGN.md's exception
 * to "providers are the truth"). It is saved as the user types, so a reload, a closed tab or a
 * restart keeps it. A reply, reply all or forward answers one email, one draft per email and kind.
 *
 * Send holds it (`send_state` held) with a `send` job due at `send_at`; Undo takes the job back while
 * it waits. The job sends it through the account's provider (src/sending/worker.ts), and the draft
 * is deleted only once the provider has accepted the email. `rfc822_id` is the Message-ID Setpoint
 * set, kept across Try again, and `attempted_at` says a send reached the provider: a send run again
 * after one (a restart, a retry) first asks the provider whether that Message-ID is already there,
 * so an accepted email is never sent twice.
 */
export const drafts = sqliteTable('drafts', {
  id: integer('id').primaryKey({autoIncrement: true}),
  kind: text('kind', {enum: DRAFT_KINDS}).notNull(),
  // The email it answers or forwards. A draft outlives its email (deleted at the provider), so the
  // user's text stays; it then sends with no quote and no reply headers.
  messageId: integer('message_id').references(() => messages.id, {onDelete: 'set null'}),
  // From: the account, and which of its addresses.
  accountId: integer('account_id').notNull().references(() => accounts.id, {onDelete: 'cascade'}),
  fromAddress: text('from_address').notNull(),
  toRecipients: text('to_recipients', {mode: 'json'}).$type<Recipient[]>().notNull(),
  ccRecipients: text('cc_recipients', {mode: 'json'}).$type<Recipient[]>().notNull(),
  bccRecipients: text('bcc_recipients', {mode: 'json'}).$type<Recipient[]>().notNull(),
  subject: text('subject').notNull(),
  // Rich-text blocks (shared/src/richText.ts), the user's own text without the quote.
  body: text('body', {mode: 'json'}).$type<Block[]>().notNull(),
  // A reply's quote as the user trimmed it, as rich-text blocks. Null sends the original in full,
  // quoted from the email itself at send time.
  quote: text('quote', {mode: 'json'}).$type<Block[]>(),
  // A forward's attachments the user took off it, by their ids: the rest go with it.
  removedAttachments: text('removed_attachments', {mode: 'json'}).$type<number[]>().notNull().default(sql`'[]'`),
  // Help me write's line and the body's versions for its undo and redo. Null until it's used.
  write: text('write', {mode: 'json'}).$type<DraftWriteState>(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  sendState: text('send_state', {enum: SEND_STATES}),
  sendAt: text('send_at'),
  sendError: text('send_error'),
  rfc822Id: text('rfc822_id'),
  attemptedAt: text('attempted_at'),
}, table => [
  // One reply, reply all and forward per email. New messages are any number.
  uniqueIndex('drafts_answer').on(table.messageId, table.kind).where(sql`${table.messageId} is not null`),
  index('drafts_updated').on(table.updatedAt),
  check('drafts_kind', sql`${table.kind} in (${quoted(DRAFT_KINDS)})`),
  check('drafts_send_state', sql`${table.sendState} is null or ${table.sendState} in (${quoted(SEND_STATES)})`),
]);

/**
 * The user's own files attached to a draft, each kept in the data directory's draft-files/ under its
 * id (src/sending/files.ts). A file outlives its draft for a short while (`released_at`), so
 * Discard's Undo and the reply-type menu's new draft can take it; then it's deleted with its bytes.
 */
export const draftFiles = sqliteTable('draft_files', {
  id: integer('id').primaryKey({autoIncrement: true}),
  draftId: integer('draft_id').references(() => drafts.id, {onDelete: 'set null'}),
  filename: text('filename').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: text('created_at').notNull(),
  // When its draft went (discarded, or sent): null while it has one.
  releasedAt: text('released_at'),
}, table => [index('draft_files_draft').on(table.draftId)]);

/** Where items come from: each Google calendar, and Todoist as one more toggle. */
export const calendars = sqliteTable('calendars', {
  id: integer('id').primaryKey({autoIncrement: true}),
  provider: text('provider', {enum: CALENDAR_PROVIDERS}).notNull(),
  providerId: text('provider_id').notNull(),
  // The Google account a calendar belongs to. Null for Todoist.
  accountId: integer('account_id').references(() => accounts.id),
  name: text('name').notNull(),
  // Null for Todoist, which shows its ring glyph instead.
  colour: text('colour', {enum: COLOURS}),
  position: integer('position').notNull(),
  // The Calendar sidebar's checkbox: a quick filter over the listed calendars.
  visible: integer('visible', {mode: 'boolean'}).notNull().default(true),
  // Settings › Calendar's switch. When it is off, the calendar leaves Calendar entirely (its
  // sidebar, grid, agenda, pickers and search), whatever its checkbox says.
  listed: integer('listed', {mode: 'boolean'}).notNull().default(true),
  // Google's accessRole for the calendar (calendarWritable reads it). Null for Todoist and
  // for a Google calendar not listed since the column came.
  accessRole: text('access_role'),
}, table => [
  // Per account: a calendar shared with two Google accounts is on both lists with one id.
  uniqueIndex('calendars_account_provider').on(table.accountId, table.provider, table.providerId),
  // SQLite counts nulls as distinct, so a calendar without an account (Todoist's) keeps its own rule.
  uniqueIndex('calendars_provider').on(table.provider, table.providerId).where(sql`${table.accountId} is null`),
  check('calendars_provider_kind', sql`${table.provider} in (${quoted(CALENDAR_PROVIDERS)})`),
  check('calendars_colour', sql`${table.colour} is null or ${table.colour} in (${quoted(COLOURS)})`),
]);

/**
 * Anything on the calendar: a Google event or a Todoist task, one model. A timed event has
 * `starts_at`/`ends_at`. An all-day event has `start_date`/`end_date` (end exclusive, as Google's).
 * A task has `due_date`, plus `due_at` when it has a time. A task created here with no date has
 * neither until Todoist confirms it, and then leaves (commands/index.ts).
 */
export const items = sqliteTable('items', {
  id: integer('id').primaryKey({autoIncrement: true}),
  calendarId: integer('calendar_id').notNull().references(() => calendars.id),
  providerId: text('provider_id').notNull(),
  kind: text('kind', {enum: ITEM_KINDS}).notNull(),
  title: text('title').notNull(),
  allDay: integer('all_day', {mode: 'boolean'}).notNull().default(false),
  startsAt: text('starts_at'),
  endsAt: text('ends_at'),
  startDate: text('start_date'),
  endDate: text('end_date'),
  dueDate: text('due_date'),
  dueAt: text('due_at'),
  // The zone a recurring event repeats in.
  timeZone: text('time_zone'),
  // An RFC 5545 rule ("RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR"), as Google stores it.
  recurrence: text('recurrence'),
  place: text('place'),
  address: text('address'),
  attendees: text('attendees', {mode: 'json'}).$type<string[]>(),
  // Minutes before the start.
  reminders: text('reminders', {mode: 'json'}).$type<number[]>(),
  // Time to Leave for this event, added among its notifications. The Google event keeps it (a
  // private extended property), so it syncs and a recurring event's exceptions keep it.
  leaveReminder: integer('leave_reminder', {mode: 'boolean'}).notNull().default(false),
  // A task's Todoist project.
  project: text('project'),
  doneAt: text('done_at'),
  // An occurrence of a recurring event changed on its own ("This event"). These hold the recurring
  // item it belongs to and the start it replaces, as Google's recurringEventId and
  // originalStartTime. `cancelled` is a deleted occurrence.
  recurringItemId: integer('recurring_item_id').references((): AnySQLiteColumn => items.id, {onDelete: 'cascade'}),
  originalStart: text('original_start'),
  cancelled: integer('cancelled', {mode: 'boolean'}).notNull().default(false),
  // ---- What the providers add ----
  // Google's etag for the event as last seen. Setpoint sends it as If-Match, so a change made
  // elsewhere since isn't overwritten.
  etag: text('etag'),
  // A series Google expands itself (EXDATE or RDATE lines, an all-day series, a rule the expander
  // doesn't cover). Its occurrences are rows of their own, and the series itself isn't drawn.
  expanded: integer('expanded', {mode: 'boolean'}).notNull().default(false),
  // Google's own kinds of event (birthdays, focus time, out of office) can't be changed here.
  readOnly: integer('read_only', {mode: 'boolean'}).notNull().default(false),
  // A Todoist task's due as Todoist words it ("every mon"), and whether it repeats. A completed
  // occurrence of a repeating task is a row of its own (`recurring_item_id`, `original_start` =
  // its due date). This tombstone keeps it done on its day after Todoist moves the task on.
  dueString: text('due_string'),
  dueRecurring: integer('due_recurring', {mode: 'boolean'}).notNull().default(false),
  // An event's own colour (Google's colorId, as one of the swatches). Null takes its calendar's.
  colour: text('colour', {enum: COLOURS}),
  // A task's Todoist labels, by name (Todoist's key for them).
  labels: text('labels', {mode: 'json'}).$type<string[]>(),
  // A Google event's own URL (its `source.url`, an .ics file's URL line), for Open.
  sourceUrl: text('source_url'),
  // A Google event's free/busy (its `transparency`). The editor's conflict preview leaves out a
  // free one. Tasks keep Google's default, busy.
  transparency: text('transparency', {enum: TRANSPARENCIES}).notNull().default('opaque'),
  // A Google event's iCalUID. An .ics import (Google's events.import) writes by this key, so
  // the review can say which of a file's events the chosen calendar already has.
  icalUid: text('ical_uid'),
  // The description as its provider wrote it, never rewritten on the way in: a Google
  // event's HTML, a Todoist task's Markdown. Setpoint sends it back only when the user changed it.
  description: text('description'),
  parentProviderId: text('parent_provider_id'),
  childOrder: integer('child_order'),
  // Todoist's order key. Siblings sort by it as text (server/src/domain/orderKey.ts).
  orderKey: text('order_key'),
}, table => [
  index('items_ical_uid').on(table.calendarId, table.icalUid),
  uniqueIndex('items_calendar_provider').on(table.calendarId, table.providerId),
  index('items_starts').on(table.startsAt),
  index('items_due').on(table.dueDate),
  uniqueIndex('items_occurrence').on(table.recurringItemId, table.originalStart),
  check('items_exception', sql`(${table.recurringItemId} is null) = (${table.originalStart} is null)`),
  check('items_kind', sql`${table.kind} in (${quoted(ITEM_KINDS)})`),
  check('items_when', sql`case ${table.kind}
    when 'task' then (${table.dueDate} is not null or ${table.dueAt} is null) and ${table.startsAt} is null and ${table.startDate} is null
    else (${table.allDay} and ${table.startDate} is not null and ${table.endDate} is not null)
      or (not ${table.allDay} and ${table.startsAt} is not null and ${table.endsAt} is not null) end`),
]);

/** A day's forecast at home, for the grid and the right pane. Temperatures in °F. */
export const weatherDays = sqliteTable('weather_days', {
  date: text('date').primaryKey(),
  condition: text('condition', {enum: WEATHER_CONDITIONS}).notNull(),
  highF: integer('high_f').notNull(),
  lowF: integer('low_f').notNull(),
  fetchedAt: text('fetched_at').notNull(),
}, table => [check('weather_condition', sql`${table.condition} in (${quoted(WEATHER_CONDITIONS)})`)]);

/** Settings › Mail's trusted remote-content domains. */
export const trustedDomains = sqliteTable('trusted_domains', {
  domain: text('domain').primaryKey(),
  createdAt: text('created_at').notNull(),
});

// ---- The owner and sign-in ----

/**
 * The single owner, claimed once with a setup token. `security_generation` moves on every security
 * change (password, passkeys, recovery codes, mode). That ends every session and pending sign-in
 * made under the old one. Every caller shares the password budget.
 */
export const owner = sqliteTable('owner', {
  id: integer('id').primaryKey(),
  passwordHash: text('password_hash').notNull(),
  authMode: text('auth_mode', {enum: AUTH_MODES}).notNull().default('password_or_passkey'),
  securityGeneration: integer('security_generation').notNull().default(1),
  passwordAttempts: integer('password_attempts').notNull().default(0),
  passwordWindowEndsAt: text('password_window_ends_at'),
  claimedAt: text('claimed_at').notNull(),
}, table => [
  check('owner_singleton', sql`${table.id} = 1`),
  check('owner_auth_mode', sql`${table.authMode} in (${quoted(AUTH_MODES)})`),
]);

/** One-time setup tokens from the CLI, stored as hashes. The first claim spends one. */
export const setupTokens = sqliteTable('setup_tokens', {
  hash: text('hash').primaryKey(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

/**
 * A browser's session. The cookie's secret is 256 random bits, and only its SHA-256 is kept. It
 * lasts 30 days from its last use, and only while the owner's security generation is its own.
 * `password_at` is when the password was last given in it, for changes that need a recent one.
 */
export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({autoIncrement: true}),
  hash: text('hash').notNull().unique(),
  securityGeneration: integer('security_generation').notNull(),
  method: text('method', {enum: SESSION_METHODS}).notNull(),
  passwordAt: text('password_at'),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at').notNull(),
  endedAt: text('ended_at'),
}, table => [check('sessions_method', sql`${table.method} in (${quoted(SESSION_METHODS)})`)]);

/**
 * A sign-in between its steps. Either the password was right and a passkey must follow (strict
 * mode), or a passkey sign-in has started. A short-lived cookie holds it for five minutes, and it
 * is stored as a hash.
 */
export const pendingSignIns = sqliteTable('pending_sign_ins', {
  hash: text('hash').primaryKey(),
  securityGeneration: integer('security_generation').notNull(),
  passwordAt: text('password_at'),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

/** A WebAuthn challenge, by hash, spent once: a sign-in's (tied to its pending sign-in) or a registration's. */
export const webauthnChallenges = sqliteTable('webauthn_challenges', {
  hash: text('hash').primaryKey(),
  purpose: text('purpose', {enum: ['sign_in', 'register']}).notNull(),
  pendingHash: text('pending_hash'),
  sessionId: integer('session_id').references(() => sessions.id, {onDelete: 'cascade'}),
  securityGeneration: integer('security_generation').notNull(),
  expiresAt: text('expires_at').notNull(),
}, table => [
  check('webauthn_purpose', sql`${table.purpose} in ('sign_in', 'register')`),
  check('webauthn_binding', sql`(${table.purpose} = 'sign_in') = (${table.pendingHash} is not null)`),
]);

/** A registered passkey. Its sign counter never goes back. */
export const passkeys = sqliteTable('passkeys', {
  id: integer('id').primaryKey({autoIncrement: true}),
  credentialId: text('credential_id').notNull().unique(),
  label: text('label').notNull(),
  // base64url of the COSE public key.
  publicKey: text('public_key').notNull(),
  signCount: integer('sign_count').notNull().default(0),
  transports: text('transports', {mode: 'json'}).$type<string[]>().notNull(),
  backedUp: integer('backed_up', {mode: 'boolean'}),
  deviceType: text('device_type'),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
});

/** Recovery codes, as hashes. Each works once. */
export const recoveryCodes = sqliteTable('recovery_codes', {
  hash: text('hash').primaryKey(),
  generatedAt: text('generated_at').notNull(),
  usedAt: text('used_at'),
});

/**
 * Home Assistant's bearer token for GET /api/status/ha. There is one at a time. The CLI
 * (`ha-token`) issues and rotates it, and only its SHA-256 is kept. Revoking deletes the row.
 */
export const haToken = sqliteTable('ha_token', {
  id: integer('id').primaryKey(),
  hash: text('hash').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [check('ha_token_singleton', sql`${table.id} = 1`)]);

// ---- Settings and secrets ----

/** One row per settings section (`@setpoint/shared` settingsSchema). Missing ones take the defaults. */
export const settings = sqliteTable('settings', {
  section: text('section').primaryKey(),
  value: text('value', {mode: 'json'}).notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Instance secrets (AI keys, the Places key, ntfy's token), encrypted, write-only through the API. */
export const secrets = sqliteTable('secrets', {
  name: text('name', {enum: SECRET_NAMES}).primaryKey(),
  ciphertext: text('ciphertext').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [check('secrets_name', sql`${table.name} in (${quoted(SECRET_NAMES)})`)]);

// ---- Sources, sync and jobs ----

/**
 * A provider connection: each mail account (`account_id`), Google Calendar per Google account (on
 * the same consent, so `account_id` too), Todoist and weather. The account carries the label,
 * colour, icon and order. The others show their provider's name. Health is derived on read from
 * the last check against the schedule (src/domain/health.ts).
 *
 * `dev` marks the seed's stand-in sources, which the in-process dev provider serves. A dev source
 * never holds credentials, and a source with credentials is never dev.
 */
export const sources = sqliteTable('sources', {
  id: integer('id').primaryKey({autoIncrement: true}),
  provider: text('provider', {enum: SOURCE_PROVIDERS}).notNull(),
  accountId: integer('account_id').references(() => accounts.id, {onDelete: 'cascade'}),
  // AES-256-GCM, src/secrets/crypto.ts's `sp2:` format.
  credentials: text('credentials'),
  dev: integer('dev', {mode: 'boolean'}).notNull().default(false),
  syncMode: text('sync_mode', {enum: SYNC_MODES}).notNull(),
  // The check's schedule: a poll, or the sweep behind a push.
  intervalSeconds: integer('interval_seconds').notNull(),
  pushRenewsAt: text('push_renews_at'),
  // The heartbeat: when a check last finished, last succeeded and last failed (with the provider's
  // words).
  lastCheckAt: text('last_check_at'),
  lastSuccessAt: text('last_success_at'),
  lastErrorAt: text('last_error_at'),
  lastError: text('last_error'),
  // The provider refused the credentials (revoked, expired). The source needs reconnect until new
  // ones arrive.
  needsReconnectAt: text('needs_reconnect_at'),
  createdAt: text('created_at').notNull(),
}, table => [
  uniqueIndex('sources_account_provider').on(table.accountId, table.provider),
  check('sources_provider', sql`${table.provider} in (${quoted(SOURCE_PROVIDERS)})`),
  check('sources_sync_mode', sql`${table.syncMode} in (${quoted(SYNC_MODES)})`),
  check('sources_dev_credentials', sql`not (${table.dev} and ${table.credentials} is not null)`),
  check('sources_interval', sql`${table.intervalSeconds} > 0`),
]);

/** Where incremental sync resumes: Gmail's history id, IMAP's UIDs, a calendar's sync token. */
export const syncCursors = sqliteTable('sync_cursors', {
  sourceId: integer('source_id').notNull().references(() => sources.id, {onDelete: 'cascade'}),
  // What the cursor is for within the source ("history", a calendar's id). "" for the source itself.
  scope: text('scope').notNull().default(''),
  cursor: text('cursor').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [uniqueIndex('sync_cursors_scope').on(table.sourceId, table.scope)]);

// The kinds besides syncs, sweeps, pushes and commands. `triage` is one email's triage, retried by
// the same policy while its models are down. `extract` puts one backfilled email through the history
// extraction pass. `news` is one News source's fetch (src/news/worker.ts). `news_sort` sorts what's
// Unsorted and runs the hourly re-score (src/news/sortWorker.ts). Jobs's `jobs_read` is a wiring
// point: Jobs reads what triage sorted in the accounts it reads (src/jobs/reader.ts). Removing Jobs
// may leave the value. `search_terms` is one email's search terms (src/search/terms.ts).
// `mailpieces` is one USPS digest's scans, which src/mailpieces/worker.ts reads from its source.
// `send` is one draft's send, due when its Undo hold ends (src/sending/worker.ts).
export const JOB_KINDS = ['sync', 'sweep', 'push', 'command', 'triage', 'extract', 'news', 'news_sort', 'jobs_read', 'search_terms', 'mailpieces', 'send'] as const;
export const JOB_STATES = ['queued', 'running', 'done', 'failed'] as const;

/**
 * Durable work: a source's sync, sweep or push renewal, or a command for its provider. A worker
 * claims a job with a lease, so one left running by a crash is taken up again. Failures follow the
 * one retry policy (src/domain/retry.ts). `key` keeps one queued or running job per purpose.
 * `again` asks a running sync for one more once it's done (a push that came while it ran).
 */
export const jobs = sqliteTable('jobs', {
  id: integer('id').primaryKey({autoIncrement: true}),
  kind: text('kind', {enum: JOB_KINDS}).notNull(),
  key: text('key').notNull(),
  sourceId: integer('source_id').references(() => sources.id, {onDelete: 'cascade'}),
  commandId: integer('command_id').references(() => commands.id, {onDelete: 'cascade'}),
  // The email a triage job sorts.
  messageId: integer('message_id').references(() => messages.id, {onDelete: 'cascade'}),
  // The News source a `news` job fetches.
  newsSourceId: integer('news_source_id').references((): AnySQLiteColumn => newsSources.id, {onDelete: 'cascade'}),
  // The draft a `send` job sends.
  draftId: integer('draft_id').references((): AnySQLiteColumn => drafts.id, {onDelete: 'cascade'}),
  state: text('state', {enum: JOB_STATES}).notNull().default('queued'),
  attempts: integer('attempts').notNull().default(0),
  runAt: text('run_at').notNull(),
  leaseUntil: text('lease_until'),
  lastError: text('last_error'),
  // When the last error came, for "as of" on a change waiting to try again.
  lastErrorAt: text('last_error_at'),
  createdAt: text('created_at').notNull(),
  finishedAt: text('finished_at'),
  again: integer('again', {mode: 'boolean'}).notNull().default(false),
}, table => [
  uniqueIndex('jobs_active_key').on(table.key).where(sql`${table.state} in ('queued', 'running')`),
  index('jobs_due').on(table.state, table.runAt),
  check('jobs_kind', sql`${table.kind} in (${quoted(JOB_KINDS)})`),
  check('jobs_state', sql`${table.state} in (${quoted(JOB_STATES)})`),
]);

/**
 * Every change to a provider (after mantel's `control`). It's pending until the provider confirms.
 * Otherwise it's failed, with the provider's own message, until Try again (pending again) or Move
 * back (reverted). The mirror shows the change from the start, and `previous` holds what Move back
 * restores. One active (pending or failed) command per target.
 */
export const commands = sqliteTable('commands', {
  id: integer('id').primaryKey({autoIncrement: true}),
  target: text('target', {enum: COMMAND_TARGETS}).notNull(),
  targetId: integer('target_id').notNull(),
  kind: text('kind', {enum: COMMAND_KINDS}).notNull(),
  sourceId: integer('source_id').references(() => sources.id, {onDelete: 'set null'}),
  state: text('state', {enum: COMMAND_STATES}).notNull().default('pending'),
  // What the provider is asked to do, and what the mirror held before (for Move back).
  payload: text('payload', {mode: 'json'}).$type<Record<string, unknown>>().notNull(),
  previous: text('previous', {mode: 'json'}).$type<Record<string, unknown> | null>(),
  // An item change's earlier time, for the failed card's "From Fri, Oct 9".
  previousWhen: text('previous_when', {mode: 'json'}).$type<ItemWhen | null>(),
  providerMessage: text('provider_message'),
  attempts: integer('attempts').notNull().default(0),
  createdAt: text('created_at').notNull(),
  settledAt: text('settled_at'),
}, table => [
  uniqueIndex('commands_one_active').on(table.target, table.targetId).where(sql`${table.state} in ('pending', 'failed')`),
  check('commands_target', sql`${table.target} in (${quoted(COMMAND_TARGETS)})`),
  check('commands_kind', sql`${table.kind} in (${quoted(COMMAND_KINDS)})`),
  check('commands_state', sql`${table.state} in (${quoted(COMMAND_STATES)})`),
]);

// ---- The notification log and the AI usage ledger ----

/** Every notification notify() sent or tried. `dedupe` keeps "once" once (a reconnect alert, a reminder). */
export const notifications = sqliteTable('notifications', {
  id: integer('id').primaryKey({autoIncrement: true}),
  kind: text('kind', {enum: NOTIFICATION_KINDS}).notNull(),
  topic: text('topic', {enum: NOTIFY_TOPICS}).notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  click: text('click'),
  dedupe: text('dedupe').unique(),
  state: text('state', {enum: ['sent', 'failed', 'skipped']}).notNull(),
  error: text('error'),
  createdAt: text('created_at').notNull(),
}, table => [
  check('notifications_kind', sql`${table.kind} in (${quoted(NOTIFICATION_KINDS)})`),
  check('notifications_topic', sql`${table.topic} in (${quoted(NOTIFY_TOPICS)})`),
  check('notifications_state', sql`${table.state} in ('sent', 'failed', 'skipped')`),
]);

/** Each model call: what it was for, its tokens and cost (Settings › AI; triage, search and Alfred write it). */
export const aiUsage = sqliteTable('ai_usage', {
  id: integer('id').primaryKey({autoIncrement: true}),
  at: text('at').notNull(),
  provider: text('provider', {enum: AI_PROVIDERS}).notNull(),
  model: text('model').notNull(),
  purpose: text('purpose', {enum: AI_PURPOSES}).notNull(),
  messageId: integer('message_id').references(() => messages.id, {onDelete: 'set null'}),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  cachedTokens: integer('cached_tokens').notNull().default(0),
  // US dollars × 1,000,000.
  costMicros: integer('cost_micros').notNull(),
}, table => [
  index('ai_usage_at').on(table.at),
  check('ai_usage_provider', sql`${table.provider} in (${quoted(AI_PROVIDERS)})`),
  check('ai_usage_purpose', sql`${table.purpose} in (${quoted(AI_PURPOSES)})`),
]);

// ---- Calendar, Todoist and weather ----

export const CHANNEL_STATES = ['pending', 'active', 'retired', 'unsupported'] as const;

/**
 * A Google Calendar watch channel (push). Its token is kept as a SHA-256 hash. A notification must
 * name the channel, carry the token and match the resource Google gave it.
 * `unsupported` remembers a calendar Google can't watch (holidays) until `expires_at`.
 */
export const calendarChannels = sqliteTable('calendar_channels', {
  id: text('id').primaryKey(),
  sourceId: integer('source_id').notNull().references(() => sources.id, {onDelete: 'cascade'}),
  calendarId: integer('calendar_id').notNull().references(() => calendars.id, {onDelete: 'cascade'}),
  address: text('address').notNull(),
  tokenHash: text('token_hash').notNull(),
  resourceId: text('resource_id'),
  state: text('state', {enum: CHANNEL_STATES}).notNull(),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
  lastNotificationAt: text('last_notification_at'),
}, table => [
  index('calendar_channels_calendar').on(table.calendarId, table.state),
  check('calendar_channels_state', sql`${table.state} in (${quoted(CHANNEL_STATES)})`),
]);

/**
 * Todoist's projects, for a task's project name and the editor's picker, and their colours for the
 * task rings. The id is Setpoint's own, so a colour change's command can name its project.
 */
export const todoistProjects = sqliteTable('todoist_projects', {
  id: integer('id').primaryKey({autoIncrement: true}),
  providerId: text('provider_id').notNull(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
  inbox: integer('inbox', {mode: 'boolean'}).notNull().default(false),
  // Todoist's colour name (TODOIST_COLOURS). Null for one Setpoint doesn't know. No check, so a
  // colour Todoist adds later can't stop a sync.
  colour: text('colour'),
}, table => [uniqueIndex('todoist_projects_provider').on(table.providerId)]);

/** Todoist's personal labels, mirrored by sync, for a task's labels picker. */
export const todoistLabels = sqliteTable('todoist_labels', {
  providerId: text('provider_id').primaryKey(),
  name: text('name').notNull(),
  position: integer('position').notNull(),
});

/**
 * Todoist's OAuth state between Connect and the callback. It is single use and lasts ten minutes.
 * A cookie binds it to the browser that started it, and the cookie's hash is kept here.
 */
export const todoistOauthStates = sqliteTable('todoist_oauth_states', {
  hash: text('hash').primaryKey(),
  bindHash: text('bind_hash').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
});

/**
 * Time to Leave's route for one occurrence, from Home to the event's place, checked on its
 * cadence (src/domain/timeToLeave.ts). `inputs` fingerprints Home, the destination and the start
 * the route was asked for, so an answer for an event that moved meanwhile is thrown away.
 */
export const travelEstimates = sqliteTable('travel_estimates', {
  itemId: integer('item_id').notNull().references(() => items.id, {onDelete: 'cascade'}),
  occurrenceStart: text('occurrence_start').notNull(),
  inputs: text('inputs').notNull(),
  durationSeconds: integer('duration_seconds'),
  distanceMeters: integer('distance_meters'),
  leaveAt: text('leave_at'),
  checkedAt: text('checked_at'),
  nextCheckAt: text('next_check_at'),
  error: text('error'),
}, table => [uniqueIndex('travel_estimates_occurrence').on(table.itemId, table.occurrenceStart)]);

/** Where a scheduler got to ("reminders": the last moment reminders were sent up to). */
export const scheduleMarks = sqliteTable('schedule_marks', {
  name: text('name').primaryKey(),
  at: text('at').notNull(),
});

// ---- Triage: rules, pattern prompts' answers, imported evidence and triage's health ----

export const RULE_ORIGINS = ['written', 'learned'] as const;

/**
 * Triage's rules (Settings › Mail): written ones (the user's, some brought over at cutover) in
 * their order, and learned ones from a pattern prompt's Yes. `match` is `@setpoint/shared`'s
 * ruleMatchSchema. No rule moves protected mail, because triage applies protection after every
 * rule.
 */
export const triageRules = sqliteTable('triage_rules', {
  id: integer('id').primaryKey({autoIncrement: true}),
  origin: text('origin', {enum: RULE_ORIGINS}).notNull(),
  match: text('match', {mode: 'json'}).$type<RuleMatch>().notNull(),
  lane: text('lane', {enum: LANES}).notNull(),
  kind: text('kind', {enum: KINDS}),
  position: integer('position').notNull(),
  enabled: integer('enabled', {mode: 'boolean'}).notNull().default(true),
  // A written rule's actions: mark read, and trash now or after a delay (RULE_TRASH). Learned
  // rules keep false and 'never'. The actions apply to mail that arrived at or after `changed_at`
  // (created, edited or turned on). The email remembers its rule in messages.triage_rule_id.
  markRead: integer('mark_read', {mode: 'boolean'}).notNull().default(false),
  trash: text('trash', {enum: RULE_TRASH}).notNull().default('never'),
  changedAt: text('changed_at'),
  // `v1:<rule name>` for a rule brought over at cutover. Null for every other rule.
  importedFrom: text('imported_from').unique(),
  createdAt: text('created_at').notNull(),
}, table => [
  check('triage_rules_origin', sql`${table.origin} in (${quoted(RULE_ORIGINS)})`),
  check('triage_rules_lane', sql`${table.lane} in (${quoted(LANES)})`),
  check('triage_rules_kind', sql`${table.kind} is null or ${table.kind} in (${quoted(KINDS)})`),
  check('triage_rules_noise', sql`${table.lane} <> 'noise' or ${table.kind} is null`),
]);

/**
 * A pattern prompt, one per organisation and type, kept so it has an id and its answer sticks.
 * Triage writes it when the pattern first appears and keeps its count and emails current while
 * it's open. Yes made `rule_id` (a learned rule), and No keeps it quiet for good. It is open while
 * `answer` is null. `organisation_key` is the organisation lower-cased (src/domain/triageRules.ts
 * organisationKey).
 */
export const patternPrompts = sqliteTable('pattern_prompts', {
  id: integer('id').primaryKey({autoIncrement: true}),
  organisationKey: text('organisation_key').notNull(),
  organisation: text('organisation').notNull(),
  type: text('type', {enum: MESSAGE_TYPES}).notNull(),
  kind: text('kind', {enum: KINDS}).notNull(),
  count: integer('count').notNull(),
  messageIds: text('message_ids', {mode: 'json'}).$type<number[]>().notNull(),
  answer: text('answer', {enum: ['yes', 'no']}),
  ruleId: integer('rule_id').references(() => triageRules.id, {onDelete: 'set null'}),
  createdAt: text('created_at').notNull(),
  answeredAt: text('answered_at'),
}, table => [
  uniqueIndex('pattern_prompts_key').on(table.organisationKey, table.type),
  check('pattern_prompts_answer', sql`${table.answer} is null or ${table.answer} in ('yes', 'no')`),
  check('pattern_prompts_answered', sql`(${table.answer} is null) = (${table.answeredAt} is null)`),
  check('pattern_prompts_type', sql`${table.type} in (${quoted(MESSAGE_TYPES)})`),
  check('pattern_prompts_kind', sql`${table.kind} in (${quoted(KINDS)})`),
]);

/**
 * Evidence for the learning loop from outside the message record: lane corrections, brought
 * over once at cutover. A correction out of Attention counts as a Done without opening. One
 * into Attention counts as one opened first. Lanes are Setpoint's.
 */
export const triageEvidence = sqliteTable('triage_evidence', {
  id: integer('id').primaryKey({autoIncrement: true}),
  source: text('source', {enum: ['v1_correction']}).notNull(),
  organisationKey: text('organisation_key').notNull(),
  organisation: text('organisation').notNull(),
  type: text('type', {enum: MESSAGE_TYPES}),
  fromAddress: text('from_address').notNull(),
  subject: text('subject').notNull(),
  fromLane: text('from_lane', {enum: LANES}).notNull(),
  toLane: text('to_lane', {enum: LANES}).notNull(),
  at: text('at').notNull(),
  // What the cutover's import kept it unique by. Nothing adds to this table now.
  dedupe: text('dedupe').notNull().unique(),
}, table => [
  index('triage_evidence_key').on(table.organisationKey, table.type),
  check('triage_evidence_source', sql`${table.source} in ('v1_correction')`),
  check('triage_evidence_type', sql`${table.type} is null or ${table.type} in (${quoted(MESSAGE_TYPES)})`),
  check('triage_evidence_lanes', sql`${table.fromLane} in (${quoted(LANES)}) and ${table.toLane} in (${quoted(LANES)})`),
]);

/**
 * Triage's heartbeat, one row: its last successful and failed model calls, for "Triage is down, as
 * of 9:09 AM". Triage is down while the last call failed.
 */
export const triageHealth = sqliteTable('triage_health', {
  id: integer('id').primaryKey(),
  lastSuccessAt: text('last_success_at'),
  lastFailureAt: text('last_failure_at'),
  lastError: text('last_error'),
}, table => [check('triage_health_singleton', sql`${table.id} = 1`)]);

// ---- Search and Alfred: the search log and Alfred's short threads ----

/** Which reading a search used, as the search log holds it: what the model said, and what became of it. */
export interface SearchReadingLog {
  // 'model' asked it, 'cache' reused its last answer, 'kept' came with the request, null read
  // nothing.
  source: 'model' | 'cache' | 'kept' | null;
  fallback: SearchReadingFallback | null;
  prompt: number;
  organisations: string[];
  types: string[];
  keywords: string;
  is_date: boolean;
  more: number;
  // Time from the request to the answer.
  ms: number;
}

/**
 * Each search from the field, logged so ranking can be measured against real searches. It holds
 * what was typed, the chips in force, the free text left, and the ids it returned in order, with
 * later pages appended. Alfred's own searches aren't logged.
 */
export const searchLog = sqliteTable('search_log', {
  id: integer('id').primaryKey({autoIncrement: true}),
  at: text('at').notNull(),
  // The field's text as sent, and the free text left after the chips.
  query: text('query').notNull(),
  freeText: text('free_text').notNull(),
  chips: text('chips', {mode: 'json'}).$type<SearchChip[]>().notNull(),
  // The account the search ran inside (the sidebar's), if any.
  accountId: integer('account_id').references(() => accounts.id, {onDelete: 'set null'}),
  order: text('order', {enum: ['newest', 'match']}).notNull(),
  total: integer('total').notNull(),
  resultIds: text('result_ids', {mode: 'json'}).$type<number[]>().notNull(),
  // `source: 'kept'` for a search with a suggestion's chips. Null for one without.
  reading: text('reading', {mode: 'json'}).$type<SearchReadingLog>(),
}, table => [
  index('search_log_at').on(table.at),
  check('search_log_order', sql`${table.order} in ('newest', 'match')`),
]);

/** A result opened from a search, and its position in the list (0-based). */
export const searchOpens = sqliteTable('search_opens', {
  id: integer('id').primaryKey({autoIncrement: true}),
  searchId: integer('search_id').notNull().references(() => searchLog.id, {onDelete: 'cascade'}),
  messageId: integer('message_id').references(() => messages.id, {onDelete: 'set null'}),
  position: integer('position').notNull(),
  at: text('at').notNull(),
}, table => [index('search_opens_search').on(table.searchId)]);

/**
 * A suggestion offered for the field's text, and whether it reached the screen and was accepted,
 * so acceptance can be judged. For one with a reading in it, `reading` is what the model said.
 */
export const searchSuggestions = sqliteTable('search_suggestions', {
  id: integer('id').primaryKey({autoIncrement: true}),
  at: text('at').notNull(),
  query: text('query').notNull(),
  accountId: integer('account_id').references(() => accounts.id, {onDelete: 'set null'}),
  chips: text('chips', {mode: 'json'}).$type<SearchChip[]>().notNull(),
  // The word results' rows, those it would hide, and the rows it would leave.
  words: integer('words').notNull(),
  hides: integer('hides').notNull(),
  total: integer('total').notNull(),
  reading: text('reading', {mode: 'json'}).$type<SearchReadingLog>(),
  shownAt: text('shown_at'),
  acceptedAt: text('accepted_at'),
  // The search that accepting it ran. That search's chip removals say what became of it.
  searchId: integer('search_id').references(() => searchLog.id, {onDelete: 'set null'}),
}, table => [index('search_suggestions_at').on(table.at)]);

/** A chip taken off a search: what a wrong reading looks like in the log. */
export const searchChipRemovals = sqliteTable('search_chip_removals', {
  id: integer('id').primaryKey({autoIncrement: true}),
  searchId: integer('search_id').notNull().references(() => searchLog.id, {onDelete: 'cascade'}),
  chip: text('chip', {mode: 'json'}).$type<SearchChip>().notNull(),
  at: text('at').notNull(),
}, table => [index('search_chip_removals_search').on(table.searchId)]);

/**
 * One of Alfred's short threads (the Answer card's follow-ups), held so a
 * follow-up continues it. `transcript` is the model provider's own message list. Alfred only ever
 * appends to it, so a follow-up resends it unchanged. Scoped to one email for Ask about this email.
 */
export const alfredConversations = sqliteTable('alfred_conversations', {
  id: integer('id').primaryKey({autoIncrement: true}),
  messageId: integer('message_id').references(() => messages.id, {onDelete: 'set null'}),
  provider: text('provider', {enum: AI_PROVIDERS}).notNull(),
  model: text('model').notNull(),
  // `items` is the provider's message list. `pending` holds the results of the last turn's tool
  // calls (its `answer`), sent with the next question. `seen` holds the emails the thread has
  // searched or read, which its answers may cite.
  transcript: text('transcript', {mode: 'json'}).$type<{items: unknown[]; pending: {id: string; output: string; error?: boolean; document?: {data: string; title: string}}[]; seen: number[]; noted?: string[]}>().notNull(),
  createdAt: text('created_at').notNull(),
  touchedAt: text('touched_at').notNull(),
}, table => [
  index('alfred_conversations_touched').on(table.touchedAt),
  check('alfred_conversations_provider', sql`${table.provider} in (${quoted(AI_PROVIDERS)})`),
]);

/** A question and Alfred's answer in a thread: the answer's text, sources and proposals, as shown. */
export const alfredTurns = sqliteTable('alfred_turns', {
  id: integer('id').primaryKey({autoIncrement: true}),
  conversationId: integer('conversation_id').notNull().references(() => alfredConversations.id, {onDelete: 'cascade'}),
  at: text('at').notNull(),
  question: text('question').notNull(),
  // Null: "Couldn't find that in your mail or calendar".
  answer: text('answer'),
  emphasis: text('emphasis', {mode: 'json'}).$type<EmphasisOut[]>().notNull(),
  sourceIds: text('source_ids', {mode: 'json'}).$type<number[]>().notNull(),
  // The events and tasks it rests on, as list_items gave them then.
  itemSources: text('item_sources', {mode: 'json'}).$type<AnswerItemOut[]>().notNull().default(sql`'[]'`),
  // The job applications it rests on, as a registered tool (Jobs') gave them then.
  applicationSources: text('application_sources', {mode: 'json'}).$type<AnswerApplicationOut[]>().notNull().default(sql`'[]'`),
  searched: text('searched', {mode: 'json'}).$type<string[]>().notNull(),
  proposals: text('proposals', {mode: 'json'}).$type<ProposalOut[]>().notNull(),
}, table => [index('alfred_turns_conversation').on(table.conversationId)]);

// ---- What the cutover import left ----

/**
 * Pins brought over at cutover that waited for their emails after the cutover. Nothing reads or
 * writes it now, and the table stays until a migration has another reason to drop it.
 */
export const pendingPins = sqliteTable('pending_pins', {
  id: integer('id').primaryKey({autoIncrement: true}),
  accountId: integer('account_id').notNull().references(() => accounts.id, {onDelete: 'cascade'}),
  providerId: text('provider_id'),
  messageId: text('message_id'),
  pinnedAt: text('pinned_at').notNull(),
}, table => [
  uniqueIndex('pending_pins_provider').on(table.accountId, table.providerId),
  uniqueIndex('pending_pins_message').on(table.accountId, table.messageId),
  check('pending_pins_key', sql`${table.providerId} is not null or ${table.messageId} is not null`),
]);

// ---- Todoist's webhook ----

/**
 * Todoist webhook deliveries already taken (X-Todoist-Delivery-Id), so a redelivery queues nothing.
 * Kept 30 days. The payload isn't stored, because a delivery only wakes a sync.
 */
export const todoistWebhookDeliveries = sqliteTable('todoist_webhook_deliveries', {
  deliveryId: text('delivery_id').primaryKey(),
  receivedAt: text('received_at').notNull(),
});

// ---- News: sources, articles, stories, their facts and seen state, and image copies ----

// Which adapter reads a News source: shared's NEWS_ADAPTERS (Settings › News draws its icon from it).
export {NEWS_ADAPTERS};
export type {NewsAdapterKey};
/** Where a source came from: the built-in list in the repository, or the data directory's local list. */
export const NEWS_SOURCE_ORIGINS = ['default', 'local'] as const;

/**
 * A News source (Settings › News): one feed, official API, page read or discovery search, with its
 * own heartbeat and health. It is kept apart from `sources` (the accounts', calendar's and
 * weather's). A failing feed shows only in Settings › News, never in the health pill,
 * Settings › Accounts or mantel's status. Health is derived on read, as for `sources`.
 *
 * `key` is stable across restarts, so the lists re-register without duplicates. A source dropped
 * from its list is retired (its articles stay). `dev` marks the seed's stand-ins, which no adapter
 * ever fetches. `config` is the adapter's own (a radius, a points threshold, a search's terms).
 */
export const newsSources = sqliteTable('news_sources', {
  id: integer('id').primaryKey({autoIncrement: true}),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  section: text('section', {enum: NEWS_SECTIONS}).notNull(),
  kind: text('kind', {enum: NEWS_SOURCE_KINDS}).notNull(),
  adapter: text('adapter', {enum: NEWS_ADAPTERS}).notNull(),
  // The feed, page or API base. Null where the home location makes it (NWS's zone).
  url: text('url'),
  // What's read, for Settings › News: "Feed, Local News only", "M3 and up within 100 km".
  reads: text('reads').notNull(),
  config: text('config', {mode: 'json'}).$type<Record<string, unknown>>().notNull().default({}),
  origin: text('origin', {enum: NEWS_SOURCE_ORIGINS}).notNull(),
  dev: integer('dev', {mode: 'boolean'}).notNull().default(false),
  // Its pages can't be read in-app (KTLA, OpenAI), so its articles show their feed summary and the
  // link.
  summaryOnly: integer('summary_only', {mode: 'boolean'}).notNull().default(false),
  // A metered paper. It counts toward and confirms stories, but is never shown or readable.
  metered: integer('metered', {mode: 'boolean'}).notNull().default(false),
  intervalSeconds: integer('interval_seconds').notNull(),
  position: integer('position').notNull(),
  // Where the next fetch resumes (a feed's ETag and Last-Modified, an API's last id). The adapter's
  // own.
  cursor: text('cursor'),
  // The heartbeat, as on `sources`, and when the current failure began ("Failing, 404 since 6:02 AM").
  lastCheckAt: text('last_check_at'),
  lastSuccessAt: text('last_success_at'),
  lastErrorAt: text('last_error_at'),
  lastError: text('last_error'),
  failingSince: text('failing_since'),
  retiredAt: text('retired_at'),
  createdAt: text('created_at').notNull(),
}, table => [
  check('news_sources_section', sql`${table.section} in (${quoted(NEWS_SECTIONS)})`),
  check('news_sources_kind', sql`${table.kind} in (${quoted(NEWS_SOURCE_KINDS)})`),
  check('news_sources_adapter', sql`${table.adapter} in (${quoted(NEWS_ADAPTERS)})`),
  check('news_sources_origin', sql`${table.origin} in (${quoted(NEWS_SOURCE_ORIGINS)})`),
  check('news_sources_interval', sql`${table.intervalSeconds} > 0`),
]);

/**
 * One outlet's article, as its source gave it: per source, by canonical URL. `extracted_text` is the
 * page's text, dropped when its story leaves the page. `summary_only` is set when the page can't be
 * read in-app. A `metered` article counts but never shows. A `discovery` article was only found
 * (Google News), with no text. An article joins at most one story (`news_story_articles`). Until
 * then it's Unsorted.
 */
export const newsArticles = sqliteTable('news_articles', {
  id: integer('id').primaryKey({autoIncrement: true}),
  sourceId: integer('source_id').notNull().references(() => newsSources.id),
  url: text('url').notNull(),
  canonicalUrl: text('canonical_url').notNull(),
  // "NBC Los Angeles", and the short name rows use ("NBC LA"). Null uses the outlet.
  outlet: text('outlet').notNull(),
  outletShort: text('outlet_short'),
  byline: text('byline'),
  headline: text('headline').notNull(),
  feedSummary: text('feed_summary'),
  extractedText: text('extracted_text'),
  summaryOnly: integer('summary_only', {mode: 'boolean'}).notNull().default(false),
  metered: integer('metered', {mode: 'boolean'}).notNull().default(false),
  discovery: integer('discovery', {mode: 'boolean'}).notNull().default(false),
  publishedAt: text('published_at').notNull(),
  // The outlet's image, before Setpoint copies it. Never served.
  imageUrl: text('image_url'),
  fetchedAt: text('fetched_at').notNull(),
  // Where it happened, from official data (a fire's or a quake's point) or the model's reading,
  // for Local's closeness.
  lat: real('lat'),
  lng: real('lng'),
  // Claude Haiku 5.5's reading (its fact notes, sections, importance), once read.
  notes: text('notes', {mode: 'json'}).$type<ArticleNotes>(),
  // Its text's opening words, to count identical wire copy as one outlet.
  wireKey: text('wire_key'),
  // Why it was left out, when it's noise. It never joins a story.
  noise: text('noise').$type<NoiseReason>(),
  // When sorting finished with it: grouped into a story, or found to be noise. Null is Unsorted.
  sortedAt: text('sorted_at'),
}, table => [
  uniqueIndex('news_articles_canonical').on(table.sourceId, table.canonicalUrl),
  index('news_articles_fetched').on(table.fetchedAt),
  index('news_articles_sorted').on(table.sortedAt),
  check('news_articles_readable', sql`not (${table.discovery} and ${table.extractedText} is not null)`),
]);

/**
 * A story: the articles about one event, with the model's headline, one line and summary.
 * `score` is its ranking, biggest first. `last_new_fact_at` moves only on a new fact. Then the dot
 * comes back as updated, and the story leaves the page 48 h after it. Seen is per story (`seen_at`,
 * the last time the user saw it). `expired_unseen` records that it left the page before they did,
 * and the recap is built on that. The lead and image articles are sorting's picks among its sources.
 */
export const newsStories = sqliteTable('news_stories', {
  id: integer('id').primaryKey({autoIncrement: true}),
  headline: text('headline').notNull(),
  oneLine: text('one_line'),
  summary: text('summary'),
  score: integer('score').notNull().default(0),
  leadArticleId: integer('lead_article_id').references((): AnySQLiteColumn => newsArticles.id, {onDelete: 'set null'}),
  imageArticleId: integer('image_article_id').references((): AnySQLiteColumn => newsArticles.id, {onDelete: 'set null'}),
  firstReportedAt: text('first_reported_at').notNull(),
  lastNewFactAt: text('last_new_fact_at').notNull(),
  seenAt: text('seen_at'),
  expiredAt: text('expired_at'),
  expiredUnseen: integer('expired_unseen', {mode: 'boolean'}).notNull().default(false),
  createdAt: text('created_at').notNull(),
  // The model's importance, 0–100: the highest of its articles', then its writer's judgement (the
  // hourly ranking's before that). Also its outlets, with wire copy counted once. With recency,
  // growth and closeness they make `score`. `ranked_at` is when it was last judged.
  importance: integer('importance').notNull().default(0),
  outlets: integer('outlets').notNull().default(0),
  rankedAt: text('ranked_at'),
  // The headline and summary are due to be written (a new story, or new facts), and when they were.
  needsWriting: integer('needs_writing', {mode: 'boolean'}).notNull().default(false),
  writtenAt: text('written_at'),
  // Rated under the write gate and never written. It shows only under its section's Also
  // reported, never in All, the recap or a section's own rows.
  belowGate: integer('below_gate', {mode: 'boolean'}).notNull().default(false),
  // Made by the first run's fill of the last 48 hours. It never goes to the recap.
  backfill: integer('backfill', {mode: 'boolean'}).notNull().default(false),
}, table => [
  index('news_stories_live').on(table.expiredAt, table.score),
  index('news_stories_fact').on(table.lastNewFactAt),
  check('news_stories_unseen', sql`not ${table.expiredUnseen} or ${table.expiredAt} is not null`),
]);

/** The sections a story sits in (one or more), in the order sorting gave them. */
export const newsStorySections = sqliteTable('news_story_sections', {
  storyId: integer('story_id').notNull().references(() => newsStories.id, {onDelete: 'cascade'}),
  section: text('section', {enum: NEWS_SECTIONS}).notNull(),
  position: integer('position').notNull(),
}, table => [
  uniqueIndex('news_story_sections_key').on(table.storyId, table.section),
  index('news_story_sections_section').on(table.section),
  check('news_story_sections_section', sql`${table.section} in (${quoted(NEWS_SECTIONS)})`),
]);

/** Which story an article is about: each article in at most one. */
export const newsStoryArticles = sqliteTable('news_story_articles', {
  storyId: integer('story_id').notNull().references(() => newsStories.id, {onDelete: 'cascade'}),
  articleId: integer('article_id').notNull().unique().references(() => newsArticles.id, {onDelete: 'cascade'}),
  linkedAt: text('linked_at').notNull(),
}, table => [index('news_story_articles_story').on(table.storyId)]);

/**
 * A story's facts timeline, each with its time and the article that brought it. "New since you
 * looked" is the facts after `seen_at`. Dropped when the story leaves the page (the archive keeps
 * its summary, not its detail).
 */
export const newsFacts = sqliteTable('news_facts', {
  id: integer('id').primaryKey({autoIncrement: true}),
  storyId: integer('story_id').notNull().references(() => newsStories.id, {onDelete: 'cascade'}),
  at: text('at').notNull(),
  text: text('text').notNull(),
  articleId: integer('article_id').references(() => newsArticles.id, {onDelete: 'set null'}),
}, table => [index('news_facts_story').on(table.storyId, table.at)]);

export const NEWS_IMAGE_VARIANTS = ['large', 'thumb'] as const;

/**
 * Setpoint's copies of an article's image, resized and served by Setpoint itself: a large
 * one for a block's lead, the pane and the article, and a thumbnail for rows. The bytes are a file
 * in the data directory's news-images/ (src/news/images.ts), and `file` is its name there. When a
 * story leaves the page, only its own thumbnail stays, for the archive's 90 days.
 */
export const newsImages = sqliteTable('news_images', {
  id: integer('id').primaryKey({autoIncrement: true}),
  articleId: integer('article_id').notNull().references(() => newsArticles.id, {onDelete: 'cascade'}),
  variant: text('variant', {enum: NEWS_IMAGE_VARIANTS}).notNull(),
  file: text('file').notNull().unique(),
  mimeType: text('mime_type').notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: text('created_at').notNull(),
}, table => [
  uniqueIndex('news_images_article').on(table.articleId, table.variant),
  check('news_images_variant', sql`${table.variant} in (${quoted(NEWS_IMAGE_VARIANTS)})`),
  check('news_images_size', sql`${table.width} > 0 and ${table.height} > 0`),
]);

/**
 * Upcoming: a keynote found from invite headlines and confirmed, shown at the top of its block
 * until it starts ("Apple event · Tue Oct 20 · 10 AM"). `story_id` is the story that announced it.
 */
export const newsEvents = sqliteTable('news_events', {
  id: integer('id').primaryKey({autoIncrement: true}),
  storyId: integer('story_id').notNull().references(() => newsStories.id, {onDelete: 'cascade'}),
  section: text('section', {enum: NEWS_SECTIONS}).notNull(),
  name: text('name').notNull(),
  startsAt: text('starts_at').notNull(),
  allDay: integer('all_day', {mode: 'boolean'}).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, table => [
  index('news_events_starts').on(table.startsAt),
  check('news_events_section', sql`${table.section} in (${quoted(NEWS_SECTIONS)})`),
]);

/**
 * While you were away, one row. It holds when the last recap was put away (null before the first
 * was, so the first holds what Missed held). It holds when this one was first on screen and the
 * stories it was fixed with then. It holds when the user was last on News, for the hour away that
 * puts it away (src/domain/news.ts).
 */
export const newsRecap = sqliteTable('news_recap', {
  id: integer('id').primaryKey(),
  putAwayAt: text('put_away_at'),
  shownAt: text('shown_at'),
  storyIds: text('story_ids', {mode: 'json'}).$type<number[]>(),
  hereAt: text('here_at'),
}, table => [check('news_recap_singleton', sql`${table.id} = 1`)]);

/**
 * News's sorting, one row. It holds its health as triage's is: down while its last model call
 * failed or there was no model to ask, with when this spell began and the provider's words. It also
 * holds the first run's span, and when the hourly re-score last ran (`last_ranked_at`).
 */
export const newsSorting = sqliteTable('news_sorting', {
  id: integer('id').primaryKey(),
  lastSuccessAt: text('last_success_at'),
  lastFailureAt: text('last_failure_at'),
  failingSince: text('failing_since'),
  lastError: text('last_error'),
  // The failure's ProviderError kind, or 'no_key'.
  lastErrorKind: text('last_error_kind'),
  firstRunStartedAt: text('first_run_started_at'),
  firstRunDoneAt: text('first_run_done_at'),
  lastRankedAt: text('last_ranked_at'),
}, table => [check('news_sorting_singleton', sql`${table.id} = 1`)]);

/**
 * A USPS Informed Delivery digest's day, kept 30 days (src/mailpieces/worker.ts prunes it). It
 * holds the day the digest is for, and how many mailpieces it said were coming. That may be more
 * than it had scans for. The email may go (trashed, deleted) while its day stays.
 */
export const mailDigests = sqliteTable('mail_digests', {
  id: integer('id').primaryKey({autoIncrement: true}),
  messageId: integer('message_id').references(() => messages.id, {onDelete: 'set null'}),
  // Local `YYYY-MM-DD`.
  day: text('day').notNull(),
  pieces: integer('pieces').notNull(),
  storedAt: text('stored_at').notNull(),
}, table => [
  uniqueIndex('mail_digests_message').on(table.messageId),
  index('mail_digests_day').on(table.day),
]);

/** One mailpiece's picture in a digest, in the digest's order. Ads (ride-alongs) are never kept. */
export const mailScans = sqliteTable('mail_scans', {
  id: integer('id').primaryKey({autoIncrement: true}),
  digestId: integer('digest_id').notNull().references(() => mailDigests.id, {onDelete: 'cascade'}),
  position: integer('position').notNull(),
  mimeType: text('mime_type').notNull(),
  bytes: blob('bytes', {mode: 'buffer'}).notNull(),
}, table => [uniqueIndex('mail_scans_order').on(table.digestId, table.position)]);
