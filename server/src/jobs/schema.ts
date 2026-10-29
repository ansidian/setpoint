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
  // Where its JD lookup stands; a saved posting is `found` (jobs_postings).
  jdLookup: text('jd_lookup', {enum: JD_LOOKUPS}).notNull().default('none'),
  jdLookupAt: text('jd_lookup_at'),
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
}, table => [
  uniqueIndex('jobs_jd_candidates_link').on(table.applicationId, table.link),
]);

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

/** Every email Jobs has read, once (decision 61): never read or charged for again. */
export const jobsEmailsRead = sqliteTable('jobs_emails_read', {
  messageId: integer('message_id').primaryKey(),
  readAt: text('read_at').notNull(),
  // What it made: an application, an event, a Needs you item, or nothing.
  outcome: text('outcome', {enum: ['application', 'event', 'needs_you', 'ignored']}).notNull(),
});

/** An email Not an application blocked (decision 67): it never makes an application again. */
export const jobsBlockedEmails = sqliteTable('jobs_blocked_emails', {
  messageId: integer('message_id').primaryKey(),
  blockedAt: text('blocked_at').notNull(),
});

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
  accounts: text('accounts', {mode: 'json'}).$type<JobsReadAccount[]>().notNull(),
  updatedAt: text('updated_at').notNull(),
}, table => [
  check('jobs_settings_one', sql`${table.id} = 1`),
]);
