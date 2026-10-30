// What the JD lookup asks the models (J3; decisions 53, 54, 61, D315), and how it reads their
// answers, leniently, as Jobs reads an email's (./prompt.ts):
// - Haiku 5.5 checks the candidates the email's link or a platform found against the application
//   (company, normalised title, location, date): each is the posting, might be, or isn't.
// - Sonnet 5.5 with Claude's web search, only when those miss, searches and judges what it finds
//   itself, as the same three verdicts.
// - Haiku 5.5 reads the saved JD: location and setting, salary if stated, must-haves, nice-to-haves
//   and the three-line what-they-want summary.
import type {JobWorkplace} from '@setpoint/shared';
import type {ToolSpec} from '../providers/ai/index.ts';
import type {Verdict} from './lookupRules.ts';

/** Bumped when a prompt or tool changes. */
export const JD_PROMPT_VERSION = 'v2';

/** How much of a candidate's text the check sees, and of the confirmation email. */
export const CHECK_TEXT_LIMIT = 1_500;
export const EMAIL_EXCERPT_LIMIT = 3_000;
/** How much of a posting the reading sees: the whole of nearly every posting. */
export const READING_TEXT_LIMIT = 30_000;
/** Web searches Sonnet may run for one lookup (D-recorded). */
export const SEARCH_MAX_USES = 5;

export const CHECK_MAX_OUTPUT_TOKENS = 300;
export const READING_MAX_OUTPUT_TOKENS = 1_200;
export const SEARCH_MAX_OUTPUT_TOKENS = 2_000;

/** The application, as the prompts describe it. */
export interface JdApplication {
  company: string;
  title: string;
  requisitionId: string | null;
  // Its Applied date, YYYY-MM-DD in the user's zone.
  appliedOn: string;
  platform: string | null;
  // The confirmation's text (and a job board's match email's), cut.
  emails: string[];
}

const clip = (text: string, limit: number) => (text.length > limit ? `${text.slice(0, limit).trimEnd()}\n[cut]` : text);

function applicationLines(application: JdApplication): string[] {
  return [
    `Company: ${application.company}`,
    `Role: ${application.title || '(the emails name none)'}`,
    ...(application.requisitionId ? [`Requisition ID: ${application.requisitionId}`] : []),
    `Applied: ${application.appliedOn}`,
    ...(application.platform ? [`Applied through: ${application.platform}`] : []),
    ...application.emails.map((email, index) => `\nEmail ${index + 1} about it:\n${clip(email.trim(), EMAIL_EXCERPT_LIMIT)}`),
  ];
}

// ---- The check (Haiku) ----

export const CHECK_SYSTEM = `You check which job postings are the one the user applied to, for their job application tracker. Answer only with the submit_posting_check tool.

For each candidate give a verdict:
- match: the same employer, the same role (titles can differ in brackets, tags like "remote", or word order), a location that fits what the emails say, and posted before the user applied. Say match only when you are sure.
- maybe: it could be the one, but something doesn't fit or the emails don't say enough to tell (another location of the same role, a near title).
- no: another employer, another role, or posted after the user applied.

A page that isn't a job posting itself, such as an application confirmation, an application status page, or the applicant's own details and answers, is no, whatever company and role it names.`;

export const CHECK_TOOL: ToolSpec = {
  name: 'submit_posting_check',
  description: 'Submit a verdict on each candidate posting.',
  schema: {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        items: {type: 'object', properties: {candidate: {type: 'integer'}, verdict: {type: 'string', enum: ['match', 'maybe', 'no']}}, required: ['candidate', 'verdict']},
      },
    },
    required: ['verdicts'],
  },
};

export interface CheckCandidate {
  title: string;
  location: string | null;
  postedAt: string | null;
  requisitionId: string | null;
  site: string;
  link: string;
  text: string;
}

export function checkInput(application: JdApplication, candidates: CheckCandidate[]): string {
  return [
    'The application:',
    ...applicationLines(application),
    '',
    ...candidates.flatMap((candidate, index) => [
      `Candidate ${index + 1}, on ${candidate.site}: ${candidate.link}`,
      `Title: ${candidate.title}`,
      `Location: ${candidate.location ?? 'not given'}`,
      ...(candidate.postedAt ? [`Posted: ${candidate.postedAt.slice(0, 10)}`] : []),
      ...(candidate.requisitionId ? [`Requisition ID: ${candidate.requisitionId}`] : []),
      `Text:\n${clip(candidate.text, CHECK_TEXT_LIMIT)}`,
      '',
    ]),
  ].join('\n');
}

const VERDICTS = new Set<Verdict>(['match', 'maybe', 'no']);

/** Each candidate's verdict, in order. One the answer leaves out, or an answer it can't use, is "maybe": unsure, never saved. */
export function verdictsOf(input: Record<string, unknown> | null, count: number): Verdict[] {
  const out: Verdict[] = Array.from({length: count}, () => 'maybe');
  const list = input && Array.isArray(input.verdicts) ? input.verdicts : [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const {candidate, verdict} = entry as {candidate?: unknown; verdict?: unknown};
    const index = typeof candidate === 'number' ? candidate - 1 : typeof candidate === 'string' ? Number(candidate) - 1 : -1;
    if (Number.isInteger(index) && index >= 0 && index < count && typeof verdict === 'string' && VERDICTS.has(verdict as Verdict)) out[index] = verdict as Verdict;
  }
  return out;
}

// ---- The search (Sonnet with web search) ----

