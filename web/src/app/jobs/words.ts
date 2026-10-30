// What the Jobs page writes (DESIGN.md › Jobs, boards 32–36): its dates, each status's mark and step,
// the JD column, the per-week tip, Needs you's lines, and the table's order; mail's chip and badge
// (J7); and J8's states and Settings (38a, 38b, 39a, 39b). Pure, so the page and its pane stay thin.
import type {
  ApplicationOut, ApplicationRowOut, JdSummaryOut, JobEventKind, JobReadMode, JobsAiOut, JobsHistoryOut, JobsMailApplicationOut, JobsReadingOut, JobStatus,
  JobWeekOut, NeedsYouItemOut, PostingOut,
} from '@setpoint/shared';
import {clockTime, localDate, readerTime} from '../../logic/format.ts';
import {asOf} from '../../logic/health.ts';
import {dollars} from '../../logic/news.ts';
import type {Segment} from '../../logic/search.ts';
import type {IconName} from '../../ui/glyphs.ts';

const onDay = (date: string, options: Intl.DateTimeFormatOptions) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', {...options, timeZone: 'UTC'});

/** A local day as Jobs writes it: "Oct 6", with the year once it isn't this year's ("Feb 9, 2025"). */
export function dayWord(date: string, today: string): string {
  return date.slice(0, 4) === today.slice(0, 4) ? onDay(date, {month: 'short', day: 'numeric'}) : onDay(date, {month: 'short', day: 'numeric', year: 'numeric'});
}

/** The Applied column: "Today", else the day ("Oct 6"). */
export const appliedWord = (date: string, today: string) => (date === today ? 'Today' : dayWord(date, today));

/** "Oct 1, 10:41 AM", as the full posting's line says when it was found. */
export const stampWord = (at: string, timeZone: string, today: string) => `${dayWord(localDate(at, timeZone), today)}, ${clockTime(at, timeZone)}`;

export const STATUS_LABELS: Record<JobStatus, string> = {applied: 'Applied', in_process: 'In process', offer: 'Offer', rejected: 'Rejected', withdrawn: 'Withdrawn'};

/** The status filter's segments, in the header's order (D314). */
export const FILTERS = ['all', 'applied', 'in_process', 'offer', 'rejected', 'withdrawn'] as const;
export type Filter = (typeof FILTERS)[number];

/** A row's mark and label (D309): Ghosted is a flag on Applied, drawn as its own. */
export type Mark = 'applied' | 'proc' | 'offer' | 'rej' | 'wd' | 'ghost';
export function markOf(row: Pick<ApplicationRowOut, 'status' | 'ghosted'>): Mark {
  if (row.status === 'applied') return row.ghosted ? 'ghost' : 'applied';
  return ({in_process: 'proc', offer: 'offer', rejected: 'rej', withdrawn: 'wd'} as const)[row.status];
}
export const markLabel = (row: Pick<ApplicationRowOut, 'status' | 'ghosted'>) => (row.status === 'applied' && row.ghosted ? 'Ghosted' : STATUS_LABELS[row.status]);

/** Closed (Rejected, Withdrawn) and Ghosted rows step down a shade, never in opacity. */
export const recedes = (row: Pick<ApplicationRowOut, 'status' | 'ghosted'>) => row.status === 'rejected' || row.status === 'withdrawn' || (row.status === 'applied' && row.ghosted);

/**
 * The step after a row's status: In process its latest step ("Interview Tue Oct 13, 2:00 PM"), a
 * re-application "Re-applied" (with the earlier one's end without the detail open), Ghosted "no
 * email in 48 days", the rest the day the status was set ("Oct 6").
 */
export function statusStep(row: ApplicationRowOut, besideDetail: boolean, today: string): string | null {
  if (row.status === 'in_process') return row.step;
  if (row.status === 'applied') {
    if (row.ghosted) return `no email in ${row.days_without_email} days`;
    if (row.reapplied_from) {
      const before = row.reapplied_from;
      return besideDetail ? 'Re-applied' : `Re-applied, ${STATUS_LABELS[before.status].toLowerCase()} ${dayWord(before.status_on, today)}`;
    }
    return null;
  }
  return dayWord(row.status_on, today);
}

/** The pencil's tip on a status set by hand (D322). */
export const setByYou = (row: ApplicationRowOut, today: string) => `Set by you on ${dayWord(row.status_on, today)} · only an email that sets a status changes it`;

