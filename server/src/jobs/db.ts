// Jobs's tables on the app's database: its own migrations (./drizzle) with its own migrations table,
// applied after the app's, and a Drizzle instance typed by its own schema over the same connection.
// Every place that opens a database Jobs is used on calls migrateJobs: the server at start and the
// seed (both wiring points), and Jobs's tests. It's idempotent.
import {fileURLToPath} from 'node:url';
import type Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

const MIGRATIONS = fileURLToPath(new URL('./drizzle', import.meta.url));

export type JobsDb = ReturnType<typeof drizzle<typeof schema>>;

const instances = new WeakMap<Database.Database, JobsDb>();

/** Jobs's Drizzle over a connection the app opened. */
export function jobsDb(sqlite: Database.Database): JobsDb {
  let db = instances.get(sqlite);
  if (!db) {
    db = drizzle(sqlite, {schema});
    instances.set(sqlite, db);
  }
  return db;
}

/** Creates or updates Jobs's tables; run after the app's own migrations. */
export function migrateJobs(sqlite: Database.Database) {
  migrate(jobsDb(sqlite), {migrationsFolder: MIGRATIONS, migrationsTable: schema.JOBS_MIGRATIONS_TABLE});
}
