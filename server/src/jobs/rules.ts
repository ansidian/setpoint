// Jobs's pure rules (J1), tested as tables (tests/rules.test.ts): Ghosted, the per-week buckets, the
// counts by status, which of a company's other applications are Applied before, and the keys
// applications match on. No database, no clock: the caller passes now and the zone.
import {GHOSTED_AFTER_DAYS, JOB_STATUSES, JOB_WEEKS} from '@setpoint/shared';
import type {JobCountsOut, JobStatus, JobWeekOut} from '@setpoint/shared';
import {addDays, daysBetween, localDay, weekday} from '../domain/time.ts';

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

/** A company as Jobs groups applications by: case and punctuation ignored. J2 loosens it ("Fabrikam Labs"). */
export function companyKey(company: string): string {
  return company.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