/** When something was found, as the JD column's tip says it: "7h ago" today, else the day. */
function foundWhen(at: string, now: number, timeZone: string): string {
  const today = localDate(now, timeZone);
  const day = localDate(at, timeZone);
  if (day !== today) return dayWord(day, today);
  const minutes = Math.floor((now - Date.parse(at)) / 60_000);
  if (minutes < 1) return 'now';
  return minutes < 60 ? `${minutes}m ago` : `${Math.round(minutes / 60)}h ago`;
}

/** How a saved JD was found, in the JD column's words: the platform's name, "Search", "The email's link". */
export function foundBy(jd: Pick<JdSummaryOut, 'source' | 'platform'>): string {
  if (jd.source === 'platform') return jd.platform ?? 'The platform';
  return jd.source === 'search' ? 'Search' : 'The email\'s link';
}

/** The JD column: its glyph, its words and its tip, or nothing for a closed application from history (D311). */
export function jdCell(jd: JdSummaryOut, now: number, timeZone: string): {icon: IconName; text: string; title: string; spin?: boolean} | null {
  switch (jd.state) {
    case 'found': {
      const text = foundBy(jd);
      return {icon: 'description', text, title: jd.found_at ? `${text} · found ${foundWhen(jd.found_at, now, timeZone)}` : text};
    }
    case 'candidates':
      return {icon: 'pending', text: 'In Needs you', title: `${jd.candidates} ${jd.candidates === 1 ? 'candidate' : 'candidates'} in Needs you`};
    case 'not_found':
      return jd.link
        ? {icon: 'remove', text: 'Couldn\'t read', title: 'Couldn\'t read the posting you picked'}
        : {icon: 'remove', text: 'No JD found', title: 'No JD found'};
    case 'looking':
      return {icon: 'progress_activity', text: 'Looking it up…', title: 'Looking for the posting', spin: true};
    case 'none':
      return null;
  }
}

/** The full posting's row and head: "Found on Greenhouse · Oct 1, 10:41 AM", "Found by search · Sep 30, 2:18 PM". */
const foundHow = (posting: Pick<PostingOut, 'source' | 'platform'>) =>
  (posting.source === 'platform' ? `Found on ${posting.platform ?? 'the platform'}` : posting.source === 'search' ? 'Found by search' : 'Found from the email\'s link');

export function foundLine(posting: Pick<PostingOut, 'source' | 'platform' | 'found_at'>, timeZone: string, today: string): string {
  return `${foundHow(posting)} · ${stampWord(posting.found_at, timeZone, today)}`;
}

/** A link's host, the full posting's tool ("greenhouse.example"). */
export function hostOf(link: string): string {
  try {
    return new URL(link).host.replace(/^www\./, '');
  } catch {
    return link;
  }
}

