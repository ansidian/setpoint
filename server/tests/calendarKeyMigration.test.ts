// Migration 0012_calendar_per_account over a database at 0011 holding calendars, their items and a
// push channel (SV-9): only the indexes change, so nothing is lost, and afterwards a Google
// calendar id may repeat across accounts while Todoist's calendar stays the only one.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {expect, onTestFinished, test} from 'vitest';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

test('0012_calendar_per_account applies over a database at 0011 with calendars, items and a channel', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-migration-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  const before = path.join(dir, 'before');
  fs.mkdirSync(path.join(before, 'meta'), {recursive: true});
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {entries: {tag: string}[]};
  const upTo = journal.entries.findIndex(entry => entry.tag.endsWith('_calendar_per_account'));
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
  const at = '2026-10-08T16:00:00.000Z';
  const account = sqlite.prepare(`insert into accounts (provider, label, address, colour, icon, position, created_at) values ('gmail', ?, ?, ?, 'person', ?, ?)`);
  account.run('Personal', 'user@example.com', 'cool', 0, at);
  account.run('Work', 'user@example.net', 'warm', 1, at);
  sqlite.prepare(`insert into sources (provider, account_id, sync_mode, interval_seconds, created_at) values ('google_calendar', 1, 'push', 900, ?)`).run(at);
  const calendar = sqlite.prepare('insert into calendars (provider, provider_id, account_id, name, colour, position) values (?, ?, ?, ?, ?, ?)');
  calendar.run('google', 'user@example.com', 1, 'Personal', 'cool', 0);
  calendar.run('todoist', 'todoist', null, 'Todoist', null, 1);
  sqlite.prepare(`insert into items (calendar_id, provider_id, kind, title, all_day, start_date, end_date) values (1, 'columbus', 'event', 'Columbus Day', 1, '2026-10-12', '2026-10-13')`).run();
  sqlite.prepare(`insert into items (calendar_id, provider_id, kind, title, all_day, due_date) values (2, 'task-1', 'task', 'Laundry', 1, '2026-10-10')`).run();
  sqlite.prepare(`insert into calendar_channels (id, source_id, calendar_id, address, token_hash, state, expires_at, created_at) values ('channel-1', 1, 1, 'https://setpoint.example.com/api/calendar/push', ?, 'active', ?, ?)`).run('0'.repeat(64), '2026-10-15T16:00:00.000Z', at);

  migrate(db, {migrationsFolder: MIGRATIONS});

  expect(sqlite.prepare('select id, provider, provider_id, account_id from calendars order by id').all()).toEqual([
    {id: 1, provider: 'google', provider_id: 'user@example.com', account_id: 1}, {id: 2, provider: 'todoist', provider_id: 'todoist', account_id: null},
  ]);
  expect(sqlite.prepare('select calendar_id, provider_id from items order by id').all()).toEqual([{calendar_id: 1, provider_id: 'columbus'}, {calendar_id: 2, provider_id: 'task-1'}]);
  expect(sqlite.prepare('select id, calendar_id, state from calendar_channels').all()).toEqual([{id: 'channel-1', calendar_id: 1, state: 'active'}]);
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);

  // The same Google calendar on Work's list too; still once per account, and one Todoist.
  calendar.run('google', 'user@example.com', 2, 'Personal', 'cool', 2);
  expect(() => calendar.run('google', 'user@example.com', 2, 'Personal', 'cool', 3)).toThrow(/UNIQUE/);
  expect(() => calendar.run('todoist', 'todoist', null, 'Todoist', null, 3)).toThrow(/UNIQUE/);
});
