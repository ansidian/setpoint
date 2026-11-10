// Jobs's reads (J1): the page (its two numbers, Needs you, From history, the rows, and J4's history
// pass) and an application's detail, shaped as `@setpoint/shared`'s jobs/api.ts; J5's search and
// the shell's item; J7's emails for mail's slots. Ghosted comes from the clock here, never from a stored status (rules.ts).
import type {
  ApplicationLinkOut, ApplicationOut, ApplicationRowOut, JdCandidateOut, JdSummaryOut, JobEventOut, JobsCheckOut, JobsMailApplicationOut, JobMoveOut, JobsMovementOut, JobsMailMessageOut, JobsMailOut, JobsNavOut,
  JobsPageOut, JobsSearchOut, NeedsYouItemOut, PostingOut,
} from '@setpoint/shared';
import {GHOSTED_AFTER_DAYS, isQuietJobEvent, STATUS_OF_JOB_EVENT} from '@setpoint/shared';
import type {JobStatus} from '@setpoint/shared';
import {and, asc, desc, eq, inArray, isNotNull, isNull} from 'drizzle-orm';
import {addDays, localDay, zonedInstant} from '../domain/time.ts';
import {notFound} from '../errors.ts';
import {isoNow} from '../store.ts';
import type {Store} from '../store.ts';
import {jobsDb} from './db.ts';
import {historyStatus} from './historyState.ts';
import {existingMessages} from './mail.ts';
import {readingStatus} from './readerState.ts';
import {appliedBefore, checkPosting, countsByStatus, daysWithoutEmail, isGhosted, relatedApplications, sameCompany, weeklyCounts} from './rules.ts';
import * as j from './schema.ts';
import {searchApplications} from './search.ts';
import {knownApplications} from './stick.ts';

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
    if (posting) {
      return {state: 'found', source: posting.source, platform: posting.platform, found_at: posting.foundAt, candidates: 0, looked_at: application.jdLookupAt, link: posting.link, stopped: false};
    }
    const unread = application.jdLookup === 'not_found' ? candidates.get(application.id)?.find(candidate => candidate.pickedAt) : undefined;
    return {
      state: application.jdLookup, source: null, platform: null, found_at: null,
      candidates: application.jdLookup === 'candidates' ? (candidates.get(application.id)?.length ?? 0) : 0, looked_at: application.jdLookupAt, link: unread?.link ?? null,
      // Stopped by the user (SV-170); any lookup or answer since clears it.
      stopped: application.jdLookup === 'not_found' && application.jdLookupStoppedAt !== null,
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
      pinned_at: application.pinnedAt,
    };
  };
  return {db, now, applications, byId, postings, candidates, link, rowOf};
}

const newestFirst = (a: Application, b: Application) => b.appliedAt.localeCompare(a.appliedAt) || b.id - a.id;

const candidateOut = (candidate: Candidate): JdCandidateOut => ({
  id: candidate.id, title: candidate.title, location: candidate.location, platform: candidate.platform, link: candidate.link, unreadable: candidate.unreadable,
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
    reading: readingStatus(store),
    history: historyStatus(store),
    counts: countsByStatus(rows),
    weeks: weeklyCounts(applications.map(application => application.appliedAt), now, store.timeZone),
    needs_you: today.map(itemOf),
    from_history: history.map(itemOf),
    rows,
  };
}

