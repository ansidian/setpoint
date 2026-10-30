// Jobs's API (after News; BRIEF.md › Jobs; DESIGN.md › Jobs, boards 32–40; darma D303–D327). Outputs
// are Zod schemas as well as types, so tests and the seed check the shapes the page draws from.
//
//   GET  /api/jobs                       JobsPageOut (the two numbers, Needs you, From history, the rows)
//   GET  /api/jobs/applications/:id      ApplicationOut (the detail: its JD, timeline, Applied before)
//   POST /api/jobs/applications/:id/lookup  ApplicationOut, 202 (J3: Look it up)
//   GET  /api/jobs/settings              JobsSettingsOut (J4, drawn in J8: Settings › Jobs)
//   PATCH /api/jobs/settings             jobsSettingsPatchInput → JobsSettingsOut (J4: turning Jobs on starts the history pass)
//   POST /api/jobs/from-history/dismiss  JobsDismissedOut (J4: Dismiss all, the same as ignoring each item)
//   POST /api/jobs/from-history/undo     jobsUndoDismissInput → JobsDismissedOut (J4: the toast's Undo)
//   GET  /api/jobs/search?q=…            JobsSearchOut (J5: company or role first, then JD text)
//   GET  /api/jobs/nav                   JobsNavOut (J5: the sidebar's and the rail's item, ⌘K's Go to and `4`)
//   GET  /api/jobs/mail?messages=1,2,3   JobsMailOut (J7: what mail's slots draw for a page of rows, or the email open)
//
// J6's answers and corrections each answer JobsChangeOut, whose `undo` the toast's Undo sends back:
//   POST   /api/jobs/applications/:id/jd/pick           jobsPickInput (a JD to confirm, Choose…, or after Not this posting)
//   POST   /api/jobs/applications/:id/jd/none           None of these
//   POST   /api/jobs/needs-you/:id/assign               jobsAssignInput (Assign to…, Another application…)
//   POST   /api/jobs/needs-you/:id/track                Track this (decision 69)
//   POST   /api/jobs/needs-you/:id/not-a-job            Not about a job
//   PATCH  /api/jobs/applications/:id                   jobsEditInput (the title in place, the company from More)
//   POST   /api/jobs/applications/:id/status            jobsStatusInput (Set status; null is Let emails decide)
//   POST   /api/jobs/applications/:id/merge             jobsMergeInput (Merge with…: the other comes into this one)
//   POST   /api/jobs/applications/:id/not-this-posting  the JD goes, its other candidates offered
//   POST   /api/jobs/applications/:id/not-an-application  hidden, its emails blocked (decision 67)
//   DELETE /api/jobs/applications/:id                   forgotten, so a later email can make it again
//   POST   /api/jobs/events/:id/move                    jobsMoveInput (Move to…)
//   POST   /api/jobs/events/:id/not-about-this          back into Needs you
//   POST   /api/jobs/undo/:token                        JobsUndoneOut (the toast's Undo: exactly what was there)
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
  // The saved posting's link, for a row's Open posting and Copy posting link (J6); null unless found.
  link: z.url().nullable(),
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
 * The history pass (J4; decisions 57, 72; board 38a and Settings › Jobs, drawn in J8): "Reading history
 * · 140 of 330 emails" while it runs, "Read 330 emails once, when Jobs was turned on · finished Oct 1,
 * 8:14 PM" once it's done. `total` is fixed when it starts (mail arriving meanwhile is the live
 * reader's); `read` counts what it has read so far. `waiting` is a pass held while the AI is down or
 * has no key (the page's `reading` says why and since when).
 */
export const jobsHistorySchema = z.strictObject({
  state: z.enum(JOB_HISTORY_STATES),
  read: z.int().nonnegative(),
  total: z.int().nonnegative(),
  // When the pass began and ended; null before it has.
  started_at: instant.nullable(),
  finished_at: instant.nullable(),
});
export type JobsHistoryOut = z.infer<typeof jobsHistorySchema>;

/**
 * GET /api/jobs: the page's two numbers and nothing else (D314), Needs you (oldest first, as they
 * came) and From history (newest first), and every application, newest first by Applied.
 */
export const jobsPageSchema = z.strictObject({
  enabled: z.boolean(),
  reading: jobsReadingSchema,
  history: jobsHistorySchema,
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

/**
 * J5's search (D316): company or role first (best first, then newest), then a match only in a JD's
 * text, newest first, with the line it matched quoted ("…our services run on Kubernetes across two
 * regions…").
 */
export const jobsSearchInput = z.strictObject({q: z.string().trim().min(1).max(200)});
export const jobsSearchSchema = z.strictObject({
  query: z.string(),
  company_or_role: z.array(applicationRowSchema),
  in_jd: z.array(z.strictObject({row: applicationRowSchema, line: z.string()})),
});
export type JobsSearchOut = z.infer<typeof jobsSearchSchema>;

/**
 * GET /api/jobs/nav: what the shell draws of Jobs on every page (J5): whether it's on (no item while
 * it's off, D310) and the Needs you count beside it (today's, not From history's; gone at zero, D313).
 */
export const jobsNavSchema = z.strictObject({enabled: z.boolean(), needs_you: z.int().nonnegative()});
export type JobsNavOut = z.infer<typeof jobsNavSchema>;

/**
 * J7's request (D306): the emails a page of mail's rows shows, or the one the reader has open, as
 * their ids joined by commas. At most 500, so a long list asks in a few requests, never one per row.
 */
export const JOBS_MAIL_MAX = 500;
export const jobsMailInput = z.strictObject({
  messages: z.string().regex(/^[1-9]\d{0,9}(,[1-9]\d{0,9})*$/, 'Message ids joined by commas.')
    .transform(list => [...new Set(list.split(',').map(Number))]).pipe(z.array(id).min(1).max(JOBS_MAIL_MAX)),
});

/** An application as mail's slots name it: "Software Engineer I · Applied Oct 1 · In process". */
export const jobsMailApplicationSchema = z.strictObject({
  id,
  company: z.string(),
  title: z.string(),
  applied_on: localDate,
  status: jobStatusSchema,
  // The day its status was set: "Rejected Oct 5".
  status_on: localDate,
  ghosted: z.boolean(),
});
export type JobsMailApplicationOut = z.infer<typeof jobsMailApplicationSchema>;

/**
 * One email with something for mail's slots (DESIGN.md › Jobs › In mail; boards 37a–37c):
 * `application` is the one it belongs to (the reader's JD chip); `applied_before`, on a job board's
 * match email whose company matches applications (loosely, and by the companies corrections gave
 * them), is the most recent of them, how many there are, and the search that shows them all in Jobs
 * ("contoso pharmaceuticals").
 */
export const jobsMailMessageSchema = z.strictObject({
  message_id: id,
  application: jobsMailApplicationSchema.nullable(),
  applied_before: z.strictObject({
    query: z.string(),
    count: z.int().positive(),
    latest: jobsMailApplicationSchema,
  }).nullable(),
});
export type JobsMailMessageOut = z.infer<typeof jobsMailMessageSchema>;

/** GET /api/jobs/mail: only the emails with something to show; none while Jobs is off (D313: mail's counts never change). */
export const jobsMailSchema = z.strictObject({messages: z.array(jobsMailMessageSchema)});
export type JobsMailOut = z.infer<typeof jobsMailSchema>;

/** An account Jobs reads and how (decision 56); an account not listed is off. */
export const jobsReadAccountSchema = z.strictObject({account_id: id, reads: z.enum(JOB_READ_MODES)});
export type JobsReadAccount = z.infer<typeof jobsReadAccountSchema>;

/** Settings › Jobs (board 39a): on or off (off by default), the accounts it reads, the history pass. */
export const jobsSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  accounts: z.array(jobsReadAccountSchema),
  history: jobsHistorySchema,
  // From history's items still waiting: "6 waiting in Needs you, what the pass wasn't sure of".
  from_history: z.int().nonnegative(),
  applications: z.int().nonnegative(),
});
export type JobsSettingsOut = z.infer<typeof jobsSettingsSchema>;

/**
 * PATCH /api/jobs/settings. Turning Jobs on sets when it was turned on and starts the history pass
 * over what it hasn't read from before then; off stops reading. Accounts changed while it's on start
 * the pass again over what the new list hasn't had read. Each account once, and only mail's own.
 */
export const jobsSettingsPatchInput = z.strictObject({
  enabled: z.boolean().optional(),
  accounts: z.array(jobsReadAccountSchema).refine(list => new Set(list.map(each => each.account_id)).size === list.length, 'Each account once.').optional(),
});
export type JobsSettingsPatch = z.infer<typeof jobsSettingsPatchInput>;

/** Dismiss all's answer, and Undo's: the From history items it dismissed, or brought back. */
export const jobsDismissedSchema = z.strictObject({needs_you: z.array(id)});
export type JobsDismissedOut = z.infer<typeof jobsDismissedSchema>;

/** Undo of Dismiss all: the items it dismissed, as its answer named them. */
export const jobsUndoDismissInput = z.strictObject({needs_you: z.array(id).min(1).max(10_000)});
export type JobsUndoDismiss = z.infer<typeof jobsUndoDismissInput>;

/**
 * What an answer or a correction did (J6): `undo` is its toast's Undo, and `application` the one it
 * made or kept (Track this opens the one it made; Merge with… keeps this one), or null.
 */
export const jobsChangeSchema = z.strictObject({undo: id, application: id.nullable()});
export type JobsChangeOut = z.infer<typeof jobsChangeSchema>;

/** Undo's answer: the applications and Needs you items put back as they were. */
export const jobsUndoneSchema = z.strictObject({applications: z.array(id), needs_you: z.array(id)});
export type JobsUndoneOut = z.infer<typeof jobsUndoneSchema>;

/** A candidate picked as the posting. */
export const jobsPickInput = z.strictObject({candidate: id});
/** Assign to…: the application an update is about. */
export const jobsAssignInput = z.strictObject({application: id});
/** Move to…: the application an event belongs to instead. */
export const jobsMoveInput = z.strictObject({application: id});
/** Merge with…: the other application, which comes into this one with all its emails. */
export const jobsMergeInput = z.strictObject({other: id});

/** The title in place, or the company from More (decision 58): set by hand, and kept. */
export const jobsEditInput = z.strictObject({
  company: z.string().trim().min(1).max(200).optional(),
  title: z.string().trim().min(1).max(300).optional(),
}).refine(edit => edit.company !== undefined || edit.title !== undefined, 'The company or the title.');
export type JobsEdit = z.infer<typeof jobsEditInput>;

/** Set status (D365): one of the five, set by hand (D322); null is Let emails decide. */
export const jobsStatusInput = z.strictObject({status: jobStatusSchema.nullable()});
export type JobsStatusSet = z.infer<typeof jobsStatusInput>;

/**
 * The `jobs` live event: `applications` changed (a row lands or moves, settling from `sub2`) and
 * `needs_you` items came or went. One naming nothing means Jobs's own state changed (turned on or
 * off, the history pass, emails waiting for the AI): GET /api/jobs again. `history` is the history
 * pass's progress as it stands, on each event the pass sends (J4: "Reading history · 140 of 330").
 */
export interface JobsLiveEvent {
  type: 'jobs';
  applications: number[];
  needs_you: number[];
  history?: JobsHistoryOut;
}
