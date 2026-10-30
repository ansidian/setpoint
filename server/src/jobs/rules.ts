// Jobs's pure rules, tested as tables (tests/rules.test.ts, tests/reading.test.ts): Ghosted, the
// per-week buckets, the counts by status, which of a company's other applications are Applied before
// (J1); and what each email does (J2): the keys and loose company names applications match on, a
// confident match, duplicates and re-applications, Indeed's pairs, statuses and blocked emails; and
// mail's Applied before (J7). No
// database, no clock: the caller passes now and the zone.
import {GHOSTED_AFTER_DAYS, isQuietJobEvent, JOB_STATUSES, JOB_WEEKS, STATUS_OF_JOB_EVENT} from '@setpoint/shared';
import type {JobCountsOut, JobEventKind, JobReadMode, JobStatus, JobWeekOut, Kind, NeedsYouReason} from '@setpoint/shared';
import {addDays, daysBetween, localDay, weekday} from '../domain/time.ts';
import type {JobEmailEvent} from './prompt.ts';

/** Whole local days from an application's last email (or its Applied date, with none) to now. */
export function daysWithoutEmail(lastEmailAt: string, now: string, timeZone: string): number {
  return Math.max(0, daysBetween(localDay(lastEmailAt, timeZone), localDay(now, timeZone)));
}

/**
 * Ghosted (decision 55): still at Applied, with no email for 30 days or more. A flag, never a status:
 * an email of any kind, quiet ones included, starts the 30 days again, and it never moves the
 * application to Rejected.
 */
export function isGhosted(status: JobStatus, lastEmailAt: string, now: string, timeZone: string): boolean {
  return status === 'applied' && daysWithoutEmail(lastEmailAt, now, timeZone) >= GHOSTED_AFTER_DAYS;
}

/**
 * Applications per week (D314, D318): the last 12 weeks oldest first, Sunday to Saturday in the zone,
 * the last being this week, unfinished, counting what's applied so far. An application counts in the
 * week of its Applied date (a tracked one's is its email's, decision 69).
 */
export function weeklyCounts(appliedAts: string[], now: string, timeZone: string, weeks = JOB_WEEKS): JobWeekOut[] {
  const today = localDay(now, timeZone);
  const thisWeek = addDays(today, -weekday(today));
  const out: JobWeekOut[] = Array.from({length: weeks}, (_, index) => {
    const start = addDays(thisWeek, -7 * (weeks - 1 - index));
    return {start, end: addDays(start, 6), count: 0, current: index === weeks - 1};
  });
  const first = out[0]!.start;
  for (const at of appliedAts) {
    const day = localDay(at, timeZone);
    if (day < first || day > out.at(-1)!.end) continue;
    out[Math.floor(daysBetween(first, day) / 7)]!.count += 1;
  }
  return out;
}

/** The status filter's counts: every application, each status, and how many at Applied are Ghosted. */
export function countsByStatus(applications: {status: JobStatus; ghosted: boolean}[]): JobCountsOut {
  const byStatus = Object.fromEntries(JOB_STATUSES.map(status => [status, 0])) as Record<JobStatus, number>;
  let ghosted = 0;
  for (const application of applications) {
    byStatus[application.status] += 1;
    if (application.ghosted) ghosted += 1;
  }
  return {all: applications.length, by_status: byStatus, ghosted};
}

export const isClosed = (status: JobStatus) => status === 'rejected' || status === 'withdrawn';

/**
 * Splits a company's other applications for the detail (D306): earlier, closed ones are Applied
 * before (a re-application's earlier one among them); the rest, open or later, are Also at.
 * Both newest first.
 */
export function relatedApplications<T extends {id: number; appliedAt: string; status: JobStatus}>(self: {id: number; appliedAt: string}, others: T[]) {
  const sorted = others.filter(other => other.id !== self.id).sort((a, b) => b.appliedAt.localeCompare(a.appliedAt) || b.id - a.id);
  const before = (other: T) => isClosed(other.status) && other.appliedAt < self.appliedAt;
  return {appliedBefore: sorted.filter(before), alsoAt: sorted.filter(other => !before(other))};
}

