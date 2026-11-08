// The browser extension's check (SV-173) through its one route, against the seed: each posting's role
// and the company's other applications, in the order asked, a page of cards in one request, nothing
// while Jobs is off, and only the extension's own token reads it, which opens nothing else. The
// matching itself is reading.test.ts's table.
import {jobsCheckSchema} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {signedIn, world} from '../../../tests/helpers.ts';
import {jobsApi, jobsTokenApi} from '../api.ts';
import {issueJobsToken, revokeJobsToken} from '../token.ts';

type Posting = {company: string; title: string};

async function seeded() {
  const w = world({seed: true});
  const c = await signedIn(w, {routes: [jobsApi(w.store)], tokenRoutes: [jobsTokenApi(w.store)]});
  const {token} = issueJobsToken(w.store);
  // The extension's request: its token and no cookie.
  const check = async (postings: Posting[], authorization: string | null = `Bearer ${token}`, method = 'POST') => {
    const response = await c.app.request('/api/jobs/check', {
      method, headers: {'content-type': 'application/json', ...(authorization ? {authorization} : {})}, body: JSON.stringify({postings}),
    });
    return {status: response.status, headers: response.headers, body: await response.json()};
  };
  return {w, c, token, check};
}

const contoso = {company: 'Contoso Pharmaceuticals', title: 'Associate Software Engineer (Hybrid)'};
const nothing = {role: [], others: [], query: null};

describe('POST /api/jobs/check', () => {
  test('a page of cards in one request, in the order asked: the role, another role there, and none', async () => {
    const {check} = await seeded();
    const got = await check([contoso, {company: 'Contoso Pharmaceuticals', title: 'Data Scientist'}, {company: 'Northwind Traders', title: 'Software Engineer I'}]);
    expect(got.status).toBe(200);
    const {enabled, postings: [role, other, none]} = jobsCheckSchema.parse(got.body);
    expect(enabled).toBe(true);
    const applied = expect.objectContaining({company: 'Contoso Pharmaceuticals', title: 'Associate Software Engineer', applied_on: '2026-09-16', status: 'rejected', status_on: '2026-10-05'});
    expect(role).toEqual({role: [applied], others: [], query: 'contoso pharmaceuticals'});
    expect(other).toEqual({role: [], others: [applied], query: 'contoso pharmaceuticals'});
    expect(none).toEqual(nothing);
  });

  test('with Jobs off, nothing, and it says so', async () => {
    const {c, check} = await seeded();
    expect((await c.send('PATCH', '/api/jobs/settings', {body: {enabled: false}})).status).toBe(200);
    expect((await check([contoso])).body).toEqual({enabled: false, postings: [nothing]});
  });

  test('only the current token reads it: not none, another, the session alone, or one revoked', async () => {
    const {w, c, token, check} = await seeded();
    for (const authorization of [null, 'Bearer sp_jobs_not-it', `Basic ${token}`]) {
      const got = await check([contoso], authorization);
      expect(got.status).toBe(401);
      expect(got.headers.get('www-authenticate')).toBe('Bearer realm="setpoint"');
    }
    // The owner's session, with no token, isn't the extension.
    expect((await c.send('POST', '/api/jobs/check', {body: {postings: [contoso]}})).status).toBe(401);
    revokeJobsToken(w.store);
    expect((await check([contoso])).status).toBe(401);
  });

  test('the token opens nothing else: Jobs\'s page, or the check by another method', async () => {
    const {c, token} = await seeded();
    const authorization = `Bearer ${token}`;
    expect((await c.app.request('/api/jobs', {headers: {authorization}})).status).toBe(401);
    expect((await c.app.request('/api/jobs/check', {headers: {authorization}})).status).toBe(401);
  });
});
