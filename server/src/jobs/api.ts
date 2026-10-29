// Jobs's routes (J1, read-only for now; shapes and the list in `@setpoint/shared` jobs/api.ts): the
// page and an application's detail. Mounted under /api behind the session by server.ts, a wiring
// point, through createApp's `routes`, so the app itself never names Jobs.
import {Hono} from 'hono';
import {z} from 'zod';
import {parse} from '../errors.ts';
import type {Store} from '../store.ts';
import {applicationDetail, jobsPage} from './queries.ts';

const id = (value: string) => parse(z.coerce.number().pipe(z.int().positive()), value);

export function jobsApi(store: Store) {
  const api = new Hono();
  api.get('/jobs', c => c.json(jobsPage(store)));
  api.get('/jobs/applications/:id', c => c.json(applicationDetail(store, id(c.req.param('id')))));
  return api;
}
