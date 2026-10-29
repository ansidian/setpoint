// Jobs's API (after News; BRIEF.md › Jobs; DESIGN.md › Jobs, boards 32–40; darma D303–D327). Outputs
// are Zod schemas as well as types, so tests and the seed check the shapes the page draws from.
//
//   GET  /api/jobs                       JobsPageOut (the two numbers, Needs you, From history, the rows)
//   GET  /api/jobs/applications/:id      ApplicationOut (the detail: its JD, timeline, Applied before)
//
// Later slices add, with these shapes:
//
//   GET  /api/jobs/search?q=…            JobsSearchOut (J5: company or role first, then JD text)
//   GET  /api/jobs/settings              JobsSettingsOut (J8: Settings › Jobs)
//   PATCH /api/jobs/settings             jobsSettingsPatchInput → JobsSettingsOut
//
// Every change goes out as a `jobs` live event (JobsLiveEvent). Ages are instants and dates are
// local; the page words them ("Today", "2h", "no email in 48 days"). Jobs never counts anything in the
// Inbox (D313).
import {z} from 'zod';
import {id, instant, localDate} from '../api/common.ts';
import {
  JD_SOURCES, JD_STATES, JOB_EVENT_KINDS, JOB_HAND_FIELDS, JOB_HISTORY_STATES, JOB_READ_MODES, JOB_STATUS_SETTERS, JOB_STATUSES,
  JOB_WORKPLACES, NEEDS_YOU_KINDS, NEEDS_YOU_REASONS,
} from './enums.ts';

export const jobStatusSchema = z.enum(JOB_STATUSES);

/**
 * Where an application's JD stands, for the JD column and its tooltip: "Greenhouse · found Oct 1",
 * "Search · found 7h ago", "The email's link", "2 candidates in Needs you", "No JD found".
 */
export const jdSummarySchema = z.strictObject({
  state: z.enum(JD_STATES),
  // How it was found and the platform it was found on ("Greenhouse"); null unless found.
  source: z.enum(JD_SOURCES).nullable(),
  platform: z.string().nullable(),
  found_at: instant.nullable(),
  // Candidates waiting in Needs you; 0 unless `candidates`.
  candidates: z.int().nonnegative(),
  // When a lookup last ended (`not_found`: "had nothing for it on Oct 1") or began (`looking`).
  looked_at: instant.nullable(),
});
export type JdSummaryOut = z.infer<typeof jdSummarySchema>;

/** An earlier application a re-application links to: "Re-applied, rejected Sep 2". */
export const applicationLinkSchema = z.strictObject({
  id,
  company: z.string(),
  title: z.string(),
  applied_on: localDate,
  status: jobStatusSchema,
  // The day its status was set: "Rejected Mar 14".
  status_on: localDate,
});
export type ApplicationLinkOut = z.infer<typeof applicationLinkSchema>;

/** One row of the table (DESIGN.md › The table). */
export const applicationRowSchema = z.strictObject({
  id,
  company: z.string(),
  title: z.string(),
  // The hiring platform, triage's `via` ("Greenhouse", "Indeed"); null when there was none.
  platform: z.string().nullable(),
  // The mail account its emails came to; null once that account is gone.
  account_id: id.nullable(),
  applied_at: instant,
  applied_on: localDate,
  status: jobStatusSchema,
  status_set_by: z.enum(JOB_STATUS_SETTERS),
  status_set_at: instant,
  // The day the status was set: Offer "· Oct 6", Rejected "· Oct 5", Withdrawn "· Sep 10".
  status_on: localDate,
  // The latest step as the email states it ("Interview Tue Oct 13, 2:00 PM"), In process only.
  step: z.string().nullable(),
  step_at: instant.nullable(),
  // Applied with no email for 30 days or more (decision 55), and how many: "no email in 48 days".
  ghosted: z.boolean(),
  days_without_email: z.int().nonnegative(),
  reapplied_from: applicationLinkSchema.nullable(),
  // Made by Track this, so Applied is its email's date (decision 69, D323).
  first_seen_in_email: z.boolean(),
  jd: jdSummarySchema,
});
export type ApplicationRowOut = z.infer<typeof applicationRowSchema>;

