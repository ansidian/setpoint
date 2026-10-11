// SV-25: 0013 gave Todoist's projects a colour column, but Todoist is polled incrementally and a
// project only comes back from its sync when it changes, so the projects already mirrored would
// never get theirs. 0014 drops Todoist's sync cursor once, making its next poll a full sync; its
// completed-list cursor and every other source's cursor stay.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {expect, onTestFinished, test} from 'vitest';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

test('the migration after 0013 makes Todoist\'s next poll a full sync, keeping every other cursor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-migration-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  const before = path.join(dir, 'before');
  fs.mkdirSync(path.join(before, 'meta'), {recursive: true});
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {entries: {tag: string}[]};
  journal.entries = journal.entries.slice(0, journal.entries.findIndex(entry => entry.tag.endsWith('_todoist_project_colour')) + 1);
  fs.writeFileSync(path.join(before, 'meta/_journal.json'), JSON.stringify(journal));
  for (const entry of journal.entries) fs.copyFileSync(path.join(MIGRATIONS, `${entry.tag}.sql`), path.join(before, `${entry.tag}.sql`));

  const sqlite = new Database(path.join(dir, 'setpoint.sqlite'));
  onTestFinished(() => {
    sqlite.close();
  });
  const db = drizzle(sqlite);
  migrate(db, {migrationsFolder: before});
  const at = '2026-10-09T19:00:00.000Z';
  const source = sqlite.prepare(`insert into sources (provider, sync_mode, interval_seconds, created_at) values (?, 'poll', 300, ?)`);
  source.run('todoist', at);
  source.run('weather', at);
  const cursor = sqlite.prepare(`insert into sync_cursors (source_id, scope, cursor, updated_at) values (?, ?, ?, ?)`);
  cursor.run(1, '', 'todoist-token', at);
  cursor.run(1, 'completed', 'completed-token', at);
  cursor.run(2, '', 'weather-token', at);

  migrate(db, {migrationsFolder: MIGRATIONS});

  expect(sqlite.prepare('select source_id, scope, cursor from sync_cursors order by source_id, scope').all()).toEqual([
    {source_id: 1, scope: 'completed', cursor: 'completed-token'}, {source_id: 2, scope: '', cursor: 'weather-token'},
  ]);
});
