// Jobs's routes (shapes and the list in `@setpoint/shared` jobs/api.ts): the page and an
// application's detail (J1); Look it up (J3, D320), which starts a JD lookup on any application;
// Settings › Jobs, where turning Jobs on starts the history pass, and From history's Dismiss all and
// its Undo (J4). Mounted under /api behind the session by server.ts, a wiring point, through
// createApp's `routes`, so the app itself never names Jobs.
import type {Context} from 'hono';
import {Hono} from 'hono';
import {z} from 'zod';
import {jobsSettingsPatchInput, jobsUndoDismissInput} from '@setpoint/shared';
import type {JobsDismissedOut} from '@setpoint/shared';
import {conflict, invalid, parse} from '../errors.ts';
import type {Store} from '../store.ts';
import {requestLookup} from './lookup.ts';
import {dismissFromHistory, undoDismissFromHistory} from './needsYou.ts';
import {applicationDetail, jobsPage} from './queries.ts';
import {jobsSettings, updateJobsSettings} from './settings.ts';

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
  return api;
}
