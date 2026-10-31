// Jobs's tables (J1), all `jobs_`, in their own Drizzle schema and migrations folder (./drizzle, made
// by `npx drizzle-kit generate --config src/jobs/drizzle.config.ts` from server/), applied with their
// own migrations table after the main ones (./db.ts). They point at mail by message and account id
// only, as plain integers with no foreign key, and nothing in mail's tables points back (D303), so
// drop.sql removes them without touching mail and mail never waits on Jobs.
//
// Timestamps are ISO 8601 UTC strings; JSON columns hold values checked by `@setpoint/shared`.
import {sql} from 'drizzle-orm';
import {check, index, integer, sqliteTable, text, uniqueIndex, type AnySQLiteColumn} from 'drizzle-orm/sqlite-core';
import {
  JD_LOOKUPS, JD_SOURCES, JOB_EVENT_KINDS, JOB_HAND_FIELDS, JOB_STATUS_SETTERS, JOB_STATUSES, JOB_WORKPLACES, NEEDS_YOU_KINDS, NEEDS_YOU_REASONS,
  type JobsReadAccount,
} from '@setpoint/shared';
import {PROVIDER_ERROR_KINDS} from '../domain/retry.ts';
import {JOB_EMAIL_EVENTS} from './prompt.ts';

const quoted = (values: readonly string[]) => sql.raw(values.map(value => `'${value}'`).join(', '));

/** Jobs's own migrations table, so its migrations never mix with the app's. */
export const JOBS_MIGRATIONS_TABLE = 'jobs_migrations';

/**
 * An application: a company and a role (decision 51). `titleKey` is the title normalised (case,
 * brackets and tags like "remote" ignored) for matching; `requisitionId` wins over it when an email
 * gives one. Status is never Ghosted (that's computed), and `statusSetBy` says whether an email or the
 * user set it (decision 68). Applications are kept for good (decision 63).
 */
export const jobsApplications = sqliteTable('jobs_applications', {
  id: integer('id').primaryKey({autoIncrement: true}),
  company: text('company').notNull(),
  title: text('title').notNull(),
  titleKey: text('title_key').notNull(),
  requisitionId: text('requisition_id'),
  // Triage's `via` for its confirmation ("Greenhouse").
  platform: text('platform'),
  // mail's accounts.id, no foreign key: the account its emails came to.
  accountId: integer('account_id'),
  appliedAt: text('applied_at').notNull(),
  status: text('status', {enum: JOB_STATUSES}).notNull(),
  statusSetBy: text('status_set_by', {enum: JOB_STATUS_SETTERS}).notNull(),
  statusSetAt: text('status_set_at').notNull(),
  // The latest step as the email states it ("Interview Tue Oct 13, 2:00 PM").
  step: text('step'),
  stepAt: text('step_at'),
  // A re-application links to the closed one before it (decision 51).
  reappliedFromId: integer('reapplied_from_id').references((): AnySQLiteColumn => jobsApplications.id, {onDelete: 'set null'}),
  // Made by Track this: Applied is its email's date (decision 69).
  firstSeenInEmail: integer('first_seen_in_email', {mode: 'boolean'}).notNull().default(false),
  // Its confirmation named no company (Indeed's "Indeed Application: <title>") and no match email
  // paired with it yet: `company` holds the platform until one does (J2).
  companyUnknown: integer('company_unknown', {mode: 'boolean'}).notNull().default(false),
  // Where its JD lookup stands; a saved posting is `found` (jobs_postings).
  jdLookup: text('jd_lookup', {enum: JD_LOOKUPS}).notNull().default('none'),
  jdLookupAt: text('jd_lookup_at'),
  // Its lookup was started by the history pass's end (J4): what it's unsure of goes to From history.
  jdLookupFromHistory: integer('jd_lookup_from_history', {mode: 'boolean'}).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  index('jobs_applications_applied').on(table.appliedAt),
  index('jobs_applications_company').on(table.company),
  check('jobs_applications_status', sql`${table.status} in (${quoted(JOB_STATUSES)})`),
  check('jobs_applications_status_set_by', sql`${table.statusSetBy} in (${quoted(JOB_STATUS_SETTERS)})`),
  check('jobs_applications_jd_lookup', sql`${table.jdLookup} in (${quoted(JD_LOOKUPS)})`),
]);

