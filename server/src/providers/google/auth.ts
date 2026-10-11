// Google over plain HTTPS, shared by Gmail and Google Calendar: the one OAuth client and its
// consent (Gmail and Calendar on one sign-in; Connect Gmail writes it to both sources), access
// tokens refreshed per source, and requests that turn Google's errors into ProviderErrors with
// Google's own words. Every base URL is configurable so tests point them at a fake on 127.0.0.1.
//
// Harvested for Calendar from v1's `calendar-google-client` (getAuthorizedAccount) as for Gmail:
// refresh five minutes before expiry, a missing expires_in counts as an hour, a new refresh token
// or scope in the answer is kept, and `invalid_grant` means the consent was revoked: needs reconnect.
import {writeSourceCredentials} from '../../secrets/store.ts';
import type {Store} from '../../store.ts';
import type {AdapterContext} from '../../sync/adapter.ts';
import {kindOfStatus, ProviderError} from '../../sync/errors.ts';

export interface GoogleEndpoints {
  consent: string;
  token: string;
  gmail: string;
  pubsub: string;
}

export const GOOGLE_ENDPOINTS: GoogleEndpoints = {
  consent: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
  gmail: 'https://gmail.googleapis.com',
  pubsub: 'https://pubsub.googleapis.com',
};

/**
 * v1's combined consent: Gmail (read, labels, trash) and Calendar on one sign-in. The calendar list
 * is read and written: SV-20 writes each calendar's colour to it (D33).
 */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist',
];

/** The OAuth client registered in Google Cloud (v2's callback is a second redirect URI on it). */
export interface GoogleClient {
  clientId: string;
  clientSecret: string;
  endpoints: GoogleEndpoints;
  // Each request gives up after this long (a transient failure).
  requestTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
// A token this close to its expiry is refreshed first (v1).
const REFRESH_LEAD_MS = 5 * 60_000;
const DEFAULT_TOKEN_TTL_S = 3600;

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 429: 'Too Many Requests',
  500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout',
};

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

/**
 * A refused request as a ProviderError, in Google's words: "Requested entity was not found. (404
 * Not Found)". A refused refresh token (`invalid_grant`) means the access was revoked or expired:
 * needs reconnect. Gmail answers some rate limits with 403 rateLimitExceeded, retried like 429.
 */
export async function googleError(response: Response, what: string): Promise<ProviderError> {
  let message = '';
  let reason = '';
  try {
    const body = await response.json() as {error?: string | {message?: string; errors?: {reason?: string}[]}; error_description?: string};
    if (typeof body.error === 'string') {
      reason = body.error;
      message = body.error_description ? `${body.error_description} (${body.error})` : body.error;
    } else if (body.error) {
      message = body.error.message ?? '';
      reason = body.error.errors?.[0]?.reason ?? '';
    }
  } catch {
    // Not JSON: the status says it.
  }
  const status = response.status;
  const statusLine = `${status} ${STATUS_TEXT[status] ?? response.statusText}`.trim();
  const text = message ? `${message} (${statusLine})` : `${what} failed (${statusLine})`;
  if (reason === 'invalid_grant') return new ProviderError('auth', `Google refused Setpoint's access: ${text}`, {status});
  if (status === 403 && /rateLimitExceeded/i.test(reason)) return new ProviderError('rate_limited', text, {status, retryAfterMs: retryAfterMs(response)});
  return new ProviderError(kindOfStatus(status), text, {status, retryAfterMs: retryAfterMs(response)});
}

export interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/** A form POST to Google's token endpoint (code exchange, refresh, service-account grant). */
export async function tokenRequest(client: Pick<GoogleClient, 'endpoints' | 'requestTimeoutMs'>, form: Record<string, string>, signal?: AbortSignal): Promise<TokenResponse> {
  const timeout = AbortSignal.timeout(client.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS);
  const response = await fetch(client.endpoints.token, {
    method: 'POST', headers: {'content-type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams(form),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
  if (!response.ok) throw await googleError(response, 'Google sign-in');
  return await response.json() as TokenResponse;
}

const expiresAt = (store: Store, expiresIn: unknown) =>
  new Date(store.now().getTime() + (typeof expiresIn === 'number' && Number.isFinite(expiresIn) ? expiresIn : DEFAULT_TOKEN_TTL_S) * 1000).toISOString();

/**
 * A source's access token: the stored one while it has five minutes left, otherwise refreshed
 * with the refresh token and stored again (encrypted). Concurrent callers share one refresh.
 */
export class GoogleTokens {
  private readonly client: GoogleClient;
  private readonly refreshing = new Map<number, Promise<string>>();

  constructor(client: GoogleClient) {
    this.client = client;
  }

  async accessToken(context: AdapterContext, force = false): Promise<string> {
    const credentials = context.credentials();
    if (!credentials || credentials.kind !== 'oauth') throw new ProviderError('auth', 'This account has no Google sign-in; reconnect it in Settings › Accounts.');
    const fresh = credentials.access_token && credentials.expires_at && Date.parse(credentials.expires_at) - REFRESH_LEAD_MS > context.store.now().getTime();
    if (fresh && !force) return credentials.access_token!;
    const running = this.refreshing.get(context.source.id);
    if (running) return running;
    const refresh = (async () => {
      const tokens = await tokenRequest(this.client, {
        client_id: this.client.clientId, client_secret: this.client.clientSecret, refresh_token: credentials.refresh_token, grant_type: 'refresh_token',
      }, context.signal);
      if (!tokens.access_token) throw new ProviderError('transient', 'Google answered the refresh without an access token.');
      // Only if the source still holds the credentials this refresh started from (a reconnect may have replaced them).
      const current = context.credentials();
      if (current?.kind === 'oauth' && current.refresh_token === credentials.refresh_token) {
        writeSourceCredentials(context.store, context.source.id, {
          kind: 'oauth', refresh_token: tokens.refresh_token ?? credentials.refresh_token, access_token: tokens.access_token,
          expires_at: expiresAt(context.store, tokens.expires_in), scope: tokens.scope ?? credentials.scope,
        });
      }
      return tokens.access_token;
    })().finally(() => this.refreshing.delete(context.source.id));
    this.refreshing.set(context.source.id, refresh);
    return refresh;
  }
}

export interface RequestOptions {
  method?: string;
  query?: Record<string, string | string[] | number | undefined>;
  body?: unknown;
  // What a refusal says it was ("Gmail history").
  what: string;
  // Statuses the caller handles itself (Gmail's 404 for a deleted message).
  accept?: number[];
}

/**
 * An authorised request for a source. A 401 refreshes the token once and tries again (the token
 * may have been revoked early); a second 401 is a refused sign-in.
 */
export async function googleRequest(client: GoogleClient, tokens: GoogleTokens, context: AdapterContext, url: string, options: RequestOptions): Promise<Response> {
  const target = new URL(url);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) target.searchParams.append(name, String(item));
  }
  for (let attempt = 0; ; attempt += 1) {
    const token = await tokens.accessToken(context, attempt > 0);
    const response = await fetch(target, {
      method: options.method ?? 'GET',
      headers: {authorization: `Bearer ${token}`, ...(options.body === undefined ? {} : {'content-type': 'application/json'})},
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(client.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS)]),
    });
    if (response.ok || options.accept?.includes(response.status)) return response;
    if (response.status === 401 && attempt === 0) continue;
    throw await googleError(response, options.what);
  }
}
