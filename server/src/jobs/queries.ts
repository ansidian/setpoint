// Jobs's reads (J1): the page (its two numbers, Needs you, From history and the rows) and an
// application's detail, shaped as `@setpoint/shared`'s jobs/api.ts. Ghosted comes from the clock
// here, never from a stored status (rules.ts).
import type {
  ApplicationLinkOut, ApplicationOut, ApplicationRowOut, JdCandidateOut, JdSummaryOut, JobEventOut, JobsPageOut, NeedsYouItemOut, PostingOut,
} from '@setpoint/shared';
import {isQuietJobEvent} from '@setpoint/shared';
import {asc, eq, isNull} from 'drizzle-orm';
import {localDay} from '../domain/time.ts';
import {notFound} from '../errors.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {jobsDb} from './db.ts';
import {existingMessages} from './mail.ts';
import {countsByStatus, daysWithoutEmail, isGhosted, relatedApplications, sameCompany, weeklyCounts} from './rules.ts';
import * as j from './schema.ts';

type Application = typeof j.jobsApplications.$inferSelect;
type Candidate = typeof j.jobsJdCandidates.$inferSelect;

/** Jobs is on (off until the user turns it on, D310). */
export function jobsEnabled(store: Store): boolean {
  return jobsDb(store.sqlite).select({enabled: j.jobsSettings.enabled}).from(j.jobsSettings).get()?.enabled ?? false;
}

/** Everything a row needs, read once for the page or a detail. */
function loadRows(store: Store) {
  const db = jobsDb(store.sqlite);
  const now = isoNow(store);
  const applications = db.select().from(j.jobsApplications).all();
  const lastEmail = new Map<number, string>();
  for (const event of db.select({applicationId: j.jobsEvents.applicationId, at: j.jobsEvents.at}).from(j.jobsEvents).all()) {
    if ((lastEmail.get(event.applicationId) ?? '') < event.at) lastEmail.set(event.applicationId, event.at);
  }
  const postings = new Map(db.select().from(j.jobsPostings).all().map(posting => [posting.applicationId, posting]));
  const candidates = new Map<number, Candidate[]>();
  for (const candidate of db.select().from(j.jobsJdCandidates).orderBy(asc(j.jobsJdCandidates.position), asc(j.jobsJdCandidates.id)).all()) {
    candidates.set(candidate.applicationId, [...(candidates.get(candidate.applicationId) ?? []), candidate]);
  }
  const byId = new Map(applications.map(application => [application.id, application]));

  const link = (application: Application): ApplicationLinkOut => ({
    id: application.id, company: application.company, title: application.title, applied_on: localDay(application.appliedAt, store.timeZone),
    status: application.status, status_on: localDay(application.statusSetAt, store.timeZone),
  });
  const jdOf = (application: Application): JdSummaryOut => {
    const posting = postings.get(application.id);
    if (posting) return {state: 'found', source: posting.source, platform: posting.platform, found_at: posting.foundAt, candidates: 0, looked_at: application.jdLookupAt};
    return {
      state: application.jdLookup, source: null, platform: null, found_at: null,
      candidates: application.jdLookup === 'candidates' ? (candidates.get(application.id)?.length ?? 0) : 0, looked_at: application.jdLookupAt,
    };
  };
  const rowOf = (application: Application): ApplicationRowOut => {
    const last = lastEmail.get(application.id) ?? application.appliedAt;
    const from = application.reappliedFromId ? byId.get(application.reappliedFromId) : undefined;
    return {
      id: application.id, company: application.company, title: application.title, platform: application.platform, account_id: application.accountId,
      applied_at: application.appliedAt, applied_on: localDay(application.appliedAt, store.timeZone),
      status: application.status, status_set_by: application.statusSetBy, status_set_at: application.statusSetAt,
      status_on: localDay(application.statusSetAt, store.timeZone),
      step: application.status === 'in_process' ? application.step : null, step_at: application.status === 'in_process' ? application.stepAt : null,
      ghosted: isGhosted(application.status, last, now, store.timeZone), days_without_email: daysWithoutEmail(last, now, store.timeZone),
      reapplied_from: from ? link(from) : null, first_seen_in_email: application.firstSeenInEmail, jd: jdOf(application),
    };
  };
  return {db, now, applications, byId, postings, candidates, link, rowOf};
}

