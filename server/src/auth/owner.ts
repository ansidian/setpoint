// The single owner (harvested from v1's server/auth: owner store, claim, setup token, password
// throttle, recovery codes and security transitions; SV-2's harvest notes say what each branch is
// for). Setpoint has one owner, claimed once with a setup token printed by the CLI. Every security
// change goes through one transition that moves the security generation, ending every session.
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH} from '@setpoint/shared';
import type {AuthMode} from '@setpoint/shared';
import bcrypt from 'bcryptjs';
import {and, count, eq, gt, isNull, lte, or} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {conflict, SetpointError, tooMany, unauthorized} from '../errors.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {hashSecret, SESSION_DAYS} from './sessions.ts';

export type Owner = typeof t.owner.$inferSelect;

/** bcrypt's cost; tests pass 4. v1 used 12, and its hashes carry over as they are. */
export const BCRYPT_COST = 12;
export const SETUP_TOKEN_MINUTES = 60;
/** The password budget: 10 attempts per 15 minutes, shared by every caller (v1). */
export const PASSWORD_WINDOW_MS = 15 * 60_000;
export const PASSWORD_MAX_ATTEMPTS = 10;
export const RECOVERY_CODE_COUNT = 8;

export const getOwner = (store: Store): Owner | null => store.db.select().from(t.owner).get() ?? null;

export function requireOwner(store: Store): Owner {
  const owner = getOwner(store);
  if (!owner) throw conflict('not_claimed', 'Setpoint hasn\'t been claimed yet.');
  return owner;
}

export const isAcceptableNewPassword = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= MIN_PASSWORD_LENGTH && value.length <= MAX_PASSWORD_LENGTH;

export const hashPassword = (password: string, cost = BCRYPT_COST) => bcrypt.hash(password, cost);

/** False for anything but a string of a checkable length, before bcrypt runs (v1's policy). */
export async function passwordMatches(owner: Owner, password: unknown): Promise<boolean> {
  if (typeof password !== 'string' || !password || password.length > MAX_PASSWORD_LENGTH) return false;
  return bcrypt.compare(password, owner.passwordHash);
}

// ---- Setup tokens ----

/**
 * A one-time setup token for the first claim, valid an hour. Only its hash is kept, and a new one
 * replaces any earlier one. Refused once the owner exists.
 */
export function issueSetupToken(store: Store): {token: string; expiresAt: string} {
  return transaction(store, () => {
    if (getOwner(store)) throw conflict('already_claimed', 'Setpoint is already claimed; sign in instead.');
    const token = `setup_${randomBytes(24).toString('base64url')}`;
    const now = store.now();
    const expiresAt = new Date(now.getTime() + SETUP_TOKEN_MINUTES * 60_000).toISOString();
    store.db.delete(t.setupTokens).run();
    store.db.insert(t.setupTokens).values({hash: hashSecret(token), createdAt: now.toISOString(), expiresAt}).run();
    return {token, expiresAt};
  });
}

/** Whether a submitted setup token is the live one. Compared as hashes, in constant time (v1). */
function setupTokenMatches(store: Store, submitted: string): boolean {
  const live = store.db.select().from(t.setupTokens).where(gt(t.setupTokens.expiresAt, isoNow(store))).all();
  const digest = Buffer.from(hashSecret(submitted), 'hex');
  return live.some(row => timingSafeEqual(Buffer.from(row.hash, 'hex'), digest));
}

// ---- Recovery codes ----

const normaliseCode = (value: string) => value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
export const hashRecoveryCode = (code: string) => hashSecret(normaliseCode(code));

/** Eight codes like "SP-1A2B-…" (128 bits each); only their hashes are kept. */
export function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  return Array.from({length: n}, () => `SP-${randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')}`);
}

function replaceRecoveryCodes(store: Store, codes: string[]) {
  const now = isoNow(store);
  store.db.delete(t.recoveryCodes).run();
  for (const code of codes) store.db.insert(t.recoveryCodes).values({hash: hashRecoveryCode(code), generatedAt: now}).run();
}

