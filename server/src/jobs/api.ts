// Jobs's routes (shapes and the list in `@setpoint/shared` jobs/api.ts): the page and an
// application's detail (J1), and Look it up (J3, D320), which starts a JD lookup on any application. Mounted under /api behind the session by server.ts, a wiring
// point, through createApp's `routes`, so the app itself never names Jobs.
import {Hono} from 'hono';
import {z} from 'zod';
import {conflict, parse} from '../errors.ts';
import type {Store} from '../store.ts';
import {requestLookup} from './lookup.ts';
import {applicationDetail, jobsPage} from './queries.ts';

const id = (value: string) => parse(z.coerce.number().pipe(z.int().positive()), value);

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
  return api;
}
