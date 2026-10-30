// Migration 0017_news_airnow_key over a database at 0016 that already holds secrets (N2): the secrets
// table's rebuild, for AirNow's key among the names its check allows, keeps the keys already set.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {expect, onTestFinished, test} from 'vitest';
import {registerMigrationFunctions} from '../src/db/open.ts';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const AT = '2026-10-07T16:00:00.000Z';

test('0017_news_airnow_key applies over a database at 0016 with secrets', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-migration-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  // The migrations folder as it was before N2.
  const before = path.join(dir, 'before');
  fs.mkdirSync(path.join(before, 'meta'), {recursive: true});
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {entries: {tag: string}[]};
  const upTo = journal.entries.findIndex(entry => entry.tag.endsWith('_news_airnow_key'));
  expect(upTo).toBeGreaterThan(0);
  journal.entries = journal.entries.slice(0, upTo);
  fs.writeFileSync(path.join(before, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(before, `${entry.tag}.sql`));

  const sqlite = new Database(path.join(dir, 'setpoint.sqlite'));
  onTestFinished(() => {
    sqlite.close();
  });
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite);
  migrate(db, {migrationsFolder: before});
  sqlite.prepare(`insert into secrets (name, ciphertext, updated_at) values ('places_api_key', 'sp2:sealed', '${AT}')`).run();
  expect(() => sqlite.prepare(`insert into secrets (name, ciphertext, updated_at) values ('airnow_api_key', 'sp2:sealed', '${AT}')`).run()).toThrow(/CHECK/);

  registerMigrationFunctions(sqlite);
  migrate(db, {migrationsFolder: MIGRATIONS});

  expect(sqlite.prepare('select name, ciphertext, updated_at from secrets').all()).toEqual([{name: 'places_api_key', ciphertext: 'sp2:sealed', updated_at: AT}]);
  sqlite.prepare(`insert into secrets (name, ciphertext, updated_at) values ('airnow_api_key', 'sp2:sealed', '${AT}')`).run();
  expect(() => sqlite.prepare(`insert into secrets (name, ciphertext, updated_at) values ('pirate_weather_api_key', 'sp2:sealed', '${AT}')`).run()).toThrow(/CHECK/);
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
});