/**
 * A timeline event (decision 63, D317). It keeps its own copy of what it shows, so it outlives the
 * email; `messageId` (mail's messages.id, no foreign key) links to the email while it exists.
 */
export const jobsEvents = sqliteTable('jobs_events', {
  id: integer('id').primaryKey({autoIncrement: true}),
  applicationId: integer('application_id').notNull().references(() => jobsApplications.id, {onDelete: 'cascade'}),
  at: text('at').notNull(),
  kind: text('kind', {enum: JOB_EVENT_KINDS}).notNull(),
  sender: text('sender').notNull(),
  subject: text('subject').notNull(),
  // Its one line: "Interview Tue Oct 13, 2:00 PM".
  line: text('line'),
  messageId: integer('message_id'),
  // The email Track this made the application from (its First seen tag).
  firstSeen: integer('first_seen', {mode: 'boolean'}).notNull().default(false),
  createdAt: text('created_at').notNull(),
}, table => [
  index('jobs_events_application').on(table.applicationId, table.at),
  index('jobs_events_message').on(table.messageId),
  check('jobs_events_kind', sql`${table.kind} in (${quoted(JOB_EVENT_KINDS)})`),
]);

/** An application's saved JD (decision 53): kept as it was, never overwritten. */
export const jobsPostings = sqliteTable('jobs_postings', {
  id: integer('id').primaryKey({autoIncrement: true}),
  applicationId: integer('application_id').notNull().unique().references(() => jobsApplications.id, {onDelete: 'cascade'}),
  fullText: text('full_text').notNull(),
  summary: text('summary').notNull(),
  location: text('location'),
  workplace: text('workplace', {enum: JOB_WORKPLACES}),
  workplaceDetail: text('workplace_detail'),
  salary: text('salary'),
  mustHaves: text('must_haves', {mode: 'json'}).$type<string[]>().notNull(),
  niceToHaves: text('nice_to_haves', {mode: 'json'}).$type<string[]>().notNull(),
  link: text('link'),
  source: text('source', {enum: JD_SOURCES}).notNull(),
  // The platform it was found on ("Greenhouse"); null for a search.
  platform: text('platform'),
  foundAt: text('found_at').notNull(),
}, table => [
  check('jobs_postings_source', sql`${table.source} in (${quoted(JD_SOURCES)})`),
  check('jobs_postings_workplace', sql`${table.workplace} is null or ${table.workplace} in (${quoted(JOB_WORKPLACES)})`),
]);

/** A posting the lookup was unsure of (decision 54): offered in Needs you, and again by Not this posting. */
export const jobsJdCandidates = sqliteTable('jobs_jd_candidates', {
  id: integer('id').primaryKey({autoIncrement: true}),
  applicationId: integer('application_id').notNull().references(() => jobsApplications.id, {onDelete: 'cascade'}),
  title: text('title').notNull(),
  location: text('location'),
  platform: text('platform').notNull(),
  link: text('link').notNull(),
  position: integer('position').notNull(),
  foundAt: text('found_at').notNull(),
  // How the lookup found it (J6: a pick saves it as found this way); null reads as a search.
  source: text('source', {enum: JD_SOURCES}),
  // The user picked it (J6): the lookup reads this one and saves it.
  pickedAt: text('picked_at'),
  // Opening it came back `unreadable` (a 403, a non-HTML answer, a page with no text Jobs can use),
  // so the picker says so; a failure to reach it says nothing about the page, and leaves this false.
  unreadable: integer('unreadable', {mode: 'boolean'}).notNull().default(false),
}, table => [
  uniqueIndex('jobs_jd_candidates_link').on(table.applicationId, table.link),
]);

/**
 * A posting the user said isn't this application's (J6: None of these, Not this posting): no lookup
 * saves or offers it again (decision 58).
 */
export const jobsRejectedPostings = sqliteTable('jobs_rejected_postings', {
  id: integer('id').primaryKey({autoIncrement: true}),
  applicationId: integer('application_id').notNull().references(() => jobsApplications.id, {onDelete: 'cascade'}),
  link: text('link').notNull(),
  rejectedAt: text('rejected_at').notNull(),
}, table => [
  uniqueIndex('jobs_rejected_postings_link').on(table.applicationId, table.link),
]);