/**
 * A title as applications match on it (decision 51): case, anything in brackets, and tags like
 * "remote" or "hybrid" ignored, so "Software Engineer II (Java) (2026-1042)" and "Software Engineer
 * II" are one role. A requisition ID, when an email gives one, wins over it (J2).
 */
export function titleKey(title: string): string {
  return title.toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/\b(remote|hybrid|on-?site)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** A company with case and punctuation ignored. */
export function companyKey(company: string): string {
  return company.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Words a company's name may carry or drop without being another company.
const COMPANY_SUFFIXES = new Set(['the', 'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh']);

const companyWords = (company: string) => companyKey(company).split(' ').filter(word => word && !COMPANY_SUFFIXES.has(word));

/**
 * Companies match loosely (decision 51, D305): case, punctuation and "Inc." ignored, and one name may
 * be the start of the other, word by word. "Fabrikam Labs" is "Fabrikam", and "wide world" is "Wide
 * World Importers"; "Northwind Talent" isn't "Northwind Traders", and "Fabrikam" isn't "Fabrikamco".
 */
export function sameCompany(a: string, b: string): boolean {
  const [short, long] = [companyWords(a), companyWords(b)].sort((x, y) => x.length - y.length) as [string[], string[]];
  return short.length > 0 && short.every((word, index) => long[index] === word);
}

/** A requisition ID as it's compared: case, spaces and dashes ignored ("R-2026-118" is "r2026118"). */
export function requisitionKey(id: string): string {
  return id.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

// ---- Reading mail into applications (J2, decisions 50, 51, 55, 56, 67, 68) ----

/** Which mail an account Jobs lists is read (decision 56): all of it, or only triage's Career. */
export const readsEmail = (mode: JobReadMode | null, kind: Kind | null) => mode === 'every' || (mode === 'career' && kind === 'career');

/** A role as an email or application names it: its requisition ID wins over its title (decision 51). */
export interface Role {
  titleKey: string | null;
  requisitionId: string | null;
}

/** Two roles are one: by requisition ID when both have one, else by normalised title. */
export function sameRole(a: Role, b: Role): boolean {
  if (a.requisitionId && b.requisitionId) return requisitionKey(a.requisitionId) === requisitionKey(b.requisitionId);
  return !!a.titleKey && a.titleKey === b.titleKey;
}

const namesRole = (role: Role) => !!role.titleKey || !!role.requisitionId;

/**
 * Another company and role an application answers to, because the user said so (decision 58): a
 * merge brings the other's, an email moved or assigned to it brings the role it names, and a title
 * or company edited by hand keeps the old name (./stick.ts). A null company is the application's own.
 */
export interface Alias extends Role {
  company: string | null;
}

/** What the rules know of an application. */
export interface KnownApplication extends Role {
  id: number;
  company: string;
  status: JobStatus;
  statusSetAt: string;
  appliedAt: string;
  // A company-less confirmation waiting for its Indeed pair.
  companyUnknown: boolean;
  aliases?: Alias[];
}

/** Whether an application answers to a company: its own, or one a correction gave it. */
const answersTo = (application: KnownApplication, company: string) =>
  sameCompany(application.company, company) || (application.aliases ?? []).some(alias => alias.company !== null && sameCompany(alias.company, company));

/** Whether an application is about a role: its own, or one a correction gave it at that company. */
const hasRole = (application: KnownApplication, company: string, role: Role) =>
  sameRole(application, role) || (application.aliases ?? []).some(alias => (alias.company === null || sameCompany(alias.company, company)) && sameRole(alias, role));

export type Match =
  | {match: KnownApplication}
  | {several: NeedsYouReason}
  | {none: 'no_company' | 'no_role' | NeedsYouReason};

const newestFirst = (a: KnownApplication, b: KnownApplication) => b.appliedAt.localeCompare(a.appliedAt) || b.id - a.id;

/**
 * A confident match (decision 51): a role (requisition ID or normalised title) that matches exactly
 * one of the company's applications, or the one that's still open when it matches a closed one and
 * its re-application; or, for an email naming no role, the company's only open application.
 * Otherwise it might match (two or more, or a role the company's applications don't have) or matches
 * nothing (no application at the company, or none open for an email naming no role).
 */
export function matchApplication(applications: KnownApplication[], company: string, role: Role): Match {
  const atCompany = applications.filter(application => !application.companyUnknown && answersTo(application, company));
  if (!atCompany.length) return {none: 'no_company'};
  const open = atCompany.filter(application => !isClosed(application.status));
  if (!namesRole(role)) {
    if (open.length === 1) return {match: open[0]!};
    return open.length ? {several: 'names_no_role'} : {none: 'no_role'};
  }
  const roles = atCompany.filter(application => hasRole(application, company, role)).sort(newestFirst);
  if (roles.length === 1) return {match: roles[0]!};
  if (!roles.length) return {none: 'names_other_role'};
  const openRoles = roles.filter(application => !isClosed(application.status));
  return openRoles.length === 1 ? {match: openRoles[0]!} : {several: 'matches_several'};
}

/**
 * Applied before (D306, decision 52), for mail: a job board's match email ("Associate Software
 * Engineer @ Contoso Pharmaceuticals") whose company matches applications, loosely and by the
 * companies corrections gave them, as an email does. Any other email, or one naming no company, has
 * none. The matches come newest first, the badge naming the first; `query` is the search that shows
 * them all on Jobs: the words their companies share, or the newest's company when they share none.
 */
export function appliedBefore<T extends KnownApplication>(email: {event: string | null; company: string | null}, applications: T[]): {matches: T[]; query: string} | null {
  if (email.event !== 'match' || !email.company?.trim()) return null;
  const company = email.company;
  const matches = applications.filter(application => !application.companyUnknown && answersTo(application, company)).sort(newestFirst);
  if (!matches.length) return null;
  const words = matches.map(application => companyWords(application.company));
  const shared: string[] = [];
  for (const [index, word] of words[0]!.entries()) {
    if (!words.every(each => each[index] === word)) break;
    shared.push(word);
  }
  return {matches, query: shared.length ? shared.join(' ') : companyKey(matches[0]!.company)};
}

/**
 * The status an event moves its application to (decisions 55, 68), or null: only an event that sets
 * one, and only when it's no older than the status it replaces, so an email read late never undoes a
 * newer one. A status set by hand gives way to a later email that sets one; a quiet email never moves it.
 */
export function statusAfter(application: Pick<KnownApplication, 'statusSetAt'>, kind: JobEventKind, at: string): JobStatus | null {
  if (isQuietJobEvent(kind)) return null;
  if (at < application.statusSetAt) return null;
  return STATUS_OF_JOB_EVENT[kind];
}

/** An event as Let emails decide reads it. */
export interface StatusEvent {
  at: string;
  kind: JobEventKind;
  line: string | null;
  subject: string;
}

/**
 * The status an application's emails make it (decision 55): the latest event that sets one, by its
 * date, with In process's step its line; with none, Applied as of its Applied date. Let emails decide
 * hands a status set by hand back to this, and a merge, a move or Not about this recomputes it unless
 * the user set it (decision 68, D365).
 */
export function statusFromEvents(appliedAt: string, events: StatusEvent[]): {status: JobStatus; statusSetAt: string; step: string | null; stepAt: string | null} {
  const loud = events.filter(event => !isQuietJobEvent(event.kind)).sort((a, b) => a.at.localeCompare(b.at));
  const last = loud.at(-1);
  if (!last) return {status: 'applied', statusSetAt: appliedAt, step: null, stepAt: null};
  const status = STATUS_OF_JOB_EVENT[last.kind as keyof typeof STATUS_OF_JOB_EVENT];
  return {status, statusSetAt: last.at, step: status === 'in_process' ? last.line ?? last.subject : null, stepAt: status === 'in_process' ? last.at : null};
}

/** An email blocked by Not an application (decision 67, D321), as the rules see it. */
export interface BlockedEmail extends Role {
  // Null for a role blocked with no email of its own.
  messageId: number | null;
  company: string | null;
}

/**
 * Whether an email is one of a blocked application's (D321): it's blocked itself, or it names the
 * same company and the same role as a blocked email. One naming no role isn't recognised by role.
 */
export function isBlocked(blocked: BlockedEmail[], messageId: number, company: string, role: Role): boolean {
  return blocked.some(email => email.messageId === messageId
    || (email.company !== null && namesRole(role) && sameCompany(email.company, company) && sameRole(email, role)));
}

/** A job board's match email Jobs has read ("<title> @ <company>"), for Indeed's pairs. */
export interface ReadMatchEmail {
  messageId: number;
  at: string;
  company: string;
  titleKey: string;
  applicationId: number | null;
}

/** An Indeed confirmation and its match email pair within this many days of each other. */
export const PAIR_WITHIN_DAYS = 30;

const withinDays = (a: string, b: string, days: number) => Math.abs(Date.parse(a) - Date.parse(b)) <= days * 86_400_000;
const nearest = (at: string) => <T extends {at: string}>(a: T, b: T) => Math.abs(Date.parse(a.at) - Date.parse(at)) - Math.abs(Date.parse(b.at) - Date.parse(at));

/**
 * Indeed's pairs (decision 51): a confirmation naming no company ("Indeed Application: <title>") takes
 * the company of the unpaired match email with its title nearest it in time, within 30 days.
 */
export function pairForConfirmation(matches: ReadMatchEmail[], titleKey: string | null, at: string): ReadMatchEmail | null {
  if (!titleKey) return null;
  return matches.filter(match => match.applicationId === null && match.titleKey === titleKey && withinDays(match.at, at, PAIR_WITHIN_DAYS))
    .sort(nearest(at))[0] ?? null;
}

/** And the other way: a match email names the company of the company-less application with its title nearest it. */
export function pairForMatch(applications: KnownApplication[], titleKey: string | null, at: string): KnownApplication | null {
  if (!titleKey) return null;
  return applications.filter(application => application.companyUnknown && application.titleKey === titleKey && withinDays(application.appliedAt, at, PAIR_WITHIN_DAYS))
    .map(application => ({...application, at: application.appliedAt})).sort(nearest(at))[0] ?? null;
}

/** An email as the rules take it: what the model read, the company it's about, and when it came. */
export interface IncomingEmail {
  messageId: number;
  at: string;
  event: JobEmailEvent;
  // The company the email names, else triage's organisation (the platform, for Indeed's).
  company: string;
  // Whether the email itself named the company.
  companyNamed: boolean;
  role: Role;
}

/** What one email does (decision 50). */
export type Plan =
  | {do: 'ignore'; why: 'out' | 'blocked' | 'rejection_matches_nothing' | 'quiet_matches_nothing' | 'match_email'}
  | {do: 'create'; company: string; companyUnknown: boolean; reappliedFrom: number | null; pairedWith: ReadMatchEmail | null}
  | {do: 'event'; applicationId: number; kind: JobEventKind; status: JobStatus | null}
  | {do: 'pair'; applicationId: number; company: string}
  | {do: 'needs_you'; kind: 'update_to_assign' | 'email_to_track'; reason: NeedsYouReason};

export const EVENT_OF_EMAIL = {
  confirmation: 'applied', assessment: 'assessment', interview: 'interview', offer: 'offer', rejection: 'rejection',
  account: 'account', verification: 'verification', next_step: 'next_step', form: 'form', match: 'match', other: 'other',
} as const satisfies Record<Exclude<JobEmailEvent, 'recruiter' | 'unrelated'>, JobEventKind>;

/**
 * What an email does, given the applications so far, the blocked emails and the match emails read
 * (decisions 50, 51, 55, 67, 68):
 * - a recruiter's cold email and mail that isn't about an application are out; a blocked one too
 * - a confirmation makes an application, unless it matches an open one (a duplicate, quiet) or only
 *   a closed one (a re-application, linked); naming no company, it takes its Indeed pair's
 * - an assessment, interview, offer or rejection matching one becomes its event, moving the status;
 *   one that might match waits to be assigned; a rejection matching nothing is ignored unless an open
 *   application elsewhere has its role (SV-128), and the rest matching nothing wait as Track this
 * - quiet mail becomes a quiet event when it matches, and is otherwise ignored; a job board's match
 *   email only joins an application as its Indeed pair
 */
export function planEmail(email: IncomingEmail, applications: KnownApplication[], blocked: BlockedEmail[], matches: ReadMatchEmail[]): Plan {
  if (email.event === 'recruiter' || email.event === 'unrelated') return {do: 'ignore', why: 'out'};
  if (isBlocked(blocked, email.messageId, email.company, email.role)) return {do: 'ignore', why: 'blocked'};
  const kind = EVENT_OF_EMAIL[email.event];

  if (email.event === 'match') {
    const waiting = email.companyNamed ? pairForMatch(applications, email.role.titleKey, email.at) : null;
    return waiting ? {do: 'pair', applicationId: waiting.id, company: email.company} : {do: 'ignore', why: 'match_email'};
  }

  if (email.event === 'confirmation') {
    const pair = email.companyNamed ? null : pairForConfirmation(matches, email.role.titleKey, email.at);
    const company = pair?.company ?? email.company;
    const unknown = !email.companyNamed && !pair;
    const found = unknown ? {none: 'no_company'} as const : matchApplication(applications, company, email.role);
    if ('match' in found) {
      if (!isClosed(found.match.status)) return {do: 'event', applicationId: found.match.id, kind: 'duplicate', status: null};
      return {do: 'create', company, companyUnknown: false, reappliedFrom: found.match.id, pairedWith: pair};
    }
    if ('several' in found && namesRole(email.role)) {
      // A role several applications share (none of them told apart by requisition ID): a duplicate on
      // the newest open one, else a re-application of the newest closed one.
      const roles = applications.filter(application => !application.companyUnknown && answersTo(application, company)
        && hasRole(application, company, email.role)).sort(newestFirst);
      const open = roles.find(application => !isClosed(application.status));
      if (open) return {do: 'event', applicationId: open.id, kind: 'duplicate', status: null};
      return {do: 'create', company, companyUnknown: false, reappliedFrom: roles[0]?.id ?? null, pairedWith: pair};
    }
    // Naming no role with two or more open there, or a role it has no application for: a new one.
    return {do: 'create', company, companyUnknown: unknown, reappliedFrom: null, pairedWith: pair};
  }

  const found = matchApplication(applications, email.company, email.role);
  if ('match' in found) return {do: 'event', applicationId: found.match.id, kind, status: statusAfter(found.match, kind, email.at)};
  if (isQuietJobEvent(kind)) return {do: 'ignore', why: 'quiet_matches_nothing'};
  if ('several' in found) return {do: 'needs_you', kind: 'update_to_assign', reason: found.several};
  if (found.none === 'names_other_role') return {do: 'needs_you', kind: 'update_to_assign', reason: 'names_other_role'};
  if (kind === 'rejection') {
    // Another name of the employer, perhaps: a title alone never moves a status, so it's asked.
    const sameRoleOpen = namesRole(email.role) && applications.some(application => !isClosed(application.status) && hasRole(application, email.company, email.role));
    return sameRoleOpen ? {do: 'needs_you', kind: 'update_to_assign', reason: 'same_role_elsewhere'} : {do: 'ignore', why: 'rejection_matches_nothing'};
  }
  return {do: 'needs_you', kind: 'email_to_track', reason: 'no_application'};
}