const newestFirst = (a: Application, b: Application) => b.appliedAt.localeCompare(a.appliedAt) || b.id - a.id;

const candidateOut = (candidate: Candidate): JdCandidateOut => ({
  id: candidate.id, title: candidate.title, location: candidate.location, platform: candidate.platform, link: candidate.link,
});

/** GET /api/jobs. */
export function jobsPage(store: Store): JobsPageOut {
  const {db, now, applications, candidates, rowOf} = loadRows(store);
  const rows = [...applications].sort(newestFirst).map(rowOf);
  const open = db.select().from(j.jobsNeedsYou).where(isNull(j.jobsNeedsYou.resolvedAt)).all();
  const present = existingMessages(store, open.map(item => item.messageId));
  const itemOf = (item: typeof j.jobsNeedsYou.$inferSelect): NeedsYouItemOut => ({
    id: item.id, kind: item.kind, reason: item.reason, from_history: item.fromHistory, company: item.company, title: item.title, platform: item.platform,
    subject: item.subject, sender: item.sender, event_kind: item.eventKind, line: item.line, account_id: item.accountId, at: item.at,
    message_id: item.messageId !== null && present.has(item.messageId) ? item.messageId : null,
    application_id: item.applicationId,
    candidates: item.kind === 'jd_to_confirm' && item.applicationId ? (candidates.get(item.applicationId) ?? []).slice(0, 3).map(candidateOut) : [],
  });
  // Today's as they came, oldest first; From history newest first by its email's date.
  const today = open.filter(item => !item.fromHistory).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id);
  const history = open.filter(item => item.fromHistory).sort((a, b) => b.at.localeCompare(a.at) || b.id - a.id);
  return {
    enabled: jobsEnabled(store),
    counts: countsByStatus(rows),
    weeks: weeklyCounts(applications.map(application => application.appliedAt), now, store.timeZone),
    needs_you: today.map(itemOf),
    from_history: history.map(itemOf),
    rows,
  };
}

const postingOut = (posting: typeof j.jobsPostings.$inferSelect): PostingOut => ({
  summary: posting.summary, location: posting.location, workplace: posting.workplace, workplace_detail: posting.workplaceDetail, salary: posting.salary,
  must_haves: posting.mustHaves, nice_to_haves: posting.niceToHaves, full_text: posting.fullText, link: posting.link, source: posting.source,
  platform: posting.platform, found_at: posting.foundAt,
});

/** GET /api/jobs/applications/:id. */
export function applicationDetail(store: Store, id: number): ApplicationOut {
  const {db, applications, byId, postings, candidates, link, rowOf} = loadRows(store);
  const application = byId.get(id);
  if (!application) throw notFound('No such application.');
  const events = db.select().from(j.jobsEvents).where(eq(j.jobsEvents.applicationId, id)).orderBy(asc(j.jobsEvents.at), asc(j.jobsEvents.id)).all();
  const present = existingMessages(store, events.map(event => event.messageId));
  const timeline = events.map((event): JobEventOut => ({
    id: event.id, at: event.at, kind: event.kind, quiet: isQuietJobEvent(event.kind), sender: event.sender, subject: event.subject, line: event.line,
    message_id: event.messageId !== null && present.has(event.messageId) ? event.messageId : null, first_seen: event.firstSeen,
  }));
  const {appliedBefore, alsoAt} = relatedApplications(application, applications.filter(other => sameCompany(other.company, application.company)));
  const posting = postings.get(id);
  return {
    ...rowOf(application),
    posting: posting ? postingOut(posting) : null,
    candidates: (candidates.get(id) ?? []).map(candidateOut),
    timeline,
    applied_before: appliedBefore.map(link),
    also_at: alsoAt.map(link),
    hand_set: db.select().from(j.jobsHandSet).where(eq(j.jobsHandSet.applicationId, id)).all().map(row => ({field: row.field, set_at: row.setAt})),
  };
}
