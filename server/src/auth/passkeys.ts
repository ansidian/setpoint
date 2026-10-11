// Passkeys (WebAuthn), harvested from v1's passkey store, challenge store, pending sign-ins,
// WebAuthn config and service (SV-2's harvest notes). Challenges and pending sign-ins are stored as
// hashes, spent once, last five minutes and belong to one security generation. A sign-in that
// needs a passkey after the password (strict mode) carries the password's time in its pending row.
import {randomBytes} from 'node:crypto';
import {
  generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {AuthenticationResponseJSON, AuthenticatorTransportFuture, RegistrationResponseJSON} from '@simplewebauthn/server';
import type {PasskeyOut} from '@setpoint/shared';
import {and, eq, gt} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {conflict, notFound, SetpointError, unauthorized} from '../errors.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {getOwner, requireOwner, securityTransition} from './owner.ts';
import {hashSecret, newSecret} from './sessions.ts';

export const CHALLENGE_MS = 5 * 60_000;
const RP_NAME = 'Setpoint';
// The owner's WebAuthn user handle: there is only one user.
const USER_ID = new TextEncoder().encode('setpoint-owner');
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export interface RelyingParty {
  rpId: string;
  origin: string;
}

/**
 * The relying party: Setpoint's public origin when set (SETPOINT_PUBLIC_URL, https in production),
 * else in development the browser's own loopback origin (localhost or 127.0.0.1, any port), so
 * passkeys work against `npm run dev` and Vite alike. Passkeys belong to the hostname, which is why
 * the cutover keeps it (BRIEF.md › Cutover).
 */
export function relyingParty(publicUrl: string | null, requestOrigin: string | undefined, production: boolean): RelyingParty {
  if (publicUrl) {
    const url = new URL(publicUrl);
    if (production && url.protocol !== 'https:') throw new SetpointError('passkeys_unavailable', 'Passkeys need SETPOINT_PUBLIC_URL to be https.', 503);
    return {rpId: url.hostname, origin: url.origin};
  }
  if (!production && requestOrigin) {
    try {
      const url = new URL(requestOrigin);
      if ((url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK.has(url.hostname)) return {rpId: url.hostname, origin: url.origin};
    } catch {
      // Not a URL: refused below.
    }
  }
  throw new SetpointError('passkeys_unavailable', 'Passkeys need SETPOINT_PUBLIC_URL, or a local origin in development.', 503);
}

function presentPasskey(row: typeof t.passkeys.$inferSelect): PasskeyOut {
  return {id: row.id, label: row.label, created_at: row.createdAt, last_used_at: row.lastUsedAt, backed_up: row.backedUp};
}

export const listPasskeys = (store: Store): PasskeyOut[] =>
  store.db.select().from(t.passkeys).orderBy(t.passkeys.createdAt, t.passkeys.id).all().map(presentPasskey);

const transportsOf = (row: typeof t.passkeys.$inferSelect) => row.transports as AuthenticatorTransportFuture[];
const expiry = (store: Store) => new Date(store.now().getTime() + CHALLENGE_MS).toISOString();

// ---- Pending sign-ins ----

export interface PendingSignIn {
  hash: string;
  securityGeneration: number;
  passwordAt: string | null;
}

/**
 * A pending sign-in under `generation`; its secret goes in a short-lived cookie. Null, making
 * nothing, when the owner's generation has moved on since the caller checked the password (a
 * security change landed while bcrypt ran), as v1's pending-auth store refused.
 */
export function startPendingSignIn(store: Store, passwordAt: string | null, generation = requireOwner(store).securityGeneration): string | null {
  return transaction(store, () => {
    if (requireOwner(store).securityGeneration !== generation) return null;
    const secret = newSecret();
    store.db.insert(t.pendingSignIns).values({
      hash: hashSecret(secret), securityGeneration: generation, passwordAt, createdAt: isoNow(store), expiresAt: expiry(store),
    }).run();
    return secret;
  });
}

/** The pending sign-in behind a cookie, if it's unexpired and its generation is still the owner's. */
export function findPendingSignIn(store: Store, secret: string | null): PendingSignIn | null {
  if (!secret) return null;
  const row = store.db.select().from(t.pendingSignIns)
    .where(and(eq(t.pendingSignIns.hash, hashSecret(secret)), gt(t.pendingSignIns.expiresAt, isoNow(store)))).get();
  const owner = getOwner(store);
  if (!row || !owner || row.securityGeneration !== owner.securityGeneration) return null;
  return {hash: row.hash, securityGeneration: row.securityGeneration, passwordAt: row.passwordAt};
}

export function cancelPendingSignIn(store: Store, secret: string | null) {
  if (!secret) return;
  const hash = hashSecret(secret);
  transaction(store, () => {
    store.db.delete(t.webauthnChallenges).where(eq(t.webauthnChallenges.pendingHash, hash)).run();
    store.db.delete(t.pendingSignIns).where(eq(t.pendingSignIns.hash, hash)).run();
  });
}

/** Spends a challenge: true only once, unexpired, for its purpose, binding and generation. */
function spendChallenge(store: Store, challenge: string, purpose: 'sign_in' | 'register', binding: {pendingHash?: string; sessionId?: number}, generation: number): boolean {
  const row = store.db.delete(t.webauthnChallenges).where(eq(t.webauthnChallenges.hash, hashSecret(challenge))).returning().get();
  if (!row || row.expiresAt <= isoNow(store) || row.purpose !== purpose || row.securityGeneration !== generation) return false;
  if (binding.pendingHash !== undefined && row.pendingHash !== binding.pendingHash) return false;
  if (binding.sessionId !== undefined && row.sessionId !== binding.sessionId) return false;
  return true;
}

// ---- Signing in with a passkey ----

/**
 * The options for a passkey sign-in. In strict mode it continues the pending sign-in a correct
 * password started; otherwise it starts one. Returns the pending cookie's secret when it made one.
 */
export async function passkeySignInOptions(store: Store, rp: RelyingParty, pendingSecret: string | null) {
  const owner = getOwner(store);
  if (!owner) throw unauthorized('Passkey sign-in isn\'t available.');
  let pending = findPendingSignIn(store, pendingSecret);
  let newPending: string | null = null;
  if (!pending) {
    if (owner.authMode === 'password_plus_passkey') throw conflict('password_first', 'Enter your password before using a passkey.');
    newPending = startPendingSignIn(store, null)!;
    pending = findPendingSignIn(store, newPending)!;
  }
  const passkeys = store.db.select().from(t.passkeys).all();
  if (!passkeys.length) throw conflict('no_passkey', 'No passkey is registered.');
  const challenge = randomBytes(32).toString('base64url');
  store.db.insert(t.webauthnChallenges).values({
    hash: hashSecret(challenge), purpose: 'sign_in', pendingHash: pending.hash, securityGeneration: pending.securityGeneration, expiresAt: expiry(store),
  }).run();
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    challenge: Buffer.from(challenge, 'base64url'),
    userVerification: 'required',
    allowCredentials: passkeys.map(passkey => ({id: passkey.credentialId, transports: transportsOf(passkey)})),
  });
  return {options, pendingSecret: newPending};
}

