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
 * The SQL functions migrations call. A migration can't import TypeScript, and 0022_search_body fills
 * `search_body` for every email already there with the rule new mail gets, inside its own
 * transaction. Every database replays it once, so this stays while that migration does.
 */
export function registerMigrationFunctions(sqlite: Database.Database) {
  sqlite.function('search_body_of', {deterministic: true}, body => searchBody(String(body)));
}

/** Opens (creating if needed) and migrates the database. Pass ':memory:' for tests. */
export function openDatabase(file: string): OpenDatabase {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    // A large migration's temporary data sits beside the database: the image's /tmp is a small
    // tmpfs, which filled at 0022's rewrite of every email (SQLITE_FULL, with the disk half empty).
    process.env.SQLITE_TMPDIR ??= path.dirname(file);
  }
  const sqlite = new Database(file);
  if (file !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, {schema});
  registerMigrationFunctions(sqlite);
  migrate(db, {migrationsFolder: MIGRATIONS});
  return {sqlite, db};
}
