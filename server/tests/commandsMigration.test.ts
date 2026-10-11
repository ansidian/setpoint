// The commands table's rebuilds for a new target and kind, each over a database at the migration
// before it holding a command with its job: 0009_calendar_colour (SV-20) and
// 0013_todoist_project_colour (SV-25, which rebuilds todoist_projects too). Both keep the command
// and its job, and the job still belongs to its command (deleting the command takes the job with it).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {migrate} from 'drizzle-orm/better-sqlite3/migrator';
import {expect, onTestFinished, test} from 'vitest';

const MIGRATIONS = fileURLToPath(new URL('../drizzle', import.meta.url));

test.each(['_calendar_colour', '_todoist_project_colour'])('%s applies over a database a migration earlier with a pending command and its job', tag => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setpoint-migration-'));
  onTestFinished(() => fs.rmSync(dir, {recursive: true, force: true}));
  const before = path.join(dir, 'before');
  fs.mkdirSync(path.join(before, 'meta'), {recursive: true});
  const journal = JSON.parse(fs.readFileSync(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as {entries: {tag: string}[]};
  const upTo = journal.entries.findIndex(entry => entry.tag.endsWith(tag));
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
  const at = '2026-10-07T16:00:00.000Z';
  sqlite.prepare(`insert into commands (target, target_id, kind, payload, created_at) values ('item', 7, 'item_update', '{}', ?)`).run(at);
  sqlite.prepare(`insert into jobs (kind, key, command_id, run_at, created_at) values ('command', 'command:1', 1, ?, ?)`).run(at, at);
  sqlite.prepare(`insert into jobs (kind, key, run_at, created_at) values ('sync', 'sync:1', ?, ?)`).run(at, at);
  sqlite.prepare(`insert into todoist_projects (provider_id, name, position, inbox) values ('p-home', 'Home', 1, 0), ('inbox', 'Inbox', 0, 1)`).run();

  migrate(db, {migrationsFolder: MIGRATIONS});

  expect(sqlite.prepare('select id, target, kind, state from commands').all()).toEqual([{id: 1, target: 'item', kind: 'item_update', state: 'pending'}]);
  expect(sqlite.prepare('select kind, key, command_id from jobs order by id').all()).toEqual([
    {kind: 'command', key: 'command:1', command_id: 1}, {kind: 'sync', key: 'sync:1', command_id: null},
  ]);
  sqlite.prepare(`insert into commands (target, target_id, kind, payload, created_at) values ('calendar', 3, 'calendar_colour', '{"colour":"violet"}', ?)`).run(at);
  // Still one active command per target.
  expect(() => sqlite.prepare(`insert into commands (target, target_id, kind, payload, created_at) values ('calendar', 3, 'calendar_colour', '{}', ?)`).run(at)).toThrow(/UNIQUE/);
  sqlite.prepare('delete from commands where id = 1').run();
  expect(sqlite.prepare(`select count(*) as n from jobs where kind = 'command'`).get()).toEqual({n: 0});
  expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  // SV-25: each project numbered, in Todoist's order, with no colour until the full sync 0014 brings.
  expect(sqlite.prepare('select id, provider_id, name, inbox, colour from todoist_projects order by id').all()).toEqual([
    {id: 1, provider_id: 'inbox', name: 'Inbox', inbox: 1, colour: null}, {id: 2, provider_id: 'p-home', name: 'Home', inbox: 0, colour: null},
  ]);
  sqlite.prepare(`insert into commands (target, target_id, kind, payload, created_at) values ('project', 2, 'project_colour', '{"colour":"teal"}', ?)`).run(at);
});
