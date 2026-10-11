// Connecting Todoist: OAuth with the callback at /api/ea/accounts/todoist/callback (v1's path, so
// the app's registration in Todoist's console still matches). Harvested from v1's `todoist-oauth`
// (see SV-6), keeping its security core:
// - the state is 32 random bytes, stored as a hash, single use (deleted when read, even if refused)
//   and good for ten minutes;
// - the state is bound to the browser that started it by an HttpOnly cookie scoped to the callback
//   path, whose hash is kept with it and compared in constant time before any token exchange (CSRF
//   and login fixation);
// - nothing is stored unless the exchange succeeds, and a failure says nothing more than that.
// v1's staged app credentials and personal tokens aren't ported: the app's id and secret come from
// configuration, and the token is the source's key (Todoist's tokens don't expire).
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {and, eq, isNull, lt} from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import {DEFAULT_SCHEDULES} from '../../domain/sources.ts';
import {writeSourceCredentials} from '../../secrets/store.ts';
import {isoNow, noteLive, transaction} from '../../store.ts';
import type {Store} from '../../store.ts';
import {requestJson} from '../http.ts';
import type {HttpOptions} from '../http.ts';
import {readTodoistRefusal, TODOIST_API} from './api.ts';
import {todoistCalendar} from './sync.ts';

export const TODOIST_CALLBACK_PATH = '/api/ea/accounts/todoist/callback';
export const TODOIST_AUTHORIZE_URL = 'https://app.todoist.com/oauth/authorize';
export const TODOIST_SCOPE = 'data:read_write,data:delete';
export const STATE_TTL_MS = 10 * 60_000;
export const BIND_COOKIE = 'setpoint_todoist_bind';

export interface TodoistClient {
  clientId: string;
  clientSecret: string;
}

export interface TodoistOAuthOptions extends HttpOptions {
  client: TodoistClient | null;
  // Where Todoist's consent page and token exchange live (tests: a fake on 127.0.0.1).
  authorizeUrl?: string;
  apiUrl?: string;
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

export class TodoistOAuthError extends Error {}

/** Starts a connection: the consent page's address, and the browser binding for the cookie. */
export function beginTodoistOAuth(store: Store, options: TodoistOAuthOptions): {url: string; bind: string} {
  if (!options.client) throw new TodoistOAuthError('Setpoint has no Todoist app configured (SETPOINT_TODOIST_CLIENT_ID).');
  const state = randomBytes(32).toString('base64url');
  const bind = randomBytes(32).toString('base64url');
  const now = store.now().getTime();
  transaction(store, () => {
    store.db.delete(t.todoistOauthStates).where(lt(t.todoistOauthStates.expiresAt, new Date(now).toISOString())).run();
    store.db.insert(t.todoistOauthStates).values({hash: hash(state), bindHash: hash(bind), createdAt: new Date(now).toISOString(), expiresAt: new Date(now + STATE_TTL_MS).toISOString()}).run();
  });
  const url = new URL(options.authorizeUrl ?? TODOIST_AUTHORIZE_URL);
  url.search = new URLSearchParams({client_id: options.client.clientId, scope: TODOIST_SCOPE, state, response_type: 'code'}).toString();
  return {url: url.href, bind};
}

/**
 * Todoist's redirect back: checks the state and the browser, exchanges the code, and stores the
 * token on the Todoist source (made if new), which clears needs reconnect. Returns the source's id.
 */
export async function completeTodoistOAuth(store: Store, options: TodoistOAuthOptions, input: {code: string | null; state: string | null; bind: string | null; redirectUri: string}): Promise<number> {
  if (!options.client) throw new TodoistOAuthError('No Todoist app is configured.');
  if (!input.state || !input.code || !input.bind) throw new TodoistOAuthError('The Todoist sign-in was incomplete.');
  // Single use: read and deleted together, whatever happens next.
  const row = transaction(store, () => {
    const found = store.db.select().from(t.todoistOauthStates).where(eq(t.todoistOauthStates.hash, hash(input.state!))).get();
    if (found) store.db.delete(t.todoistOauthStates).where(eq(t.todoistOauthStates.hash, found.hash)).run();
    return found;
  });
  if (!row) throw new TodoistOAuthError('The Todoist sign-in expired or was already used.');
  if (Date.parse(row.expiresAt) <= store.now().getTime()) throw new TodoistOAuthError('The Todoist sign-in expired.');
  const expected = Buffer.from(row.bindHash, 'hex');
  const given = Buffer.from(hash(input.bind), 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new TodoistOAuthError('The Todoist sign-in came back to a different browser.');

  const answer = await requestJson<{access_token?: unknown}>({timeoutMs: 10_000, ...options}, {
    method: 'POST', url: `${(options.apiUrl ?? TODOIST_API).replace(/\/+$/, '')}/oauth/access_token`,
    body: new URLSearchParams({client_id: options.client.clientId, client_secret: options.client.clientSecret, code: input.code, redirect_uri: input.redirectUri, grant_type: 'authorization_code'}),
  }, readTodoistRefusal, 'Todoist').catch(() => {
    throw new TodoistOAuthError('Todoist didn\'t accept the sign-in.');
  });
  if (typeof answer?.access_token !== 'string' || !answer.access_token) throw new TodoistOAuthError('Todoist didn\'t accept the sign-in.');
  return connectTodoist(store, answer.access_token);
}

/** Stores a Todoist token on the Todoist source (made if new) with its calendar: the callback's, and v1's import. */
export function connectTodoist(store: Store, token: string): number {
  const sourceId = transaction(store, () => {
    todoistCalendar(store);
    const found = store.db.select().from(t.sources).where(and(eq(t.sources.provider, 'todoist'), isNull(t.sources.accountId), eq(t.sources.dev, false))).get();
    if (found) return found.id;
    const schedule = DEFAULT_SCHEDULES.todoist;
    return store.db.insert(t.sources).values({provider: 'todoist', syncMode: schedule.mode, intervalSeconds: schedule.intervalSeconds, createdAt: isoNow(store)}).returning().get().id;
  });
  writeSourceCredentials(store, sourceId, {kind: 'api_key', key: token});
  noteLive(store, {type: 'health', sources: [sourceId]});
  return sourceId;
}
