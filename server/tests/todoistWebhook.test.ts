// Todoist's webhook at POST /api/todoist/webhook (v1's route test, ported): signed deliveries wake
// one sync of the Todoist source and nothing else, without a session or Setpoint's own page;
// redeliveries are taken once, for 30 days.
import {createHmac} from 'node:crypto';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {connectTodoist} from '../src/providers/todoist/oauth.ts';
import {finishJob} from '../src/sync/jobs.ts';
import {client, world} from './helpers.ts';

const SECRET = 'todoist-secret';
const DAY = 86_400_000;
const BODY = JSON.stringify({event_name: 'item:updated', event_data: {content: 'Café planning'}});
const sign = (body: string, secret = SECRET) => createHmac('sha256', secret).update(body).digest('base64');

function setup({connected = true, secret = SECRET as string | null} = {}) {
  const w = world();
  const sourceId = connected ? connectTodoist(w.store, 'todoist-token') : null;
  const {app} = client(w, {providers: {todoistOAuth: {client: secret ? {clientId: 'todoist-client', clientSecret: secret} : null}}});
  // From Todoist: another origin, no cookie.
  const deliver = async (headers: Record<string, string>, body = BODY) =>
    (await app.request('/api/todoist/webhook', {method: 'POST', headers: {origin: 'https://todoist.com', 'content-type': 'application/json', ...headers}, body})).status;
  const signed = (id: string, body = BODY) => deliver({'x-todoist-hmac-sha256': sign(body), 'x-todoist-delivery-id': id}, body);
  const jobs = () => w.store.db.select().from(t.jobs).all();
  const deliveries = () => w.store.db.select().from(t.todoistWebhookDeliveries).all().map(row => row.deliveryId).sort();
  return {w, sourceId, deliver, signed, jobs, deliveries};
}

describe('Todoist webhook', () => {
  test('a signed delivery queues one sync of the Todoist source, from another origin and without a session', async () => {
    const {sourceId, signed, jobs} = setup();
    expect(await signed('delivery-1')).toBe(200);
    expect(jobs().map(job => [job.kind, job.key, job.state])).toEqual([['sync', `sync:${sourceId}`, 'queued']]);
    // Many deliveries while it's queued, still one sync.
    expect(await signed('delivery-2')).toBe(200);
    expect(jobs()).toHaveLength(1);
  });

  test('a redelivery queues nothing new', async () => {
    const {w, signed, jobs} = setup();
    expect(await signed('delivery-1')).toBe(200);
    finishJob(w.store, jobs()[0]!.id);
    expect(await signed('delivery-1')).toBe(200);
    expect(jobs().map(job => job.state)).toEqual(['done']);
  });

  test.each([
    ['no signature', {'x-todoist-delivery-id': 'd'}],
    ['an empty signature', {'x-todoist-hmac-sha256': '', 'x-todoist-delivery-id': 'd'}],
    ['another secret\'s signature', {'x-todoist-hmac-sha256': sign(BODY, 'guess'), 'x-todoist-delivery-id': 'd'}],
    ['another body\'s signature', {'x-todoist-hmac-sha256': sign('{}'), 'x-todoist-delivery-id': 'd'}],
    ['a signature of the wrong length', {'x-todoist-hmac-sha256': sign(BODY).slice(0, 20), 'x-todoist-delivery-id': 'd'}],
    ['a hex signature', {'x-todoist-hmac-sha256': createHmac('sha256', SECRET).update(BODY).digest('hex'), 'x-todoist-delivery-id': 'd'}],
  ])('%s is 401 and queues nothing', async (_, headers) => {
    const {deliver, jobs, deliveries} = setup();
    expect(await deliver(headers)).toBe(401);
    expect(jobs()).toEqual([]);
    expect(deliveries()).toEqual([]);
  });

  test.each([
    ['no delivery id', {}],
    ['an empty delivery id', {'x-todoist-delivery-id': ''}],
    ['a delivery id with spaces', {'x-todoist-delivery-id': 'a b'}],
    ['an overlong delivery id', {'x-todoist-delivery-id': 'x'.repeat(201)}],
  ])('%s is 400', async (_, headers) => {
    const {deliver, jobs} = setup();
    expect(await deliver({'x-todoist-hmac-sha256': sign(BODY), ...headers})).toBe(400);
    expect(jobs()).toEqual([]);
  });

  test('without the client secret configured, every delivery is refused', async () => {
    const {signed, jobs} = setup({secret: null});
    expect(await signed('delivery-1')).toBe(503);
    expect(jobs()).toEqual([]);
  });

  test('with no Todoist source, or one that needs signing in again, it\'s still 200 and nothing runs', async () => {
    const none = setup({connected: false});
    expect(await none.signed('delivery-1')).toBe(200);
    expect(none.jobs()).toEqual([]);
    const stale = setup();
    stale.w.store.db.update(t.sources).set({needsReconnectAt: stale.w.store.now().toISOString()}).where(eq(t.sources.id, stale.sourceId!)).run();
    expect(await stale.signed('delivery-1')).toBe(200);
    expect(stale.jobs()).toEqual([]);
  });

  test('when the sync can\'t be queued it\'s 503, and Todoist\'s retry is taken', async () => {
    const {w, signed, jobs, deliveries} = setup();
    w.store.sqlite.exec('CREATE TEMP TRIGGER refuse BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT, \'disk full\'); END');
    expect(await signed('delivery-1')).toBe(503);
    expect(deliveries()).toEqual([]);
    w.store.sqlite.exec('DROP TRIGGER refuse');
    expect(await signed('delivery-1')).toBe(200);
    expect(jobs()).toHaveLength(1);
  });

  test('deliveries are remembered for 30 days', async () => {
    const {w, signed, deliveries} = setup();
    await signed('delivery-1');
    w.advance(29 * DAY);
    await signed('delivery-2');
    expect(deliveries()).toEqual(['delivery-1', 'delivery-2']);
    w.advance(2 * DAY);
    await signed('delivery-3');
    expect(deliveries()).toEqual(['delivery-2', 'delivery-3']);
  });
});