export const SEARCH_SYSTEM = `You find the job posting the user applied to, for their job application tracker, while it's still up. Use web search, then answer only with the submit_posting_search tool.

Search for the employer's own careers page and its hiring platform (Greenhouse, Lever, Ashby, Workday, iCIMS, SmartRecruiters and the like) before job boards. Give up to three candidates, best first, each the page of one posting (never a search results page or a list of jobs), with:
- url: the posting's address, exactly as found
- title, location, and site (where it is: "Greenhouse", "LinkedIn", the employer's name)
- verdict: match only when you are sure it is the same employer, the same role, a location that fits the emails, and was up when the user applied; maybe when it could be.

Give an empty list when nothing you found could be it. Never make up an address.`;

export const SEARCH_TOOL: ToolSpec = {
  name: 'submit_posting_search',
  description: 'Submit the postings found, best first.',
  schema: {
    type: 'object',
    properties: {
      candidates: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          properties: {
            url: {type: 'string'}, title: {type: 'string'}, location: {anyOf: [{type: 'string'}, {type: 'null'}]}, site: {type: 'string'},
            verdict: {type: 'string', enum: ['match', 'maybe']},
          },
          required: ['url', 'title', 'location', 'site', 'verdict'],
        },
      },
    },
    required: ['candidates'],
  },
};

export const searchInput = (application: JdApplication) => ['Find the posting for this application:', ...applicationLines(application)].join('\n');

export interface SearchCandidate {
  url: string;
  title: string;
  location: string | null;
  site: string;
  verdict: Verdict;
}

const line = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean || /^(null|none|n\/a|unknown)$/i.test(clean)) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
};

const httpUrl = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
};

/** Sonnet's candidates, at most three, each with a usable address; none from an answer it can't use. */
export function searchCandidatesOf(input: Record<string, unknown> | null): SearchCandidate[] {
  const list = input && Array.isArray(input.candidates) ? input.candidates : [];
  const out: SearchCandidate[] = [];
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const url = httpUrl(record.url);
    const title = line(record.title, 160);
    if (!url || !title || out.some(each => each.url === url)) continue;
    const site = line(record.site, 60) ?? new URL(url).hostname.replace(/^www\./, '');
    out.push({url, title, location: line(record.location, 120), site, verdict: record.verdict === 'match' ? 'match' : 'maybe'});
  }
  return out.slice(0, 3);
}

// ---- The reading (Haiku) ----

export const READING_SYSTEM = `You read one job posting for the user's job application tracker, for the minute before a call. Answer only with the submit_posting_reading tool, from the posting's own words; never guess.

- summary: what they want, in three short lines of plain sentences (no bullets): the role, the work, and what matters most to them.
- location: the place as the posting gives it ("Irvine, CA", "Remote, US"), or null.
- workplace: on_site, hybrid or remote, or null when it doesn't say. workplace_detail: how much in the office when stated ("3 days"), else null.
- salary: the pay range exactly as stated ("$95,000–$115,000"), or null when it isn't stated.
- must_haves: what it requires, at most 8, each under 80 characters.
- nice_to_haves: what it prefers or calls a plus, at most 8, each under 80 characters.`;

const nullable = {anyOf: [{type: 'string'}, {type: 'null'}]};

export const READING_TOOL: ToolSpec = {
  name: 'submit_posting_reading',
  description: 'Submit what the posting says.',
  schema: {
    type: 'object',
    properties: {
      summary: {type: 'string'},
      location: nullable,
      workplace: {anyOf: [{type: 'string', enum: ['on_site', 'hybrid', 'remote']}, {type: 'null'}]},
      workplace_detail: nullable,
      salary: nullable,
      must_haves: {type: 'array', items: {type: 'string'}},
      nice_to_haves: {type: 'array', items: {type: 'string'}},
    },
    required: ['summary', 'location', 'workplace', 'workplace_detail', 'salary', 'must_haves', 'nice_to_haves'],
  },
};

export function readingInput(application: Pick<JdApplication, 'company' | 'title'>, posting: {title: string; location: string | null; facts: string[]; text: string}): string {
  return [
    `Employer: ${application.company}`,
    `Posting: ${posting.title}`,
    ...(posting.location ? [`Location given: ${posting.location}`] : []),
    ...posting.facts,
    '',
    clip(posting.text, READING_TEXT_LIMIT),
  ].join('\n');
}

export interface PostingReading {
  summary: string;
  location: string | null;
  workplace: JobWorkplace | null;
  workplaceDetail: string | null;
  salary: string | null;
  mustHaves: string[];
  niceToHaves: string[];
}

const items = (value: unknown) => (Array.isArray(value) ? value.map(item => line(item, 120)).filter((item): item is string => item !== null).slice(0, 8) : []);

/** What the reading found; an answer it can't use reads as nothing found, so the JD is still kept (its text is what matters). */
export function postingReadingOf(input: Record<string, unknown> | null, fallbackLocation: string | null): PostingReading {
  const workplace = input?.workplace;
  const summary = typeof input?.summary === 'string' ? input.summary.replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim().slice(0, 600) : '';
  return {
    summary,
    location: line(input?.location, 200) ?? fallbackLocation,
    workplace: workplace === 'on_site' || workplace === 'hybrid' || workplace === 'remote' ? workplace : null,
    workplaceDetail: line(input?.workplace_detail, 40),
    salary: line(input?.salary, 240),
    mustHaves: items(input?.must_haves),
    niceToHaves: items(input?.nice_to_haves),
  };
}