/**
 * Another company and role an application answers to because the user said so (J6, decision 58):
 * a merge's other application, an email moved or assigned to it, a title or company edited by hand.
 * A later email naming it finds this application (rules.ts `Alias`). A null company is its own.
 */
export const jobsAliases = sqliteTable('jobs_aliases', {
  id: integer('id').primaryKey({autoIncrement: true}),
  applicationId: integer('application_id').notNull().references(() => jobsApplications.id, {onDelete: 'cascade'}),
  company: text('company'),
  titleKey: text('title_key'),
  requisitionId: text('requisition_id'),
  createdAt: text('created_at').notNull(),
}, table => [
  index('jobs_aliases_application').on(table.applicationId),
]);

/**
 * What a correction or an answer changed, kept for its toast's Undo (J6): the rows as they were
 * before, and the rows it made. Undo puts them back exactly (./undo.ts); a day later they go.
 */
export const jobsUndo = sqliteTable('jobs_undo', {
  id: integer('id').primaryKey({autoIncrement: true}),
  snapshot: text('snapshot', {mode: 'json'}).$type<unknown>().notNull(),
  createdAt: text('created_at').notNull(),
});

/**
 * What waits in Needs you (decisions 50, 54, 57). Like an event, it keeps its own copy of the email
 * (date, sender, subject, line), and links to it by message id while it exists. One the history pass
 * was unsure of is `fromHistory` (From history, folded). A resolved item stays, with how.
 */
export const jobsNeedsYou = sqliteTable('jobs_needs_you', {
  id: integer('id').primaryKey({autoIncrement: true}),
  kind: text('kind', {enum: NEEDS_YOU_KINDS}).notNull(),
  reason: text('reason', {enum: NEEDS_YOU_REASONS}).notNull(),
  fromHistory: integer('from_history', {mode: 'boolean'}).notNull().default(false),
  // A JD to confirm's application.
  applicationId: integer('application_id').references(() => jobsApplications.id, {onDelete: 'cascade'}),
  company: text('company').notNull(),
  title: text('title'),
  platform: text('platform'),
  subject: text('subject'),
  sender: text('sender'),
  eventKind: text('event_kind', {enum: JOB_EVENT_KINDS}),
  line: text('line'),
  accountId: integer('account_id'),
  at: text('at').notNull(),
  messageId: integer('message_id'),
  createdAt: text('created_at').notNull(),
  resolvedAt: text('resolved_at'),
  // How it was answered (J6): "picked", "assigned", "tracked", "not_about_a_job", "dismissed"…
  resolution: text('resolution'),
}, table => [
  index('jobs_needs_you_open').on(table.resolvedAt, table.fromHistory),
  check('jobs_needs_you_kind', sql`${table.kind} in (${quoted(NEEDS_YOU_KINDS)})`),
  check('jobs_needs_you_reason', sql`${table.reason} in (${quoted(NEEDS_YOU_REASONS)})`),
  check('jobs_needs_you_jd', sql`${table.kind} <> 'jd_to_confirm' or ${table.applicationId} is not null`),
]);

/**
 * Every email Jobs has read, once (decision 61): never read or charged for again. J2 keeps what the
 * model read in it (null for the seed's and for an answer it couldn't use), so the rules can run
 * again without asking (Indeed's pairs, blocked emails, J6's corrections) and J4 can re-run history.
 */
export const jobsEmailsRead = sqliteTable('jobs_emails_read', {
  messageId: integer('message_id').primaryKey(),
  readAt: text('read_at').notNull(),
  // What it made: an application, an event, a Needs you item, or nothing.
  outcome: text('outcome', {enum: ['application', 'event', 'needs_you', 'ignored']}).notNull(),
  // The email's own date, and what the model read (./prompt.ts): its event, the company it names
  // (null when it names none), the role and its key, the requisition ID and the one line.
  at: text('at'),
  event: text('event', {enum: JOB_EMAIL_EVENTS}),
  company: text('company'),
  title: text('title'),
  titleKey: text('title_key'),
  requisitionId: text('requisition_id'),
  line: text('line'),
  // The application it went to, or made; a Needs you item's is null until J6 assigns it.
  applicationId: integer('application_id').references(() => jobsApplications.id, {onDelete: 'set null'}),
}, table => [
  index('jobs_emails_read_event').on(table.event, table.at),
]);

