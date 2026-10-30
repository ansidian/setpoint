// Reading again the salaries and locations Jobs cut (SV-129). A reading kept 80 characters of a
// salary and 120 of a location, and the rest is only in the saved posting. It's for the postings
// saved before that changed, run once with `jobs-repair-facts`, and safe to run again:
//
// - A posting with a value cut at those limits is read again by Haiku from its saved text, with no
//   web lookup, on the ledger as `jobs_reading_jds`.
// - Only the field that was cut changes, and only to a value the reading found, so a bad answer
//   leaves the row as it was and a later run tries it again. The saved JD's text is never touched
//   (decision 53), and neither is the application, so what the user set stays theirs (./stick.ts).
//
// It's apart from `jobs-reread` (./reread.ts): that one's --apply always starts a history pass and
// forgets the ignored rejections again, which repairing a posting has no need of.
import {asc, eq, like, or} from 'drizzle-orm';
import type {AiEndpoints, ModelClient} from '../providers/ai/index.ts';
import type {Store} from '../store.ts';
import {ProviderError} from '../sync/errors.ts';
import {jobsDb} from './db.ts';
import {readPosting} from './lookup.ts';
import {jobsModelClient, NO_JOBS_KEY} from './models.ts';
import * as j from './schema.ts';

const OLD_LIMITS = {salary: 80, location: 120} as const;
type Fact = keyof typeof OLD_LIMITS;
const FACTS = Object.keys(OLD_LIMITS) as Fact[];

/** Whether a value was cut at this limit. Cutting drops a space left before the …, so it can be one shorter. */
export const wasCut = (value: string | null, limit: number) => value !== null && value.endsWith('…') && (value.length === limit || value.length === limit - 1);

export interface CutPosting {
  applicationId: number;
  company: string;
  title: string;
  cut: Fact[];
}

const cutPostings = (store: Store) => jobsDb(store.sqlite).select({
  id: j.jobsPostings.id, applicationId: j.jobsPostings.applicationId, text: j.jobsPostings.fullText, salary: j.jobsPostings.salary, location: j.jobsPostings.location,
  company: j.jobsApplications.company, title: j.jobsApplications.title,
}).from(j.jobsPostings).innerJoin(j.jobsApplications, eq(j.jobsApplications.id, j.jobsPostings.applicationId))
  .where(or(like(j.jobsPostings.salary, '%…'), like(j.jobsPostings.location, '%…')))
  .orderBy(asc(j.jobsPostings.applicationId)).all()
  .map(posting => ({...posting, cut: FACTS.filter(fact => wasCut(posting[fact], OLD_LIMITS[fact]))}))
  .filter(posting => posting.cut.length);

const planned = ({applicationId, company, title, cut}: CutPosting): CutPosting => ({applicationId, company, title, cut});

/** What `jobs-repair-facts` would read again. It writes nothing. */
export const repairFactsPlan = (store: Store): CutPosting[] => cutPostings(store).map(planned);

/** Reads each cut posting again, each kept as it's done, so a provider's refusal stops it with those saved. */
async function repairFacts(store: Store, haiku: {client: ModelClient; model: string}): Promise<{cut: CutPosting[]; repaired: number}> {
  const db = jobsDb(store.sqlite);
  const postings = cutPostings(store);
  let repaired = 0;
  for (const posting of postings) {
    // No location given, so the reading finds it in the text rather than repeating the cut one.
    const reading = await readPosting(store, haiku, posting, {title: posting.title, location: null, facts: [], text: posting.text});
    const found = Object.fromEntries(posting.cut.flatMap(fact => (reading[fact] ? [[fact, reading[fact]]] : [])));
    if (!Object.keys(found).length) continue;
    db.update(j.jobsPostings).set(found).where(eq(j.jobsPostings.id, posting.id)).run();
    repaired += 1;
  }
  return {cut: postings.map(planned), repaired};
}

/** `jobs-repair-facts --apply`: repairs with Jobs's reading model, charged to its ledger. */
export async function repairFactsWithHaiku(store: Store, endpoints: AiEndpoints) {
  const haiku = jobsModelClient(store, endpoints, 'reading');
  if (!haiku) throw new ProviderError('auth', NO_JOBS_KEY);
  return repairFacts(store, haiku);
}
