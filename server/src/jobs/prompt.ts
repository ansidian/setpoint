// What Jobs asks Haiku 5.5 about each email (J2, decision 61) and how it reads the answer. Triage has
// already read the email: Jobs passes on its organisation, platform (`via`), type, kind and summary,
// and asks only for what triage doesn't keep: the event, the company it names, the role, the
// requisition ID and the one line ("Interview Tue Oct 13, 2:00 PM"). The answer is read leniently,
// field by field, as triage's is; an answer with no usable event is null (read, making nothing).
import type {ToolSpec} from '../providers/ai/index.ts';

/** Bumped when the prompt or tool changes. */
export const JOBS_PROMPT_VERSION = 'v1';

/**
 * What an email is to Jobs. The first five set a status (decision 55; "interview" takes a scheduling
 * request too); the next six are quiet (decision 50); a recruiter's cold email and mail that isn't
 * about the user's applications are out.
 */
export const JOB_EMAIL_EVENTS = [
  'confirmation', 'assessment', 'interview', 'offer', 'rejection',
  'account', 'verification', 'next_step', 'form', 'match', 'other',
  'recruiter', 'unrelated',
] as const;
export type JobEmailEvent = (typeof JOB_EMAIL_EVENTS)[number];

/** A body longer than this is cut: what Jobs needs is near the top. */
export const JOBS_EVIDENCE_LIMIT = 12_000;

export const JOBS_MAX_OUTPUT_TOKENS = 400;

export const JOBS_SYSTEM = `You read one email for the user's job application tracker. Answer only with the submit_job_email tool.

event, what the email is to the user's applications:
- confirmation: the user's application was received ("Thank you for applying", "Application received", "Indeed Application: <title>").
- assessment: a test, case study, coding challenge or questionnaire to complete.
- interview: an interview, phone screen or call, or a request to schedule one.
- offer: a job offer.
- rejection: the application won't go forward, or the role was filled or closed.
- account: an account was created on a careers site or job platform.
- verification: a verification code, or "verify your email".
- next_step: "one final step" to finish an application that isn't submitted yet.
- form: an EEO, voluntary self-identification or screening form.
- match: a job board's alert or match for a posting ("<title> @ <company>", "Jobs you may like").
- other: about one of the user's applications, but none of the above.
- recruiter: a recruiter or company reaching out first about a role the user didn't apply to.
- unrelated: not about the user's job applications at all (shopping, newsletters, school, bills).

company: the employer the email is about, as a person would say it ("Fabrikam", not "Workday" or "Indeed"). null when the email names no employer, as when only the job board sends it.

title: the role's title exactly as the email gives it, or null when it names none. Never guess one.

requisition_id: the posting's requisition or job ID when the email gives one ("R-2026-118", "JR104"), else null.

line: for an assessment, interview, offer or rejection, the step in under 50 characters, with its date and time when the email gives them: "Interview Tue Oct 13, 2:00 PM", "Case study due Oct 12", "Phone screen, pick a slot", "Offer, reply by Oct 16", "Not moving forward". Otherwise null.`;

const nullableString = {anyOf: [{type: 'string'}, {type: 'null'}]};

export const JOBS_TOOL: ToolSpec = {
  name: 'submit_job_email',
  description: 'Submit what one email is to the user\'s job applications.',
  schema: {
    type: 'object',
    properties: {
      event: {type: 'string', enum: [...JOB_EMAIL_EVENTS]},
      company: nullableString,
      title: nullableString,
      requisition_id: nullableString,
      line: nullableString,
    },
    required: ['event', 'company', 'title', 'requisition_id', 'line'],
  },
};

/** The email as triage left it (./mail.ts jobsEmail). */
export interface PromptEmail {
  accountLabel: string | null;
  fromName: string;
  fromAddress: string;
  subject: string;
  receivedAt: string;
  body: string;
  organisation: string | null;
  via: string | null;
  type: string | null;
  kind: string | null;
  summary: string | null;
}

/** The email as the model reads it, with triage's reading of it first. */
export function jobsPromptInput(email: PromptEmail): string {
  const body = email.body.trim();
  const triage = [
    email.organisation && `organisation ${email.organisation}`,
    email.via && `via ${email.via}`,
    email.type && `type ${email.type}`,
    email.kind && `kind ${email.kind}`,
  ].filter(Boolean).join(', ');
  return [
    ...(email.accountLabel ? [`Account: ${email.accountLabel}`] : []),
    `From: ${email.fromName} <${email.fromAddress}>`,
    `Subject: ${email.subject}`,
    `Date: ${email.receivedAt}`,
    ...(triage ? [`Triage read it as: ${triage}.`] : []),
    ...(email.summary ? [`Triage's summary: ${email.summary}`] : []),
    '',
    'Body:',
    body.length > JOBS_EVIDENCE_LIMIT ? `${body.slice(0, JOBS_EVIDENCE_LIMIT)}\n\n[The body was cut short here.]` : body,
  ].join('\n');
}

/** What the model read. */
export interface EmailReading {
  event: JobEmailEvent;
  company: string | null;
  title: string | null;
  requisitionId: string | null;
  line: string | null;
}

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean || /^(null|none|n\/a|unknown)$/i.test(clean)) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

/** The tool's input as a reading, or null when it has no event Jobs knows. */
export function emailReadingOf(input: Record<string, unknown> | null): EmailReading | null {
  if (!input || typeof input.event !== 'string' || !(JOB_EMAIL_EVENTS as readonly string[]).includes(input.event)) return null;
  return {
    event: input.event as JobEmailEvent,
    company: text(input.company, 120),
    title: text(input.title, 160),
    requisitionId: text(input.requisition_id, 60),
    line: text(input.line, 80),
  };
}
