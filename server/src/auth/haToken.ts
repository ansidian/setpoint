// Home Assistant's bearer token for the read-only status endpoint (GET /api/status/ha, B6). It's
// separate from the owner's session: it reads that one endpoint and nothing else, and no session
// cookie reads the endpoint in its place. There is one token at a time. The CLI issues it
// (`npm run cli -- ha-token`, which also rotates: the old one stops working) and revokes it
// (`ha-token --revoke`). Only its SHA-256 is kept, the comparison is constant-time, and the token
// itself is printed once by the CLI and never logged.
import {randomBytes, timingSafeEqual} from 'node:crypto';
import * as t from '../db/schema.ts';
import {transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {hashSecret} from './sessions.ts';

const PREFIX = 'sp_ha_';

/** A new token (256 random bits), replacing any earlier one. Returned once; only its hash is kept. */
export function issueHaToken(store: Store): {token: string; createdAt: string} {
  const token = `${PREFIX}${randomBytes(32).toString('base64url')}`;
  const createdAt = store.now().toISOString();
  transaction(store, () => {
    store.db.delete(t.haToken).run();
    store.db.insert(t.haToken).values({id: 1, hash: hashSecret(token), createdAt}).run();
  });
  return {token, createdAt};
}

/** Revokes the token; returns whether there was one. */
export function revokeHaToken(store: Store): boolean {
  return store.db.delete(t.haToken).returning({id: t.haToken.id}).all().length > 0;
}

/** When the current token was issued, or null when there is none. */
export function haTokenIssuedAt(store: Store): string | null {
  return store.db.select({createdAt: t.haToken.createdAt}).from(t.haToken).get()?.createdAt ?? null;
}

/** Whether an Authorization header carries the current token ("Bearer sp_ha_…"). */
export function haTokenMatches(store: Store, authorization: string | undefined): boolean {
  const match = /^Bearer[ \t]+(\S{1,512})[ \t]*$/i.exec(authorization ?? '');
  if (!match) return false;
  const row = store.db.select({hash: t.haToken.hash}).from(t.haToken).get();
  if (!row) return false;
  return timingSafeEqual(Buffer.from(row.hash, 'hex'), Buffer.from(hashSecret(match[1]!), 'hex'));
}
