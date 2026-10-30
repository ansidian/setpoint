// Every correction sticks (decision 58; BRIEF.md › Jobs › Corrections; J6): the one place the reader,
// the rules, the history pass and the lookup ask before they write, so that no new email, re-run or
// lookup undoes what the user set.
//
// - A field the user set (company, title, status) is theirs: nothing automatic writes it again. The
//   one exception is D322's: an email that sets a status (an assessment, interview, offer or
//   rejection), no older than the status it replaces, takes over from one set by hand; a quiet email
//   never does (decision 68). `emailSetsStatus` is that exception, and the only place it's made.
// - A merge, a move, an assignment and an edited title or company leave the application answering to
//   the company and role they brought (`knownApplications`' aliases), so a later email naming them
//   comes to it rather than making another application or waiting in Needs you.
// - Not an application blocks its emails and, by its company and role, the ones after them
//   (`blockedEmails`, decision 67). Delete blocks nothing, so a later email can make it again.
// - A posting the user turned down (None of these, Not this posting) is never saved or offered again
//   (`rejectedLinks`), and a lookup writes only while its application is still `looking` for one
//   (`stillLooking`): Undo, None of these or Not this posting since it began win over what it found.
// - Emails already read are never read again (jobs_emails_read), so a history re-run never replays
//   an email the user moved, assigned or took off.
import type {JobHandField} from '@setpoint/shared';
import {and, eq, inArray} from 'drizzle-orm';
import type {Store} from '../store.ts';
import {jobsDb} from './db.ts';
import {titleKey} from './rules.ts';
import type {Alias, BlockedEmail, KnownApplication} from './rules.ts';
import * as j from './schema.ts';

/** Whether the user set this field by hand: nothing automatic writes it again. */
export function setByHand(store: Store, applicationId: number, field: JobHandField): boolean {
  return jobsDb(store.sqlite).select({id: j.jobsHandSet.applicationId}).from(j.jobsHandSet)
    .where(and(eq(j.jobsHandSet.applicationId, applicationId), eq(j.jobsHandSet.field, field))).get() !== undefined;
}

/**
 * D322's exception, the only one: an email that sets a status has just moved this application
 * (rules.ts `statusAfter` said so), so a status the user set by hand gives way to it.
 */
export function emailSetsStatus(store: Store, applicationId: number) {
  jobsDb(store.sqlite).delete(j.jobsHandSet).where(and(eq(j.jobsHandSet.applicationId, applicationId), eq(j.jobsHandSet.field, 'status'))).run();
}

/**
 * Every application as the rules match on it, with the companies and roles corrections gave it: its
 * aliases, and the title it was given by hand (the emails still name the old one, which is its key).
 */
export function knownApplications(store: Store): KnownApplication[] {
  const db = jobsDb(store.sqlite);
  const aliases = new Map<number, Alias[]>();
  const add = (applicationId: number, alias: Alias) => aliases.set(applicationId, [...aliases.get(applicationId) ?? [], alias]);
  for (const alias of db.select().from(j.jobsAliases).all()) {
    add(alias.applicationId, {company: alias.company, titleKey: alias.titleKey || null, requisitionId: alias.requisitionId});
  }
  const titled = new Set(db.select({id: j.jobsHandSet.applicationId}).from(j.jobsHandSet).where(eq(j.jobsHandSet.field, 'title')).all().map(row => row.id));
  return db.select({
    id: j.jobsApplications.id, company: j.jobsApplications.company, title: j.jobsApplications.title, titleKey: j.jobsApplications.titleKey,
    requisitionId: j.jobsApplications.requisitionId, status: j.jobsApplications.status, statusSetAt: j.jobsApplications.statusSetAt,
    appliedAt: j.jobsApplications.appliedAt, companyUnknown: j.jobsApplications.companyUnknown,
  }).from(j.jobsApplications).all().map(({title, ...row}) => {
    const own = aliases.get(row.id) ?? [];
    const handTitle = titled.has(row.id) && titleKey(title) ? [{company: null, titleKey: titleKey(title), requisitionId: null}] : [];
    return {...row, titleKey: row.titleKey || null, aliases: [...own, ...handTitle]};
  });
}

/** Gives an application another company and role to answer to (a merge, a move, an assignment, an edit). One naming no role adds nothing. */
export function addAlias(store: Store, applicationId: number, alias: Alias, now: string) {
  if (!alias.titleKey && !alias.requisitionId && alias.company === null) return;
  jobsDb(store.sqlite).insert(j.jobsAliases).values({applicationId, company: alias.company, titleKey: alias.titleKey, requisitionId: alias.requisitionId, createdAt: now}).run();
}

/** The emails Not an application blocked, by their own company and role, else as they were read (decision 67). */
export function blockedEmails(store: Store): BlockedEmail[] {
  return jobsDb(store.sqlite).select({
    messageId: j.jobsBlockedEmails.messageId, blockedCompany: j.jobsBlockedEmails.company, blockedKey: j.jobsBlockedEmails.titleKey,
    blockedRequisition: j.jobsBlockedEmails.requisitionId, company: j.jobsEmailsRead.company, titleKey: j.jobsEmailsRead.titleKey,
    requisitionId: j.jobsEmailsRead.requisitionId,
  }).from(j.jobsBlockedEmails).leftJoin(j.jobsEmailsRead, eq(j.jobsEmailsRead.messageId, j.jobsBlockedEmails.messageId)).all()
    .map(row => row.blockedCompany !== null
      ? {messageId: row.messageId, company: row.blockedCompany, titleKey: row.blockedKey || null, requisitionId: row.blockedRequisition}
      : {messageId: row.messageId, company: row.company, titleKey: row.titleKey, requisitionId: row.requisitionId});
}

/** The postings the user turned down for this application: no lookup saves or offers them again. */
export function rejectedLinks(store: Store, applicationId: number): Set<string> {
  return new Set(jobsDb(store.sqlite).select({link: j.jobsRejectedPostings.link}).from(j.jobsRejectedPostings)
    .where(eq(j.jobsRejectedPostings.applicationId, applicationId)).all().map(row => row.link));
}

/** Turns these postings down for the application (None of these, Not this posting). */
export function rejectLinks(store: Store, applicationId: number, links: string[], now: string) {
  for (const link of new Set(links)) jobsDb(store.sqlite).insert(j.jobsRejectedPostings).values({applicationId, link, rejectedAt: now}).onConflictDoNothing().run();
}

/** A lookup writes what it found only while its application still waits for one (`looking`). */
export function stillLooking(store: Store, applicationId: number): boolean {
  return jobsDb(store.sqlite).select({id: j.jobsApplications.id}).from(j.jobsApplications)
    .where(and(eq(j.jobsApplications.id, applicationId), inArray(j.jobsApplications.jdLookup, ['looking']))).get() !== undefined;
}