/**
 * Verifies a passkey sign-in against its pending sign-in, spending both. Returns what the session
 * is made from: its generation and, after a password (strict mode), the password's time.
 */
export async function verifyPasskeySignIn(store: Store, rp: RelyingParty, pendingSecret: string | null, response: Record<string, unknown>) {
  const failed = () => unauthorized('That passkey didn\'t work.', 'passkey_failed');
  const pending = findPendingSignIn(store, pendingSecret);
  if (!pending) throw unauthorized('Start the sign-in again.', 'no_pending_sign_in');
  const credentialId = typeof response.id === 'string' ? response.id : null;
  const passkey = credentialId ? store.db.select().from(t.passkeys).where(eq(t.passkeys.credentialId, credentialId)).get() : undefined;
  if (!passkey) throw failed();
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: response as unknown as AuthenticationResponseJSON,
      expectedChallenge: challenge => spendChallenge(store, challenge, 'sign_in', {pendingHash: pending.hash}, pending.securityGeneration),
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
      credential: {id: passkey.credentialId, publicKey: Buffer.from(passkey.publicKey, 'base64url'), counter: passkey.signCount, transports: transportsOf(passkey)},
    });
  } catch {
    throw failed();
  }
  if (!verification.verified) throw failed();
  const info = verification.authenticationInfo;
  return transaction(store, () => {
    const spent = store.db.delete(t.pendingSignIns).where(eq(t.pendingSignIns.hash, pending.hash)).returning().get();
    if (!spent || spent.securityGeneration !== getOwner(store)?.securityGeneration) throw failed();
    // The sign counter never goes back.
    store.db.update(t.passkeys).set({
      signCount: Math.max(passkey.signCount, info.newCounter), backedUp: info.credentialBackedUp, deviceType: info.credentialDeviceType, lastUsedAt: isoNow(store),
    }).where(eq(t.passkeys.id, passkey.id)).run();
    return {generation: spent.securityGeneration, passwordAt: spent.passwordAt};
  });
}

