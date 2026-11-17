import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {searchBody} from '../domain/searchBody.ts';
import * as schema from './schema.ts';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenDatabase {
  sqlite: Database.Database;
  db: Db;
}

/**
 * The SQL functions migrations call. A migration can't import TypeScript. 0022_search_body fills
 * `search_body` for every email already there, inside its own transaction, with the rule new mail
 * gets. Every database replays it once, so this stays while that migration does.
 */
function registerMigrationFunctions(sqlite: Database.Database) {
  sqlite.function('search_body_of', {deterministic: true}, body => searchBody(String(body)));
}

/** Opens (creating if needed) and migrates the database. Pass ':memory:' for tests. */
export function openDatabase(file: string): OpenDatabase {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    // A large migration's temporary data sits beside the database. The image's /tmp is a small
    // tmpfs, and it filled at 0022's rewrite of every email (SQLITE_FULL, with the disk half empty).
    process.env.SQLITE_TMPDIR ??= path.dirname(file);
  }
  const sqlite = new Database(file);
  if (file !== ':memory:') sqlite.pragma('journal_mode = WAL');
  const opened = connected(sqlite);
  const before = appliedMigrations(sqlite);
  migrate(opened.db, {migrationsFolder: MIGRATIONS});
  // A migration that rewrites much leaves as much in the write-ahead log, and SQLite only shrinks the
  // log when the last connection closes, which a running server never does. So once one has run,
  // its pages go into the database and the log is emptied.
  if (file !== ':memory:' && appliedMigrations(sqlite) !== before) sqlite.pragma('wal_checkpoint(TRUNCATE)');
  return opened;
}

const appliedMigrations = (sqlite: Database.Database): number => {
  const table = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'").get();
  return table ? sqlite.prepare('SELECT count(*) FROM __drizzle_migrations').pluck().get() as number : 0;
};

/**
 * An in-memory copy of a database from its `sqlite.serialize()`, as it stood. Nothing migrates, and
 * writes reach only the copy. Tests start from one, because migrating and seeding each time was most
 * of what a seeded test cost.
 */
export const openImage = (image: Buffer): OpenDatabase => connected(new Database(image));

function connected(sqlite: Database.Database): OpenDatabase {
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  registerMigrationFunctions(sqlite);
  return {sqlite, db: drizzle(sqlite, {schema})};
}