/** A JD candidate, for a JD to confirm and Not this posting: "Junior Developer · New York, NY · Greenhouse". */
export const jdCandidateSchema = z.strictObject({
  id,
  title: z.string(),
  location: z.string().nullable(),
  // Where it was seen ("Greenhouse", "LinkedIn").
  platform: z.string(),
  link: z.url(),
});
export type JdCandidateOut = z.infer<typeof jdCandidateSchema>;

/**
 * A Needs you item (DESIGN.md › Needs you). Its email's date, sender and subject are its own copy
 * (decision 63), so it stands after the email is purged; `message_id` is null once it's gone.
 * Line one is what it's about ("Lucerne Publishing · Junior Developer", or the email's subject) and
 * the sender or company; line two words its event and reason.
 */
export const needsYouItemSchema = z.strictObject({
  id,
  kind: z.enum(NEEDS_YOU_KINDS),
  reason: z.enum(NEEDS_YOU_REASONS),
  from_history: z.boolean(),
  company: z.string(),
  // The role it names, if any.
  title: z.string().nullable(),
  platform: z.string().nullable(),
  // The email's own copy; null for a JD to confirm, which is about the application.
  subject: z.string().nullable(),
  sender: z.string().nullable(),
  // What the email was: a rejection to assign, an interview to track; null for a JD to confirm.
  event_kind: z.enum(JOB_EVENT_KINDS).nullable(),
  line: z.string().nullable(),
  account_id: id.nullable(),
  // The email's date, or the application's Applied date for a JD to confirm ("Applied Oct 5").
  at: instant,
  message_id: id.nullable(),
  // A JD to confirm's application, and its candidates (up to three).
  application_id: id.nullable(),
  candidates: z.array(jdCandidateSchema).max(3),
});
export type NeedsYouItemOut = z.infer<typeof needsYouItemSchema>;

/** One week of Per week, Sunday to Saturday in the user's zone; the last is this week, unfinished. */
export const jobWeekSchema = z.strictObject({
  start: localDate,
  end: localDate,
  count: z.int().nonnegative(),
  current: z.boolean(),
});
export type JobWeekOut = z.infer<typeof jobWeekSchema>;

/** The status filter's counts: "All 62", "Applied 31" (18 of them Ghosted), and the rest. */
export const jobCountsSchema = z.strictObject({
  all: z.int().nonnegative(),
  by_status: z.record(jobStatusSchema, z.int().nonnegative()),
  ghosted: z.int().nonnegative(),
});
export type JobCountsOut = z.infer<typeof jobCountsSchema>;

/**
 * Jobs's reading of mail (J2; board 38b, drawn in J8): emails triage has sorted that Jobs hasn't read
 * yet, and whether the AI is down: "5 emails not read yet, Anthropic unreachable since 8:52 AM,
 * retrying". `waiting` is briefly above 0 as mail arrives; the line shows only while `down`.
 */
export const jobsReadingSchema = z.strictObject({
  waiting: z.int().nonnegative(),
  state: z.enum(['healthy', 'down']),
  // The first failure since the last success, and the provider's words; null while healthy.
  since: instant.nullable(),
  reason: z.string().nullable(),
  // False when it waits for a key in Settings › AI rather than retrying.
  retrying: z.boolean(),
});
export type JobsReadingOut = z.infer<typeof jobsReadingSchema>;

/**
 * GET /api/jobs: the page's two numbers and nothing else (D314), Needs you (oldest first, as they
 * came) and From history (newest first), and every application, newest first by Applied.
 */
export const jobsPageSchema = z.strictObject({
  enabled: z.boolean(),
  reading: jobsReadingSchema,
  counts: jobCountsSchema,
  weeks: z.array(jobWeekSchema),
  needs_you: z.array(needsYouItemSchema),
  from_history: z.array(needsYouItemSchema),
  rows: z.array(applicationRowSchema),
});
export type JobsPageOut = z.infer<typeof jobsPageSchema>;

