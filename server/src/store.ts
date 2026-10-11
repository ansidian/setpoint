// Everything an operation needs besides its input: the database, the clock, the owner's zone, the
// live feed and the key for credentials. Tests build one over an in-memory database with a fixed
// clock; the CLI has no live feed.
import type Database from 'better-sqlite3';
import type {LiveEvent} from '@setpoint/shared';
import type {Db} from './db/open.ts';
import type {LiveFeed} from './live/feed.ts';
import type {Keyring} from './secrets/crypto.ts';

export interface Store {
  sqlite: Database.Database;
  db: Db;
  timeZone: string;
  now(): Date;
  live?: LiveFeed;
  // Null when no key is configured: credentials can then be neither written nor read.
  keyring: Keyring | null;
}

export const isoNow = (store: Store) => store.now().toISOString();

/**
 * better-sqlite3 transactions are synchronous, so each operation is atomic and nothing interleaves
 * with it. Nested calls become savepoints. The outermost takes the write lock at BEGIN, so another
 * process's write (the CLI's) is waited out under busy_timeout. Live events go out once it commits,
 * and not at all if it rolls back.
 */
export function transaction<T>(store: Store, operation: () => T): T {
  if (store.sqlite.inTransaction) return store.sqlite.transaction(operation)();
  let result: T;
  try {
    result = store.sqlite.transaction(operation).immediate();
  } catch (error) {
    store.live?.discard();
    throw error;
  }
  store.live?.flush();
  return result;
}

/** Notes what a write changed, for the live stream; outside a transaction it goes out at once. */
export function noteLive(store: Store, event: LiveEvent) {
  if (!store.live) return;
  store.live.note(event);
  if (!store.sqlite.inTransaction) store.live.flush();
}
