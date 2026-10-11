import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export interface OpenDatabase {
  sqlite: Database.Database;
  db: Db;
}

/** Opens (creating if needed) and migrates the database. Pass ':memory:' for tests. */
export function openDatabase(file: string): OpenDatabase {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), {recursive: true});
  const sqlite = new Database(file);
  if (file !== ':memory:') sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, {schema});
  migrate(db, {migrationsFolder: MIGRATIONS});
  return {sqlite, db};
}
