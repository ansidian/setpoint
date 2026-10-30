// Jobs's routes (shapes and the list in `@setpoint/shared` jobs/api.ts): the page and an
// application's detail (J1); Look it up (J3, D320), which starts a JD lookup on any application;
// Settings › Jobs, where turning Jobs on starts the history pass, and From history's Dismiss all and
// its Undo (J4); search and the shell's item (J5); Needs you's answers, the corrections and their
// Undo (J6); what mail's slots draw (J7). Mounted under /api behind the session by server.ts, a
// wiring point, through createApp's `routes`, so the app itself never names Jobs.
import type {Context} from 'hono';
import {Hono} from 'hono';
import {z} from 'zod';
import {
  jobsAssignInput, jobsEditInput, jobsMailInput, jobsMergeInput, jobsMoveInput, jobsPickInput, jobsSearchInput, jobsSettingsPatchInput, jobsStatusInput, jobsUndoDismissInput,
} from '@setpoint/shared';
import type {JobsChangeOut, JobsDismissedOut, JobsUndoneOut} from '@setpoint/shared';
import {conflict, invalid, notFound, parse} from '../errors.ts';
import type {Store} from '../store.ts';
import {requestLookup} from './lookup.ts';
import {
  deleteApplication, editApplication, mergeApplications, moveEvent, notAboutThis, notAnApplication, notThisPosting, setStatus,
} from './corrections.ts';
import {assignItem, dismissFromHistory, noneOfThese, notAJob, pickCandidate, trackItem, undoDismissFromHistory} from './needsYou.ts';
import {applicationDetail, jobsInMail, jobsNav, jobsPage, jobsSearch} from './queries.ts';
import {jobsSettings, updateJobsSettings} from './settings.ts';
import {undoCorrection} from './undo.ts';

const id = (value: string) => parse(z.coerce.number().pipe(z.int().positive()), value);

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw invalid('The body must be JSON.');
  }
}

export function jobsApi(store: Store) {
  const api = new Hono();
  api.get('/jobs', c => c.json(jobsPage(store)));
  api.get('/jobs/nav', c => c.json(jobsNav(store)));
  // Jobs's own search, never mail's or ⌘K's (D316).
  api.get('/jobs/search', c => c.json(jobsSearch(store, parse(jobsSearchInput, {q: c.req.query('q') ?? ''}).q)));
  // Mail's slots (J7): a page of rows, or the email open, in one request (D306).
  api.get('/jobs/mail', c => c.json(jobsInMail(store, parse(jobsMailInput, {messages: c.req.query('messages') ?? ''}).messages)));
  api.get('/jobs/applications/:id', c => c.json(applicationDetail(store, id(c.req.param('id')))));
  // Look it up: the application's JD looked up again, open or closed. It answers at once with the
  // detail, its JD `looking`; the lookup runs on Jobs's worker and its end comes as a `jobs` event.
  api.post('/jobs/applications/:id/lookup', c => {
    const applicationId = id(c.req.param('id'));
    if (requestLookup(store, applicationId) === 'saved') throw conflict('jd_saved', 'This application has its JD already, Not this posting takes it away first.');
    return c.json(applicationDetail(store, applicationId), 202);
  });
  api.get('/jobs/settings', c => c.json(jobsSettings(store)));
  // On starts the history pass (once: it never reads an email twice); off stops reading.
  api.patch('/jobs/settings', async c => c.json(updateJobsSettings(store, parse(jobsSettingsPatchInput, await body(c)))));
  // Dismiss all: the same as ignoring each From history item (D324). Its answer names them for Undo.
  api.post('/jobs/from-history/dismiss', c => c.json({needs_you: dismissFromHistory(store)} satisfies JobsDismissedOut));
  api.post('/jobs/from-history/undo', async c => {
    const {needs_you: ids} = parse(jobsUndoDismissInput, await body(c));
    return c.json({needs_you: undoDismissFromHistory(store, ids)} satisfies JobsDismissedOut);
  });

  // Needs you's answers (J6), each with its toast's Undo.
  const change = (answer: JobsChangeOut) => answer;
  api.post('/jobs/applications/:id/jd/pick', async c => c.json(change(pickCandidate(store, id(c.req.param('id')), parse(jobsPickInput, await body(c)).candidate))));
  api.post('/jobs/applications/:id/jd/none', c => c.json(change(noneOfThese(store, id(c.req.param('id'))))));
  api.post('/jobs/needs-you/:id/assign', async c => c.json(change(assignItem(store, id(c.req.param('id')), parse(jobsAssignInput, await body(c)).application))));
  api.post('/jobs/needs-you/:id/track', c => c.json(change(trackItem(store, id(c.req.param('id'))))));
  api.post('/jobs/needs-you/:id/not-a-job', c => c.json(change(notAJob(store, id(c.req.param('id'))))));

  // The corrections (J6, decision 58): each sticks (stick.ts), and each has Undo.
  api.patch('/jobs/applications/:id', async c => c.json(change(editApplication(store, id(c.req.param('id')), parse(jobsEditInput, await body(c))))));
  api.post('/jobs/applications/:id/status', async c => c.json(change(setStatus(store, id(c.req.param('id')), parse(jobsStatusInput, await body(c)).status))));
  api.post('/jobs/applications/:id/merge', async c => c.json(change(mergeApplications(store, id(c.req.param('id')), parse(jobsMergeInput, await body(c)).other))));
  api.post('/jobs/applications/:id/not-this-posting', c => c.json(change(notThisPosting(store, id(c.req.param('id'))))));
  api.post('/jobs/applications/:id/not-an-application', c => c.json(change(notAnApplication(store, id(c.req.param('id'))))));
  api.delete('/jobs/applications/:id', c => c.json(change(deleteApplication(store, id(c.req.param('id'))))));
  api.post('/jobs/events/:id/move', async c => c.json(change(moveEvent(store, id(c.req.param('id')), parse(jobsMoveInput, await body(c)).application))));
  api.post('/jobs/events/:id/not-about-this', c => c.json(change(notAboutThis(store, id(c.req.param('id'))))));
  // The toast's Undo: exactly what was there before.
  api.post('/jobs/undo/:token', c => {
    const undone = undoCorrection(store, id(c.req.param('token')));
    if (!undone) throw notFound('That can no longer be undone.');
    return c.json(undone satisfies JobsUndoneOut);
  });
  return api;
}