/**
 * What Not an application blocked (decision 67): each of its emails, so none makes an application
 * again, and its company and role, so no later email naming them does either. J6 keeps that company
 * and role here, as the application had them (null falls back to what the email was read as), and a
 * row without an email holds the role alone, for an application whose emails Setpoint never held.
 * `applicationId` is the application it was, gone now, for Undo.
 */
export const jobsBlockedEmails = sqliteTable('jobs_blocked_emails', {
  id: integer('id').primaryKey({autoIncrement: true}),
  messageId: integer('message_id'),
  blockedAt: text('blocked_at').notNull(),
  company: text('company'),
  titleKey: text('title_key'),
  requisitionId: text('requisition_id'),
  applicationId: integer('application_id'),
}, table => [
  uniqueIndex('jobs_blocked_emails_message').on(table.messageId),
]);

/** A field the user set by hand (decision 58): no later email, re-run or lookup overwrites it. */
export const jobsHandSet = sqliteTable('jobs_hand_set', {
  applicationId: integer('application_id').notNull().references(() => jobsApplications.id, {onDelete: 'cascade'}),
  field: text('field', {enum: JOB_HAND_FIELDS}).notNull(),
  setAt: text('set_at').notNull(),
}, table => [
  uniqueIndex('jobs_hand_set_key').on(table.applicationId, table.field),
  check('jobs_hand_set_field', sql`${table.field} in (${quoted(JOB_HAND_FIELDS)})`),
]);

/**
 * Jobs's own settings, one row, kept here rather than in the app's settings so removing Jobs leaves
 * nothing behind: on or off (off until the user turns it on), and the accounts it reads (D310).
 */
export const jobsSettings = sqliteTable('jobs_settings', {
  id: integer('id').primaryKey(),
  enabled: integer('enabled', {mode: 'boolean'}).notNull().default(false),
  // When it was last turned on: mail received from then on is read as it's triaged (J2); what came
  // before is the history pass's (J4). Null reads as `updated_at`.
  enabledAt: text('enabled_at'),
  accounts: text('accounts', {mode: 'json'}).$type<JobsReadAccount[]>().notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check('jobs_settings_one', sql`${table.id} = 1`),
]);

/**
 * The history pass (J4, decisions 57 and 72), one row: the last one started. It reads, oldest first,
 * what Jobs hasn't read in the accounts it lists from before `before` (when Jobs was turned on).
 * `total` is fixed when it starts; while it runs, what it has read is counted from jobs_emails_read
 * (read since `started_at`, received before `before`), and `read` is kept once it's done. No row is a
 * pass not started yet.
 */
export const jobsHistory = sqliteTable('jobs_history', {
  id: integer('id').primaryKey(),
  state: text('state', {enum: ['running', 'done']}).notNull(),
  before: text('before').notNull(),
  startedAt: text('started_at').notNull(),
  total: integer('total').notNull(),
  read: integer('read'),
  finishedAt: text('finished_at'),
}, table => [
  check('jobs_history_one', sql`${table.id} = 1`),
  check('jobs_history_state', sql`${table.state} in ('running', 'done')`),
]);

/**
 * How Jobs's reading of mail stands (J2), one row, as triage's health: down while its last model call
 * failed (or there was no key to call with), as of its last success. Emails wait meanwhile, counted
 * on the page ("5 emails not read yet"), and are read once it's back.
 */
export const jobsReader = sqliteTable('jobs_reader', {
  id: integer('id').primaryKey(),
  lastSuccessAt: text('last_success_at'),
  lastFailureAt: text('last_failure_at'),
  // The first failure since the last success: "Anthropic unreachable since 8:52 AM".
  failingSince: text('failing_since'),
  lastError: text('last_error'),
  // The failure's kind (src/domain/retry.ts): `auth` waits for a key; the rest are retried.
  lastErrorKind: text('last_error_kind', {enum: PROVIDER_ERROR_KINDS}),
}, table => [
  check('jobs_reader_one', sql`${table.id} = 1`),
]);