const postingOut = (posting: typeof j.jobsPostings.$inferSelect): PostingOut => ({
  summary: posting.summary, location: posting.location, location_set_at: posting.locationSetAt, workplace: posting.workplace, workplace_detail: posting.workplaceDetail, salary: posting.salary,
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

/** GET /api/jobs/search?q=…: company or role first, then a match only in a JD's text, with its line (D316). */
export function jobsSearch(store: Store, q: string): JobsSearchOut {
  const {applications, byId, postings, rowOf} = loadRows(store);
  const found = searchApplications(applications.map(application => ({
    id: application.id, company: application.company, title: application.title, appliedAt: application.appliedAt,
    fullText: postings.get(application.id)?.fullText ?? null,
  })), q);
  return {
    query: q,
    company_or_role: found.companyOrRole.map(id => rowOf(byId.get(id)!)),
    in_jd: found.inJd.map(({id, line}) => ({row: rowOf(byId.get(id)!), line})),
  };
}

/** GET /api/jobs/nav: whether Jobs is on, and today's Needs you count, for the shell. */
export function jobsNav(store: Store): JobsNavOut {
  const waiting = jobsDb(store.sqlite).select({id: j.jobsNeedsYou.id}).from(j.jobsNeedsYou)
    .where(and(isNull(j.jobsNeedsYou.resolvedAt), eq(j.jobsNeedsYou.fromHistory, false))).all();
  return {enabled: jobsEnabled(store), needs_you: waiting.length};
}

/**
 * GET /api/jobs/mail?messages=…: what mail's slots draw for these emails, in one request for a page
 * of rows (J7, D306): the application each belongs to, for the reader's JD chip, and Applied before on
 * a job board's match email whose company matches applications, the most recent of them named. Only
 * the emails with something are listed, and none while Jobs is off. Nothing here writes, so mail's
 * counts never change (D313).
 */
export function jobsInMail(store: Store, messageIds: number[]): JobsMailOut {
  if (!messageIds.length || !jobsEnabled(store)) return {messages: []};
  const db = jobsDb(store.sqlite);
  // The application an email belongs to is the one its event is on; the newest, should two be.
  const belongs = new Map<number, number>();
  for (const event of db.select({messageId: j.jobsEvents.messageId, applicationId: j.jobsEvents.applicationId}).from(j.jobsEvents)
    .where(inArray(j.jobsEvents.messageId, messageIds)).orderBy(asc(j.jobsEvents.at), asc(j.jobsEvents.id)).all()) {
    if (event.messageId !== null) belongs.set(event.messageId, event.applicationId);
  }
  const matchEmails = db.select({messageId: j.jobsEmailsRead.messageId, event: j.jobsEmailsRead.event, company: j.jobsEmailsRead.company}).from(j.jobsEmailsRead)
    .where(and(inArray(j.jobsEmailsRead.messageId, messageIds), eq(j.jobsEmailsRead.event, 'match'), isNotNull(j.jobsEmailsRead.company)))
    .orderBy(desc(j.jobsEmailsRead.messageId)).all();
  if (!belongs.size && !matchEmails.length) return {messages: []};

  const {byId, rowOf} = loadRows(store);
  const summary = (id: number): JobsMailApplicationOut | null => {
    const application = byId.get(id);
    if (!application) return null;
    const row = rowOf(application);
    return {id: row.id, company: row.company, title: row.title, applied_on: row.applied_on, status: row.status, status_on: row.status_on, ghosted: row.ghosted};
  };
  const known = matchEmails.length ? knownApplications(store) : [];
  const out = new Map<number, JobsMailMessageOut>();
  const entry = (messageId: number) => out.get(messageId) ?? out.set(messageId, {message_id: messageId, application: null, applied_before: null}).get(messageId)!;
  for (const [messageId, applicationId] of belongs) {
    const application = summary(applicationId);
    if (application) entry(messageId).application = application;
  }
  for (const email of matchEmails) {
    const found = appliedBefore(email, known);
    const latest = found ? summary(found.matches[0]!.id) : null;
    if (found && latest) entry(email.messageId).applied_before = {query: found.query, count: found.matches.length, latest};
  }
  return {messages: messageIds.filter(id => out.has(id)).map(id => out.get(id)!)};
}

/**
 * POST /api/jobs/check (SV-173): postings' applications for the browser extension, each its role's and
 * the company's others (rules.ts `checkPosting`), as mail's badge has an application, in the order
 * asked. Nothing while Jobs is off. Nothing here writes.
 */
export function jobsCheck(store: Store, postings: {company: string; title: string}[]): JobsCheckOut {
  if (!jobsEnabled(store)) return {enabled: false, postings: postings.map(() => ({role: [], others: [], query: null}))};
  const {byId, rowOf} = loadRows(store);
  const summary = (id: number): JobsMailApplicationOut => {
    const row = rowOf(byId.get(id)!);
    return {id: row.id, company: row.company, title: row.title, applied_on: row.applied_on, status: row.status, status_on: row.status_on, ghosted: row.ghosted};
  };
  const known = knownApplications(store).filter(application => byId.has(application.id));
  return {
    enabled: true,
    postings: postings.map(posting => {
      const found = checkPosting(posting, known);
      return {role: found.role.map(application => summary(application.id)), others: found.others.map(application => summary(application.id)), query: found.query};
    }),
  };
}

/** How many applications the pane's recent movement lists (D467). */
export const MOVES_SHOWN = 8;

/**
 * GET /api/jobs/movement (SV-220, D467, D470): each application's latest status change, newest first, the
 * last MOVES_SHOWN. Its emails, oldest first, change it when one sets a status it didn't have (the first
 * from nothing, a new application); a status set by hand changes it from what its emails had set before
 * (it keeps no history, so only the latest hand move shows); and turning Ghosted, at the start of the day
 * 30 days after its last email of any kind, changes it from Applied. Nothing here writes, and there are
 * no counts (D314).
 */
export function jobsMovement(store: Store): JobsMovementOut {
  const db = jobsDb(store.sqlite);
  const now = isoNow(store);
  const settings = db.select({accounts: j.jobsSettings.accounts}).from(j.jobsSettings).get();
  const events = new Map<number, {at: string; kind: typeof j.jobsEvents.$inferSelect.kind}[]>();
  for (const event of db.select({applicationId: j.jobsEvents.applicationId, at: j.jobsEvents.at, kind: j.jobsEvents.kind}).from(j.jobsEvents)
    .orderBy(asc(j.jobsEvents.at), asc(j.jobsEvents.id)).all()) {
    events.set(event.applicationId, [...(events.get(event.applicationId) ?? []), event]);
  }
  let since: string | null = null;
  const moves: JobMoveOut[] = [];
  for (const application of db.select().from(j.jobsApplications).all()) {
    const own = events.get(application.id) ?? [];
    const first = own[0]?.at;
    const earliest = first && first < application.appliedAt ? first : application.appliedAt;
    if (since === null || earliest < since) since = earliest;
    const base = {application_id: application.id, company: application.company, title: application.title};
    const hand = application.statusSetBy === 'user' ? application.statusSetAt : null;
    let status: JobStatus | null = null;
    let latest: JobMoveOut | null = null;
    const change = (to: JobStatus, at: string, byHand: boolean) => {
      // An application exists because it was applied for, so a first email that isn't a confirmation comes from Applied.
      const from = status ?? (to === 'applied' ? null : 'applied');
      if (from !== to) latest = {...base, from, to, by_hand: byHand, at};
      status = to;
    };
    for (const event of own) {
      if (hand !== null && event.at > hand) break;
      if (!isQuietJobEvent(event.kind)) change(STATUS_OF_JOB_EVENT[event.kind], event.at, false);
    }
    if (hand !== null) change(application.status, hand, true);
    const lastEmail = own.at(-1)?.at ?? application.appliedAt;
    if (isGhosted(application.status, lastEmail, now, store.timeZone)) {
      latest = {...base, from: 'applied', to: 'ghosted', by_hand: false, at: zonedInstant(addDays(localDay(lastEmail, store.timeZone), GHOSTED_AFTER_DAYS), '00:00', store.timeZone)};
    }
    // Tracked by hand with no email that set a status: it's new, from when it was applied.
    latest ??= {...base, from: null, to: 'applied', by_hand: false, at: application.appliedAt};
    moves.push(latest);
  }
  return {
    moves: moves.sort((a, b) => b.at.localeCompare(a.at) || b.application_id - a.application_id).slice(0, MOVES_SHOWN),
    accounts: (settings?.accounts ?? []).map(account => account.account_id),
    since,
  };
}