/** A saved JD (decision 53): kept as it was, never overwritten. */
export const postingSchema = z.strictObject({
  // The three-line what-they-want summary.
  summary: z.string(),
  location: z.string().nullable(),
  workplace: z.enum(JOB_WORKPLACES).nullable(),
  // "3 days", after Hybrid.
  workplace_detail: z.string().nullable(),
  // As stated ("$95,000–$115,000"); null is "Salary not stated".
  salary: z.string().nullable(),
  must_haves: z.array(z.string()),
  nice_to_haves: z.array(z.string()),
  // The posting's full text, cleaned to markdown.
  full_text: z.string(),
  link: z.url().nullable(),
  source: z.enum(JD_SOURCES),
  // The platform it was found on ("Greenhouse"); null for a search.
  platform: z.string().nullable(),
  found_at: instant,
});
export type PostingOut = z.infer<typeof postingSchema>;

/**
 * A timeline event (D317), oldest first. Its date, kind, sender, subject and line are its own copy;
 * `message_id` opens the email while it exists and is null once it's gone. A quiet event has no kind
 * on screen and never moved the status.
 */
export const jobEventSchema = z.strictObject({
  id,
  at: instant,
  kind: z.enum(JOB_EVENT_KINDS),
  quiet: z.boolean(),
  sender: z.string(),
  subject: z.string(),
  line: z.string().nullable(),
  message_id: id.nullable(),
  // The email Track this made the application from (decision 69): its "First seen" tag.
  first_seen: z.boolean(),
});
export type JobEventOut = z.infer<typeof jobEventSchema>;

/** A field the user set by hand, for the tooltip "Set by you on Sep 10". */
export const handSetSchema = z.strictObject({field: z.enum(JOB_HAND_FIELDS), set_at: instant});

/** GET /api/jobs/applications/:id: the detail (DESIGN.md › The application's detail). */
export const applicationSchema = applicationRowSchema.extend({
  posting: postingSchema.nullable(),
  // The other candidates, for Not this posting and a JD to confirm.
  candidates: z.array(jdCandidateSchema),
  timeline: z.array(jobEventSchema),
  // Earlier, closed applications at the company (Applied before at Northwind Talent, D306), newest first.
  applied_before: z.array(applicationLinkSchema),
  // The company's other applications (Also at Humongous Insurance), newest first.
  also_at: z.array(applicationLinkSchema),
  hand_set: z.array(handSetSchema),
});
export type ApplicationOut = z.infer<typeof applicationSchema>;

/** J5's search (D316): company or role first, then a match only in a JD's text, with its line. */
export const jobsSearchInput = z.strictObject({q: z.string().trim().min(1).max(200)});
export const jobsSearchSchema = z.strictObject({
  query: z.string(),
  company_or_role: z.array(applicationRowSchema),
  in_jd: z.array(z.strictObject({row: applicationRowSchema, line: z.string()})),
});
export type JobsSearchOut = z.infer<typeof jobsSearchSchema>;

/** An account Jobs reads and how (decision 56); an account not listed is off. */
export const jobsReadAccountSchema = z.strictObject({account_id: id, reads: z.enum(JOB_READ_MODES)});
export type JobsReadAccount = z.infer<typeof jobsReadAccountSchema>;

/** Settings › Jobs (board 39a): on or off (off by default), the accounts it reads, the history pass. */
export const jobsSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  accounts: z.array(jobsReadAccountSchema),
  history: z.strictObject({
    state: z.enum(JOB_HISTORY_STATES),
    read: z.int().nonnegative(),
    total: z.int().nonnegative(),
    finished_at: instant.nullable(),
  }),
  from_history: z.int().nonnegative(),
  applications: z.int().nonnegative(),
});
export type JobsSettingsOut = z.infer<typeof jobsSettingsSchema>;

export const jobsSettingsPatchInput = z.strictObject({
  enabled: z.boolean().optional(),
  accounts: z.array(jobsReadAccountSchema).optional(),
});
export type JobsSettingsPatch = z.infer<typeof jobsSettingsPatchInput>;

/**
 * The `jobs` live event: `applications` changed (a row lands or moves, settling from `sub2`) and
 * `needs_you` items came or went. One naming nothing means Jobs's own state changed (turned on or
 * off, the history pass, emails waiting for the AI): GET /api/jobs again.
 */
export interface JobsLiveEvent {
  type: 'jobs';
  applications: number[];
  needs_you: number[];
}
