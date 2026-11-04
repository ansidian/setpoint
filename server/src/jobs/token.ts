// The browser extension's bearer token for POST /api/jobs/check (SV-173), as Home Assistant's is
// (../auth/haToken.ts): apart from the owner's session, it reads that one endpoint and nothing else.
// There is one token at a time. The CLI issues it (`npm run cli -- jobs-token`, which also rotates:
// the old one stops working) and revokes it (`jobs-token --revoke`). Only its SHA-256 is kept, the
// comparison is constant-time, and the token itself is printed once by the CLI and never logged.
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {hashSecret} from '../auth/sessions.ts';
import {transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {jobsDb} from './db.ts';
import * as j from './schema.ts';

const PREFIX = 'sp_jobs_';

/** A new token (256 random bits), replacing any earlier one. Returned once; only its hash is kept. */
export function issueJobsToken(store: Store): {token: string; createdAt: string} {
  const token = `${PREFIX}${randomBytes(32).toString('base64url')}`;
  const createdAt = store.now().toISOString();
  const db = jobsDb(store.sqlite);
  transaction(store, () => {
    db.delete(j.jobsCheckToken).run();
    db.insert(j.jobsCheckToken).values({id: 1, hash: hashSecret(token), createdAt}).run();
  });
  return {token, createdAt};
}

/** Revokes the token; returns whether there was one. */
export function revokeJobsToken(store: Store): boolean {
  return jobsDb(store.sqlite).delete(j.jobsCheckToken).returning({id: j.jobsCheckToken.id}).all().length > 0;
}

/** When the current token was issued, or null when there is none. */
export function jobsTokenIssuedAt(store: Store): string | null {
  return jobsDb(store.sqlite).select({createdAt: j.jobsCheckToken.createdAt}).from(j.jobsCheckToken).get()?.createdAt ?? null;
}

/** Whether an Authorization header carries the current token ("Bearer sp_jobs_…"). */
export function jobsTokenMatches(store: Store, authorization: string | undefined): boolean {
  const match = /^Bearer[ \t]+(\S{1,512})[ \t]*$/i.exec(authorization ?? '');
  if (!match) return false;
  const row = jobsDb(store.sqlite).select({hash: j.jobsCheckToken.hash}).from(j.jobsCheckToken).get();
  if (!row) return false;
  return timingSafeEqual(Buffer.from(row.hash, 'hex'), Buffer.from(hashSecret(match[1]!), 'hex'));
}
