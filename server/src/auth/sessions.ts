// A browser's session (adapted from darma's sessions and v1's middleware/auth.ts; SV-2's harvest
// notes). The cookie holds 256 random bits; only their SHA-256 is stored, so a copy of the database
// signs no one in. A session lasts 30 days from its last use, and only while the owner's security
// generation is the one it was made under: a security change ends every session at once.
import {createHash, randomBytes} from 'node:crypto';
import type {SessionMethod} from '@setpoint/shared';
import {and, eq, isNull} from 'drizzle-orm';
import * as t from '../db/schema.ts';
import {isoNow, transaction} from '../store.ts';
import type {Store} from '../store.ts';

export const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60_000;
/** Security changes need the password given in the last 10 minutes (v1's step-up window). */
export const RECENT_PASSWORD_MS = 10 * 60_000;
// base64url of 32 bytes.
export const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export const hashSecret = (secret: string) => createHash('sha256').update(secret, 'utf8').digest('hex');
export const newSecret = () => randomBytes(32).toString('base64url');

export interface Session {
  id: number;
  method: SessionMethod;
  securityGeneration: number;
  passwordAt: string | null;
  // The cookie should be sent again, because this use extended the session.
  renewed: boolean;
}

/**
 * A new session under the owner's current generation, or null if that generation has moved on
 * since the caller read it (a security change raced the sign-in).
 */
export function createSession(store: Store, {generation, method, passwordAt}: {generation: number; method: SessionMethod; passwordAt: string | null}): string | null {
  return transaction(store, () => {
    const owner = store.db.select({generation: t.owner.securityGeneration}).from(t.owner).get();
    if (!owner || owner.generation !== generation) return null;
    const secret = newSecret();
    const now = isoNow(store);
    store.db.insert(t.sessions).values({hash: hashSecret(secret), securityGeneration: generation, method, passwordAt, createdAt: now, lastUsedAt: now}).run();
    return secret;
  });
}

/**
 * The session behind a cookie's secret, or null once it has ended, idled out or outlived its
 * security generation. Each use extends it, recorded at most once a minute; the live stream's checks
 * pass `extend: false`, so a tab left open isn't use.
 */
export function findSession(store: Store, secret: string, extend = true): Session | null {
  if (!SECRET_PATTERN.test(secret)) return null;
  const found = store.db.select({session: t.sessions, generation: t.owner.securityGeneration}).from(t.sessions)
    .innerJoin(t.owner, eq(t.owner.id, 1))
    .where(and(eq(t.sessions.hash, hashSecret(secret)), isNull(t.sessions.endedAt))).get();
  if (!found || found.session.securityGeneration !== found.generation) return null;
  const now = store.now();
  const idle = now.getTime() - Date.parse(found.session.lastUsedAt);
  if (idle >= SESSION_MS) return null;
  const renewed = extend && idle > 60_000;
  if (renewed) store.db.update(t.sessions).set({lastUsedAt: now.toISOString()}).where(eq(t.sessions.id, found.session.id)).run();
  const {id, method, securityGeneration, passwordAt} = found.session;
  return {id, method, securityGeneration, passwordAt, renewed};
}

export function hasRecentPassword(store: Store, session: Pick<Session, 'passwordAt'>): boolean {
  if (!session.passwordAt) return false;
  const age = store.now().getTime() - Date.parse(session.passwordAt);
  return age >= 0 && age <= RECENT_PASSWORD_MS;
}

/** Sign out. An unknown or already ended session is fine. */
export function endSession(store: Store, secret: string) {
  if (!SECRET_PATTERN.test(secret)) return;
  store.db.update(t.sessions).set({endedAt: isoNow(store)}).where(and(eq(t.sessions.hash, hashSecret(secret)), isNull(t.sessions.endedAt))).run();
}

export function markPasswordGiven(store: Store, sessionId: number) {
  store.db.update(t.sessions).set({passwordAt: isoNow(store)}).where(eq(t.sessions.id, sessionId)).run();
}
