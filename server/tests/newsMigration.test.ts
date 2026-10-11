// Migration 0016_news over a database at 0015 that already holds jobs (N1): the jobs table's rebuild
// keeps them (its copy is hand-corrected to fill the new news_source_id with NULL, as 0005's was for
// message_id), and a News source's jobs go with it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {expect, onTestFinished, test} from 'vitest';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));
const AT = '2026-10-07T16:00:00.000Z';

test('0016_news applies over a database at 0015 with jobs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-migration-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  // The migrations folder as it was before N1.
  const before = path.join(dir, 'before');
  fs.mkdirSync(path.join(before, 'meta'), {recursive: true});
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {entries: {tag: string}[]};
  const upTo = journal.entries.findIndex(entry => entry.tag.endsWith('_news'));
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
  sqlite.prepare(`insert into jobs (kind, key, state, run_at, created_at) values ('sync', 'sync:1', 'queued', '${AT}', '${AT}')`).run();

  migrate(db, {migrationsFolder: MIGRATIONS});

  expect(sqlite.prepare('select kind, key, state, news_source_id from jobs').all()).toEqual([{kind: 'sync', key: 'sync:1', state: 'queued', news_source_id: null}]);
  sqlite.prepare(`insert into news_sources (key, name, section, kind, adapter, url, reads, origin, interval_seconds, position, created_at)
    values ('npr-national', 'NPR', 'general', 'feed', 'feed', 'https://npr.example/feed', 'Feed', 'default', 900, 0, '${AT}')`).run();
  sqlite.prepare(`insert into jobs (kind, key, news_source_id, run_at, created_at) values ('news', 'news:1', 1, '${AT}', '${AT}')`).run();
  expect(() => sqlite.prepare(`insert into jobs (kind, key, run_at, created_at) values ('fetch', 'fetch:1', '${AT}', '${AT}')`).run()).toThrow(/CHECK/);
  sqlite.prepare('delete from news_sources').run();
  expect(sqlite.prepare(`select count(*) as n from jobs where kind = 'news'`).get()).toEqual({n: 0});
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
});