export function recoveryStatus(store: Store): {remaining: number; generated_at: string | null} {
  const rows = store.db.select().from(t.recoveryCodes).all();
  return {remaining: rows.filter(row => !row.usedAt).length, generated_at: rows.map(row => row.generatedAt).sort().at(-1) ?? null};
}

// ---- The claim ----

/**
 * The first claim: the setup token and a new password make the owner, with recovery codes, in one
 * transaction. A second claim, or one racing the first, is refused and changes nothing.
 */
export async function claimOwner(store: Store, setupToken: string, password: string, cost = BCRYPT_COST): Promise<{owner: Owner; recoveryCodes: string[]}> {
  if (getOwner(store)) throw conflict('already_claimed', 'Setpoint is already claimed; sign in instead.');
  if (!setupTokenMatches(store, setupToken)) throw new SetpointError('bad_setup_token', 'That setup token isn\'t valid. Run `npm run cli -- setup-token` for a new one.', 403);
  if (!isAcceptableNewPassword(password)) throw new SetpointError('weak_password', `Use at least ${MIN_PASSWORD_LENGTH} characters.`, 400);
  const passwordHash = await hashPassword(password, cost);
  const recoveryCodes = generateRecoveryCodes();
  const owner = transaction(store, () => {
    if (getOwner(store)) throw conflict('already_claimed', 'Setpoint is already claimed; sign in instead.');
    // Spent even if it were still live: a token claims once.
    if (!setupTokenMatches(store, setupToken)) throw new SetpointError('bad_setup_token', 'That setup token isn\'t valid.', 403);
    store.db.delete(t.setupTokens).run();
    const row = store.db.insert(t.owner).values({id: 1, passwordHash, claimedAt: isoNow(store)}).returning().get();
    replaceRecoveryCodes(store, recoveryCodes);
    return row;
  });
  return {owner, recoveryCodes};
}

// ---- The password budget ----

/**
 * Reserves one password attempt before bcrypt runs, successes included, so concurrent guesses from
 * anywhere share one budget and none can erase another's. A refused attempt doesn't extend the
 * window. Throws 429 with how long to wait.
 */
export function reservePasswordAttempt(store: Store) {
  transaction(store, () => {
    const owner = requireOwner(store);
    const now = store.now();
    const windowOver = !owner.passwordWindowEndsAt || Date.parse(owner.passwordWindowEndsAt) <= now.getTime();
    if (windowOver) {
      store.db.update(t.owner).set({passwordAttempts: 1, passwordWindowEndsAt: new Date(now.getTime() + PASSWORD_WINDOW_MS).toISOString()}).run();
      return;
    }
    if (owner.passwordAttempts < PASSWORD_MAX_ATTEMPTS) {
      store.db.update(t.owner).set({passwordAttempts: owner.passwordAttempts + 1}).run();
      return;
    }
    const retryAfterSeconds = Math.max(1, Math.ceil((Date.parse(owner.passwordWindowEndsAt!) - now.getTime()) / 1000));
    throw tooMany('Too many password attempts. Try again later.', {retry_after_seconds: retryAfterSeconds});
  });
}

/** Strict mode needs a passkey after the password; without one registered, it can't be met (v1). */
export function passwordSignInOutcome(mode: AuthMode, passkeyCount: number): 'signed_in' | 'passkey_required' | 'misconfigured' {
  if (mode === 'password_or_passkey') return 'signed_in';
  return passkeyCount > 0 ? 'passkey_required' : 'misconfigured';
}

export const passkeyCount = (store: Store) => store.db.select({n: count()}).from(t.passkeys).get()!.n;

// ---- Security transitions ----

/**
 * One security change: if the owner is still at `expectedGeneration`, runs `mutate`, moves the
 * generation on and ends every session, pending sign-in and WebAuthn challenge made under the old
 * one, all in one transaction. Returns the new generation, or null (changing nothing) when another
 * change got there first. A failing `mutate` rolls everything back.
 */