/** A link without its scheme, as the unfolded posting's line shows it whole. */
export const bareLink = (link: string) => link.replace(/^https?:\/\//, '').replace(/^www\./, '');

/** Where a lookup looks, in order, for its line (34c): the email's own link first. */
const PLATFORM_APIS = ['Greenhouse', 'Lever', 'Ashby'];
export const lookingWhere = (platform: string | null) => (platform && !PLATFORM_APIS.includes(platform) ? `${platform}, then the platforms, then search` : 'the email\'s link, then the platforms, then search');

/** No JD found's line (38b): "Breezy and a web search had nothing for it on Oct 1". */
function notFoundLine(platform: string | null, lookedAt: string | null, timeZone: string, today: string): string {
  const who = platform ? `${platform} and a web search` : 'A web search';
  return lookedAt ? `${who} had nothing for it on ${dayWord(localDate(lookedAt, timeZone), today)}` : `${who} had nothing for it`;
}

/** Not found's lead and line: No JD found, or the posting the user picked that Jobs couldn't read (SV-132). */
export function notFoundWords(jd: Pick<JdSummaryOut, 'link' | 'looked_at'>, platform: string | null, timeZone: string, today: string): {lead: string; rest: string} {
  if (!jd.link) return {lead: 'No JD found', rest: notFoundLine(platform, jd.looked_at, timeZone, today)};
  const host = new URL(jd.link).hostname.replace(/^www\./, '');
  return {lead: 'Couldn\'t read the posting you picked', rest: jd.looked_at ? `${host} gave Jobs no text on ${dayWord(localDate(jd.looked_at, timeZone), today)}` : `${host} gave Jobs no text`};
}

/** Applications per week's bars: the busiest week 20 px and the rest in proportion; a week with none a 1 px stub. */
export function barHeights(weeks: Pick<JobWeekOut, 'count'>[], tallest = 20): number[] {
  const most = Math.max(0, ...weeks.map(week => week.count));
  return weeks.map(week => (week.count === 0 || most === 0 ? 1 : Math.max(2, Math.round((week.count / most) * tallest))));
}

/** A bar's tip: "Sep 27 – Oct 3 · 8 applications". */
export function weekTip(week: JobWeekOut, today: string): {when: string; count: string} {
  return {when: `${dayWord(week.start, today)} – ${dayWord(week.end, today)}`, count: `${week.count} ${week.count === 1 ? 'application' : 'applications'}`};
}

const EVENT_WORDS: Partial<Record<JobEventKind, string>> = {
  applied: 'a confirmation', assessment: 'an assessment', interview: 'an interview request', offer: 'an offer', rejection: 'a rejection',
};
const eventWord = (kind: JobEventKind | null) => (kind && EVENT_WORDS[kind]) || 'an update';
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const firstWord = (company: string) => company.split(/\s+/)[0] ?? company;

/** Why an item waits, as its line two and From history's rows word it ("it could be either Humongous application"). */
export function whyLine(item: NeedsYouItemOut): string {
  switch (item.reason) {
    case 'matches_several':
      return `it could be either ${firstWord(item.company)} application`;
    case 'names_no_role':
      return 'names no role, and there are two';
    case 'names_other_role':
      return 'names a role neither application has';
    case 'same_role_elsewhere':
      return 'the same role as an application under another name';
    case 'no_application':
      return `${eventWord(item.event_kind)} with no application`;
    case 'unsure_posting':
      return 'Is this the posting?';
    case 'taken_off':
      return 'taken off the application it was on';
  }
}

/** Line two of a Needs you item (34a): "A rejection · it could be either Humongous application", "An interview request with no application". */
export function needsLine(item: NeedsYouItemOut): string {
  if (item.reason === 'no_application') return capital(whyLine(item));
  if (item.kind === 'jd_to_confirm') return 'Is this the posting?';
  return `${capital(eventWord(item.event_kind))} · ${whyLine(item)}`;
}

/** What an item is about, its line one: "Lucerne Publishing · Junior Developer" for a JD, else the email's subject. */
export const itemWhat = (item: NeedsYouItemOut) => (item.kind === 'jd_to_confirm' ? [item.company, item.title].filter(Boolean).join(' · ') : item.subject ?? item.company);

/** Who it's from, after line one: "Humongous Insurance via iCIMS", or the company. */
export const itemFrom = (item: NeedsYouItemOut) => (item.platform && item.kind === 'update_to_assign' ? `${item.company} via ${item.platform}` : item.company);

/** A From history row's words after its subject (34b): "Relecloud · names a role neither application has", "Is this the posting? · 3 candidates". */
export function historyWhy(item: NeedsYouItemOut): string {
  if (item.kind === 'jd_to_confirm') return `Is this the posting? · ${item.candidates.length} ${item.candidates.length === 1 ? 'candidate' : 'candidates'}`;
  return `${item.company} · ${whyLine(item)}`;
}

/** A role-less application (a confirmation that named none) reads as this in its row, title and tab. */
export const NO_ROLE = 'No role named';
export const titleOf = (row: Pick<ApplicationRowOut, 'title'>) => row.title.trim() || NO_ROLE;

/** The tab's title: "Jobs", or "Software Engineer I · Northwind Talent" with one open; never a count. */
export const tabTitle = (row: Pick<ApplicationRowOut, 'title' | 'company'> | null) => (row ? (row.title.trim() ? `${row.title.trim()} · ${row.company}` : row.company) : 'Jobs');

/**
 * The detail's status line after its chip: In process's latest step, else the last email that set a
 * status after the first ("Update on your application"), with its age; "No reply yet" when none has.
 */
export function latestStep(detail: Pick<ApplicationOut, 'status' | 'step' | 'step_at' | 'timeline'>): {text: string; at: string | null} {
  if (detail.status === 'in_process' && detail.step) return {text: detail.step, at: detail.step_at};
  // A second confirmation (one a merge brought) isn't a step.
  const moved = detail.timeline.filter(event => !event.quiet).slice(1).filter(event => event.kind !== 'applied').at(-1);
  return moved ? {text: moved.subject, at: moved.at} : {text: 'No reply yet', at: null};
}

/** The detail's line under its head, "· Applied Oct 1", "· Applied Today". */
export const appliedLine = (date: string, today: string) => `Applied ${appliedWord(date, today)}`;

// ---- In mail (J7, boards 37a–37c) ----

/**
 * Where an application stands, after its Applied date in mail's chip and badge: "In process",
 * "Rejected Oct 5", "Offer Oct 6", "Ghosted"; nothing for Applied, which the date already says.
 */
export function standing(application: Pick<JobsMailApplicationOut, 'status' | 'status_on' | 'ghosted'>, today: string): string | null {
  if (application.status === 'applied') return application.ghosted ? 'Ghosted' : null;
  if (application.status === 'in_process') return STATUS_LABELS.in_process;
  return `${STATUS_LABELS[application.status]} ${dayWord(application.status_on, today)}`;
}

/** "Applied Sep 16 · Rejected Oct 5": the badge, and the chip after its role. */
export const appliedStanding = (application: Pick<JobsMailApplicationOut, 'applied_on' | 'status' | 'status_on' | 'ghosted'>, today: string) =>
  [appliedLine(application.applied_on, today), standing(application, today)].filter(Boolean).join(' · ');

/** The chip's role, or the company for an application that names none. */
export const chipRole = (application: Pick<JobsMailApplicationOut, 'title' | 'company'>) => application.title.trim() || application.company;

/** The popover's foot: "Found on Greenhouse · Oct 1", its full time in the tooltip (foundLine). */
export function foundShort(posting: Pick<PostingOut, 'source' | 'platform' | 'found_at'>, timeZone: string, today: string): string {
  return `${foundHow(posting)} · ${dayWord(localDate(posting.found_at, timeZone), today)}`;
}

// ---- The table's order (D314: newest first by Applied, by default) ----

export const SORT_KEYS = ['company', 'role', 'platform', 'applied', 'status', 'jd'] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export interface Sort {
  key: SortKey;
  down: boolean;
}
export const DEFAULT_SORT: Sort = {key: 'applied', down: true};

const STATUS_ORDER: Record<Mark, number> = {proc: 0, offer: 1, applied: 2, ghost: 3, wd: 4, rej: 5};
const JD_ORDER: Record<JdSummaryOut['state'], number> = {found: 0, candidates: 1, looking: 2, not_found: 3, none: 4};
const text = (a: string | null, b: string | null) => (a ?? '￿').localeCompare(b ?? '￿', 'en', {sensitivity: 'base'});

/**
 * A header's click: sorts by it (Applied newest first, the rest A to Z or in their order), and a
 * second click flips it.
 */
export const nextSort = (sort: Sort, key: SortKey): Sort => (sort.key === key ? {key, down: !sort.down} : {key, down: key === 'applied'});

/** Rows in the table's order; ties go newest first, so a sort never shuffles equal rows. */
export function sortRows<T extends ApplicationRowOut>(rows: readonly T[], sort: Sort): T[] {
  const newest = (a: T, b: T) => b.applied_at.localeCompare(a.applied_at) || b.id - a.id;
  const by: Record<SortKey, (a: T, b: T) => number> = {
    company: (a, b) => text(a.company, b.company),
    role: (a, b) => text(a.title, b.title),
    platform: (a, b) => text(a.platform, b.platform),
    applied: (a, b) => a.applied_at.localeCompare(b.applied_at) || a.id - b.id,
    status: (a, b) => STATUS_ORDER[markOf(a)] - STATUS_ORDER[markOf(b)],
    jd: (a, b) => JD_ORDER[a.jd.state] - JD_ORDER[b.jd.state],
  };
  return [...rows].sort((a, b) => {
    const order = by[sort.key](a, b) * (sort.down ? -1 : 1);
    return order || newest(a, b);
  });
}

// ---- Search's highlights (36a, 36b) ----

const searchWords = (q: string) => q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Text with what the query matched marked, as the server matched it: each query word at the start of
 * a word ("humongous" in Humongous Insurance, "kubernetes" in a JD's line).
 */
export function marks(textValue: string, q: string): Segment[] {
  const words = searchWords(q);
  if (!words.length) return [{text: textValue, mark: false}];
  const escaped = words.map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${escaped.join('|')})`, 'giu');
  const parts: Segment[] = [];
  let last = 0;
  for (const match of textValue.matchAll(pattern)) {
    if (match.index > last) parts.push({text: textValue.slice(last, match.index), mark: false});
    parts.push({text: match[0], mark: true});
    last = match.index + match[0].length;
  }
  if (last < textValue.length) parts.push({text: textValue.slice(last), mark: false});
  return parts;
}

// ---- J8: the states (38a, 38b) and Settings (39a, 39b) ----

const emails = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'email' : 'emails'}`;

/** The history pass's line while it runs (38a): "Reading history · 140 of 330 emails · showing what’s read so far". */
export const historyLine = (history: Pick<JobsHistoryOut, 'read' | 'total'>) =>
  `Reading history · ${history.read.toLocaleString('en-US')} of ${emails(history.total)} · showing what’s read so far`;

/** How far the pass has come, 0 to 1, for its line's foot. */
export const historyShare = (history: Pick<JobsHistoryOut, 'read' | 'total'>) => (history.total > 0 ? Math.min(1, history.read / history.total) : 0);

/** The line's last words, with its `good` check, before it folds away: "Read 330 emails". */
export const historyRead = (history: Pick<JobsHistoryOut, 'read'>) => `Read ${emails(history.read)}`;

/** Whether the pass is under way: reading, or held while the AI is down. */
export const historyRuns = (history: Pick<JobsHistoryOut, 'state'>) => history.state === 'running' || history.state === 'waiting';

/**
 * The AI down (38b): "5 emails not read yet, Anthropic unreachable since 8:52 AM, retrying". It counts
 * what waits for the reader and what the history pass, held, has still to read. Null while healthy.
 */
export function readingLine(reading: JobsReadingOut, history: Pick<JobsHistoryOut, 'state' | 'read' | 'total'>, now: number, timeZone: string): string | null {
  if (reading.state !== 'down' || !reading.cause) return null;
  const since = reading.since ? ` since ${asOf(reading.since, now, timeZone)}` : '';
  const why = {
    unreachable: `Anthropic unreachable${since}`,
    rate_limited: `Anthropic rate limited${since}`,
    refused: 'Anthropic refused its key in Settings › AI',
    no_key: 'Jobs needs an Anthropic key in Settings › AI',
  }[reading.cause];
  const waiting = reading.waiting + (history.state === 'waiting' ? Math.max(0, history.total - history.read) : 0);
  const line = `${why}${reading.retrying ? ', retrying' : ''}`;
  return waiting ? `${emails(waiting)} not read yet, ${line}` : line;
}

/** Settings › Jobs's head (39a): "62 applications". */
export const applicationsCount = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'application' : 'applications'}`;

/** What Jobs reads in an account (D310, #273), its select's choices: "Every email", "Career mail only", or "Off" for one it doesn't list. */
export const READS_WORDS: Record<JobReadMode | 'off', string> = {every: 'Every email', career: 'Career mail only', off: 'Off'};

/**
 * Settings › Jobs's History pass row (39a): "Read 330 emails once, when Jobs was turned on · finished
 * Oct 1, 8:14 PM" once done, the running line while it runs, and what it will do before it has.
 */
export function historySetting(history: JobsHistoryOut, now: number, timeZone: string): string {
  if (historyRuns(history)) return `Reading history · ${history.read.toLocaleString('en-US')} of ${emails(history.total)}`;
  if (history.state === 'done') {
    const finished = history.finished_at ? ` · finished ${readerTime(history.finished_at, now, timeZone)}` : '';
    return `Read ${emails(history.read)} once, when Jobs was turned on${finished}`;
  }
  return 'Runs once when Jobs is turned on, over the mail from before then';
}

/** Settings › Jobs's From history row: "6 waiting in Needs you, what the pass wasn't sure of". */
export const fromHistorySetting = (waiting: number) =>
  (waiting ? `${waiting.toLocaleString('en-US')} waiting in Needs you, what the pass wasn't sure of` : 'None waiting in Needs you');

/** A model's name and how it runs: "Claude Sonnet 5.5 with web search". */
export const jobsModelWith = (label: string, search = false) => (search ? `${label} with web search` : label);

/** Usage this month's Jobs row (39b): "Emails $0.62 · finding JDs $2.71 · reading JDs $0.52". */
export function jobsUsageParts(month: JobsAiOut['this_month']): string {
  const parts: [string, number][] = [['Emails', month.emails.cost_usd], ['finding JDs', month.finding_jds.cost_usd], ['reading JDs', month.reading_jds.cost_usd]];
  return parts.map(([name, cost]) => `${name} ${dollars(cost, true)}`).join(' · ');
}
