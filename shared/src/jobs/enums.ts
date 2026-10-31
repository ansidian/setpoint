// Jobs's fixed sets (after News, J1; BRIEF.md › Jobs, darma D303–D327). Jobs is a module that can be
// removed whole (D303): its contract lives in this folder and reaches `@setpoint/shared` by one export
// line (server/src/jobs/README.md lists every wiring point). Change these deliberately, as enums.ts.

/**
 * An application's status (decision 55). Ghosted isn't one: it's a flag on Applied after 30 days
 * with no email, computed when read, never stored and never a move to Rejected.
 */
export const JOB_STATUSES = ['applied', 'in_process', 'offer', 'rejected', 'withdrawn'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Still open: a JD is looked up only for these (decision 57). */
export const OPEN_JOB_STATUSES = ['applied', 'in_process', 'offer'] as const satisfies readonly JobStatus[];

/** Who set an application's status: an email, or the user by hand (decision 58, D322). */
export const JOB_STATUS_SETTERS = ['email', 'user'] as const;
export type JobStatusSetter = (typeof JOB_STATUS_SETTERS)[number];

/**
 * What an event on the timeline was (decision 50). The first five set a status; the rest are quiet,
 * added to an application they match and never moving its status or undoing one set by hand
 * (decision 68): a second confirmation while it's open, account created, a verification code or
 * "verify your email", "one final step", an EEO or screening form, a job board's match, and anything
 * else about it.
 */
export const JOB_EVENT_KINDS = [
  'applied', 'assessment', 'interview', 'offer', 'rejection',
  'duplicate', 'account', 'verification', 'next_step', 'form', 'match', 'other',
] as const;
export type JobEventKind = (typeof JOB_EVENT_KINDS)[number];

export const QUIET_JOB_EVENT_KINDS = ['duplicate', 'account', 'verification', 'next_step', 'form', 'match', 'other'] as const satisfies readonly JobEventKind[];
export type QuietJobEventKind = (typeof QUIET_JOB_EVENT_KINDS)[number];

/** The status an event that sets one moves its application to (decision 55). */
export const STATUS_OF_JOB_EVENT = {
  applied: 'applied', assessment: 'in_process', interview: 'in_process', offer: 'offer', rejection: 'rejected',
} as const satisfies Record<Exclude<JobEventKind, QuietJobEventKind>, JobStatus>;

export const isQuietJobEvent = (kind: JobEventKind): kind is QuietJobEventKind => (QUIET_JOB_EVENT_KINDS as readonly string[]).includes(kind);

/** How a JD was found (decision 54): the email's own link, the hiring platform's API or a web search; or the user pasted it (SV-140). */
export const JD_SOURCES = ['email_link', 'platform', 'search', 'pasted'] as const;
export type JdSource = (typeof JD_SOURCES)[number];

/**
 * Where an application's JD stands, for its row and detail. `found` has a saved posting; `candidates`
 * waits in Needs you as a JD to confirm; `looking` is a lookup under way; `not_found` says "No JD
 * found", or that a picked posting couldn't be read, with Look it up (D320); `none` was never looked up (a closed application from history).
 */
export const JD_STATES = ['found', 'candidates', 'looking', 'not_found', 'none'] as const;
export type JdState = (typeof JD_STATES)[number];

/** A lookup's stored outcome; `found` is the posting itself, so it isn't one of these. */
export const JD_LOOKUPS = ['none', 'looking', 'candidates', 'not_found'] as const satisfies readonly JdState[];
export type JdLookup = (typeof JD_LOOKUPS)[number];

/** A posting's setting (decision 53). */
export const JOB_WORKPLACES = ['on_site', 'hybrid', 'remote'] as const;
export type JobWorkplace = (typeof JOB_WORKPLACES)[number];

/**
 * What waits in Needs you (decisions 50, 54): a JD to confirm (up to three candidates), an update to
 * assign (it might match more than one application, or none by its role), and an email to track (an
 * interview, assessment or offer matching nothing: Track this). Any of them can come from the history
 * pass, which keeps them in From history, folded (decision 57).
 */
export const NEEDS_YOU_KINDS = ['jd_to_confirm', 'update_to_assign', 'email_to_track'] as const;
export type NeedsYouKind = (typeof NEEDS_YOU_KINDS)[number];

/**
 * Why an item waits, which line two words: "it could be either Humongous application" (matches
 * several), "names no role, and there are two", "names a role neither application has", "an interview
 * request with no application", "Is this the posting?" (unsure of the posting), and an email the user
 * took off an application with Not about this (J6): "taken off Software Engineer I".
 */
export const NEEDS_YOU_REASONS = ['matches_several', 'names_no_role', 'names_other_role', 'same_role_elsewhere', 'no_application', 'unsure_posting', 'taken_off'] as const;
export type NeedsYouReason = (typeof NEEDS_YOU_REASONS)[number];

/** The fields a correction sets by hand, which no later email, re-run or lookup overwrites (decision 58). */
export const JOB_HAND_FIELDS = ['company', 'title', 'status'] as const;
export type JobHandField = (typeof JOB_HAND_FIELDS)[number];

/**
 * How Jobs reads an account it lists (decision 56): every email (the Jobs account), or only what
 * triage sorts as Career (Business). An account it doesn't list is off.
 */
export const JOB_READ_MODES = ['every', 'career'] as const;
export type JobReadMode = (typeof JOB_READ_MODES)[number];

/**
 * The history pass (decision 57): once, when Jobs is turned on. `waiting` is a pass under way that
 * waits for the AI (down, or no key), as the page's reading line does; it goes on once it's back.
 */
export const JOB_HISTORY_STATES = ['not_started', 'running', 'waiting', 'done'] as const;
export type JobHistoryState = (typeof JOB_HISTORY_STATES)[number];

/**
 * Why Jobs's reading is down (J8, board 38b), as the page words it: Anthropic unreachable or rate
 * limited (retried), its key refused, or no key in Settings › AI (both waiting for Settings › AI).
 */
export const JOB_READING_CAUSES = ['unreachable', 'rate_limited', 'refused', 'no_key'] as const;
export type JobReadingCause = (typeof JOB_READING_CAUSES)[number];

/** Ghosted: still at Applied this many days after its last email (decision 55). */
export const GHOSTED_AFTER_DAYS = 30;

/** Applications per week covers this many weeks, this one included (D314). */
export const JOB_WEEKS = 12;