export function securityTransition(store: Store, expectedGeneration: number, mutate: () => void): number | null {
  return transaction(store, () => {
    const bumped = store.db.update(t.owner).set({securityGeneration: expectedGeneration + 1})
      .where(and(eq(t.owner.id, 1), eq(t.owner.securityGeneration, expectedGeneration))).returning().get();
    if (!bumped) return null;
    mutate();
    store.db.update(t.sessions).set({endedAt: isoNow(store)}).where(isNull(t.sessions.endedAt)).run();
    store.db.delete(t.pendingSignIns).run();
    store.db.delete(t.webauthnChallenges).run();
    return bumped.securityGeneration;
  });
}

export async function changePassword(store: Store, expectedGeneration: number, newPassword: string, cost = BCRYPT_COST): Promise<number | null> {
  const passwordHash = await hashPassword(newPassword, cost);
  return securityTransition(store, expectedGeneration, () => {
    store.db.update(t.owner).set({passwordHash}).run();
  });
}

export function setAuthMode(store: Store, expectedGeneration: number, mode: AuthMode): number | null {
  if (mode === 'password_plus_passkey' && passkeyCount(store) === 0) throw conflict('no_passkey', 'Register a passkey before requiring one.');
  return securityTransition(store, expectedGeneration, () => {
    store.db.update(t.owner).set({authMode: mode}).run();
  });
}

export function regenerateRecoveryCodes(store: Store, expectedGeneration: number): {generation: number | null; codes: string[]} {
  const codes = generateRecoveryCodes();
  const generation = securityTransition(store, expectedGeneration, () => replaceRecoveryCodes(store, codes));
  return {generation, codes};
}

/**
 * Recovery with a code: spends it, sets the new password, clears every passkey and strict mode
 * (they may be what was lost) and issues new codes. A wrong or spent code changes nothing.
 */
export async function recover(store: Store, code: string, newPassword: string, cost = BCRYPT_COST): Promise<{generation: number; codes: string[]}> {
  const owner = getOwner(store);
  if (!owner) throw unauthorized('Recovery failed.', 'recovery_failed');
  const passwordHash = await hashPassword(newPassword, cost);
  const codes = generateRecoveryCodes();
  const generation = securityTransition(store, owner.securityGeneration, () => {
    const spent = store.db.update(t.recoveryCodes).set({usedAt: isoNow(store)})
      .where(and(eq(t.recoveryCodes.hash, hashRecoveryCode(code)), isNull(t.recoveryCodes.usedAt))).returning().get();
    if (!normaliseCode(code) || !spent) throw unauthorized('Recovery failed.', 'recovery_failed');
    store.db.update(t.owner).set({passwordHash, authMode: 'password_or_passkey'}).run();
    store.db.delete(t.passkeys).run();
    replaceRecoveryCodes(store, codes);
  });
  if (generation === null) throw unauthorized('Recovery failed.', 'recovery_failed');
  return {generation, codes};
}

/**
 * Expired pending sign-ins, challenges and setup tokens, and sessions ended or idle for 30 days,
 * swept on each sign-in so the tables stay small (v1 swept expired sessions the same way: a cookie
 * that stops being sent never comes back to be deleted).
 */
export function sweepExpiredAuth(store: Store) {
  const now = isoNow(store);
  const monthAgo = new Date(store.now().getTime() - SESSION_DAYS * 24 * 60 * 60_000).toISOString();
  transaction(store, () => {
    store.db.delete(t.pendingSignIns).where(lte(t.pendingSignIns.expiresAt, now)).run();
    store.db.delete(t.webauthnChallenges).where(lte(t.webauthnChallenges.expiresAt, now)).run();
    store.db.delete(t.setupTokens).where(lte(t.setupTokens.expiresAt, now)).run();
    store.db.delete(t.sessions).where(or(lte(t.sessions.lastUsedAt, monthAgo), lte(t.sessions.endedAt, monthAgo))).run();
  });
}