// ---- Registering a passkey (needs a recent password) ----

export async function passkeyRegistrationOptions(store: Store, rp: RelyingParty, session: {id: number; securityGeneration: number}) {
  const challenge = randomBytes(32).toString('base64url');
  store.db.insert(t.webauthnChallenges).values({
    hash: hashSecret(challenge), purpose: 'register', sessionId: session.id, securityGeneration: session.securityGeneration, expiresAt: expiry(store),
  }).run();
  return generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rp.rpId,
    userName: 'owner',
    userID: USER_ID,
    userDisplayName: 'Setpoint',
    challenge: Buffer.from(challenge, 'base64url'),
    attestationType: 'none',
    authenticatorSelection: {residentKey: 'preferred', userVerification: 'required'},
    excludeCredentials: store.db.select().from(t.passkeys).all().map(passkey => ({id: passkey.credentialId, transports: transportsOf(passkey)})),
  });
}

/** Verifies and stores a new passkey; a security change, so it returns the new generation. */
export async function registerPasskey(store: Store, rp: RelyingParty, session: {id: number; securityGeneration: number}, label: string, response: Record<string, unknown>) {
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: response as unknown as RegistrationResponseJSON,
      expectedChallenge: challenge => spendChallenge(store, challenge, 'register', {sessionId: session.id}, session.securityGeneration),
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpId,
      requireUserVerification: true,
    });
  } catch {
    throw unauthorized('That passkey couldn\'t be registered.', 'passkey_failed');
  }
  if (!verification.verified) throw unauthorized('That passkey couldn\'t be registered.', 'passkey_failed');
  const {credential, credentialBackedUp, credentialDeviceType} = verification.registrationInfo;
  const transports = credential.transports ?? (Array.isArray((response.response as {transports?: unknown})?.transports) ? (response.response as {transports: string[]}).transports : []);
  return securityTransition(store, session.securityGeneration, () => {
    store.db.insert(t.passkeys).values({
      credentialId: credential.id, label, publicKey: Buffer.from(credential.publicKey).toString('base64url'), signCount: credential.counter,
      transports: transports.map(String), backedUp: credentialBackedUp, deviceType: credentialDeviceType, createdAt: isoNow(store),
    }).run();
  });
}

/** Removes a passkey; removing the last one turns strict mode off, so sign-in stays possible (v1). */
export function deletePasskey(store: Store, generation: number, passkeyId: number): number | null {
  const passkey = store.db.select().from(t.passkeys).where(eq(t.passkeys.id, passkeyId)).get();
  if (!passkey) throw notFound('No such passkey.');
  return securityTransition(store, generation, () => {
    store.db.delete(t.passkeys).where(eq(t.passkeys.id, passkeyId)).run();
    if (!store.db.select().from(t.passkeys).get()) store.db.update(t.owner).set({authMode: 'password_or_passkey'}).run();
  });
}
