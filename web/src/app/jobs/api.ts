// Jobs's calls to the server (J5), through web/src/api/client.ts's helpers, never `fetch` itself (the
// lint holds the network to web/src/api/). Every path is under /jobs, so a `jobs` live event refreshes
// whichever are on screen (logic/live.ts).
import type {ApplicationOut, JobsNavOut} from '@setpoint/shared';
import {getCached, refreshIfShown, sendJson, setCached} from '../../api/client.ts';

/** GET /api/jobs: the two numbers, Needs you, From history and the rows. */
export const JOBS_PATH = '/jobs';
/** GET /api/jobs/nav: whether Jobs is on, and today's Needs you count, for the shell on every page. */
export const NAV_PATH = '/jobs/nav';
/** GET /api/jobs/applications/:id: the detail. */
export const applicationPath = (id: number) => `/jobs/applications/${id}`;
/** GET /api/jobs/search?q=…: company or role first, then JD text (D316). */
export const searchPath = (q: string) => `/jobs/search?q=${encodeURIComponent(q.trim())}`;

/** The shell's item as last answered, if it has been. */
export const cachedNav = () => getCached<JobsNavOut>(NAV_PATH);

/**
 * Look it up (D320): the JD looked up again, on any application. The answer is the detail with its JD
 * `looking`, shown at once; the lookup's end comes as a `jobs` event.
 */
export async function lookUp(id: number): Promise<void> {
  const detail = await sendJson<ApplicationOut>('POST', `${applicationPath(id)}/lookup`);
  setCached(applicationPath(id), detail);
  refreshIfShown(JOBS_PATH);
}
