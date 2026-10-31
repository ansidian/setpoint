// Migration 0024_search_reading over a database at 0023 that already holds a ledger and a search log
// (SV-138): the ledger's rebuild keeps its rows and allows the new purpose, the log's rows keep theirs
// with no reading, and a chip removed goes when its search does.
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

function atSearchTerms() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-migration-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  const before = path.join(dir, 'before');
  fs.mkdirSync(path.join(before, 'meta'), {recursive: true});
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {entries: {tag: string}[]};
  const upTo = journal.entries.findIndex(entry => entry.tag.endsWith('_search_reading'));
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
  registerMigrationFunctions(sqlite);
  migrate(db, {migrationsFolder: before});
  return {sqlite, db};
}

test('0024_search_reading keeps the ledger and the log, and allows the new purpose', () => {
  const {sqlite, db} = atSearchTerms();
  sqlite.prepare(`insert into ai_usage (at, provider, model, purpose, input_tokens, output_tokens, cost_micros) values ('${AT}', 'anthropic', 'claude-haiku-5-5', 'search_terms', 10, 2, 7)`).run();
  sqlite.prepare(`insert into search_log (at, query, free_text, chips, "order", total, result_ids) values ('${AT}', 'renewal', 'renewal', '[]', 'match', 0, '[]')`).run();
  const insertUsage = (purpose: string) => sqlite.prepare(`insert into ai_usage (at, provider, model, purpose, input_tokens, output_tokens, cost_micros) values ('${AT}', 'anthropic', 'm', '${purpose}', 1, 1, 1)`);
  expect(() => insertUsage('search_reading').run()).toThrow(/CHECK/);

  migrate(db, {migrationsFolder: MIGRATIONS});

  expect(sqlite.prepare('select purpose, cost_micros from ai_usage').all()).toEqual([{purpose: 'search_terms', cost_micros: 7}]);
  expect(sqlite.prepare('select id, query, reading from search_log').all()).toEqual([{id: 1, query: 'renewal', reading: null}]);
  insertUsage('search_reading').run();
  expect(() => insertUsage('other').run()).toThrow(/CHECK/);
  sqlite.prepare(`insert into search_chip_removals (search_id, chip, at) values (1, '{}', '${AT}')`).run();
  sqlite.prepare('delete from search_log').run();
  expect(sqlite.prepare('select count(*) as n from search_chip_removals').get()).toEqual({n: 0});
});
