// What Setpoint on LinkedIn's chip says (SV-174, DESIGN.md › Decided while building #301, D434): an
// application's standing as mail's Applied before badge says it ("Applied Sep 16 · Rejected
// Oct 5"), the company's other roles, "Not applied", and why there's no answer. The standing is
// written here rather than imported, as web/src/app/jobs/words.ts brings the web app's modules with
// it; jobs.test.tsx holds the two to the same words.
import type {JobsCheckPostingOut, JobsMailApplicationOut, JobStatus} from '@setpoint/shared';

type Application = Pick<JobsMailApplicationOut, 'applied_on' | 'status' | 'status_on' | 'ghosted'>;

const STATUS_LABELS: Record<JobStatus, string> = {applied: 'Applied', in_process: 'In process', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn'};

const onDay = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {...options, timeZone: 'UTC'});

/** "Oct 6", with the year once it isn't this year's ("Feb 9, 2025"). */
const dayWord = (date: string, today: string) =>
  onDay(date, date.slice(0, 4) === today.slice(0, 4) ? {month: 'short', day: 'numeric'} : {month: 'short', day: 'numeric', year: 'numeric'});

/** "Applied Sep 16 · Rejected Oct 5", "Applied Oct 20 · In process", "Applied Today", "Applied Aug 2 · Ghosted". */
export function appliedStanding(application: Application, today: string): string {
  const applied = `Applied ${application.applied_on === today ? 'Today' : dayWord(application.applied_on, today)}`;
  const after = application.status === 'applied' ? (application.ghosted ? 'Ghosted' : null)
    : application.status === 'in_process' ? STATUS_LABELS.in_process
    : `${STATUS_LABELS[application.status]} ${dayWord(application.status_on, today)}`;
  return after ? `${applied} · ${after}` : applied;
}

/** Rejected, Withdrawn and Ghosted step down a shade, as Jobs's rows do. */
export const closes = (application: Pick<JobsMailApplicationOut, 'status' | 'ghosted'>) =>
  application.status === 'rejected' || application.status === 'withdrawn' || (application.status === 'applied' && application.ghosted);

/** The local day the chip counts from, the browser's own ("2026-11-03"). */
export function todayOf(now = new Date()): string {
  const pad = (number: number) => String(number).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Why there's no answer to show: not set up, the token refused, Setpoint unreachable or failing, or an answer this build can't read. */
export type Failure = 'setup' | 'token' | 'unreachable' | 'answer';

/** A posting's answer as the page has it. */
export type Answer =
  | {ok: true; origin: string; enabled: boolean; posting: JobsCheckPostingOut}
  | {ok: false; reason: Failure; detail?: string};

/** Violet as Jobs for this role (a shade down once closed), amber for another role, quiet for none, warn for a failure. */
export type Tone = 'applied' | 'closed' | 'other' | 'quiet' | 'warn';

/** A chip: its words, its tooltip, and where a click goes (Setpoint, or the extension's options). */
export interface Chip {
  tone: Tone;
  text: string;
  tip: string;
  href?: string;
  options?: true;
}

/** The pane's chip follows the title and always says something; a card's follows the company, only for an application. */
export type Place = 'pane' | 'card';

const FAILURES: Record<Failure, (detail?: string) => Chip> = {
  setup: () => ({tone: 'quiet', text: 'Set up Setpoint', tip: 'Add Setpoint\'s address and Jobs token in the extension\'s options', options: true}),
  token: () => ({tone: 'warn', text: 'Setpoint refused the token', tip: 'Issue a new one with npm run cli -- jobs-token, then paste it in the options', options: true}),
  unreachable: detail => ({tone: 'warn', text: 'Setpoint unreachable', tip: ['Setpoint didn\'t answer', detail].filter(Boolean).join(', '), options: true}),
  answer: () => ({tone: 'warn', text: 'Couldn\'t read Setpoint\'s answer', tip: 'It isn\'t the shape this build reads, so rebuild the extension from Setpoint\'s commit'}),
};

/** "Software Engineer I · Applied Sep 16 · Rejected Oct 5", a line of the tooltip; the company for an application that names no role. */
const listed = (applications: JobsMailApplicationOut[], today: string) =>
  applications.map(application => `${application.title.trim() || application.company} · ${appliedStanding(application, today)}`).join('\n');

/** What the chip says and does for a posting's answer (null while it's asked), or null for none. */
export function chipFor(answer: Answer | null, company: string, place: Place, today: string): Chip | null {
  const card = place === 'card';
  if (!answer) return card ? null : {tone: 'quiet', text: 'Setpoint…', tip: 'Asking Setpoint'};
  if (!answer.ok) return card ? null : FAILURES[answer.reason](answer.detail);
  if (!answer.enabled) return card ? null : {tone: 'quiet', text: 'Jobs is off in Setpoint', tip: 'Turn it on in Settings › Jobs'};
  const {role, others, query} = answer.posting;
  const [latest] = role;
  if (latest) {
    const again = role.length > 1 ? ` · ${role.length} times` : '';
    return {
      tone: closes(latest) ? 'closed' : 'applied', text: `${appliedStanding(latest, today)}${again}`,
      tip: `Open in Setpoint\n${listed([...role, ...others], today)}`, href: `${answer.origin}/jobs/${latest.id}`,
    };
  }
  if (others.length) {
    const count = others.length;
    return {
      tone: 'other', text: `Applied to ${count === 1 ? 'another role' : `${count} other roles`} here`,
      tip: `Open Jobs searched for ${company}\n${listed(others, today)}`, href: `${answer.origin}/jobs?q=${encodeURIComponent(query ?? company)}`,
    };
  }
  return card ? null : {tone: 'quiet', text: 'Not applied', tip: `Nothing in Setpoint's Jobs at ${company}`};
}
