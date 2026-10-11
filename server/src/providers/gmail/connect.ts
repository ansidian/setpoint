// Connect Gmail and Reconnect: one Google consent for Gmail and Calendar (v1's combined scopes),
// returning to /api/ea/accounts/gmail/callback, the path v1 registered, so the same Google client
// takes v2's callback as a second redirect URI.
//
// Google's redirect back is a cross-site navigation, so the SameSite=Strict session cookie isn't
// sent with it. The `state` is the proof instead: Setpoint seals it with its own key (AES-GCM,
// bound to its purpose) when the signed-in user starts, and it lasts ten minutes. Only Setpoint can
// mint one, so nobody can make it connect their account.
import {randomBytes} from 'node:crypto';
import {DEFAULT_SCHEDULES} from '../../domain/sources.ts';
import {SetpointError} from '../../errors.ts';
import {decryptSecret, encryptSecret} from '../../secrets/crypto.ts';
import type {Store} from '../../store.ts';
import {connectMailAccount} from '../../sync/connect.ts';
import type {Connected, ConnectInput} from '../../sync/connect.ts';
import {ProviderError} from '../../sync/errors.ts';
import {GOOGLE_SCOPES, googleError, tokenRequest} from '../google/auth.ts';
import type {GoogleClient} from '../google/auth.ts';

export const GMAIL_CALLBACK_PATH = '/api/ea/accounts/gmail/callback';
const STATE_TTL_MS = 10 * 60_000;
const STATE_CONTEXT = {table: 'oauth', field: 'state', recordId: 'gmail'};
// Without Pub/Sub, Gmail is polled this often instead of pushed.
export const GMAIL_POLL_SECONDS = 2 * 60;

interface State {
  account_id: number | null;
  expires_at: number;
  nonce: string;
}

function keyring(store: Store) {
  if (!store.keyring) throw new SetpointError('no_key', 'Setpoint has no encryption key; set SETPOINT_KEY_FILE.', 503);
  return store.keyring;
}

/** Google's consent page for Connect Gmail, or for reconnecting `accountId` (with its address as the hint). */
export function authorizeUrl(store: Store, client: GoogleClient, redirectUri: string, account: {id: number; address: string} | null): string {
  const state: State = {account_id: account?.id ?? null, expires_at: store.now().getTime() + STATE_TTL_MS, nonce: randomBytes(12).toString('base64url')};
  const params = new URLSearchParams({
    client_id: client.clientId, redirect_uri: redirectUri, response_type: 'code', scope: GOOGLE_SCOPES.join(' '),
    // A refresh token every time, so a reconnect always replaces a revoked one (v1).
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true',
    state: encryptSecret(keyring(store), JSON.stringify(state), STATE_CONTEXT),
    ...(account ? {login_hint: account.address} : {}),
  });
  return `${client.endpoints.consent}?${params}`;
}

function openState(store: Store, sealed: string): State {
  let state: State;
  try {
    state = JSON.parse(decryptSecret(keyring(store), sealed, STATE_CONTEXT)) as State;
  } catch {
    throw new SetpointError('bad_state', 'That Google sign-in didn\'t start in this Setpoint. Start again from Settings › Accounts.', 400);
  }
  if (state.expires_at < store.now().getTime()) throw new SetpointError('expired_state', 'That Google sign-in took too long. Start again from Settings › Accounts.', 400);
  return state;
}

export interface GmailConnectOptions {
  client: GoogleClient;
  redirectUri: string;
  // Push when Pub/Sub is set up; otherwise Gmail is polled.
  push: boolean;
}

/** Connect Gmail as the API uses it: the consent URL, then Google's callback. */
export interface GmailConnector {
  authorizeUrl(redirectUri: string, account: {id: number; address: string} | null): string;
  complete(redirectUri: string, query: {code?: string; state?: string; error?: string}): Promise<Connected>;
}

export function gmailConnector(store: Store, client: GoogleClient, push: boolean): GmailConnector {
  return {
    authorizeUrl: (redirectUri, account) => authorizeUrl(store, client, redirectUri, account),
    complete: (redirectUri, query) => completeAuthorization(store, {client, redirectUri, push}, query),
  };
}

/**
 * Google's callback: checks the state, exchanges the code, asks Gmail whose mailbox it is, and
 * connects (or reconnects) that account with its Gmail and Calendar sources.
 */
export async function completeAuthorization(store: Store, options: GmailConnectOptions, query: {code?: string; state?: string; error?: string}): Promise<Connected> {
  if (!query.state) throw new SetpointError('bad_state', 'Google\'s answer had no state. Start again from Settings › Accounts.', 400);
  const state = openState(store, query.state);
  if (query.error) throw new SetpointError('consent_refused', query.error === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${query.error}).`, 400);
  if (!query.code) throw new SetpointError('bad_state', 'Google\'s answer had no code. Start again from Settings › Accounts.', 400);
  const tokens = await tokenRequest(options.client, {
    code: query.code, client_id: options.client.clientId, client_secret: options.client.clientSecret, redirect_uri: options.redirectUri, grant_type: 'authorization_code',
  });
  if (!tokens.access_token) throw new ProviderError('transient', 'Google answered the sign-in without an access token.');
  if (!tokens.refresh_token) throw new ProviderError('permanent', 'Google didn\'t grant offline access. Remove Setpoint at myaccount.google.com › Security › Third-party access, then connect again.');
  const profile = await fetch(`${options.client.endpoints.gmail}/gmail/v1/users/me/profile`, {
    headers: {authorization: `Bearer ${tokens.access_token}`}, signal: AbortSignal.timeout(options.client.requestTimeoutMs ?? 30_000),
  });
  if (!profile.ok) throw await googleError(profile, 'Gmail profile');
  const {emailAddress} = await profile.json() as {emailAddress?: string};
  if (!emailAddress) throw new ProviderError('permanent', 'Gmail didn\'t say whose mailbox this is.');
  return connectGmail(store, options.push, {
    address: emailAddress, accountId: state.account_id ?? undefined,
    credentials: {
      kind: 'oauth', refresh_token: tokens.refresh_token, access_token: tokens.access_token,
      expires_at: new Date(store.now().getTime() + (tokens.expires_in ?? 3600) * 1000).toISOString(), scope: tokens.scope ?? GOOGLE_SCOPES.join(' '),
    },
  });
}

/**
 * A Google account's Gmail source and, on the same sign-in, its Calendar source: Connect Gmail's
 * callback, and v1's import (src/importV1.ts) with v1's refresh token, label, colour and icon.
 */
export function connectGmail(store: Store, push: boolean, input: Pick<ConnectInput, 'address' | 'credentials' | 'accountId' | 'label' | 'colour' | 'icon'>): Connected {
  const schedule = push ? DEFAULT_SCHEDULES.gmail : {mode: 'poll' as const, intervalSeconds: GMAIL_POLL_SECONDS};
  const calendar = DEFAULT_SCHEDULES.google_calendar;
  return connectMailAccount(store, {
    ...input, provider: 'gmail', syncMode: schedule.mode, intervalSeconds: schedule.intervalSeconds,
    alsoSources: [{provider: 'google_calendar', syncMode: calendar.mode, intervalSeconds: calendar.intervalSeconds}],
  });
}
