// Google Calendar push: a watch channel per calendar, renewed a day before it runs out, and the
// notifications Google sends to POST /api/calendar/push. Harvested from v1's `calendar-push-channels`
// (see SV-6), keeping its protocol rules:
// - a channel's token is 32 random bytes, kept only as a SHA-256 hash, checked in constant time;
// - each header must come once, printable and short; the state is sync, exists or not_exists, and a
//   `sync` is always message 1;
// - the channel must be live, the resource id must match the one Google gave (a pending channel
//   takes Google's first `sync`, which can arrive before the watch call returns), and the resource
//   URI must be the calendar's events;
// - a replacement is made before the old channel is retired and stopped (make before break), and
//   a callback address that changed re-registers;
// - a calendar Google can't watch (400 pushNotSupportedForRequestedResource: holidays) is
//   remembered for the channel's lifetime and synced by the sweep instead.
// v1 gated all this on production; v2 watches whenever Setpoint has a public https address.
import {createHash, randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {and, eq, inArray, lt, ne} from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import {isoNow, transaction} from '../../store.ts';
import type {Store} from '../../store.ts';
import type {SourceRow} from '../../sync/adapter.ts';
import {ProviderError} from '../../sync/errors.ts';
import type {GoogleCalendarApi} from './api.ts';
import {accountCalendars} from './sync.ts';

const DAY = 86_400_000;
export const WATCH_TTL_MS = 7 * DAY;
// Renewed when less than this is left (v1's one day).
export const RENEW_LEAD_MS = DAY;
// A registration that never finished is abandoned after this.
export const REGISTRATION_TIMEOUT_MS = 10 * 60_000;
export const PUSH_PATH = '/api/calendar/push';

type Channel = typeof t.calendarChannels.$inferSelect;

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Makes sure each calendar of the account has a live channel to `address`, renewing those close to
 * running out. Returns when the next renewal is due.
 */
export async function reconcileWatches(store: Store, api: GoogleCalendarApi, source: SourceRow, address: string): Promise<{renewBy: string | null}> {
  const now = store.now().getTime();
  const calendars = accountCalendars(store, source);
  // The first sync hasn't listed the calendars yet: look again shortly.
  // (The engine renews a source's interval before `renewBy`.)
  const later = (ms: number) => ({renewBy: new Date(now + source.intervalSeconds * 1000 + ms).toISOString()});
  if (!calendars.length) return later(5 * 60_000);
  const channels = store.db.select().from(t.calendarChannels).where(eq(t.calendarChannels.sourceId, source.id)).all();
  // Channels of calendars that went (the cascade drops them with the calendar), and old ones.
  store.db.delete(t.calendarChannels).where(and(eq(t.calendarChannels.sourceId, source.id), lt(t.calendarChannels.expiresAt, new Date(now - 30 * DAY).toISOString()))).run();
  const failures: string[] = [];
  for (const calendar of calendars) {
    const mine = channels.filter(channel => channel.calendarId === calendar.id);
    if (mine.some(channel => channel.state === 'unsupported' && Date.parse(channel.expiresAt) > now)) continue;
    if (mine.some(channel => channel.state === 'active' && channel.address === address && Date.parse(channel.expiresAt) > now + RENEW_LEAD_MS)) continue;
    if (mine.some(channel => channel.state === 'pending' && Date.parse(channel.createdAt) > now - REGISTRATION_TIMEOUT_MS)) continue;
    try {
      await register(store, api, source, calendar, address);
    } catch (error) {
      if (error instanceof ProviderError && error.status === 400 && /pushNotSupportedForRequestedResource|push notifications are not supported/i.test(error.message)) continue;
      failures.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    // Make before break: only now are the old ones retired and stopped at Google.
    for (const old of mine.filter(channel => channel.state === 'active' || channel.state === 'pending')) await retire(store, api, old);
  }
  if (failures.length) throw new ProviderError('transient', `Calendar push couldn't be renewed: ${failures[0]}`);
  const live = store.db.select().from(t.calendarChannels).where(and(eq(t.calendarChannels.sourceId, source.id), eq(t.calendarChannels.state, 'active'))).all();
  if (!live.length) return later(DAY);
  const soonest = Math.min(...live.map(channel => Date.parse(channel.expiresAt)));
  return {renewBy: new Date(soonest - RENEW_LEAD_MS).toISOString()};
}

/**
 * A live channel told at another address (the webhook origin or public URL changed since) is
 * renewed at the next tick, not at its renewal a week on; `reconcileWatches` then makes the new one
 * before it retires the old.
 */
export function renewIfMoved(store: Store, source: SourceRow, address: string) {
  const moved = store.db.select({id: t.calendarChannels.id}).from(t.calendarChannels)
    .where(and(eq(t.calendarChannels.sourceId, source.id), inArray(t.calendarChannels.state, ['active', 'pending']), ne(t.calendarChannels.address, address))).get();
  if (moved) store.db.update(t.sources).set({pushRenewsAt: null}).where(eq(t.sources.id, source.id)).run();
}

async function register(store: Store, api: GoogleCalendarApi, source: SourceRow, calendar: typeof t.calendars.$inferSelect, address: string) {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const now = store.now().getTime();
  const expiresAt = now + WATCH_TTL_MS;
  store.db.insert(t.calendarChannels).values({
    id, sourceId: source.id, calendarId: calendar.id, address, tokenHash: tokenHash(token), state: 'pending',
    expiresAt: new Date(expiresAt).toISOString(), createdAt: new Date(now).toISOString(),
  }).run();
  try {
    const answer = await api.watch(calendar.providerId, {id, type: 'web_hook', address, token, expiration: String(expiresAt), params: {ttl: String(WATCH_TTL_MS / 1000)}});
    const googleExpiry = Number(answer.expiration);
    if (answer.id !== id || !answer.resourceId || answer.resourceId.length > 1024 || !Number.isSafeInteger(googleExpiry) || googleExpiry <= now) {
      throw new ProviderError('transient', 'Google Calendar answered the watch request with something unexpected.');
    }
    const activated = transaction(store, () => {
      const row = store.db.select().from(t.calendarChannels).where(eq(t.calendarChannels.id, id)).get();
      // An early `sync` may have pinned a different resource: refuse rather than guess.
      if (!row || row.state !== 'pending' || (row.resourceId && row.resourceId !== answer.resourceId)) return false;
      store.db.update(t.calendarChannels).set({state: 'active', resourceId: answer.resourceId, expiresAt: new Date(Math.min(googleExpiry, expiresAt)).toISOString()})
        .where(eq(t.calendarChannels.id, id)).run();
      return true;
    });
    if (!activated) throw new ProviderError('transient', 'The watch resource changed during registration.');
  } catch (error) {
    const unsupported = error instanceof ProviderError && error.status === 400 && /pushNotSupportedForRequestedResource|not supported/i.test(error.message);
    store.db.update(t.calendarChannels).set({state: unsupported ? 'unsupported' : 'retired'}).where(eq(t.calendarChannels.id, id)).run();
    throw error;
  }
}

/** Retires a channel here first (its notifications are refused at once), then stops it at Google, best effort. */
async function retire(store: Store, api: GoogleCalendarApi, channel: Channel) {
  store.db.update(t.calendarChannels).set({state: 'retired'}).where(eq(t.calendarChannels.id, channel.id)).run();
  if (!channel.resourceId || Date.parse(channel.expiresAt) <= store.now().getTime()) return;
  try {
    await api.stopChannel(channel.id, channel.resourceId);
  } catch {
    // It runs out on its own within a week.
  }
}

/** Stops every channel of a source (disconnecting, or push turned off). */
export async function stopWatches(store: Store, api: GoogleCalendarApi, source: SourceRow) {
  const live = store.db.select().from(t.calendarChannels).where(and(eq(t.calendarChannels.sourceId, source.id), inArray(t.calendarChannels.state, ['active', 'pending']))).all();
  for (const channel of live) await retire(store, api, channel);
}

// ---- Notifications ----

const HEADER_LIMITS = {
  'x-goog-channel-id': 64, 'x-goog-channel-token': 256, 'x-goog-resource-id': 1024, 'x-goog-resource-uri': 2048,
  'x-goog-resource-state': 16, 'x-goog-message-number': 20,
} as const;
type HeaderName = keyof typeof HEADER_LIMITS;

/** One header, given exactly once, printable ASCII and within its limit; otherwise null. */
function header(headers: Headers | Record<string, string | string[] | undefined>, name: HeaderName): string | null {
  let value: string | null;
  if (headers instanceof Headers) {
    value = headers.get(name);
    // Headers joins repeats with ", ": a repeat has a comma no single value has.
    if (value?.includes(', ')) return null;
  } else {
    const matches = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
    if (matches.length !== 1 || typeof matches[0]![1] !== 'string') return null;
    value = matches[0]![1];
  }
  if (!value || value.length > HEADER_LIMITS[name] || !/^[\x21-\x7e]+$/.test(value)) return null;
  return value;
}

/** Whether a resource URI is the calendar's events, at the API Setpoint called (query ignored: Google adds ?alt=json). */
export function resourceUriMatches(uri: string, apiBase: string, calendarId: string): boolean {
  try {
    const url = new URL(uri);
    const base = new URL(apiBase.replace(/\/*$/, '/'));
    if (url.origin !== base.origin || url.username || url.password || url.hash) return false;
    return decodeURIComponent(url.pathname) === `${decodeURIComponent(base.pathname)}calendars/${calendarId}/events`;
  } catch {
    return false;
  }
}

export type PushAdmission = {accepted: true; sourceId: number} | {accepted: false};

/**
 * Admits one notification from Google: the channel, its token and its resource checked, and the
 * channel's first `sync` pinning the resource id. The caller queues the sync durably before it
 * answers 2xx (Google sends again after an error).
 */
export function admitPush(store: Store, headers: Headers | Record<string, string | string[] | undefined>, apiBase: string): PushAdmission {
  const id = header(headers, 'x-goog-channel-id');
  const token = header(headers, 'x-goog-channel-token');
  const resourceId = header(headers, 'x-goog-resource-id');
  const resourceUri = header(headers, 'x-goog-resource-uri');
  const state = header(headers, 'x-goog-resource-state');
  const message = header(headers, 'x-goog-message-number');
  if (!id || !token || !resourceId || !resourceUri || !state || !message) return {accepted: false};
  if (!/^[1-9][0-9]{0,19}$/.test(message)) return {accepted: false};
  if (state !== 'sync' && state !== 'exists' && state !== 'not_exists') return {accepted: false};
  if (state === 'sync' && message !== '1') return {accepted: false};
  return transaction(store, () => {
    const channel = store.db.select().from(t.calendarChannels).where(eq(t.calendarChannels.id, id)).get();
    const now = store.now().getTime();
    if (!channel || (channel.state !== 'active' && channel.state !== 'pending')) return {accepted: false} as const;
    if (Date.parse(channel.expiresAt) <= now) return {accepted: false} as const;
    const pending = channel.state === 'pending';
    if (pending && Date.parse(channel.createdAt) + REGISTRATION_TIMEOUT_MS <= now) return {accepted: false} as const;
    if (!/^[0-9a-f]{64}$/.test(channel.tokenHash)) return {accepted: false} as const;
    if (!timingSafeEqual(Buffer.from(channel.tokenHash, 'hex'), Buffer.from(tokenHash(token), 'hex'))) return {accepted: false} as const;
    const calendar = store.db.select().from(t.calendars).where(eq(t.calendars.id, channel.calendarId)).get();
    if (!calendar || !resourceUriMatches(resourceUri, apiBase, calendar.providerId)) return {accepted: false} as const;
    if (channel.resourceId ? channel.resourceId !== resourceId : !pending || state !== 'sync') return {accepted: false} as const;
    const source = store.db.select().from(t.sources).where(eq(t.sources.id, channel.sourceId)).get();
    if (!source || source.needsReconnectAt) return {accepted: false} as const;
    store.db.update(t.calendarChannels).set({resourceId: channel.resourceId ?? resourceId, lastNotificationAt: isoNow(store)}).where(eq(t.calendarChannels.id, id)).run();
    return {accepted: true, sourceId: channel.sourceId} as const;
  });
}
