// Migration 0019_task_without_date over a database at 0018 (SV-74): the items table's rebuild keeps
// every row, a completed occurrence's tombstone and Time to Leave's routes included, and afterwards
// a task may have no date (while its create waits) but not a time without one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {expect, onTestFinished, test} from 'vitest';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

test('0019_task_without_date applies over a database at 0018 with tasks, a tombstone and a route', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-migration-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  const before = path.join(dir, 'before');
  fs.mkdirSync(path.join(before, 'meta'), {recursive: true});
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {entries: {tag: string}[]};
  const upTo = journal.entries.findIndex(entry => entry.tag.endsWith('_task_without_date'));
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
  sqlite.prepare(`insert into calendars (provider, provider_id, account_id, name, colour, position) values ('todoist', 'todoist', null, 'Todoist', null, 0)`).run();
  sqlite.prepare(`insert into calendars (provider, provider_id, account_id, name, colour, position) values ('google', 'user@example.com', null, 'Personal', 'cool', 1)`).run();
  const item = sqlite.prepare(`insert into items (calendar_id, provider_id, kind, title, all_day, due_date, starts_at, ends_at, due_recurring, recurring_item_id, original_start, done_at)
    values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  item.run(1, 't-plants', 'task', 'Water plants', 1, '2026-10-14', null, null, 1, null, null, null);
  item.run(1, 't-plants@2026-10-07', 'task', 'Water plants', 1, '2026-10-07', null, null, 1, 1, '2026-10-07', '2026-10-07T17:00:00.000Z');
  item.run(2, 'dentist', 'event', 'Dentist', 0, null, '2026-10-15T21:30:00.000Z', '2026-10-15T22:30:00.000Z', 0, null, null, null);
  sqlite.prepare(`insert into travel_estimates (item_id, occurrence_start, inputs, duration_seconds) values (3, '2026-10-15T21:30:00.000Z', 'home|dentist', 1080)`).run();

  migrate(db, {migrationsFolder: MIGRATIONS});

  expect(sqlite.prepare('select id, provider_id, recurring_item_id, done_at from items order by id').all()).toEqual([
    {id: 1, provider_id: 't-plants', recurring_item_id: null, done_at: null},
    {id: 2, provider_id: 't-plants@2026-10-07', recurring_item_id: 1, done_at: '2026-10-07T17:00:00.000Z'},
    {id: 3, provider_id: 'dentist', recurring_item_id: null, done_at: null},
  ]);
  expect(sqlite.prepare('select item_id, duration_seconds from travel_estimates').all()).toEqual([{item_id: 3, duration_seconds: 1080}]);
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);

  // A task with no date while its create waits; not a time without a day.
  item.run(1, 'local-1', 'task', 'Learn guitar', 1, null, null, null, 0, null, null, null);
  expect(() => sqlite.prepare(`insert into items (calendar_id, provider_id, kind, title, all_day, due_at) values (1, 'local-2', 'task', 'Call', 1, '2026-10-15T16:00:00.000Z')`).run()).toThrow(/CHECK/);
  // The new id goes on from the last one, and a series' tombstones still go with it.
  expect(sqlite.prepare(`select id from items where provider_id = 'local-1'`).get()).toEqual({id: 4});
  sqlite.prepare('delete from items where id = 1').run();
  expect(sqlite.prepare('select id from items order by id').all()).toEqual([{id: 3}, {id: 4}]);
});
