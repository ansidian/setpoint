// Jobs's calls to the server (J5; J6 adds Needs you's answers, the corrections and their Undo; J8
// Settings › Jobs and Settings › AI's Jobs group), through web/src/api/client.ts's helpers, never `fetch` itself (the
// lint holds the network to web/src/api/). Every path is under /jobs, so a `jobs` live event refreshes
// whichever are on screen (logic/live.ts).
import type {ApplicationOut, JobsChangeOut, JobsDismissedOut, JobsEdit, JobsNavOut, JobsReadAccount, JobsSettingsOut, JobStatus, JobsUndoneOut} from '@setpoint/shared';
import {getCached, refreshIfShown, sendJson, setCached} from '../../api/client.ts';

/** GET /api/jobs: the two numbers, Needs you, From history and the rows. */
export const JOBS_PATH = '/jobs';
/** GET /api/jobs/nav: whether Jobs is on, and today's Needs you count, for the shell on every page. */
export const NAV_PATH = '/jobs/nav';
/** GET /api/jobs/applications/:id: the detail. */
export const applicationPath = (id: number) => `/jobs/applications/${id}`;
/** GET /api/jobs/search?q=…: company or role first, then JD text (D316). */
export const searchPath = (q: string) => `/jobs/search?q=${encodeURIComponent(q.trim())}`;

/** GET /api/jobs/mail?messages=…: what mail's slots draw for these emails (J7), in one request. */
export const mailPath = (ids: readonly number[]) => `/jobs/mail?messages=${ids.join(',')}`;

/** GET /api/jobs/settings: Settings › Jobs (J8, board 39a). */
export const SETTINGS_PATH = '/jobs/settings';
/** GET /api/jobs/ai: Settings › AI's Jobs group and its row in Usage this month (J8, board 39b). */
export const AI_PATH = '/jobs/ai';

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

/** What answers and corrections change: the page, the shell's count and the application open. */
function refreshJobs(applications: (number | null)[] = []) {
  refreshIfShown(JOBS_PATH);
  refreshIfShown(NAV_PATH);
  for (const id of applications) if (id !== null) refreshIfShown(applicationPath(id));
}

/** Sends an answer or a correction (J6), then refreshes what it changed; the answer carries its Undo. */
async function change(method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown, applications: (number | null)[] = []): Promise<JobsChangeOut> {
  const answer = await sendJson<JobsChangeOut>(method, path, body);
  refreshJobs([...applications, answer.application]);
  return answer;
}

/** The toast's Undo: everything the change touched, exactly as it was. */
export async function undoChange(change: JobsChangeOut): Promise<void> {
  const undone = await sendJson<JobsUndoneOut>('POST', `/jobs/undo/${change.undo}`);
  refreshJobs(undone.applications);
}

export const pickCandidate = (application: number, candidate: number) => change('POST', `${applicationPath(application)}/jd/pick`, {candidate});
export const noneOfThese = (application: number) => change('POST', `${applicationPath(application)}/jd/none`);
export const assignItem = (item: number, application: number) => change('POST', `/jobs/needs-you/${item}/assign`, {application});
export const trackItem = (item: number) => change('POST', `/jobs/needs-you/${item}/track`);
export const notAJob = (item: number) => change('POST', `/jobs/needs-you/${item}/not-a-job`);
export const editApplication = (id: number, edit: JobsEdit) => change('PATCH', applicationPath(id), edit);
export const setStatus = (id: number, status: JobStatus | null) => change('POST', `${applicationPath(id)}/status`, {status});
export const mergeWith = (id: number, other: number) => change('POST', `${applicationPath(id)}/merge`, {other}, [other]);
export const notThisPosting = (id: number) => change('POST', `${applicationPath(id)}/not-this-posting`);
export const notAnApplication = (id: number) => change('POST', `${applicationPath(id)}/not-an-application`, undefined, [id]);
export const deleteApplication = (id: number) => change('DELETE', applicationPath(id), undefined, [id]);
export const moveEvent = (event: number, from: number, application: number) => change('POST', `/jobs/events/${event}/move`, {application}, [from]);
export const notAboutThis = (event: number) => change('POST', `/jobs/events/${event}/not-about-this`);

/** From history's Dismiss all (D324): the items it dismissed, for Undo. */
export async function dismissFromHistory(): Promise<number[]> {
  const {needs_you: ids} = await sendJson<JobsDismissedOut>('POST', '/jobs/from-history/dismiss');
  refreshJobs();
  return ids;
}

/** Dismiss all's Undo: those items back in From history. */
export async function undoDismiss(ids: number[]): Promise<void> {
  await sendJson<JobsDismissedOut>('POST', '/jobs/from-history/undo', {needs_you: ids});
  refreshJobs();
}

/**
 * Settings › Jobs's switch (J8): on starts the history pass and brings Jobs into the sidebar; off stops
 * reading. Settings shows the answer at once; the page and the shell's item ask again.
 */
export async function turnJobs(enabled: boolean): Promise<void> {
  const settings = await sendJson<JobsSettingsOut>('PATCH', SETTINGS_PATH, {enabled});
  setCached(SETTINGS_PATH, settings);
  refreshJobs();
}

/** Reads (#273, D383): the accounts Jobs reads and how; while it's on, a change starts the history pass over what's new to it. */
export async function setReads(accounts: JobsReadAccount[]): Promise<void> {
  const settings = await sendJson<JobsSettingsOut>('PATCH', SETTINGS_PATH, {accounts});
  setCached(SETTINGS_PATH, settings);
  refreshJobs();
}
