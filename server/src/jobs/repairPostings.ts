// Taking away the application pages Jobs saved as JDs (SV-130). A link to an applicant's own page read
// like a posting, and the check let it through, so a saved JD can hold the applicant's name, contact
// details and answers. Links like it are no longer read (./lookupRules.ts). This is for the JDs saved
// before that, run once with `jobs-repair-postings`, and safe to run again:
//
// - It finds the JDs the email's link gave whose link is an application's own page, by the rule the
//   lookup uses. A JD found any other way is left alone, and so is one the user picked, whatever its
//   link: a lookup's own save takes its candidates with it, so a saved JD with candidates is a pick.
// - Each is taken away as Not this posting takes one (./corrections.ts), the only way a saved JD goes
//   (decision 53), so its link is turned down for good (./stick.ts). A new lookup then starts, which
//   the server runs: it's no longer offered that link, and carries on to the platforms and search.
// - It says only which applications, never the saved text, since that's what holds the details.
import {and, asc, eq, isNotNull} from 'drizzle-orm';
import {transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {notThisPosting} from './corrections.ts';
import {jobsDb} from './db.ts';
import {requestLookup} from './lookup.ts';
import {isApplicationPage} from './lookupRules.ts';
import type {PostingHosts} from './lookupRules.ts';
import * as j from './schema.ts';

export interface SavedApplicationPage {
  applicationId: number;
  company: string;
  title: string;
}

/** What `jobs-repair-postings` would take away. It writes nothing. */
export function repairPostingsPlan(store: Store, hosts: PostingHosts): SavedApplicationPage[] {
  const db = jobsDb(store.sqlite);
  const picked = new Set(db.select({id: j.jobsJdCandidates.applicationId}).from(j.jobsJdCandidates).all().map(row => row.id));
  return db.select({applicationId: j.jobsPostings.applicationId, link: j.jobsPostings.link, company: j.jobsApplications.company, title: j.jobsApplications.title})
    .from(j.jobsPostings).innerJoin(j.jobsApplications, eq(j.jobsApplications.id, j.jobsPostings.applicationId))
    .where(and(eq(j.jobsPostings.source, 'email_link'), isNotNull(j.jobsPostings.link))).orderBy(asc(j.jobsPostings.applicationId)).all()
    .filter(posting => !picked.has(posting.applicationId) && isApplicationPage(posting.link!, hosts))
    .map(({applicationId, company, title}) => ({applicationId, company, title}));
}

/** `jobs-repair-postings --apply`: each taken away and looked up again together, so a stop partway leaves none half done. */
export function repairPostings(store: Store, hosts: PostingHosts): SavedApplicationPage[] {
  const pages = repairPostingsPlan(store, hosts);
  for (const page of pages) {
    transaction(store, () => {
      notThisPosting(store, page.applicationId);
      requestLookup(store, page.applicationId);
    });
  }
  return pages;
}
