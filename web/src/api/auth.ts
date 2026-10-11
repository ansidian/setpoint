// Signing in (darma's pattern; DESIGN.md › Not designed yet: sign-in follows darma's card). Setpoint
// asks GET /api/me once at start: with a session it shows the app, else the sign-in card, which
// claims Setpoint with the CLI's setup token the first time and signs in with the password or a
// passkey after. When Setpoint can't be reached at all (a deploy, a restart: no connection, or the
// proxy's 5xx), it says so and asks again until it answers (Root; DESIGN.md › Health and states).
// Any 401 later swaps the app for the card and keeps the address. /api/me also gives the owner's
// time zone and the server's clock, which the dev server runs from the seed's moment, so the app's
// "now" is the server's.
import type {AuthStatusOut, MeOut, RecoveryCodesOut, SignInOut} from '@setpoint/shared';
import {useSyncExternalStore} from 'react';
import {ApiFailure, clearCache, getJson, onUnauthorized, refreshAll, sendJson} from './client.ts';

export type AuthState = 'checking' | 'in' | 'out' | 'unreachable';

let state: AuthState = 'checking';
let me: MeOut | null = null;
// The server's clock minus the browser's, from /api/me.
let offset = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const changed = () => listeners.forEach(listener => listener());

function set(next: AuthState) {
  if (state === next) return;
  state = next;
  changed();
}

export const useAuth = () => useSyncExternalStore(subscribe, () => state);

onUnauthorized(() => set('out'));

function learn(answer: MeOut) {
  me = answer;
  offset = Date.parse(answer.now) - Date.now();
  changed();
}

/** The owner's time zone (local days, clock times). */
export const timeZone = () => me?.time_zone ?? 'America/Los_Angeles';

/** Now, by the server's clock. */
export const serverNow = () => Date.now() + offset;

/** Setpoint itself didn't answer: no connection, or the proxy in front of it answering 5xx while it restarts. */
const unreachable = (error: unknown) => error instanceof ApiFailure && (error.code === 'unreachable' || error.status >= 500);

let checking: Promise<void> | null = null;

/**
 * Asks whether this browser is signed in: a 401 (or any refusal) shows the sign-in card. Setpoint
 * not answering is no sign-out: at launch it shows the boot screen's pill until an answer comes,
 * and while signed in the app stays, under the live stream's offline pill. One ask at a time.
 */
export function checkSession(): Promise<void> {
  checking ??= (async () => {
    try {
      learn(await getJson<MeOut>('/me', {quiet401: true}));
      set('in');
    } catch (error) {
      if (!unreachable(error)) set('out');
      else if (state !== 'in') set('unreachable');
    } finally {
      checking = null;
    }
  })();
  return checking;
}

export const authStatus = () => getJson<AuthStatusOut>('/auth/status');

/** The card's line for a refusal: the server's own sentence, or that it can't be reached. */
export const failureLine = (error: unknown) => (error instanceof Error ? error.message : 'Something went wrong.');

async function enter() {
  learn(await getJson<MeOut>('/me'));
  refreshAll();
  set('in');
}

/** The first sign-in: the setup token and a new password. Returns the recovery codes, shown once. */
export async function claim(setupToken: string, password: string): Promise<string[]> {
  const answer = await sendJson<RecoveryCodesOut>('POST', '/auth/claim', {setup_token: setupToken, password}, {quiet401: true});
  return answer.recovery_codes;
}

/**
 * Signs in with a recovery code when the password is lost: a new password replaces it, passkeys are
 * removed, and the codes are made again. Returns the new codes, shown once as the claim's are.
 */
export async function recover(recoveryCode: string, newPassword: string): Promise<string[]> {
  const answer = await sendJson<RecoveryCodesOut>('POST', '/auth/recover', {recovery_code: recoveryCode, new_password: newPassword}, {quiet401: true});
  return answer.recovery_codes;
}

/** After the claim's (or a recovery's) codes have been seen. */
export const continueIn = () => enter();

/** Signs in with the password; false when this Setpoint also needs a passkey (signInWithPasskey next). */
export async function signIn(password: string): Promise<boolean> {
  const answer = await sendJson<SignInOut>('POST', '/auth/sign-in', {password}, {quiet401: true});
  if (!answer.signed_in) return false;
  await enter();
  return true;
}

/**
 * Signs in with a passkey: alone, or after the password where Setpoint asks for both (the server
 * remembers the password step). The browser's own WebAuthn JSON forms carry the ceremony.
 */
export async function signInWithPasskey(): Promise<void> {
  const options = await sendJson<PublicKeyCredentialRequestOptionsJSON>('POST', '/auth/passkey/options', undefined, {quiet401: true});
  const credential = await navigator.credentials.get({publicKey: PublicKeyCredential.parseRequestOptionsFromJSON(options)}) as PublicKeyCredential | null;
  if (!credential) throw new Error('No passkey was used.');
  await sendJson('POST', '/auth/passkey/verify', {response: credential.toJSON()}, {quiet401: true});
  await enter();
}

export async function signOut() {
  await sendJson('POST', '/auth/sign-out');
  clearCache();
  set('out');
}
