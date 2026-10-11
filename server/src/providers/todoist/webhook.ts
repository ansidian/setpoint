// Todoist's webhook at POST /api/todoist/webhook (v1's path, so the app's registration in Todoist's
// console still matches). Harvested from v1's `todoist-webhook` (see SV-8), keeping its rules:
// - the signature is HMAC-SHA256 of the raw body with the app's client secret, base64, compared in
//   constant time after a length check; no secret or no signature is refused;
// - X-Todoist-Delivery-Id is required and taken once (a redelivery queues nothing), kept 30 days;
// - the payload is never applied: a delivery only wakes the Todoist source's sync.
// v1's debounce, coalescing and backstop are the engine's job key and 5-minute poll.
import {createHmac, timingSafeEqual} from 'node:crypto';
import {and, eq, isNull, lt} from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import {enqueueJob} from '../../sync/jobs.ts';
import {isoNow, transaction} from '../../store.ts';
import type {Store} from '../../store.ts';

export const WEBHOOK_PATH = '/api/todoist/webhook';
export const DELIVERY_TTL_MS = 30 * 86_400_000;

/** Whether `signature` is the body's HMAC-SHA256 under `secret` (base64). */
export function signatureMatches(body: Buffer, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(body).digest();
  const given = Buffer.from(signature.trim(), 'base64');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export type WebhookOutcome = 'unauthorized' | 'bad_request' | 'duplicate' | 'queued' | 'no_source';

/**
 * Admits one delivery and, if it's new, queues `sync:<todoist source>` in the same transaction, so
 * a delivery that couldn't be queued isn't remembered either (Todoist's retry is taken). Throws
 * only when the database does.
 */
export function admitTodoistWebhook(store: Store, body: Buffer, headers: Headers, secret: string): WebhookOutcome {
  if (!signatureMatches(body, headers.get('x-todoist-hmac-sha256'), secret)) return 'unauthorized';
  const deliveryId = headers.get('x-todoist-delivery-id');
  if (!deliveryId || deliveryId.length > 200 || !/^[\x21-\x7e]+$/.test(deliveryId)) return 'bad_request';
  return transaction(store, () => {
    const now = store.now().getTime();
    store.db.delete(t.todoistWebhookDeliveries).where(lt(t.todoistWebhookDeliveries.receivedAt, new Date(now - DELIVERY_TTL_MS).toISOString())).run();
    const fresh = store.db.insert(t.todoistWebhookDeliveries).values({deliveryId, receivedAt: isoNow(store)}).onConflictDoNothing().run().changes === 1;
    if (!fresh) return 'duplicate';
    const source = store.db.select().from(t.sources).where(and(eq(t.sources.provider, 'todoist'), isNull(t.sources.accountId), eq(t.sources.dev, false))).get();
    // Nothing to sync (not connected, or needs signing in again): still a 200, so Todoist keeps the webhook on.
    if (!source || source.needsReconnectAt) return 'no_source';
    enqueueJob(store, {kind: 'sync', key: `sync:${source.id}`, sourceId: source.id});
    return 'queued';
  });
}
